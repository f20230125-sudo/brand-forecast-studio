"use client";

import { useState } from "react";
import { answer, trace, type Answer } from "@/lib/assistant";
import type { Dataset } from "@/lib/types";

const EXAMPLES = [
  "What if Januvia cuts price by 5% and a generic launches in Q3?",
  "What is the HIV business unit forecast?",
  "How accurate is the Keytruda forecast?",
  "Which brands grow fastest in 2026?",
  "Can I trust the P10 to P90 range?",
];

export function Ask({ data, onOpen }: { data: Dataset; onOpen: (s: NonNullable<Answer["scenario"]>) => void }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState<Answer | null>(null);
  const ask = (text: string) => {
    if (!text.trim()) return;
    setQ(text);
    setA(answer(text, data));
  };

  return (
    <div className="ask">
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <label htmlFor="ask-q" className="sr-only">
          Ask about the forecast
        </label>
        <input id="ask-q" className="ask-in" type="text" value={q} placeholder="Ask about a brand, a business unit, a what-if…" onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <button type="submit" className="btn">
          Ask
        </button>
      </form>
      <div className="ask-ex" role="group" aria-label="Example questions">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" className="chip" onClick={() => ask(x)}>
            {x}
          </button>
        ))}
      </div>
      <div className="ask-out" aria-live="polite">
        {a && (
          <>
            <p className="ask-a">{a.text}</p>
            {a.rows && a.rows.length > 0 && (
              <table className="tbl ask-t">
                <caption className="sr-only">Answer detail</caption>
                <tbody>
                  {a.rows.map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row">{k}</th>
                      <td className="n">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="ask-trace">
              <span>Tool call</span> <code>{a.call.tool === "none" ? "none: declined" : trace(a.call)}</code>
            </p>
            {a.scenario && (
              <button type="button" className="btn" onClick={() => onOpen(a.scenario!)}>
                Open this in the what-if
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
