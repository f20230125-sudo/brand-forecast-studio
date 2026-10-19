"""Pipeline health: checks that run after every refresh, each with a status a reviewer can act on.

    python -m bf.health          (writes data/marts/health.csv and prints it)

Statuses: pass, warn (look at it before the forecast is shared), fail (do not share), info (context).
Thresholds are written next to each check.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np
import pandas as pd

from bf.model import HORIZONS, load_panel, qindex, qlabel, wide

ROOT = Path(__file__).resolve().parents[2]
MARTS = ROOT / "data" / "marts"
TOTALS = ROOT / "data" / "ref" / "source_totals.csv"
EXPECTED_LATEST = (2025, 4)  # CMS publishes a quarter about four months after it ends


def psi(a: np.ndarray, b: np.ndarray, bins: int = 10) -> float:
    """Population stability index of b against a, on a's deciles."""
    a, b = a[np.isfinite(a)], b[np.isfinite(b)]
    edges = np.unique(np.quantile(a, np.linspace(0, 1, bins + 1)))
    edges[0], edges[-1] = -np.inf, np.inf
    pa = np.histogram(a, edges)[0] / len(a)
    pb = np.histogram(b, edges)[0] / len(b)
    pa, pb = np.clip(pa, 1e-4, None), np.clip(pb, 1e-4, None)
    return float(np.sum((pb - pa) * np.log(pb / pa)))


def checks() -> list[dict]:
    out: list[dict] = []

    def add(cid: str, name: str, status: str, result: str, rule: str) -> None:
        out.append({"id": cid, "check": name, "status": status, "result": result, "rule": rule})

    df = load_panel()
    units, spend, price = wide(df)
    msd = sorted(df[df.owner == "Merck (MSD)"].brand.unique())
    latest = int(units.columns.max())

    # Source and freshness
    add("H01", "Latest quarter loaded", "pass" if latest >= qindex(*EXPECTED_LATEST) else "fail", qlabel(latest), f"at least {EXPECTED_LATEST[0]}Q{EXPECTED_LATEST[1]}")
    tot = pd.read_csv(TOTALS)
    tot["t"] = [qindex(y, q) for y, q in zip(tot.year, tot.quarter)]
    panel_q = df.groupby("t").spend.sum()
    share = (panel_q / tot.set_index("t").brand_spend).dropna()
    over = (share > 1.0000001).sum()
    add("H02", "Extract never exceeds the source", "pass" if over == 0 else "fail", f"{over} quarters above 100%", "panel spend <= source brand spend, every quarter")
    add("H03", "Share of brand spend the panel covers", "info", f"{share.min():.1%} to {share.max():.1%} by quarter", "brands >= $20M in 2025, MSD >= $2M")
    neg = int((df.units < 0).sum() + (df.spend < 0).sum())
    add("H04", "No negative units or spend", "pass" if neg == 0 else "fail", f"{neg} rows", "0")

    # MSD series
    gaps = []
    for b in msd:
        row = units.loc[b]
        life = row[row.index >= row.first_valid_index()]
        if life.isna().any():
            gaps.append(b)
    add("H05", "Every MSD brand has an unbroken series", "pass" if not gaps else "warn", f"{len(msd)} brands, gaps: {', '.join(gaps) or 'none'}", "no missing quarter after launch")
    zero_latest = [b for b in msd if units.loc[b].get(latest, 0) == 0]
    add("H06", "Every MSD brand sold in the latest quarter", "pass" if not zero_latest else "warn", ", ".join(zero_latest) or "all sold", "units > 0 in the latest quarter")
    jumps = []
    for b in msd:
        g = np.log1p(units.loc[b].dropna()).diff().dropna()
        if len(g) >= 8:
            z = (g.iloc[-1] - g.iloc[:-1].mean()) / (g.iloc[:-1].std() or 1)
            if abs(z) > 3:
                jumps.append(f"{b} (z {z:+.1f})")
    add("H07", "Latest volume change is within the brand's normal range", "pass" if not jumps else "warn", ", ".join(jumps) or "none outside", "|z| <= 3 for the latest quarter-on-quarter change")
    pj = []
    for b in msd:
        p = price.loc[b].dropna()
        if len(p) >= 2 and p.iloc[-2] > 0 and abs(math.log(p.iloc[-1] / p.iloc[-2])) > 0.25:
            pj.append(f"{b} ({p.iloc[-1] / p.iloc[-2] - 1:+.0%})")
    add("H08", "Latest price per unit moved less than 25%", "pass" if not pj else "warn", ", ".join(pj) or "none", "|change| <= 25% quarter on quarter")

    # Drift between the training years and the latest year
    g_all = np.log1p(units).T.diff().T
    early = g_all.loc[:, [c for c in g_all.columns if c < qindex(2024, 1)]].to_numpy().ravel()
    late = g_all.loc[:, [c for c in g_all.columns if c >= qindex(2025, 1)]].to_numpy().ravel()
    d = psi(early, late)
    add("H09", "Feature drift: quarter-on-quarter growth, 2025 vs 2019-2023", "pass" if d < 0.1 else ("warn" if d < 0.25 else "fail"), f"PSI {d:.3f}", "PSI < 0.10 pass, < 0.25 warn")

    # Model quality, from the backtest
    s = pd.read_csv(MARTS / "backtest_summary.csv")
    m = s[(s.scope == "MSD brands") & (s.horizon == "all")].iloc[0]
    best_base = min(m.naive, m.seasonal_naive, m.drift)
    add("H10", "Model beats the best baseline on MSD brands", "pass" if m.model < best_base else "warn", f"WAPE {m.model:.1%} vs {best_base:.1%}", "model WAPE below every baseline")
    bb = pd.read_csv(MARTS / "backtest_by_brand.csv")
    worse = bb[bb.model > bb.naive].brand.tolist()
    add("H11", "Brands where the model loses to last-quarter's value", "info" if len(worse) <= len(bb) // 3 else "warn", f"{len(worse)} of {len(bb)}: {', '.join(worse) or 'none'}", "flag for review; more than a third is a warn")
    cal = pd.read_csv(MARTS / "calibration.csv")
    c = cal[(cal.scope == "MSD brands") & (cal.horizon == "all")].iloc[0]
    cov = float(c.coverage_calibrated)
    add("H12", "Calibrated P10-P90 range holds the actual about 80% of the time", "pass" if 0.7 <= cov <= 0.9 else "warn",
        f"{cov:.0%} on {int(c.n)} MSD forecasts the calibration had not seen ({float(c.coverage_raw):.0%} before)", "between 70% and 90%")

    # The forecast itself
    fc = pd.read_csv(MARTS / "forecast_2026.csv")
    last_year = spend.loc[:, [c for c in spend.columns if c >= qindex(2025, 1)]].sum(axis=1)
    odd = []
    for b, d2 in fc.groupby("brand"):
        if len(d2) == len(HORIZONS) and last_year.get(b, 0) > 0:
            r = d2.spend_p50.sum() / last_year[b] - 1
            if abs(r) > 0.6:
                odd.append(f"{b} ({r:+.0%})")
    add("H13", "2026 forecast within 60% of 2025 spend", "pass" if not odd else "warn", ", ".join(odd) or "all within", "|2026 / 2025 - 1| <= 60%; launches and losses of exclusivity explain most exceptions")
    missing_fc = sorted(set(msd) - set(fc.brand))
    add("H14", "A forecast for every MSD brand", "pass" if not missing_fc else "fail", ", ".join(missing_fc) or f"{fc.brand.nunique()} brands", "every MSD brand in the panel")
    return out


def main() -> list[dict]:
    rows = checks()
    MARTS.mkdir(parents=True, exist_ok=True)
    with (MARTS / "health.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(f"{r['id']} {r['status']:5} {r['check']}: {r['result']}")
    return rows


if __name__ == "__main__":
    main()
