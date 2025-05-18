"""Writes the small JSON files the web interface reads, and a scenario fixture that holds the web's arithmetic to Python's.

    python -m bf.export_json      (writes site/public/data/*.json and site/tests/fixtures/scenarios.json)
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd

from bf import model, scenario

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "public" / "data"
FIXTURE = ROOT / "site" / "tests" / "fixtures" / "scenarios.json"


def r(x: float, n: int = 2) -> float:
    return round(float(x), n)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = model.load_panel()
    msd = df[df.owner == "Merck (MSD)"]
    fc = pd.read_csv(model.MARTS / "forecast_2026.csv", keep_default_na=False)
    brands = []
    for b, d in msd.groupby("brand"):
        d = d.sort_values("t")
        f = fc[fc.brand == b].sort_values("h")
        brands.append({
            "brand": b,
            "bu": d.bu.iloc[0],
            "area": d.area.iloc[0],
            "history": [{"q": model.qlabel(int(t)), "spend": r(s), "units": r(u, 1)} for t, s, u in zip(d.t, d.spend, d.units)],
            "forecast": [{"q": x.quarter, "price": r(x.price, 4), "units": r(x.units_p50, 1), "p10": r(x.spend_p10), "p50": r(x.spend_p50), "p90": r(x.spend_p90)} for x in f.itertuples()],
        })
    (OUT / "brands.json").write_text(json.dumps(brands, separators=(",", ":")), encoding="utf-8")

    s = pd.read_csv(model.MARTS / "backtest_summary.csv")
    bb = pd.read_csv(model.MARTS / "backtest_by_brand.csv", keep_default_na=False)
    h = pd.read_csv(model.MARTS / "health.csv", keep_default_na=False)
    cal = pd.read_csv(model.MARTS / "calibration.csv", dtype={"horizon": str})
    imp = pd.read_csv(model.MARTS / "feature_importance.csv")
    (OUT / "backtest.json").write_text(json.dumps({
        "summary": [{k: (r(v, 4) if isinstance(v, float) else v) for k, v in row.items()} for row in s.to_dict("records")],
        "byBrand": [{k: (r(v, 4) if isinstance(v, float) else v) for k, v in row.items()} for row in bb.to_dict("records")],
        "origins": [f"{model.FIRST_ORIGIN[0]}Q{model.FIRST_ORIGIN[1]}", f"{model.LAST_ORIGIN[0]}Q{model.LAST_ORIGIN[1]}"],
        "calibration": [{k: (None if v != v else r(v, 4)) if isinstance(v, float) else v for k, v in row.items()} for row in cal.to_dict("records")],
        "importance": [{"feature": x.feature, "share": r(x.gain_share, 4)} for x in imp.itertuples()],
    }, separators=(",", ":")), encoding="utf-8")
    (OUT / "health.json").write_text(json.dumps(h.to_dict("records"), separators=(",", ":")), encoding="utf-8")
    (OUT / "meta.json").write_text(json.dumps({
        "built": date.today().isoformat(),
        "retention": {str(k): v for k, v in scenario.retention().items()},
        "panelBrands": int(df.brand.nunique()),
        "panelRows": int(len(df)),
        "lastQuarter": model.qlabel(int(df.t.max())),
    }, separators=(",", ":")), encoding="utf-8")

    # Scenarios run in Python; the web runs the same ones and must land on the same numbers.
    cases = [
        dict(brand="JANUVIA"),
        dict(brand="JANUVIA", price_change_pct=-5, generic_entry_quarter="2026Q3"),
        dict(brand="KEYTRUDA", price_change_pct=3, volume_change_pct=8, start_quarter="2026Q2"),
        dict(brand="WINREVAIR", volume_change_pct=-20),
        dict(brand="ISENTRESS", price_change_pct=-10, volume_change_pct=5, generic_entry_quarter="2026Q1"),
    ]
    fixture = []
    for c in cases:
        res = scenario.run(scenario.Scenario(**c))
        fixture.append({"input": res.scenario.model_dump(), "quarters": [{"quarter": q.quarter, "spend": q.spend, "price_effect": q.price_effect, "volume_effect": q.volume_effect} for q in res.quarters], "delta_total": res.delta_total})
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(fixture, indent=1), encoding="utf-8")
    print(f"wrote {len(brands)} brands, backtest, health, meta and {len(fixture)} scenario cases")


if __name__ == "__main__":
    main()
