import type { Brand } from "./types";

// The same arithmetic as src/bf/scenario.py. A test runs the Python cases in tests/fixtures/scenarios.json
// through this file and requires the same spend to the cent.

export type ScenarioInput = {
  price_change_pct: number;
  volume_change_pct: number;
  start_quarter: string;
  generic_entry_quarter: string | null;
};

export type ScenarioQuarter = {
  quarter: string;
  base_spend: number;
  spend: number;
  delta_spend: number;
  price_effect: number;
  volume_effect: number;
};

export const LIMITS = { price: [-90, 100], volume: [-90, 200] } as const;

export function retentionAt(retention: Record<string, number>, k: number): number {
  const keys = Object.keys(retention).map(Number);
  const last = Math.max(...keys);
  return retention[String(Math.min(k, last))];
}

export function runScenario(brand: Brand, s: ScenarioInput, retention: Record<string, number>): ScenarioQuarter[] {
  const qs = brand.forecast.map((f) => f.q);
  const start = qs.indexOf(s.start_quarter);
  const entry = s.generic_entry_quarter ? qs.indexOf(s.generic_entry_quarter) : -1;
  return brand.forecast.map((f, i) => {
    const active = i >= start;
    const price = active ? f.price * (1 + s.price_change_pct / 100) : f.price;
    let units = active ? f.units * (1 + s.volume_change_pct / 100) : f.units;
    if (entry >= 0 && i >= entry) units *= retentionAt(retention, i - entry);
    const base = f.units * f.price;
    const spend = units * price;
    return {
      quarter: f.q,
      base_spend: base,
      spend,
      delta_spend: spend - base,
      volume_effect: (units - f.units) * f.price,
      price_effect: (price - f.price) * units,
    };
  });
}

/** A scenario a person can type is clamped into the range the Python model accepts. */
export function clamp(v: number, [lo, hi]: readonly [number, number]): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;
}
