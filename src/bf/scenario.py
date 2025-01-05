"""What-if scenarios on top of the forecast: price, volume and a generic entry.

    python -m bf.scenario JANUVIA --price -5 --volume 3 --generic 2026Q3

A scenario is validated by Pydantic before anything is computed, so a misspelt brand, a quarter outside the
forecast or a price cut of more than 100% is refused with the reason, not silently turned into a number.

Spend = units x price. A price change moves price per unit from its start quarter onwards; a volume change
moves units. A generic entry applies the median brand retention measured in Rx Market Pulse across 48
molecules that lost exclusivity (brand spend relative to the quarter before entry). That curve is spend, so
it already holds the brand's price response; it is applied to units with price left as forecast.
"""

from __future__ import annotations

import argparse
import json
from functools import lru_cache
from pathlib import Path

import pandas as pd
from pydantic import BaseModel, Field, field_validator, model_validator

ROOT = Path(__file__).resolve().parents[2]
FORECAST = ROOT / "data" / "marts" / "forecast_2026.csv"
EROSION = ROOT / "data" / "ref" / "erosion_curve.csv"


@lru_cache(maxsize=1)
def forecast_table() -> pd.DataFrame:
    return pd.read_csv(FORECAST, keep_default_na=False)


@lru_cache(maxsize=1)
def retention() -> dict[int, float]:
    """Median share of pre-entry brand spend kept k quarters after the first generic, k = 0..8; the last value holds after."""
    e = pd.read_csv(EROSION)
    base = e[e.quarters_since_entry == -1].set_index("brand_family").brand_spend_index.rename("base")
    e = e.join(base, on="brand_family")
    e["rel"] = e.brand_spend_index / e.base
    med = e[e.quarters_since_entry.between(0, 8)].groupby("quarters_since_entry").rel.median()
    return {int(k): round(float(v), 4) for k, v in med.items()}


def quarters() -> list[str]:
    return sorted(forecast_table().quarter.unique())


class Scenario(BaseModel):
    brand: str
    price_change_pct: float = Field(0.0, ge=-90, le=100, description="Change to price per unit, in percent")
    volume_change_pct: float = Field(0.0, ge=-90, le=200, description="Change to units, in percent")
    start_quarter: str | None = Field(None, description="First quarter the price and volume changes apply to; default the first forecast quarter")
    generic_entry_quarter: str | None = Field(None, description="Quarter a first generic launches, inside the forecast")

    @field_validator("brand")
    @classmethod
    def known_brand(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in set(forecast_table().brand):
            raise ValueError(f"no forecast for {v!r}; known brands: {', '.join(sorted(set(forecast_table().brand)))}")
        return v

    @field_validator("start_quarter", "generic_entry_quarter")
    @classmethod
    def known_quarter(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip().upper()
        if v not in quarters():
            raise ValueError(f"{v!r} is not a forecast quarter; use one of {', '.join(quarters())}")
        return v

    @model_validator(mode="after")
    def default_start(self) -> "Scenario":
        if self.start_quarter is None:
            self.start_quarter = quarters()[0]
        return self


class QuarterResult(BaseModel):
    quarter: str
    base_units: float
    base_price: float
    base_spend: float
    units: float
    price: float
    spend: float
    delta_spend: float
    price_effect: float
    volume_effect: float


class Result(BaseModel):
    scenario: Scenario
    quarters: list[QuarterResult]
    base_total: float
    scenario_total: float
    delta_total: float


def run(s: Scenario) -> Result:
    fc = forecast_table()
    rows = fc[fc.brand == s.brand].sort_values("h")
    ret = retention()
    qs = quarters()
    out: list[QuarterResult] = []
    for _, r in rows.iterrows():
        q = r.quarter
        active = qs.index(q) >= qs.index(s.start_quarter)
        price = r.price * (1 + s.price_change_pct / 100) if active else r.price
        units = r.units_p50 * (1 + s.volume_change_pct / 100) if active else r.units_p50
        if s.generic_entry_quarter and qs.index(q) >= qs.index(s.generic_entry_quarter):
            k = qs.index(q) - qs.index(s.generic_entry_quarter)
            units *= ret.get(min(k, max(ret)), ret[max(ret)])
        base_spend = r.units_p50 * r.price
        spend = units * price
        # Split the change into price and volume the usual way: volume at base price, price on new units.
        volume_effect = (units - r.units_p50) * r.price
        price_effect = (price - r.price) * units
        out.append(QuarterResult(quarter=q, base_units=r.units_p50, base_price=r.price, base_spend=base_spend, units=units, price=price,
                                 spend=spend, delta_spend=spend - base_spend, price_effect=price_effect, volume_effect=volume_effect))
    bt = sum(x.base_spend for x in out)
    st = sum(x.spend for x in out)
    return Result(scenario=s, quarters=out, base_total=bt, scenario_total=st, delta_total=st - bt)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("brand")
    ap.add_argument("--price", type=float, default=0.0)
    ap.add_argument("--volume", type=float, default=0.0)
    ap.add_argument("--start")
    ap.add_argument("--generic")
    a = ap.parse_args()
    res = run(Scenario(brand=a.brand, price_change_pct=a.price, volume_change_pct=a.volume, start_quarter=a.start, generic_entry_quarter=a.generic))
    print(json.dumps(res.model_dump(), indent=2))


if __name__ == "__main__":
    main()
