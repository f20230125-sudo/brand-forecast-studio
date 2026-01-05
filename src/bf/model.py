"""Quarterly brand forecasts: one global LightGBM model across all brands, tested against simple baselines.

    python -m bf.model          (backtest, then the 2026 forecast; writes data/marts/*.csv)

Volume and price are forecast separately, as a commercial team plans them: units come from the model (or
a baseline), and price per unit follows the brand's own recent price drift, the same for every method so
that the comparison is about volume. Spend = units x price.

Backtest: rolling origins from 2023 Q4 to 2025 Q3. For each origin the model is trained only on examples
whose target quarter is at or before that origin, then forecasts one to four quarters ahead. Nothing is
tuned on the test quarters: the features and settings below were fixed before the first backtest ran.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
PANEL = ROOT / "data" / "ref" / "brand_quarter.csv"
MARTS = ROOT / "data" / "marts"

HORIZONS = (1, 2, 3, 4)
FIRST_ORIGIN = (2023, 4)
LAST_ORIGIN = (2025, 3)
FEATURES = ["lag0", "lag1", "lag2", "lag3", "g1", "g4", "mean4", "age", "h", "target_q", "price_g4", "area_code"]
PARAMS = dict(n_estimators=400, learning_rate=0.03, num_leaves=15, min_child_samples=20, subsample=0.8, subsample_freq=1, colsample_bytree=0.9, random_state=7, verbose=-1)

warnings.filterwarnings("ignore", category=UserWarning)


def qindex(year: int, quarter: int) -> int:
    return (year - 2019) * 4 + (quarter - 1)


def qlabel(t: int) -> str:
    return f"{2019 + t // 4}Q{t % 4 + 1}"


def load_panel() -> pd.DataFrame:
    df = pd.read_csv(PANEL, keep_default_na=False)
    df["t"] = [qindex(y, q) for y, q in zip(df.year, df.quarter)]
    df["units"] = df["units"].astype(float).clip(lower=0)
    df["spend"] = df["spend"].astype(float).clip(lower=0)
    df["price"] = np.where(df.units > 0, df.spend / df.units.where(df.units > 0, 1), np.nan)
    return df


def wide(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Brand x quarter tables of units, spend and price. A quarter inside a brand's life with no rows is 0 units."""
    units = df.pivot_table(index="brand", columns="t", values="units", aggfunc="sum")
    spend = df.pivot_table(index="brand", columns="t", values="spend", aggfunc="sum")
    first = units.notna().idxmax(axis=1)
    for b, t0 in first.items():
        units.loc[b, units.columns[units.columns >= t0]] = units.loc[b, units.columns[units.columns >= t0]].fillna(0)
        spend.loc[b, spend.columns[spend.columns >= t0]] = spend.loc[b, spend.columns[spend.columns >= t0]].fillna(0)
    price = spend / units.where(units > 0)
    return units, spend, price


@dataclass
class Info:
    area: dict[str, str]
    owner: dict[str, str]
    bu: dict[str, str]
    area_code: dict[str, int]


def info(df: pd.DataFrame) -> Info:
    first = df.sort_values("t").groupby("brand").first()
    areas = sorted(first["area"].unique())
    return Info(first["area"].to_dict(), first["owner"].to_dict(), first["bu"].to_dict(), {a: i for i, a in enumerate(areas)})


def ly(x: float) -> float:
    return math.log1p(max(x, 0.0)) if x == x else float("nan")


def features(units: pd.DataFrame, price: pd.DataFrame, inf: Info, brand: str, t: int, h: int) -> dict | None:
    row = units.loc[brand]
    if t not in row.index or not (row.get(t) == row.get(t)):
        return None
    hist = [row.get(t - k, np.nan) for k in range(0, 5)]
    y = [ly(v) if v == v else np.nan for v in hist]
    first_t = int(row.first_valid_index())
    pr = price.loc[brand]
    p0, p4 = pr.get(t, np.nan), pr.get(t - 4, np.nan)
    return {
        "lag0": y[0], "lag1": y[1], "lag2": y[2], "lag3": y[3],
        "g1": y[0] - y[1] if y[1] == y[1] else np.nan,
        "g4": y[0] - y[4] if y[4] == y[4] else np.nan,
        "mean4": float(np.nanmean(y[:4])),
        "age": t - first_t,
        "h": h,
        "target_q": (t + h) % 4 + 1,
        "price_g4": math.log(p0 / p4) if (p0 == p0 and p4 == p4 and p0 > 0 and p4 > 0) else np.nan,
        "area_code": inf.area_code.get(inf.area[brand], -1),
    }


def examples(units: pd.DataFrame, price: pd.DataFrame, inf: Info, max_target_t: int) -> pd.DataFrame:
    out = []
    last = int(units.columns.max())
    for b in units.index:
        for t in units.columns:
            t = int(t)
            for h in HORIZONS:
                if t + h > min(max_target_t, last):
                    continue
                f = features(units, price, inf, b, t, h)
                target = units.loc[b].get(t + h, np.nan)
                if f is None or not (target == target):
                    continue
                f.update(brand=b, t=t, target=ly(target) - f["lag0"])
                out.append(f)
    return pd.DataFrame(out)


def price_path(price: pd.DataFrame, brand: str, t: int, h: int) -> float:
    """Last observed price per unit, carried forward at the brand's average quarterly price change over the last year."""
    pr = price.loc[brand]
    p0 = pr.get(t, np.nan)
    if not (p0 == p0):
        prior = pr[pr.index <= t].dropna()
        p0 = prior.iloc[-1] if len(prior) else np.nan
    p4 = pr.get(t - 4, np.nan)
    drift = math.log(p0 / p4) / 4 if (p4 == p4 and p0 == p0 and p0 > 0 and p4 > 0) else 0.0
    drift = max(min(drift, 0.05), -0.05)  # no more than about 5% a quarter either way
    return p0 * math.exp(drift * h)


def baselines(units: pd.DataFrame, brand: str, t: int, h: int) -> dict[str, float]:
    row = units.loc[brand]
    u0 = row.get(t, np.nan)
    seas = row.get(t + h - 4, np.nan)
    if h > 4 or not (seas == seas):
        seas = u0
    u4 = row.get(t - 4, np.nan)
    g = (math.log1p(u0) - math.log1p(u4)) / 4 if u4 == u4 else 0.0
    # A brand a year after launch can grow tenfold; carried forward unchecked that is not a forecast anyone would
    # use, so the drift baseline is capped at about 25% a quarter either way.
    g = max(min(g, 0.22), -0.22)
    return {"naive": u0, "seasonal_naive": seas, "drift": math.expm1(math.log1p(u0) + g * h)}


def fit(train: pd.DataFrame) -> dict[str, lgb.LGBMRegressor]:
    x, y = train[FEATURES], train["target"]
    models = {"p50": lgb.LGBMRegressor(objective="regression_l1", **PARAMS).fit(x, y)}
    for name, a in (("p10", 0.1), ("p90", 0.9)):
        models[name] = lgb.LGBMRegressor(objective="quantile", alpha=a, **PARAMS).fit(x, y)
    return models


def predict_units(models, f: dict) -> dict[str, float]:
    x = pd.DataFrame([f])[FEATURES]
    base = f["lag0"]
    out = {k: math.expm1(base + float(m.predict(x)[0])) for k, m in models.items()}
    lo, mid, hi = sorted([out["p10"], out["p50"], out["p90"]])
    return {"p10": max(lo, 0.0), "p50": max(mid, 0.0), "p90": max(hi, 0.0)}


def backtest(units, spend, price, inf) -> pd.DataFrame:
    rows = []
    for t in range(qindex(*FIRST_ORIGIN), qindex(*LAST_ORIGIN) + 1):
        models = fit(examples(units, price, inf, max_target_t=t))
        for b in units.index:
            for h in HORIZONS:
                actual = spend.loc[b].get(t + h, np.nan)
                f = features(units, price, inf, b, t, h)
                if f is None or not (actual == actual):
                    continue
                p = price_path(price, b, t, h)
                if not (p == p):
                    continue
                pu = predict_units(models, f)
                base = baselines(units, b, t, h)
                rows.append({
                    "brand": b, "owner": inf.owner[b], "bu": inf.bu.get(b, ""), "origin": qlabel(t), "target": qlabel(t + h), "h": h,
                    "actual": actual, "model": pu["p50"] * p, "p10": pu["p10"] * p, "p90": pu["p90"] * p,
                    **{k: v * p for k, v in base.items()},
                })
        print(f"origin {qlabel(t)}: {len(rows):,} forecasts so far")
    return pd.DataFrame(rows)


def wape(actual: pd.Series, pred: pd.Series) -> float:
    return float((actual - pred).abs().sum() / actual.abs().sum()) if actual.abs().sum() > 0 else float("nan")


METHODS = ["model", "naive", "seasonal_naive", "drift"]


def summarise(bt: pd.DataFrame) -> pd.DataFrame:
    rows = []
    msd = bt[bt.owner == "Merck (MSD)"]
    for scope, d in (("All brands", bt), ("MSD brands", msd)):
        for h in (0, *HORIZONS):
            dd = d if h == 0 else d[d.h == h]
            r = {"scope": scope, "horizon": "all" if h == 0 else str(h), "n": len(dd)}
            for m in METHODS:
                r[m] = wape(dd.actual, dd[m])
            r["interval_coverage"] = float(((dd.actual >= dd.p10) & (dd.actual <= dd.p90)).mean()) if len(dd) else float("nan")
            rows.append(r)
    return pd.DataFrame(rows)


def by_brand(bt: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for b, d in bt[bt.owner == "Merck (MSD)"].groupby("brand"):
        r = {"brand": b, "bu": d.bu.iloc[0], "n": len(d)}
        for m in METHODS:
            r[m] = wape(d.actual, d[m])
        r["best"] = min(METHODS, key=lambda m: r[m])
        rows.append(r)
    return pd.DataFrame(rows).sort_values(["bu", "brand"])


def forecast(units, spend, price, inf) -> pd.DataFrame:
    t = int(units.columns.max())
    models = fit(examples(units, price, inf, max_target_t=t))
    rows = []
    for b in units.index:
        if inf.owner[b] != "Merck (MSD)":
            continue
        for h in HORIZONS:
            f = features(units, price, inf, b, t, h)
            if f is None:
                continue
            p = price_path(price, b, t, h)
            pu = predict_units(models, f)
            rows.append({"brand": b, "bu": inf.bu.get(b, ""), "quarter": qlabel(t + h), "h": h, "price": p,
                         "units_p50": pu["p50"], "units_p10": pu["p10"], "units_p90": pu["p90"],
                         "spend_p50": pu["p50"] * p, "spend_p10": pu["p10"] * p, "spend_p90": pu["p90"] * p})
    return pd.DataFrame(rows)


def main() -> None:
    df = load_panel()
    units, spend, price = wide(df)
    inf = info(df)
    MARTS.mkdir(parents=True, exist_ok=True)
    bt = backtest(units, spend, price, inf)
    bt.to_csv(MARTS / "backtest.csv", index=False)
    s = summarise(bt)
    s.to_csv(MARTS / "backtest_summary.csv", index=False)
    by_brand(bt).to_csv(MARTS / "backtest_by_brand.csv", index=False)
    fc = forecast(units, spend, price, inf)
    fc.to_csv(MARTS / "forecast_2026.csv", index=False)
    print(s.to_string(index=False, float_format=lambda v: f"{v:.3f}"))


if __name__ == "__main__":
    main()
