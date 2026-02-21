"use client";

import { useRef } from "react";
import type { ScenarioQuarter } from "@/lib/scenario";
import type { Brand } from "@/lib/types";
import { usd } from "@/lib/format";
import { niceTicks, Tip, useTip, useWidth } from "./chart";

/**
 * Quarterly spend: history as a solid ink line, the forecast as a dashed line inside its P10-P90 band, and the
 * scenario (when it differs) as a line in the assumption colour. Hovering a quarter reads all of them out.
 */
export function ForecastChart({ brand, scenario, changed }: { brand: Brand; scenario: ScenarioQuarter[]; changed: boolean }) {
  const [wrap, width] = useWidth<HTMLDivElement>(900);
  const host = useRef<HTMLDivElement | null>(null);
  const { tip, atPointer, hide } = useTip(host);
  const h = 300;
  const m = { top: 16, right: 16, bottom: 30, left: 56 };
  const iw = Math.max(200, width - m.left - m.right);
  const ih = h - m.top - m.bottom;
  const qs = [...brand.history.map((p) => p.q), ...brand.forecast.map((f) => f.q)];
  const n = qs.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * iw : 0);
  const peak = Math.max(...brand.history.map((p) => p.spend), ...brand.forecast.map((f) => f.p90), ...scenario.map((s) => s.spend));
  const { top, ticks } = niceTicks(peak, 4);
  const y = (v: number) => ih - (v / top) * ih;
  const hi = brand.history.length;
  const histPath = brand.history.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.spend).toFixed(1)}`).join("");
  const last = brand.history[hi - 1];
  const fcPath = [`M${x(hi - 1).toFixed(1)},${y(last.spend).toFixed(1)}`, ...brand.forecast.map((f, i) => `L${x(hi + i).toFixed(1)},${y(f.p50).toFixed(1)}`)].join("");
  const band =
    `M${x(hi - 1).toFixed(1)},${y(last.spend).toFixed(1)}` +
    brand.forecast.map((f, i) => `L${x(hi + i).toFixed(1)},${y(f.p90).toFixed(1)}`).join("") +
    [...brand.forecast].reverse().map((f, j) => `L${x(hi + brand.forecast.length - 1 - j).toFixed(1)},${y(f.p10).toFixed(1)}`).join("") +
    "Z";
  const scPath = [`M${x(hi - 1).toFixed(1)},${y(last.spend).toFixed(1)}`, ...scenario.map((s, i) => `L${x(hi + i).toFixed(1)},${y(s.spend).toFixed(1)}`)].join("");
  const yearTicks = qs.map((q, i) => ({ q, i })).filter(({ q }) => q.endsWith("Q1"));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
    if (i < hi) {
      atPointer(qs[i], [{ label: "Spend", value: usd(brand.history[i].spend) }])(e);
    } else {
      const f = brand.forecast[i - hi];
      const s = scenario[i - hi];
      const rows = [
        { label: "Forecast", value: usd(f.p50) },
        { label: "P10 to P90", value: `${usd(f.p10)} to ${usd(f.p90)}` },
      ];
      if (changed) rows.push({ label: "Scenario", value: usd(s.spend) });
      atPointer(`${qs[i]} (forecast)`, rows)(e);
    }
  };

  return (
    <div ref={host} style={{ position: "relative" }}>
      <div ref={wrap}>
        <svg
          className="svg"
          viewBox={`0 0 ${width} ${h}`}
          width={width}
          height={h}
          role="img"
          aria-label={`${brand.brand} quarterly US Medicaid spend from ${qs[0]} to ${qs[hi - 1]}, then the forecast for ${brand.forecast[0].q} to ${brand.forecast[3].q}: ${brand.forecast.map((f) => `${f.q} ${usd(f.p50)}`).join(", ")}.`}
        >
          <g transform={`translate(${m.left},${m.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={0} x2={iw} y1={y(t)} y2={y(t)} />
                <text className="t-mute" x={-8} y={y(t) + 4} textAnchor="end">
                  {usd(t, 0)}
                </text>
              </g>
            ))}
            {yearTicks.map(({ q, i }) => (
              <text key={q} className="t-mute" x={x(i)} y={ih + 20} textAnchor="middle">
                {q.slice(0, 4)}
              </text>
            ))}
            <rect x={x(hi - 1)} y={0} width={iw - x(hi - 1)} height={ih} fill="var(--paper-2)" />
            <text className="t-mute" x={x(hi - 1) + 6} y={12}>
              forecast
            </text>
            <path d={band} fill="var(--tol)" stroke="var(--cell-rule)" strokeWidth={0.8} />
            <path d={histPath} fill="none" stroke="var(--ink)" strokeWidth={2} />
            <path d={fcPath} fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="5 4" />
            {changed && <path d={scPath} fill="none" stroke="var(--cell-rule)" strokeWidth={2.5} />}
            <line className="base" x1={0} x2={iw} y1={ih} y2={ih} />
            <rect x={0} y={0} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={hide} />
          </g>
        </svg>
      </div>
      <Tip tip={tip} width={width} />
    </div>
  );
}
