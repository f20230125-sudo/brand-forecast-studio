export type HistoryPoint = { q: string; spend: number; units: number };
export type ForecastPoint = { q: string; price: number; units: number; p10: number; p50: number; p90: number };
export type Brand = { brand: string; bu: string; area: string; history: HistoryPoint[]; forecast: ForecastPoint[] };

export type SummaryRow = {
  scope: string;
  horizon: string;
  n: number;
  model: number;
  naive: number;
  seasonal_naive: number;
  drift: number;
  interval_coverage: number;
};
export type BrandBacktest = { brand: string; bu: string; n: number; model: number; naive: number; seasonal_naive: number; drift: number; best: string };
export type CalibrationRow = {
  scope: string;
  horizon: string;
  n: number;
  coverage_raw: number | null;
  coverage_calibrated: number | null;
  median_width_raw: number | null;
  median_width_calibrated: number | null;
};
export type Importance = { feature: string; share: number };
export type Backtest = { summary: SummaryRow[]; byBrand: BrandBacktest[]; origins: [string, string]; calibration: CalibrationRow[]; importance: Importance[] };
export type HealthCheck = { id: string; check: string; status: "pass" | "warn" | "fail" | "info"; result: string; rule: string };
export type Meta = { built: string; retention: Record<string, number>; panelBrands: number; panelRows: number; lastQuarter: string };

export type Dataset = { brands: Brand[]; backtest: Backtest; health: HealthCheck[]; meta: Meta };
