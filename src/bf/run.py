"""Run the whole forecasting pipeline as one monitored job, and log the run.

    python -m bf.run            (model -> calibrate -> health -> export; appends a row to data/marts/run_log.csv)
    python -m bf.run --skip-backtest   (reuse the last backtest; refit the 2026 forecast only)

Each step is timed. The run log keeps, per run: when it ran, how long each step took, the rows and brands in the
panel, the latest quarter, accuracy (model and best baseline on MSD brands), calibrated coverage, and how many health
checks passed, need review or failed. A run whose health has a failure exits with an error, so a scheduler (a
GitHub Actions job, cron, Dataiku scenario) marks it failed and nothing downstream publishes it.
"""

from __future__ import annotations

import argparse
import csv
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from bf import calibrate, export_json, health, model

ROOT = Path(__file__).resolve().parents[2]
LOG = ROOT / "data" / "marts" / "run_log.csv"
FIELDS = ["run_at_utc", "backtest", "seconds_model", "seconds_calibrate", "seconds_health", "seconds_export", "panel_rows", "panel_brands", "latest_quarter",
          "msd_wape_model", "msd_wape_best_baseline", "msd_coverage_calibrated", "checks_pass", "checks_review", "checks_fail", "status"]


def timed(fn) -> float:
    t = time.perf_counter()
    fn()
    return round(time.perf_counter() - t, 1)


def refit_only() -> None:
    df = model.load_panel()
    units, spend, price = model.wide(df)
    fc = model.forecast(units, spend, price, model.info(df))
    fc.to_csv(model.MARTS / "forecast_2026.csv", index=False)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-backtest", action="store_true")
    a = ap.parse_args()
    row: dict = {"run_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), "backtest": "reused" if a.skip_backtest else "run"}
    row["seconds_model"] = timed(refit_only if a.skip_backtest else model.main)
    row["seconds_calibrate"] = timed(calibrate.main)
    checks: list[dict] = []
    row["seconds_health"] = timed(lambda: checks.extend(health.main()))
    row["seconds_export"] = timed(export_json.main)

    panel = model.load_panel()
    s = pd.read_csv(model.MARTS / "backtest_summary.csv")
    m = s[(s.scope == "MSD brands") & (s.horizon == "all")].iloc[0]
    cal = pd.read_csv(model.MARTS / "calibration.csv")
    c = cal[(cal.scope == "MSD brands") & (cal.horizon == "all")].iloc[0]
    row.update({
        "panel_rows": len(panel), "panel_brands": panel.brand.nunique(), "latest_quarter": model.qlabel(int(panel.t.max())),
        "msd_wape_model": round(float(m.model), 4), "msd_wape_best_baseline": round(float(min(m.naive, m.seasonal_naive, m.drift)), 4),
        "msd_coverage_calibrated": round(float(c.coverage_calibrated), 4),
        "checks_pass": sum(1 for x in checks if x["status"] == "pass"), "checks_review": sum(1 for x in checks if x["status"] == "warn"),
        "checks_fail": sum(1 for x in checks if x["status"] == "fail"),
    })
    row["status"] = "failed" if row["checks_fail"] else "ok"
    new = not LOG.exists()
    with LOG.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            w.writeheader()
        w.writerow(row)
    print(row)
    if row["checks_fail"]:
        raise SystemExit("health check failed: this run is not to be published")


if __name__ == "__main__":
    main()
