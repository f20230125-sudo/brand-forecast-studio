import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clamp, LIMITS, retentionAt, runScenario } from "./scenario";
import type { Brand, Meta } from "./types";

const data = (f: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "data", f), "utf-8"));
const brands: Brand[] = data("brands.json");
const meta: Meta = data("meta.json");
type Case = { input: { brand: string; price_change_pct: number; volume_change_pct: number; start_quarter: string; generic_entry_quarter: string | null }; quarters: { spend: number }[] };
const cases: Case[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "scenarios.json"), "utf-8"));

describe("the scenario arithmetic matches the Python engine", () => {
  it.each(cases.map((c) => [c.input.brand, c] as [string, Case]))("%s", (_name, c) => {
    const brand = brands.find((b) => b.brand === c.input.brand)!;
    const out = runScenario(brand, c.input, meta.retention);
    out.forEach((q, i) => {
      // brands.json rounds price to 4 decimals and units to 1, so allow a hair of relative error.
      expect(Math.abs(q.spend - c.quarters[i].spend) / Math.max(1, c.quarters[i].spend)).toBeLessThan(1e-4);
    });
  });
});

describe("scenario rules", () => {
  const januvia = brands.find((b) => b.brand === "JANUVIA")!;
  it("no change is the forecast", () => {
    const out = runScenario(januvia, { price_change_pct: 0, volume_change_pct: 0, start_quarter: januvia.forecast[0].q, generic_entry_quarter: null }, meta.retention);
    for (const q of out) expect(q.delta_spend).toBeCloseTo(0, 6);
  });
  it("a price change from Q3 leaves Q1 and Q2 alone", () => {
    const out = runScenario(januvia, { price_change_pct: -10, volume_change_pct: 0, start_quarter: januvia.forecast[2].q, generic_entry_quarter: null }, meta.retention);
    expect(out[0].delta_spend).toBeCloseTo(0, 6);
    expect(out[2].delta_spend / out[2].base_spend).toBeCloseTo(-0.1, 9);
  });
  it("retention holds its last value after eight quarters, and inputs are clamped", () => {
    expect(retentionAt(meta.retention, 20)).toBe(meta.retention["8"]);
    expect(clamp(-500, LIMITS.price)).toBe(-90);
    expect(clamp(Number.NaN, LIMITS.volume)).toBe(0);
  });
  it("every brand has four forecast quarters with ordered intervals", () => {
    expect(brands).toHaveLength(19);
    for (const b of brands) {
      expect(b.forecast).toHaveLength(4);
      for (const f of b.forecast) expect(f.p10 <= f.p50 && f.p50 <= f.p90).toBe(true);
    }
  });
});
