import { pct, signedPct, signedUsd, usd } from "./format";
import { runScenario, clamp, LIMITS, type ScenarioInput } from "./scenario";
import type { Brand, Dataset } from "./types";

// A forecast assistant that runs in the page, with no language model behind it. A question is routed to one
// typed tool call; the tool answers only from the published data, and the answer shows which tool ran with
// which arguments. A question it cannot route is declined, never guessed. This is the shape a Copilot Studio
// agent over the same data would take: the tools, their arguments and the refusals are the part worth testing.

export type ScenarioArgs = { brand: string; price_change_pct?: number; volume_change_pct?: number; start_quarter?: string; generic_entry_quarter?: string };
export type ToolCall =
  | { tool: "forecast"; args: { brand: string } }
  | { tool: "scenario"; args: ScenarioArgs }
  | { tool: "bu_total"; args: { bu?: string } }
  | { tool: "accuracy"; args: { brand?: string } }
  | { tool: "rank"; args: { by: "growth" | "decline" | "size" } }
  | { tool: "health"; args: Record<string, never> }
  | { tool: "range"; args: Record<string, never> }
  | { tool: "none"; args: Record<string, never>; reason: "scope" | "brand" | "unknown" };

export type Answer = { call: ToolCall; text: string; rows?: [string, string][]; scenario?: { brand: string; bu: string; input: ScenarioInput } };

const BU_WORDS: [RegExp, string][] = [
  [/\bhiv\b/, "HIV"],
  [/\boncology\b|\bcancer\b/, "Oncology"],
  [/\bdiabetes\b/, "Diabetes"],
  [/\bcardio(vascular)?\b|\bheart\b/, "Cardiovascular"],
  [/\bneuroscience\b|\bneuro\b/, "Neuroscience"],
  [/\bhospital\b|\bspecialty\b/, "Hospital & specialty"],
];
const OUT_OF_SCOPE = /\b(saudi|uae|emirates|gcc|gulf|bahrain|europe|eu|global|worldwide|japan|china|net revenue|stock|share price|poem|joke|story|weather)\b/;
const NEG = /\b(cut|cuts|drop|drops|fall|falls|decrease|decreases|lower|lowers|down|reduce|reduces|loses|lose|less|decline|declines|minus)\b|−|(?<![\w])-(?=\s*\d)/;
const POS = /\b(raise|raises|increase|increases|up|grow|grows|rise|rises|more|higher|plus|boost)\b|\+/;
const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };

const has = (t: string, re: RegExp) => re.test(t);

function norm(q: string): string {
  return q
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function findQuarter(t: string): string | undefined {
  let m = t.match(/\b(?:20)?26\s*-?\s*q([1-4])\b/) ?? t.match(/\bq([1-4])(?:\s*(?:20)?26)?\b/);
  if (m) return `2026Q${m[1]}`;
  m = t.match(/\b(first|second|third|fourth) quarter\b/);
  return m ? `2026Q${ORD[m[1]]}` : undefined;
}

/** Percent changes with the measure each applies to: "a 10% price cut", "volume drops 15 percent", "price by 4% and volume by 12%". */
function findChanges(t: string): { price?: number; volume?: number } {
  const out: { price?: number; volume?: number } = {};
  const re = /([+−-]?\s*\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)/g;
  const hits = [...t.matchAll(re)];
  let lastSign = 1;
  hits.forEach((h, i) => {
    const start = h.index ?? 0;
    const before = t.slice(i ? (hits[i - 1].index ?? 0) + hits[i - 1][0].length : 0, start);
    const after = t.slice(start + h[0].length, i + 1 < hits.length ? hits[i + 1].index : undefined);
    const raw = h[1].replace(/\s/g, "");
    const lastIn = (s: string) => {
      const p = s.lastIndexOf("price"),
        v = Math.max(s.lastIndexOf("volume"), s.lastIndexOf("units"), s.lastIndexOf("demand"));
      return p < 0 && v < 0 ? undefined : p > v ? "price" : "volume";
    };
    const firstIn = (s: string) => {
      const p = s.search(/price/),
        v = s.search(/volume|units|demand/);
      return p < 0 && v < 0 ? undefined : p >= 0 && (v < 0 || p < v) ? "price" : "volume";
    };
    const measure = lastIn(before) ?? firstIn(after);
    if (!measure) return;
    let sign: number;
    if (/^[−-]/.test(raw)) sign = -1;
    else if (/^\+/.test(raw)) sign = 1;
    else {
      const near = before + " " + after.split(/\band\b|,/)[0];
      sign = has(near, NEG) && !has(before, POS) ? -1 : has(near, POS) ? 1 : lastSign;
    }
    lastSign = sign;
    out[measure] = sign * Math.abs(Number(raw.replace(/[+−-]/g, "")));
  });
  return out;
}

export function route(q: string, data: Pick<Dataset, "brands">): ToolCall {
  const t = norm(q);
  if (has(t, OUT_OF_SCOPE)) return { tool: "none", args: {}, reason: "scope" };
  const brand = data.brands.find((b) => new RegExp(`\\b${b.brand.toLowerCase()}\\b`).test(t))?.brand;
  const bu = BU_WORDS.find(([re]) => re.test(t))?.[1];
  const accuracy = has(t, /\b(accura\w*|wape|error|miss(es)?|baselines?|backtest\w*|beat|beats|reliable)\b/);
  const range = has(t, /\b(p10|p90|range|band|interval|coverage|calibrat\w*|uncertain\w*|confidence)\b/);

  if (brand) {
    const ch = findChanges(t);
    const quarter = findQuarter(t);
    const generic = has(t, /\b(generic|generics|loe|exclusivity|biosimilar)\b/);
    if (generic || ch.price !== undefined || ch.volume !== undefined) {
      const args: ScenarioArgs = { brand };
      if (ch.price !== undefined) args.price_change_pct = clamp(ch.price, LIMITS.price);
      if (ch.volume !== undefined) args.volume_change_pct = clamp(ch.volume, LIMITS.volume);
      if (generic) args.generic_entry_quarter = quarter ?? "2026Q1";
      else if (quarter) args.start_quarter = quarter;
      return { tool: "scenario", args };
    }
    if (accuracy) return { tool: "accuracy", args: { brand } };
    return { tool: "forecast", args: { brand } };
  }
  if (accuracy) return { tool: "accuracy", args: {} };
  if (range) return { tool: "range", args: {} };
  if (has(t, /\b(health|checks?|fail\w*|review|quality|warn\w*|flag\w*)\b/)) return { tool: "health", args: {} };
  if (bu) return { tool: "bu_total", args: { bu } };
  if (has(t, /\b(declin\w*|shrink\w*|fall\w*|drop\w*|worst|losers?)\b/)) return { tool: "rank", args: { by: "decline" } };
  if (has(t, /\b(fastest|grow\w*|gainers?|rising)\b/)) return { tool: "rank", args: { by: "growth" } };
  if (has(t, /\b(biggest|largest|top|rank\w*)\b/)) return { tool: "rank", args: { by: "size" } };
  if (has(t, /\b(business units?|units|bus?|portfolio|franchises?)\b/)) return { tool: "bu_total", args: {} };
  if (has(t, /\b(forecast|outlook|sales|spend|revenue|make|brand)\b/)) return { tool: "none", args: {}, reason: "brand" };
  return { tool: "none", args: {}, reason: "unknown" };
}

export function trace(c: ToolCall): string {
  const a = Object.entries(c.args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : v}`)
    .join(", ");
  return `${c.tool}(${a})`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const y2025 = (b: Brand) => sum(b.history.filter((p) => p.q.startsWith("2025")).map((p) => p.spend));
const y2026 = (b: Brand) => sum(b.forecast.map((f) => f.p50));

export function answer(q: string, data: Dataset): Answer {
  const call = route(q, data);
  const { brands, backtest, health } = data;
  const find = (name: string) => brands.find((b) => b.brand === name)!;
  switch (call.tool) {
    case "forecast": {
      const b = find(call.args.brand);
      const a = y2025(b),
        f = y2026(b);
      return {
        call,
        text: `${b.brand} (${b.bu}): ${usd(f)} forecast for 2026, ${signedPct(f / a - 1)} on ${usd(a)} in 2025. Each quarter's range is the calibrated P10 to P90.`,
        rows: b.forecast.map((x) => [x.q, `${usd(x.p50)} (${usd(x.p10)} to ${usd(x.p90)})`]),
      };
    }
    case "scenario": {
      const b = find(call.args.brand);
      const input: ScenarioInput = {
        price_change_pct: call.args.price_change_pct ?? 0,
        volume_change_pct: call.args.volume_change_pct ?? 0,
        start_quarter: call.args.start_quarter ?? b.forecast[0].q,
        generic_entry_quarter: call.args.generic_entry_quarter ?? null,
      };
      const r = runScenario(b, input, data.meta.retention);
      const base = sum(r.map((x) => x.base_spend)),
        sc = sum(r.map((x) => x.spend));
      const what = [
        input.price_change_pct ? `price ${signedPct(input.price_change_pct / 100)}` : "",
        input.volume_change_pct ? `volume ${signedPct(input.volume_change_pct / 100)}` : "",
        input.price_change_pct || input.volume_change_pct ? `from ${input.start_quarter}` : "",
        input.generic_entry_quarter ? `first generic in ${input.generic_entry_quarter}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return {
        call,
        text: `${b.brand} with ${what}: ${usd(sc)} for 2026, ${signedUsd(sc - base)} against the forecast of ${usd(base)} (${signedPct(sc / base - 1, 1)}).`,
        rows: r.map((x) => [x.quarter, `${usd(x.spend)} (${signedUsd(x.delta_spend)})`]),
        scenario: { brand: b.brand, bu: b.bu, input },
      };
    }
    case "bu_total": {
      const groups = [...new Set(brands.map((b) => b.bu))].sort();
      const row = (u: string): [string, string] => {
        const bs = brands.filter((b) => b.bu === u);
        const a = sum(bs.map(y2025)),
          f = sum(bs.map(y2026));
        return [u, `${usd(f)} in 2026, ${signedPct(f / a - 1)} on ${usd(a)}`];
      };
      if (call.args.bu) {
        const bs = brands.filter((b) => b.bu === call.args.bu).sort((x, y) => y2026(y) - y2026(x));
        const a = sum(bs.map(y2025)),
          f = sum(bs.map(y2026));
        return {
          call,
          text: `${call.args.bu}: ${usd(f)} forecast for 2026 across ${bs.length} brands, ${signedPct(f / a - 1)} on ${usd(a)} in 2025. The total is the sum of each brand's P50; ranges do not add.`,
          rows: bs.map((b) => [b.brand, `${usd(y2026(b))}, ${signedPct(y2026(b) / y2025(b) - 1)}`]),
        };
      }
      const f = sum(brands.map(y2026));
      return { call, text: `${groups.length} business units, ${usd(f)} forecast for 2026 in all.`, rows: groups.map(row) };
    }
    case "accuracy": {
      if (call.args.brand) {
        const r = backtest.byBrand.find((x) => x.brand === call.args.brand)!;
        const best = Math.min(r.naive, r.seasonal_naive, r.drift);
        return {
          call,
          text: `${r.brand}: the model missed by ${pct(r.model, 1)} (WAPE) over ${r.n} backtest forecasts, against ${pct(best, 1)} for the best simple baseline. ${
            r.best === "model" ? "The model is the best method for this brand." : "A baseline did better on this brand, so read its forecast with that in mind."
          }`,
        };
      }
      const m = backtest.summary.find((x) => x.scope === "MSD brands" && x.horizon === "all")!;
      const wins = backtest.byBrand.filter((x) => x.best === "model").length;
      return {
        call,
        text: `On MSD brands the model missed by ${pct(m.model, 1)} (WAPE), against ${pct(Math.min(m.naive, m.seasonal_naive, m.drift), 1)} for the best baseline, and was the best method on ${wins} of ${backtest.byBrand.length} brands. Tested on rolling origins from ${backtest.origins[0]} to ${backtest.origins[1]}.`,
      };
    }
    case "rank": {
      const by = call.args.by;
      const key = (b: Brand) => (by === "size" ? y2026(b) : y2026(b) / y2025(b) - 1);
      const sorted = [...brands].sort((x, y) => (by === "decline" ? key(x) - key(y) : key(y) - key(x))).slice(0, 5);
      const label = { growth: "Fastest growing in 2026", decline: "Largest declines in 2026", size: "Largest by 2026 forecast" }[by];
      return {
        call,
        text: `${label}, against 2025:`,
        rows: sorted.map((b) => [b.brand, `${usd(y2026(b))}, ${signedPct(y2026(b) / y2025(b) - 1)}`]),
      };
    }
    case "health": {
      const n = (s: string) => health.filter((c) => c.status === s).length;
      const flagged = health.filter((c) => c.status === "warn" || c.status === "fail");
      return {
        call,
        text: `${n("pass")} checks pass, ${n("warn")} need review, ${n("fail")} fail${n("fail") ? ": do not share this forecast until they are fixed" : ""}.`,
        rows: flagged.map((c) => [c.check, c.result]),
      };
    }
    case "range": {
      const c = backtest.calibration.find((x) => x.scope === "MSD brands" && x.horizon === "all")!;
      return {
        call,
        text: `The P10 to P90 range is calibrated: on ${c.n} MSD forecasts the calibration had not seen, it held the actual ${pct(c.coverage_calibrated)} of the time (${pct(c.coverage_raw)} before calibration), against the 80% it is named for. It is wider further ahead.`,
      };
    }
    case "none": {
      const text = {
        scope: "I only answer from this study's data: US Medicaid spend on MSD's brands, before rebates. It has nothing on other countries or on MSD's revenue.",
        brand: `I have forecasts for MSD's ${brands.length} brands only: ${brands.map((b) => b.brand[0] + b.brand.slice(1).toLowerCase()).join(", ")}.`,
        unknown: "I can answer about a brand's 2026 forecast, a what-if (price, volume, a generic launch), business-unit totals, accuracy, the range, and the health checks.",
      }[call.reason];
      return { call, text };
    }
  }
}
