# Brand Forecast Studio

**Live:** https://brand-forecast-studio.vercel.app

Quarterly sales forecasts for 19 MSD brands across six business units (Oncology, Diabetes, HIV, Hospital & specialty, Cardiovascular, Neuroscience), run as one monitored pipeline with a run log and a health check after every refresh, a calibrated forecast range, and a stakeholder page with a what-if for price, volume and generic entry, business-unit totals and a question box backed by typed tools.

It mirrors what a Commercial Operations data science team does with internal sales: an automated forecasting pipeline, monitored, with a stakeholder-facing scenario tool. Here the sales are public: **US Medicaid spend from the CMS State Drug Utilization Data, 2019 Q1 to 2025 Q4**, cleaned in [Rx Market Pulse](https://github.com/f20230125-sudo/rx-market-pulse). It is not MSD revenue, not net of rebates, and not the GCC.

## What it found

- **The model beats every simple baseline overall.** Tested on rolling origins from 2023 Q4 to 2025 Q3 (each origin trains only on what was known then, then forecasts one to four quarters ahead), it misses MSD brands' spend by **17.9%** (weighted absolute percentage error), against **19.4%** for the best baseline. Across all 535 brands: **11.8%** against **12.8%**.
- **It is not best everywhere, and the page says where.** It is the most accurate method for 7 of the 19 MSD brands. For Keytruda the recent trend is better (12.4% against 14.9%); for Bridion, after a 42% price cut, last year's same quarter wins.
- **The raw P10 to P90 band was too narrow, so it is calibrated.** The quantile models' band held the actual 70% of the time for MSD brands (73% for all brands), not the 80% it is named for. Conformal calibration fixes that: on 152 MSD forecasts the calibration had not seen, the calibrated range holds **79.6%** (81.0% across 5,264 forecasts for all brands).
- **What the model leans on:** growth over the last four quarters carries 43% of the final model's split gain, last quarter's growth 13%, brand age 9%. Recent growth counts for more than the level, so a brand that turns sharply (Dificid, Bridion) is where it misses most.
- **2026 forecast for the 19 brands: about $1.9B of Medicaid spend**, led by Keytruda (~$840M) and Winrevair (~$436M, still ramping after its 2024 launch). By business unit, 2 of 6 grow: Cardiovascular (+86%, Winrevair) and Neuroscience (+12%); Diabetes falls 25% as Januvia and Janumet decline.

## How it works

```
Rx Market Pulse warehouse (36.1M rows) ──> bf.extract ──> 13,336 brand-quarters, 535 brands, MSD brands mapped to business units
                                                          │
                       bf.model: one global LightGBM model (P50) + two quantile models (P10, P90)
                       forecasts the change in log units, 1-4 quarters ahead; price per unit follows the
                       brand's own recent trend; spend = units x price; rolling-origin backtest vs 3 baselines
                                                          │
          bf.calibrate: conformal calibration of the P10-P90 range, tested on quarters it had not seen
          bf.health: 14 checks (freshness, reconciliation, gaps, anomalies, drift PSI, accuracy, coverage)
          bf.scenario: Pydantic-validated what-if (price %, volume %, start quarter, generic entry quarter)
          bf.export_json ──> site/ (Next.js): the stakeholder interface, with the same scenario arithmetic in TypeScript

bf.run runs model -> calibrate -> health -> export as one job, times each step and appends a row to data/marts/run_log.csv;
a run with a failed health check exits with an error, so a scheduler marks it failed and nothing downstream publishes it.
```

- **Features, fixed before the first backtest:** the last four quarters of log units, recent growth (one quarter and one year), brand age, the target quarter, therapy area and the brand's price trend. No feature looks past the origin; a test checks that every training example's target is at or before it.
- **Baselines:** last quarter's value, the same quarter last year, and the recent trend (capped at about 25% a quarter, since a brand a year after launch can grow tenfold). Every method uses the same price path, so the comparison is about volume.
- **Generic entry** in a scenario applies the median brand retention measured in Rx Market Pulse across 48 molecules that lost exclusivity: 77% of pre-entry spend in the first quarter, 39% a year later.
- **Scenarios are validated before anything is computed:** an unknown brand, a quarter outside the forecast or a price cut of more than 90% is refused with the reason.

## The calibrated range

For each forecast the band is widened by Q, measured on earlier forecasts at the same horizon:

```
E = max(log P10 - log actual, log actual - log P90)     how far outside its band an actual fell (negative = inside)
Q = the ceil((n + 1) x 0.8)-th smallest E over the n earlier forecasts whose target quarter was already known
calibrated band = [P10 x exp(-Q), P90 x exp(Q)]
```

Q is measured separately for MSD's brands and for the rest (a Mondrian split): MSD's brands miss more than the average brand, and one pooled Q left their band at 73%. A forecast made at origin t uses only forecasts whose target is at or before t, and coverage is reported only for origins from 2024 Q4, so it is measured on quarters the calibration had not seen. A unit test caught an off-by-one here: `np.quantile(..., method="higher")` took the 10th of 10 scores where the rule needs the 9th, which made every band slightly too wide; the fix kept coverage at 79.6% and narrowed the median MSD band from 38% to 35% above P10. Four quarters ahead has no unseen MSD forecast yet, so that row reads n/a.

## Ask the forecast

The page has a question box that works like a Copilot-style agent over the forecast, with no language model: each question is routed to one typed tool call (`forecast`, `scenario`, `bu_total`, `accuracy`, `rank`, `health`, `range`), the tool answers only from the published numbers, and the tool call is printed under the answer. A scenario answer can be opened in the what-if with one click. Questions it cannot place (another country, a non-MSD brand, a poem) are declined, not guessed.

- **Development set:** 29 questions the router was written and tuned against; all pass.
- **Held-out set:** 24 questions written before the router (`site/tests/fixtures/assistant-heldout.json`), run once, not tuned on: **24 of 24** routed to the right tool with the right arguments. Both sets were written by the same author as the router, so this shows it handles the phrasings a reviewer is likely to try, not that it understands any question.

## Pipeline health (latest run)

9 pass, 4 need review, 0 fail, 1 for information. The reviews are real: Dificid's latest volume fell far outside its normal range, Bridion's price per unit fell 42% in a quarter, the model loses to last quarter's value for 9 of 19 brands, and two 2026 forecasts move more than 60% from 2025 (Dificid down 63%, Winrevair up 89% as it ramps). The range check (H12) passes since calibration: 80% on unseen quarters, 70% before.

## Run it

```powershell
python -m venv .venv; .venv\Scripts\pip install pandas numpy scikit-learn lightgbm pydantic duckdb openpyxl pytest pyarrow
$env:PYTHONPATH = "src"
.venv\Scripts\python -m bf.extract        # needs the Rx Market Pulse warehouse; the extract is committed, so this step is optional
.venv\Scripts\python -m bf.run            # model (backtest, about 4 minutes) -> calibrate -> health -> export, logged to run_log.csv
.venv\Scripts\python -m bf.run --skip-backtest   # refit the 2026 forecast only, reusing the last backtest
.venv\Scripts\python -m bf.scenario JANUVIA --price -5 --generic 2026Q3
.venv\Scripts\python -m pytest -q         # 21 tests
cd site; npm install; npm run build; npm run start   # http://localhost:3090; npx vitest run (43), npx playwright test (11)
```

## Limits

- US Medicaid only, before manufacturer rebates. Vaccines are not in this data.
- Quarterly data gives each brand 28 points; one model across 535 brands is what makes learning possible, and it still loses to simple methods on several brands.
- The calibrated range is checked on 152 MSD forecasts, so its coverage is known to within a few points, not exactly.
- The assistant answers only what its seven tools cover; it is a router, not a language model.
- The tools a company team would use (Dataiku, Qlik Sense, Microsoft Copilot Studio) need licences; this project uses Python, LightGBM and a Next.js page instead. The run log and the failing exit code are what a Dataiku scenario or a scheduled job would watch.

An independent case study, not produced or endorsed by MSD or any company named.
