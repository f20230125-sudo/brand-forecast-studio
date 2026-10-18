# Brand Forecast Studio

Quarterly sales forecasts for 19 MSD brands across six business units (Oncology, Diabetes, HIV, Hospital & specialty, Cardiovascular, Neuroscience), with a pipeline health check that runs after every refresh and a what-if interface for price, volume and generic entry.

It mirrors what a Commercial Operations data science team does with internal sales: an automated forecasting pipeline, monitored, with a stakeholder-facing scenario tool. Here the sales are public: **US Medicaid spend from the CMS State Drug Utilization Data, 2019 Q1 to 2025 Q4**, cleaned in [Rx Market Pulse](https://github.com/f20230125-sudo/rx-market-pulse). It is not MSD revenue, not net of rebates, and not the GCC.

## What it found

- **The model beats every simple baseline overall.** Tested on rolling origins from 2023 Q4 to 2025 Q3 (each origin trains only on what was known then, then forecasts one to four quarters ahead), it misses MSD brands' spend by **17.9%** (weighted absolute percentage error), against **19.4%** for the best baseline. Across all 535 brands: **11.8%** against **12.8%**.
- **It is not best everywhere, and the page says where.** It is the most accurate method for 7 of the 19 MSD brands. For Keytruda the recent trend is better (12.4% against 14.9%); for Bridion, after a 42% price cut, last year's same quarter wins.
- **The P10 to P90 band is too narrow.** It held the actual 68% of the time for MSD brands, not the 80% it is named for. The health check flags this; read it as a narrow range.
- **2026 forecast for the 19 brands: about $1.9B of Medicaid spend**, led by Keytruda (~$840M) and Winrevair (~$436M, still ramping after its 2024 launch).

## How it works

```
Rx Market Pulse warehouse (36.1M rows) ──> bf.extract ──> 13,336 brand-quarters, 535 brands, MSD brands mapped to business units
                                                          │
                       bf.model: one global LightGBM model (P50) + two quantile models (P10, P90)
                       forecasts the change in log units, 1-4 quarters ahead; price per unit follows the
                       brand's own recent trend; spend = units x price; rolling-origin backtest vs 3 baselines
                                                          │
          bf.health: 14 checks (freshness, reconciliation, gaps, anomalies, drift PSI, accuracy, coverage)
          bf.scenario: Pydantic-validated what-if (price %, volume %, start quarter, generic entry quarter)
          bf.export_json ──> site/ (Next.js): the stakeholder interface, with the same scenario arithmetic in TypeScript
```

- **Features, fixed before the first backtest:** the last four quarters of log units, recent growth (one quarter and one year), brand age, the target quarter, therapy area and the brand's price trend. No feature looks past the origin; a test checks that every training example's target is at or before it.
- **Baselines:** last quarter's value, the same quarter last year, and the recent trend (capped at about 25% a quarter, since a brand a year after launch can grow tenfold). Every method uses the same price path, so the comparison is about volume.
- **Generic entry** in a scenario applies the median brand retention measured in Rx Market Pulse across 48 molecules that lost exclusivity: 77% of pre-entry spend in the first quarter, 39% a year later.
- **Scenarios are validated before anything is computed:** an unknown brand, a quarter outside the forecast or a price cut of more than 90% is refused with the reason.

## Pipeline health (latest run)

8 pass, 5 need review, 0 fail, 1 for information. The reviews are real: Dificid's latest volume fell far outside its normal range, Bridion's price per unit fell 42% in a quarter, the model loses to last quarter's value for 9 of 19 brands, the interval coverage is 68%, and two 2026 forecasts move more than 60% from 2025 (Dificid down 63%, Winrevair up 89% as it ramps).

## Run it

```powershell
python -m venv .venv; .venv\Scripts\pip install pandas numpy scikit-learn lightgbm pydantic duckdb openpyxl pytest pyarrow
$env:PYTHONPATH = "src"
.venv\Scripts\python -m bf.extract        # needs the Rx Market Pulse warehouse; the extract is committed, so this step is optional
.venv\Scripts\python -m bf.model          # backtest (about 4 minutes) and the 2026 forecast
.venv\Scripts\python -m bf.health
.venv\Scripts\python -m bf.scenario JANUVIA --price -5 --generic 2026Q3
.venv\Scripts\python -m bf.export_json
.venv\Scripts\python -m pytest -q         # 17 tests
cd site; npm install; npm run build; npm run start   # http://localhost:3090; npx vitest run (9), npx playwright test (8)
```

## Limits

- US Medicaid only, before manufacturer rebates. Vaccines are not in this data.
- Quarterly data gives each brand 28 points; one model across 535 brands is what makes learning possible, and it still loses to simple methods on several brands.
- The tools a company team would use (Dataiku, Qlik Sense, Microsoft Copilot Studio) need licences; this project uses Python, LightGBM and a Next.js page instead.

An independent case study, not produced or endorsed by MSD or any company named.
