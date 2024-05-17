"use client";

import { useState } from "react";
import { clamp, LIMITS, runScenario, type ScenarioInput } from "@/lib/scenario";
import type { Brand, Dataset } from "@/lib/types";
import { pct, signedPct, signedUsd, usd } from "@/lib/format";
import { Ask } from "./Ask";
import { BuChart, type BuRow } from "./BuChart";
import { ForecastChart } from "./ForecastChart";
import { Frame, useView } from "./chart";
import { ThemeToggle } from "./ThemeToggle";

const SECTIONS = [
  { id: "forecast", label: "Forecast" },
  { id: "units", label: "Business units" },
  { id: "ask", label: "Ask" },
  { id: "accuracy", label: "Accuracy" },
  { id: "health", label: "Pipeline health" },
  { id: "method", label: "Method" },
];
const METHOD_LABEL: Record<string, string> = { model: "Model", naive: "Last quarter", seasonal_naive: "Same quarter last year", drift: "Recent trend" };
// Plain names for the model's inputs, for the "what the model leans on" line.
const FEATURE_LABEL: Record<string, string> = {
  g4: "growth over the last four quarters",
  g1: "growth last quarter",
  age: "quarters since launch",
  h: "quarters ahead",
  mean4: "average units over the last four quarters",
  price_g4: "price trend over a year",
  target_q: "quarter of the year",
  area_code: "therapy area",
  lag0: "units in the latest quarter",
  lag1: "units one quarter earlier",
  lag2: "units two quarters earlier",
  lag3: "units three quarters earlier",
};
const CAL_START = "2024Q4";
const STATUS_WORD = { pass: "Pass", warn: "Review", fail: "Fail", info: "Info" } as const;

function StatusGlyph({ s }: { s: keyof typeof STATUS_WORD }) {
  // Shape carries the meaning, not colour: a tick, a ring with a bar, a cross, a ring with a dot.
  const d = { pass: "M3 8.5l3 3 7-7", warn: "M8 4v5", fail: "M4 4l8 8M12 4l-8 8", info: "M8 7v5" }[s];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {s !== "pass" && s !== "fail" && <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {s === "warn" && <circle cx="8" cy="11.6" r="1" fill="currentColor" />}
      {s === "info" && <circle cx="8" cy="4.6" r="1" fill="currentColor" />}
    </svg>
  );
}

function defaults(b: Brand): ScenarioInput {
  return { price_change_pct: 0, volume_change_pct: 0, start_quarter: b.forecast[0].q, generic_entry_quarter: null };
}

export function Studio({ data, repoUrl }: { data: Dataset; repoUrl?: string }) {
  const { brands, backtest, health, meta } = data;
  const bus = [...new Set(brands.map((b) => b.bu))].sort();
  const [bu, setBu] = useState<string>("Diabetes");
  const inBu = brands.filter((b) => b.bu === bu);
  const [name, setName] = useState<string>("JANUVIA");
  const brand = brands.find((b) => b.brand === name && b.bu === bu) ?? inBu[0];
  const [s, setS] = useState<ScenarioInput>(defaults(brand));
  const result = runScenario(brand, s, meta.retention);
  const changed = s.price_change_pct !== 0 || s.volume_change_pct !== 0 || s.generic_entry_quarter !== null;
  const baseTotal = result.reduce((a, q) => a + q.base_spend, 0);
  const scenTotal = result.reduce((a, q) => a + q.spend, 0);
  const [view, setView] = useView("chart");
  const [buView, setBuView] = useView("chart");

  const msdAll = backtest.summary.find((r) => r.scope === "MSD brands" && r.horizon === "all")!;
  const allAll = backtest.summary.find((r) => r.scope === "All brands" && r.horizon === "all")!;
  const bestBase = (r: typeof msdAll) => Math.min(r.naive, r.seasonal_naive, r.drift);
  const wins = backtest.byBrand.filter((r) => r.best === "model").length;
  const total2026 = brands.reduce((a, b) => a + b.forecast.reduce((x, f) => x + f.p50, 0), 0);
  const total2025 = brands.reduce((a, b) => a + b.history.filter((p) => p.q.startsWith("2025")).reduce((x, p) => x + p.spend, 0), 0);
  const year = (b: Brand, y: string) => b.history.filter((p) => p.q.startsWith(y)).reduce((x, p) => x + p.spend, 0);
  const fc = (b: Brand) => b.forecast.reduce((x, f) => x + f.p50, 0);
  const buRows: BuRow[] = bus.map((u) => {
    const bs = brands.filter((b) => b.bu === u);
    const f = bs.reduce((a, b) => a + fc(b), 0);
    return { bu: u, brands: bs.length, y2025: bs.reduce((a, b) => a + year(b, "2025"), 0), y2026: f, scenario: changed && u === brand.bu ? f - baseTotal + scenTotal : null };
  });
  const cal = (h: string) => backtest.calibration.find((r) => r.scope === "MSD brands" && r.horizon === h);
  const calAll = cal("all")!;
  const counts = health.reduce<Record<string, number>>((a, c) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {});

  const pickBu = (v: string) => {
    setBu(v);
    const first = brands.filter((b) => b.bu === v)[0];
    setName(first.brand);
    setS(defaults(first));
  };
  const pickBrand = (v: string) => {
    setName(v);
    setS(defaults(brands.find((b) => b.brand === v)!));
  };
  const openScenario = (x: { brand: string; bu: string; input: ScenarioInput }) => {
    setBu(x.bu);
    setName(x.brand);
    setS(x.input);
    document.getElementById("forecast")?.scrollIntoView({ block: "start" });
  };

  return (
    <>
      <a className="skip" href="#main">
        Skip to the report
      </a>
      <header className="bar">
        <div className="shell bar-in">
          <a className="brand" href="#top">
            Brand Forecast Studio
          </a>
          <nav aria-label="Sections">
            {SECTIONS.map((x) => (
              <a key={x.id} href={`#${x.id}`}>
                {x.label}
              </a>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="shell">
        <section className="hero" id="top">
          <p className="kicker">
            <b>Brand Forecast Studio</b> · a commercial data science case study by Mohammad Uzair Khan, on public US Medicaid data
          </p>
          <h1>
            Quarterly forecasts for {brands.length} MSD brands across {bus.length} business units: {usd(total2026)} of 2026 US Medicaid spend, against {usd(total2025)} in 2025
          </h1>
          <p className="lede">
            One machine-learning model, trained across {meta.panelBrands} brands, forecasts each brand&rsquo;s units four quarters ahead; price per unit follows the brand&rsquo;s own recent trend. Tested on rolling
            origins from {backtest.origins[0]} to {backtest.origins[1]}, it misses MSD brands&rsquo; spend by {pct(msdAll.model, 1)} on average, against {pct(bestBase(msdAll), 1)} for the best simple baseline, and
            wins on {wins} of {backtest.byBrand.length} brands. Its P10 to P90 range is calibrated, and held the actual {pct(calAll.coverage_calibrated)} of the time on quarters the calibration had not
            seen. Change price, volume or a generic launch below and the forecast moves with it, or ask a question in plain words.
          </p>
        </section>

        <section className="sec" id="forecast" aria-labelledby="forecast-h">
          <div className="sec-head">
            <h2 id="forecast-h">Forecast and what-if</h2>
            <p className="dek">Pick a business unit and a brand. The yellow cells are assumptions: change them and the scenario line and table follow. Nothing here is sent anywhere; the arithmetic runs in this page.</p>
          </div>
          <div className="ctl" style={{ marginBottom: 14 }}>
            <div className="seg" role="group" aria-label="Business unit">
              {bus.map((b) => (
                <button key={b} type="button" aria-pressed={b === bu} onClick={() => pickBu(b)}>
                  {b}
                </button>
              ))}
            </div>
            <label>
              Brand{" "}
              <select className="map-select" value={brand.brand} onChange={(e) => pickBrand(e.target.value)} aria-label="Brand">
                {inBu.map((b) => (
                  <option key={b.brand} value={b.brand}>
                    {b.brand}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <figure className="fig">
            <div className="fig-head">
              <div>
                <h3>
                  {brand.brand}: {usd(brand.forecast.reduce((a, f) => a + f.p50, 0))} forecast for {brand.forecast[0].q.slice(0, 4)}
                  {changed ? `, ${usd(scenTotal)} in your scenario` : ""}
                </h3>
                <p className="sub">
                  {brand.bu} · US Medicaid spend by quarter, before rebates. The band runs from the P10 to the P90 forecast.
                </p>
              </div>
              <div className="seg" role="group" aria-label="Forecast: view">
                <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}>
                  Chart
                </button>
                <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
                  Table
                </button>
              </div>
            </div>

            <div className="ctl" style={{ margin: "6px 0 14px" }}>
              <label>
                Price change{" "}
                <input
                  className="cell"
                  type="number"
                  step={1}
                  min={LIMITS.price[0]}
                  max={LIMITS.price[1]}
                  value={s.price_change_pct}
                  aria-label="Price change, percent"
                  onChange={(e) => setS({ ...s, price_change_pct: clamp(Number(e.target.value), LIMITS.price) })}
                />{" "}
                %
              </label>
              <label>
                Volume change{" "}
                <input
                  className="cell"
                  type="number"
                  step={1}
                  min={LIMITS.volume[0]}
                  max={LIMITS.volume[1]}
                  value={s.volume_change_pct}
                  aria-label="Volume change, percent"
                  onChange={(e) => setS({ ...s, volume_change_pct: clamp(Number(e.target.value), LIMITS.volume) })}
                />{" "}
                %
              </label>
              <label>
                from{" "}
                <select className="map-select" value={s.start_quarter} aria-label="Changes start in" onChange={(e) => setS({ ...s, start_quarter: e.target.value })}>
                  {brand.forecast.map((f) => (
                    <option key={f.q}>{f.q}</option>
                  ))}
                </select>
              </label>
              <label>
                First generic launches{" "}
                <select
                  className="map-select"
                  value={s.generic_entry_quarter ?? ""}
                  aria-label="First generic launches in"
                  onChange={(e) => setS({ ...s, generic_entry_quarter: e.target.value || null })}
                >
                  <option value="">not in 2026</option>
                  {brand.forecast.map((f) => (
                    <option key={f.q} value={f.q}>
                      {f.q}
                    </option>
                  ))}
                </select>
              </label>
              {changed && (
                <button type="button" className="btn" onClick={() => setS(defaults(brand))}>
                  Reset to the forecast
                </button>
              )}
            </div>
            <p className="scenario" aria-live="polite">
              {changed ? (
                <>
                  Your scenario: <b>{usd(scenTotal)}</b> for 2026, {signedUsd(scenTotal - baseTotal)} against the forecast ({pct((scenTotal - baseTotal) / baseTotal, 1).replace(/^(?!−)/, "+")}).
                </>
              ) : (
                <>This is the model&rsquo;s forecast. Change a yellow cell to build a scenario.</>
              )}
            </p>

            {view === "chart" ? (
              <>
                <p className="legend">
                  <span>
                    <i style={{ width: 20, height: 0, borderTop: "2px solid var(--ink)", display: "inline-block", verticalAlign: 3 }} /> actual
                  </span>{" "}
                  <span>
                    <i style={{ width: 20, height: 0, borderTop: "2px dashed var(--ink)", display: "inline-block", verticalAlign: 3 }} /> forecast
                  </span>{" "}
                  <span>
                    <i className="band" /> P10 to P90
                  </span>{" "}
                  {changed && (
                    <span>
                      <i style={{ width: 20, height: 0, borderTop: "2.5px solid var(--cell-rule)", display: "inline-block", verticalAlign: 3 }} /> scenario
                    </span>
                  )}
                </p>
                <ForecastChart brand={brand} scenario={result} changed={changed} />
              </>
            ) : (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`${brand.brand} forecast and scenario: table`}>
              <table className="tbl">
                <caption className="sr-only">{brand.brand} forecast and scenario by quarter</caption>
                <thead>
                  <tr>
                    <th scope="col">Quarter</th>
                    <th scope="col" className="n">
                      P10
                    </th>
                    <th scope="col" className="n">
                      Forecast
                    </th>
                    <th scope="col" className="n">
                      P90
                    </th>
                    <th scope="col" className="n">
                      Scenario
                    </th>
                    <th scope="col" className="n">
                      Price effect
                    </th>
                    <th scope="col" className="n">
                      Volume effect
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {brand.forecast.map((f, i) => (
                    <tr key={f.q}>
                      <th scope="row">{f.q}</th>
                      <td className="n">{usd(f.p10)}</td>
                      <td className="n">{usd(f.p50)}</td>
                      <td className="n">{usd(f.p90)}</td>
                      <td className="n">{usd(result[i].spend)}</td>
                      <td className="n">{signedUsd(result[i].price_effect)}</td>
                      <td className="n">{signedUsd(result[i].volume_effect)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            <figcaption className="src">
              Source: CMS State Drug Utilization Data, {brand.history[0].q} to {meta.lastQuarter}, via Rx Market Pulse. Generic entry applies the median brand retention measured across 48 molecules that lost
              exclusivity: {pct(meta.retention["0"])} of pre-entry spend in the first quarter, {pct(meta.retention["4"])} a year later.
            </figcaption>
          </figure>
        </section>

        <section className="sec" id="units" aria-labelledby="units-h">
          <div className="sec-head">
            <h2 id="units-h">
              By business unit: {buRows.filter((r) => r.y2026 > r.y2025).length} of {buRows.length} grow in 2026
            </h2>
            <p className="dek">
              Each unit&rsquo;s total is the sum of its brands&rsquo; forecasts. Ranges are left out here: single brands&rsquo; P10s do not add up to a P10 for the unit. A scenario built above shows as a yellow mark
              on its unit.
            </p>
          </div>
          <Frame
            title="US Medicaid spend by business unit, 2025 actual and 2026 forecast"
            sub="Before rebates. Outlined bar: 2025; solid bar: the 2026 forecast (P50)."
            view={buView}
            onView={setBuView}
            legend={
              <p className="legend">
                <span>
                  <i className="sq o" /> 2025 actual
                </span>{" "}
                <span>
                  <i className="sq" /> 2026 forecast
                </span>{" "}
                {changed && (
                  <span>
                    <i style={{ width: 0, height: 12, border: 0, borderLeft: "2.5px solid var(--cell-rule)", verticalAlign: -1 }} /> 2026, your scenario
                  </span>
                )}
              </p>
            }
            table={
              <table className="tbl">
                <caption className="sr-only">US Medicaid spend by business unit</caption>
                <thead>
                  <tr>
                    <th scope="col">Business unit</th>
                    <th scope="col" className="n">
                      Brands
                    </th>
                    <th scope="col" className="n">
                      2025 actual
                    </th>
                    <th scope="col" className="n">
                      2026 forecast
                    </th>
                    <th scope="col" className="n">
                      Change
                    </th>
                    <th scope="col" className="n">
                      Your scenario
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {buRows.map((r) => (
                    <tr key={r.bu}>
                      <th scope="row">{r.bu}</th>
                      <td className="n">{r.brands}</td>
                      <td className="n">{usd(r.y2025)}</td>
                      <td className="n">{usd(r.y2026)}</td>
                      <td className="n">{signedPct(r.y2026 / r.y2025 - 1)}</td>
                      <td className="n">{r.scenario == null ? "" : usd(r.scenario)}</td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <th scope="row">All</th>
                    <td className="n">{brands.length}</td>
                    <td className="n">{usd(total2025)}</td>
                    <td className="n">{usd(total2026)}</td>
                    <td className="n">{signedPct(total2026 / total2025 - 1)}</td>
                    <td className="n">{changed ? usd(total2026 - baseTotal + scenTotal) : ""}</td>
                  </tr>
                </tbody>
              </table>
            }
            source={<>Source: CMS State Drug Utilization Data via Rx Market Pulse. Business units as grouped in this study, not MSD&rsquo;s own reporting lines.</>}
          >
            <BuChart rows={buRows} />
          </Frame>
        </section>

        <section className="sec" id="ask" aria-labelledby="ask-h">
          <div className="sec-head">
            <h2 id="ask-h">Ask the forecast</h2>
            <p className="dek">
              Each question becomes one call to a typed tool (forecast, scenario, business-unit total, accuracy, ranking, health, range), and the answer comes only from the numbers on this page. The tool call is shown
              under the answer. A question it cannot place is declined rather than guessed. It runs in this page, with no language model and nothing sent anywhere.
            </p>
          </div>
          <Ask data={data} onOpen={openScenario} />
        </section>

        <section className="sec" id="accuracy" aria-labelledby="accuracy-h">
          <div className="sec-head">
            <h2 id="accuracy-h">
              Tested before it is trusted: {pct(msdAll.model, 1)} average miss on MSD brands, against {pct(bestBase(msdAll), 1)} for the best baseline
            </h2>
            <p className="dek">
              Each origin from {backtest.origins[0]} to {backtest.origins[1]} trains only on what was known then and forecasts one to four quarters ahead. The miss is weighted absolute percentage error (WAPE):
              total absolute error over total actual spend. Across all {meta.panelBrands} brands the model misses by {pct(allAll.model, 1)}, against {pct(bestBase(allAll), 1)}. It is not best everywhere, and the
              table says where. The last two columns count forecasts made from {CAL_START} on, which the range&rsquo;s calibration had not seen; four quarters ahead has none yet for MSD brands.
            </p>
          </div>
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Backtest by horizon: table">
            <table className="tbl">
              <caption>Average miss by how far ahead, MSD brands</caption>
              <thead>
                <tr>
                  <th scope="col">Quarters ahead</th>
                  {Object.values(METHOD_LABEL).map((l) => (
                    <th key={l} scope="col" className="n">
                      {l}
                    </th>
                  ))}
                  <th scope="col" className="n">
                    Inside the range, raw
                  </th>
                  <th scope="col" className="n">
                    Inside, calibrated
                  </th>
                </tr>
              </thead>
              <tbody>
                {backtest.summary
                  .filter((r) => r.scope === "MSD brands")
                  .map((r) => (
                    <tr key={r.horizon} className={r.horizon === "all" ? "tot" : undefined}>
                      <th scope="row">{r.horizon === "all" ? "All" : r.horizon}</th>
                      {(["model", "naive", "seasonal_naive", "drift"] as const).map((k) => (
                        <td key={k} className="n">
                          {pct(r[k], 1)}
                        </td>
                      ))}
                      <td className="n">{pct(cal(r.horizon)?.coverage_raw)}</td>
                      <td className="n">{pct(cal(r.horizon)?.coverage_calibrated)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Backtest by brand: table" style={{ marginTop: 24 }}>
            <table className="tbl">
              <caption>Average miss by brand; the best method is named</caption>
              <thead>
                <tr>
                  <th scope="col">Brand</th>
                  <th scope="col">Business unit</th>
                  <th scope="col" className="n">
                    Model
                  </th>
                  <th scope="col" className="n">
                    Best baseline
                  </th>
                  <th scope="col">Best method</th>
                </tr>
              </thead>
              <tbody>
                {backtest.byBrand.map((r) => (
                  <tr key={r.brand}>
                    <th scope="row">{r.brand}</th>
                    <td>{r.bu}</td>
                    <td className="n">{pct(r.model, 1)}</td>
                    <td className="n">{pct(Math.min(r.naive, r.seasonal_naive, r.drift), 1)}</td>
                    <td>{METHOD_LABEL[r.best]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sec" id="health" aria-labelledby="health-h">
          <div className="sec-head">
            <h2 id="health-h">
              Pipeline health: {counts.pass ?? 0} checks pass, {counts.warn ?? 0} need review, {counts.fail ?? 0} fail
            </h2>
            <p className="dek">Run after every refresh, before a forecast is shared. A review is not a failure: it names what a person should look at, such as a price cut or a brand the model does not beat.</p>
          </div>
          <div>
            {health.map((c) => (
              <div className="qrow" key={c.id}>
                <span className="st">
                  <StatusGlyph s={c.status} />
                  {STATUS_WORD[c.status]}
                </span>
                <span>
                  <span className="nm">{c.check}</span>
                  <span className="rs">
                    {c.result} · rule: {c.rule}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="sec" id="method" aria-labelledby="method-h">
          <div className="sec-head">
            <h2 id="method-h">Method and limits</h2>
          </div>
          <ul className="method">
            <li>
              <b>Data.</b> {meta.panelRows.toLocaleString("en-US")} brand-quarters for {meta.panelBrands} brands with at least $20M of Medicaid spend in 2025, and every MSD brand above $2M, from the CMS State Drug
              Utilization Data cleaned in Rx Market Pulse.
            </li>
            <li>
              <b>Model.</b> One LightGBM model across all brands forecasts the change in log units from lags, recent growth, brand age, quarter, therapy area and price trend; two quantile models give P10 and P90. Price per
              unit follows each brand&rsquo;s own trend over the last year, capped at about 5% a quarter. Spend is units times price.
            </li>
            <li>
              <b>Range.</b> The quantile models&rsquo; P10 to P90 band held the actual only {pct(calAll.coverage_raw)} of the time for MSD brands. It is calibrated by conformal prediction: each band is widened by
              how far earlier actuals at the same horizon fell outside theirs, measured separately for MSD&rsquo;s brands and the rest, and only from quarters already known when the forecast was made. On {calAll.n}{" "}
              MSD forecasts the calibration had not seen it holds {pct(calAll.coverage_calibrated)}; the median band widens from {pct(calAll.median_width_raw)} to {pct(calAll.median_width_calibrated)} above P10.
            </li>
            <li>
              <b>What the model leans on.</b> Share of the final model&rsquo;s split gain:{" "}
              {backtest.importance
                .slice(0, 5)
                .map((f) => `${FEATURE_LABEL[f.feature] ?? f.feature} ${pct(f.share)}`)
                .join("; ")}
              . Recent growth counts for more than the level, so a brand that turns sharply is where it misses most.
            </li>
            <li>
              <b>Baselines.</b> Last quarter&rsquo;s value, the same quarter last year, and the recent trend (capped at about 25% a quarter). Same price path for every method, so the comparison is about volume.
            </li>
            <li>
              <b>Limits.</b> US Medicaid only, before manufacturer rebates: not MSD revenue, not the GCC. Vaccines are not in this data. The calibrated range is checked on {calAll.n} MSD forecasts, so its coverage
              is known to within a few points, not exactly. The assistant answers only what its tools cover. An independent case study, not produced or endorsed by MSD.
            </li>
          </ul>
        </section>
      </main>

      <footer className="foot">
        <div className="shell">
          <p className="disc">
            Built by Mohammad Uzair Khan · {repoUrl ? <a href={repoUrl}>Code on GitHub</a> : "Code on GitHub"} · data built {meta.built}
          </p>
        </div>
      </footer>
    </>
  );
}
