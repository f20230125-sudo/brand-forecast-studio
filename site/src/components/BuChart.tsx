"use client";

import { scaleLinear } from "d3-scale";
import { usd, signedPct } from "@/lib/format";
import { fit, niceTicks, roundedBar, Tip, useTip, useWidth } from "./chart";

export type BuRow = { bu: string; brands: number; y2025: number; y2026: number; scenario: number | null };

/** Paired bars per business unit: 2025 actual (outlined) and the 2026 forecast (solid). */
export function BuChart({ rows }: { rows: BuRow[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const { tip, atPointer, hide } = useTip(ref);
  const label = Math.min(150, Math.round(w * 0.3));
  const right = 64;
  const row = 44;
  const h = rows.length * row + 26;
  const { top, ticks } = niceTicks(Math.max(...rows.flatMap((r) => [r.y2025, r.y2026, r.scenario ?? 0])));
  const x = scaleLinear().domain([0, top]).range([label, w - right]);
  return (
    <div ref={ref} style={{ position: "relative" }} onMouseLeave={hide}>
      <svg className="svg" width={w} height={h} role="img" aria-label={`US Medicaid spend by business unit, 2025 actual then 2026 forecast: ${rows.map((r) => `${r.bu} ${usd(r.y2025)} then ${usd(r.y2026)}`).join("; ")}.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={x(t)} x2={x(t)} y1={0} y2={h - 22} />
            <text x={x(t)} y={h - 6} textAnchor="middle" className="t-mute">
              {usd(t, 0)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = i * row + 6;
          const tipRows = [
            { label: "2025 actual", value: usd(r.y2025) },
            { label: "2026 forecast", value: `${usd(r.y2026)} (${signedPct(r.y2026 / r.y2025 - 1)})` },
            ...(r.scenario != null ? [{ label: "2026, your scenario", value: usd(r.scenario) }] : []),
          ];
          return (
            <g
              key={r.bu}
              onMouseMove={atPointer(r.bu, tipRows)}
            >
              <rect x={0} y={y - 4} width={w} height={row - 4} fill="transparent" />
              <text x={0} y={y + 15} className="t-strong">
                {fit(r.bu, label - 10)}
              </text>
              <path d={roundedBar(x(0), y, x(r.y2025) - x(0), 13, 2, "right")} fill="none" stroke="var(--ink)" strokeWidth={1.2} />
              <path d={roundedBar(x(0), y + 16, x(r.y2026) - x(0), 13, 2, "right")} fill="var(--ink)" />
              {r.scenario != null && <line x1={x(r.scenario)} x2={x(r.scenario)} y1={y + 13} y2={y + 32} stroke="var(--cell-rule)" strokeWidth={2.5} />}
              <text x={x(Math.max(r.y2026, r.y2025)) + 6} y={y + 26}>
                {signedPct(r.y2026 / r.y2025 - 1)}
              </text>
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} width={w} />
    </div>
  );
}
