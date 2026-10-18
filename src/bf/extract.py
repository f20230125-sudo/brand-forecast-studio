"""Extract a quarterly brand panel from the Rx Market Pulse warehouse.

    python -m bf.extract

Reads the US Medicaid State Drug Utilization warehouse built by Rx Market Pulse (36.1M rows, 2019 Q1 to
2025 Q4), keeps brand-name products, and writes one row per brand and quarter with units, prescriptions
and spend, plus the brand's owner, therapy area and, for MSD's brands, the business unit. The warehouse is
read-only here; this repository keeps only the small extract, so it does not depend on the other one being
checked out.

The panel holds every brand with at least $20M of Medicaid spend in 2025 (the training population for
one global model) and every MSD brand with at least $2M (the brands the forecasts are reported for).
"""

from __future__ import annotations

import csv
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[2]
RX_WAREHOUSE = Path(r"D:\claude-workspace\rx-analytics\data\warehouse\rx.duckdb")
RX_EROSION = Path(r"D:\claude-workspace\rx-analytics\data\marts\erosion_curve.csv")
OUT_PANEL = ROOT / "data" / "ref" / "brand_quarter.csv"
OUT_TOTALS = ROOT / "data" / "ref" / "source_totals.csv"
OUT_EROSION = ROOT / "data" / "ref" / "erosion_curve.csv"

# MSD business units for the brands it reports here. Written by hand from each brand's therapy area;
# "Hospital & specialty" groups the acute-care anti-infectives and Bridion, as MSD's own reporting does.
MSD_BU = {
    "KEYTRUDA": "Oncology",
    "WELIREG": "Oncology",
    "JANUVIA": "Diabetes",
    "JANUMET": "Diabetes",
    "STEGLATRO": "Diabetes",
    "SEGLUROMET": "Diabetes",
    "ISENTRESS": "HIV",
    "PIFELTRO": "HIV",
    "DELSTRIGO": "HIV",
    "PREVYMIS": "Hospital & specialty",
    "DIFICID": "Hospital & specialty",
    "ZERBAXA": "Hospital & specialty",
    "BRIDION": "Hospital & specialty",
    "RECARBRIO": "Hospital & specialty",
    "SIVEXTRO": "Hospital & specialty",
    "EMEND": "Hospital & specialty",
    "WINREVAIR": "Cardiovascular",
    "VERQUVO": "Cardiovascular",
    "BELSOMRA": "Neuroscience",
}

PANEL_SQL = """
with brand as (
    select family, owner, area, year, quarter,
           sum(spend) as spend, sum(units) as units, sum(rx) as rx
    from sales_nat
    where market_class = 'Brand' and family is not null
    group by 1, 2, 3, 4, 5
),
keep as (
    select family, owner
    from brand
    where year = 2025
    group by 1, 2
    having sum(spend) >= 20e6 or (owner = 'Merck (MSD)' and sum(spend) >= 2e6)
)
select b.family, b.owner, b.area, b.year, b.quarter, b.spend, b.units, b.rx
from brand b join keep k using (family, owner)
order by b.family, b.year, b.quarter
"""


def main() -> None:
    con = duckdb.connect(str(RX_WAREHOUSE), read_only=True)
    rows = con.execute(PANEL_SQL).fetchall()
    # The national brand totals by quarter, to reconcile the extract against its source.
    totals = con.execute(
        "select year, quarter, sum(spend), sum(units) from sales_nat where market_class = 'Brand' group by 1, 2 order by 1, 2"
    ).fetchall()
    con.close()

    OUT_PANEL.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PANEL.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["brand", "owner", "area", "bu", "year", "quarter", "spend", "units", "rx"])
        for fam, owner, area, y, q, spend, units, rx in rows:
            bu = MSD_BU.get(fam, "") if owner == "Merck (MSD)" else ""
            w.writerow([fam, owner, area, bu, y, q, round(spend or 0, 2), round(units or 0, 3), int(rx or 0)])
    with OUT_TOTALS.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["year", "quarter", "brand_spend", "brand_units"])
        for y, q, s, u in totals:
            w.writerow([y, q, round(s, 2), round(u, 3)])
    OUT_EROSION.write_bytes(RX_EROSION.read_bytes())

    brands = {r[0] for r in rows}
    msd = sorted({r[0] for r in rows if r[1] == "Merck (MSD)"})
    missing = sorted(set(MSD_BU) - set(msd))
    print(f"panel: {len(rows):,} rows, {len(brands)} brands, {len(msd)} MSD brands")
    if missing:
        print("MSD brands with a business unit but below the spend floor:", ", ".join(missing))


if __name__ == "__main__":
    main()
