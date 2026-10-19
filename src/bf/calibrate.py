"""Calibrate the P10-P90 range so it holds the actual about 80% of the time (conformalised quantile regression).

    python -m bf.calibrate      (after bf.model; writes data/marts/calibration.csv and calibrates forecast_2026.csv)

The quantile models' P10-P90 band held the actual only 68% of the time in the backtest. For each forecast, the
band is widened (or narrowed) by Q, measured on earlier forecasts at the same horizon:

    E = max(log P10 - log actual, log actual - log P90)       how far outside the band an actual fell (negative = inside)
    Q = the ceil((n + 1) x 0.8) / n quantile of E over the n earlier forecasts whose target quarter was already known
    band = [P10 x exp(-Q), P90 x exp(Q)]

Q is measured separately for MSD's brands and for the other brands (a Mondrian split): MSD's brands miss more than
the average brand, and one pooled Q left their band too narrow (73% coverage); their own Q brings it to about 80%.

Honest test: Q for a forecast made at origin t uses only forecasts whose target quarter is at or before t, so the
coverage reported for origins from 2024 Q4 on is measured on quarters the calibration had not seen. A group needs at
least 50 earlier forecasts at that horizon before it is calibrated.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd

from bf.model import qindex

ROOT = Path(__file__).resolve().parents[2]
MARTS = ROOT / "data" / "marts"
TARGET = 0.8
TEST_FROM = (2024, 4)


def qt(label: str) -> int:
    return qindex(int(label[:4]), int(label[-1]))


def score(bt: pd.DataFrame) -> pd.Series:
    lo, hi, y = np.log(bt.p10.clip(lower=1)), np.log(bt.p90.clip(lower=1)), np.log(bt.actual.clip(lower=1))
    return np.maximum(lo - y, y - hi)


def q_level(e: np.ndarray) -> float:
    n = len(e)
    if n == 0:
        return 0.0
    k = min(1.0, math.ceil((n + 1) * TARGET) / n)
    return float(np.quantile(e, k, method="inverted_cdf"))  # the ceil((n + 1) x 0.8)-th smallest score


def calibrate_backtest(bt: pd.DataFrame) -> pd.DataFrame:
    bt = bt.copy()
    bt["o"] = bt.origin.map(qt)
    bt["tq"] = bt.target.map(qt)
    bt["e"] = score(bt)
    bt["msd"] = bt.owner == "Merck (MSD)"
    qs = []
    for o, h, m in zip(bt.o, bt.h, bt.msd):
        known = bt[(bt.tq <= o) & (bt.h == h) & (bt.msd == m)]
        qs.append(q_level(known.e.to_numpy()) if len(known) >= 50 else np.nan)
    bt["Q"] = qs
    bt["p10c"] = bt.p10 * np.exp(-bt.Q)
    bt["p90c"] = bt.p90 * np.exp(bt.Q)
    return bt


def coverage(d: pd.DataFrame, lo: str, hi: str) -> float:
    return float(((d.actual >= d[lo]) & (d.actual <= d[hi])).mean()) if len(d) else float("nan")


def main() -> None:
    bt = pd.read_csv(MARTS / "backtest.csv", keep_default_na=False)
    bt = calibrate_backtest(bt)
    test = bt[(bt.o >= qindex(*TEST_FROM)) & bt.Q.notna()]
    rows = []
    for scope, d in (("All brands", test), ("MSD brands", test[test.owner == "Merck (MSD)"])):
        for h in ("all", 1, 2, 3, 4):
            dd = d if h == "all" else d[d.h == h]
            width_raw = float(np.median(np.log(dd.p90.clip(lower=1)) - np.log(dd.p10.clip(lower=1)))) if len(dd) else float("nan")
            width_cal = float(np.median(np.log(dd.p90c.clip(lower=1)) - np.log(dd.p10c.clip(lower=1)))) if len(dd) else float("nan")
            rows.append({"scope": scope, "horizon": str(h), "n": len(dd), "coverage_raw": coverage(dd, "p10", "p90"), "coverage_calibrated": coverage(dd, "p10c", "p90c"),
                         "median_width_raw": math.expm1(width_raw), "median_width_calibrated": math.expm1(width_cal)})
    cal = pd.DataFrame(rows)
    cal.to_csv(MARTS / "calibration.csv", index=False)

    fc = pd.read_csv(MARTS / "forecast_2026.csv", keep_default_na=False)
    # The forecasts are all MSD brands: Q from every MSD backtest forecast at that horizon.
    q_by_h = {int(h): q_level(bt[(bt.h == h) & bt.msd].e.to_numpy()) for h in sorted(bt.h.unique())}
    if "spend_p10_raw" not in fc.columns:
        fc["spend_p10_raw"], fc["spend_p90_raw"] = fc.spend_p10, fc.spend_p90
    fc["q"] = fc.h.map(q_by_h)
    fc["spend_p10"] = fc.spend_p10_raw * np.exp(-fc.q)
    fc["spend_p90"] = fc.spend_p90_raw * np.exp(fc.q)
    fc.to_csv(MARTS / "forecast_2026.csv", index=False)
    print(cal.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print("Q by horizon:", {k: round(v, 3) for k, v in q_by_h.items()})


if __name__ == "__main__":
    main()
