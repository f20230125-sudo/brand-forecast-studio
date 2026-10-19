import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { answer, route, trace, type ToolCall } from "./assistant";
import { loadDataset } from "./load";

const data = loadDataset();
const strip = (c: ToolCall) => ({ tool: c.tool, args: c.args });

// The development set: the questions the router was written and tuned against.
const DEV: [string, ToolCall["tool"], Record<string, unknown>][] = [
  ["What is the Januvia forecast for 2026?", "forecast", { brand: "JANUVIA" }],
  ["keytruda", "forecast", { brand: "KEYTRUDA" }],
  ["How much will Steglatro sell?", "forecast", { brand: "STEGLATRO" }],
  ["Dificid outlook please", "forecast", { brand: "DIFICID" }],
  ["Januvia's P10 and P90 for 2026", "forecast", { brand: "JANUVIA" }],
  ["What if Januvia cuts price by 5% and a generic launches in Q3?", "scenario", { brand: "JANUVIA", price_change_pct: -5, generic_entry_quarter: "2026Q3" }],
  ["Keytruda price up 3% and volume up 8% from 2026Q2", "scenario", { brand: "KEYTRUDA", price_change_pct: 3, volume_change_pct: 8, start_quarter: "2026Q2" }],
  ["Winrevair volume -20%", "scenario", { brand: "WINREVAIR", volume_change_pct: -20 }],
  ["Isentress loses exclusivity in the first quarter", "scenario", { brand: "ISENTRESS", generic_entry_quarter: "2026Q1" }],
  ["a 7 percent price increase on Belsomra", "scenario", { brand: "BELSOMRA", price_change_pct: 7 }],
  ["Pifeltro with volume 25% lower starting Q4", "scenario", { brand: "PIFELTRO", volume_change_pct: -25, start_quarter: "2026Q4" }],
  ["generic Janumet", "scenario", { brand: "JANUMET", generic_entry_quarter: "2026Q1" }],
  ["Diabetes total", "bu_total", { bu: "Diabetes" }],
  ["How is the cardiovascular business doing in 2026?", "bu_total", { bu: "Cardiovascular" }],
  ["neuroscience", "bu_total", { bu: "Neuroscience" }],
  ["Totals by business unit", "bu_total", {}],
  ["Is the Keytruda forecast accurate?", "accuracy", { brand: "KEYTRUDA" }],
  ["How big is the error on MSD brands?", "accuracy", {}],
  ["backtest results", "accuracy", {}],
  ["Which brands grow the most?", "rank", { by: "growth" }],
  ["Top 5 brands", "rank", { by: "size" }],
  ["Which brands are falling?", "rank", { by: "decline" }],
  ["Pipeline health", "health", {}],
  ["Anything flagged in the checks?", "health", {}],
  ["Is the interval calibrated?", "range", {}],
  ["How uncertain is the forecast?", "range", {}],
  ["What does MSD earn in the UAE?", "none", {}],
  ["Forecast Lipitor", "none", {}],
  ["hello", "none", {}],
];

describe("assistant router, development set", () => {
  it.each(DEV)("%s", (q, tool, args) => {
    expect(strip(route(q, data))).toEqual({ tool, args });
  });
});

describe("assistant answers", () => {
  it("a scenario answer equals the what-if panel's arithmetic and can be opened there", () => {
    const a = answer("What if Januvia cuts price by 5% and a generic launches in Q3?", data);
    expect(a.scenario?.input).toEqual({ price_change_pct: -5, volume_change_pct: 0, start_quarter: "2026Q1", generic_entry_quarter: "2026Q3" });
    expect(a.rows).toHaveLength(4);
    expect(a.text).toMatch(/^JANUVIA with price −5%, from 2026Q1, first generic in 2026Q3: \$/);
  });
  it("a declined question names what it can do and calls no tool", () => {
    const a = answer("Forecast Ozempic for 2026", data);
    expect(a.call.tool).toBe("none");
    expect(a.text).toContain("Januvia");
  });
  it("every tool's answer has numbers from the data, not placeholders", () => {
    for (const q of ["keytruda", "Diabetes total", "Totals by business unit", "backtest results", "Top 5 brands", "Pipeline health", "Is the interval calibrated?"]) {
      const a = answer(q, data);
      expect(a.text, q).not.toMatch(/n\/a|NaN|undefined/);
      for (const [, v] of a.rows ?? []) expect(v, q).not.toMatch(/n\/a|NaN|undefined/);
    }
  });
  it("the trace shows the tool and its arguments", () => {
    expect(trace(route("Winrevair volume -20%", data))).toBe('scenario(brand="WINREVAIR", volume_change_pct=-20)');
  });
});

// The held-out set was written before the router and is not tuned on: this reports its score, it does not
// require a perfect one. The score is printed and written to tests/fixtures/assistant-heldout-score.json.
describe("assistant router, held-out set", () => {
  it("scores the held-out questions", () => {
    const file = path.join(process.cwd(), "tests", "fixtures", "assistant-heldout.json");
    const { cases } = JSON.parse(fs.readFileSync(file, "utf-8")) as { cases: { q: string; tool: string; args: Record<string, unknown> }[] };
    const misses = cases.filter((c) => JSON.stringify(strip(route(c.q, data))) !== JSON.stringify({ tool: c.tool, args: c.args }) && !sameArgs(route(c.q, data), c));
    const score = { right: cases.length - misses.length, of: cases.length, misses: misses.map((m) => ({ q: m.q, expected: `${m.tool} ${JSON.stringify(m.args)}`, got: trace(route(m.q, data)) })) };
    fs.writeFileSync(path.join(process.cwd(), "tests", "fixtures", "assistant-heldout-score.json"), JSON.stringify(score, null, 1));
    console.log(`held-out: ${score.right} of ${score.of}`, score.misses);
    expect(score.right / score.of).toBeGreaterThanOrEqual(0.75);
  });
});

function sameArgs(c: ToolCall, e: { tool: string; args: Record<string, unknown> }): boolean {
  if (c.tool !== e.tool) return false;
  const a = c.args as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(e.args)]);
  return [...keys].every((k) => a[k] === e.args[k]);
}
