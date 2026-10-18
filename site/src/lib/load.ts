import fs from "node:fs";
import path from "node:path";
import type { Dataset } from "./types";

const DIR = path.join(process.cwd(), "public", "data");

function read<T>(file: string, check: (v: T) => boolean): T {
  const v = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf-8")) as T;
  if (!check(v)) throw new Error(`${file} is missing what the page needs`);
  return v;
}

/** Reads the data files at build time; a file without its expected shape fails the build with its name. */
export function loadDataset(): Dataset {
  return {
    brands: read("brands.json", (b: Dataset["brands"]) => Array.isArray(b) && b.length > 0 && b.every((x) => x.forecast.length === 4 && x.history.length > 0)),
    backtest: read("backtest.json", (b: Dataset["backtest"]) => Array.isArray(b.summary) && Array.isArray(b.byBrand)),
    health: read("health.json", (h: Dataset["health"]) => Array.isArray(h) && h.length > 0),
    meta: read("meta.json", (m: Dataset["meta"]) => typeof m.lastQuarter === "string" && Object.keys(m.retention).length > 0),
  };
}
