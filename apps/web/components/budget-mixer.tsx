"use client";
// A spending budget as a mixing desk (uberdesigner "budget-mixer", re-lit in the Blue night tokens). Each channel has
// a fader (its budget) and an LED meter (what's actually been spent). The channels share one fixed total: drag or
// arrow-key a fader and the other unlocked channels rebalance. Past the budget line the meter turns amber, then red
// with an overspend tag.
import { useRef, useState } from "react";
import "./beam.css";

export interface MixerChannel {
  key: string;
  name: string;
  alloc: number;
  spent: number;
  locked?: boolean;
}

const SHADES = ["#3b4a7a", "#5e76bd", "#8ea8e8", "#eef3ff", "#b9cdf7", "#6f86c8"];
const TH = 300, SEGMENTS = 30, FULL = 24, NEAR = 20;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Sets channel i to `raw` and rescales the other unlocked channels so the sum stays at `total`. */
export function rebalance(chs: MixerChannel[], i: number, raw: number, total: number, vmax: number, step: number): MixerChannel[] {
  const fixed = chs.reduce((s, c, j) => s + (c.locked && j !== i ? c.alloc : 0), 0);
  const v = Math.max(0, Math.min(vmax, total - fixed, Math.round(raw / step) * step));
  const others = chs.map((c, j) => (j !== i && !c.locked ? j : -1)).filter((j) => j >= 0);
  const free = total - fixed - v;
  const cur = others.reduce((s, j) => s + chs[j].alloc, 0);
  const next = chs.map((c) => ({ ...c }));
  next[i].alloc = v;
  others.forEach((j) => (next[j].alloc = Math.min(vmax, Math.round((cur > 0 ? (chs[j].alloc * free) / cur : free / others.length) / step) * step)));
  const drift = total - next.reduce((s, c) => s + c.alloc, 0);
  if (drift && others.length) next[others.reduce((a, b) => (next[a].alloc >= next[b].alloc ? a : b))].alloc += drift;
  return next;
}

export function BudgetMixer({
  channels,
  total,
  onChange,
  title,
  caption = "Operating budget",
  totalCaption = "Fixed total · one sum",
  hint,
  action,
}: {
  channels: MixerChannel[];
  total: number;
  onChange: (next: MixerChannel[]) => void;
  title: string;
  caption?: string;
  totalCaption?: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const [held, setHeld] = useState<number | null>(null);
  const tracks = useRef<(HTMLDivElement | null)[]>([]);
  // one scale for every fader: $0 → a round number above the largest budget or spend
  const peak = Math.max(1, ...channels.map((c) => Math.max(c.alloc, c.spent)));
  const vmax = Math.max(1000, Math.ceil((peak * 1.2) / 1000) * 1000);
  const step = vmax >= 10000 ? 100 : vmax >= 4000 ? 50 : 10;
  const tick = vmax / 8;
  const spent = channels.reduce((s, c) => s + c.spent, 0);
  const over = channels.reduce((s, c) => s + Math.max(0, c.spent - c.alloc), 0);
  const set = (i: number, v: number) => onChange(rebalance(channels, i, v, total, vmax, step));
  const fromY = (i: number, clientY: number) => {
    const r = tracks.current[i]!.getBoundingClientRect();
    return ((r.bottom - clientY) / r.height) * vmax;
  };
  const kfmt = (v: number) => (v === 0 ? "0" : v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v));

  return (
    <section data-theme="dark" className="bf-mixer glass rounded-[22px]" aria-label={`${caption}: ${title}`}>
      <div className="bf-mixer-head">
        <div>
          <p className="bf-cap">{caption}</p>
          <h2 className="bf-display">{title}</h2>
        </div>
        <div className="bf-right">
          <p className="bf-cap">{totalCaption}</p>
          <p className="bf-display bf-mono">{usd(total)}</p>
        </div>
      </div>
      <div className="bf-split" aria-hidden>
        {channels.map((c, i) => <i key={c.key} style={{ flex: `${Math.max(c.alloc, 0.0001)} 1 0`, background: SHADES[i % SHADES.length], opacity: held === null || held === i ? 1 : 0.55 }} />)}
      </div>

      <div className="bf-desk">
        {channels.map((c, i) => {
          const lit = c.alloc > 0 ? (c.spent / c.alloc) * FULL : c.spent > 0 ? SEGMENTS : 0;
          const top = TH - (Math.min(c.alloc, vmax) / vmax) * TH;
          const overBy = c.spent - c.alloc;
          return (
            <div key={c.key} className="bf-strip">
              <div className="bf-cap bf-strip-name" title={c.name}><i style={{ background: SHADES[i % SHADES.length] }} />{c.name}</div>
              {c.locked && <div className="bf-cap bf-lock">Fixed</div>}
              <div className="bf-fader">
                <div className="bf-ticks" aria-hidden>
                  {Array.from({ length: 9 }, (_, k) => k * tick).map((v, k) => (
                    <span key={k}>
                      <i className="bf-tick" style={{ top: TH - (v / vmax) * TH, width: k % 4 === 0 ? 12 : 6 }} />
                      {k % 4 === 0 && <b className="bf-tick-label" style={{ top: TH - (v / vmax) * TH }}>{kfmt(v)}</b>}
                    </span>
                  ))}
                </div>
                <div
                  ref={(el) => { tracks.current[i] = el; }}
                  role="slider"
                  tabIndex={c.locked ? -1 : 0}
                  aria-label={`${c.name} budget`}
                  aria-valuemin={0}
                  aria-valuemax={vmax}
                  aria-valuenow={c.alloc}
                  aria-valuetext={`${usd(c.alloc)} budget, ${usd(c.spent)} spent`}
                  aria-readonly={c.locked || undefined}
                  className={`bf-hit ${c.locked ? "bf-locked" : ""}`}
                  onPointerDown={(e) => { if (c.locked) return; e.currentTarget.setPointerCapture(e.pointerId); setHeld(i); set(i, fromY(i, e.clientY)); }}
                  onPointerMove={(e) => { if (held === i) set(i, fromY(i, e.clientY)); }}
                  onPointerUp={() => setHeld(null)}
                  onPointerCancel={() => setHeld(null)}
                  onKeyDown={(e) => {
                    if (c.locked) return;
                    const d = ({ ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 } as Record<string, number>)[e.key];
                    if (d) { e.preventDefault(); set(i, c.alloc + d * step * 5); }
                  }}
                >
                  <div className="bf-track"><div className="bf-fill" style={{ height: TH - top }} /></div>
                  <div className={`bf-capknob ${held === i ? "bf-held" : ""}`} style={{ top }}><span className="bf-capring" /></div>
                </div>
                <div className="bf-meter" aria-hidden>
                  {Array.from({ length: SEGMENTS }, (_, k) => {
                    const a = clamp01(lit - k);
                    const zone = c.locked ? "fine" : k >= FULL ? "over" : k >= NEAR ? "near" : "fine";
                    const rgb = zone === "over" ? "255 75 62" : zone === "near" ? "255 181 71" : "200 222 255";
                    return <i key={k} style={{ top: TH - (k + 1) * (TH / SEGMENTS) + 1.5, background: a > 0 ? `rgb(${rgb} / ${0.25 + 0.75 * a})` : undefined, boxShadow: a > 0.5 && zone !== "fine" ? `0 0 8px rgb(${rgb} / .7)` : undefined }} />;
                  })}
                  <span className="bf-mark" style={{ top: TH - FULL * (TH / SEGMENTS) }} />
                  {overBy > 0 && <span className="bf-tag" style={{ top: TH - Math.min(SEGMENTS, lit) * (TH / SEGMENTS) - 28 }}>−{usd(overBy)}</span>}
                </div>
              </div>
              <div className="bf-strip-val bf-mono">{usd(c.alloc)}</div>
              <div className="bf-cap">{total > 0 ? Math.round((c.alloc / total) * 100) : 0}% of total</div>
              <div className="bf-strip-spent">Spent <b>{usd(c.spent)}</b></div>
            </div>
          );
        })}

        <div className="bf-master">
          <p className="bf-cap">Master</p>
          <dl>
            {[["Spent", usd(spent)], ["Left", usd(Math.max(0, total - spent))], ["Over", usd(over)]].map(([k, v]) => (
              <div key={k} className="bf-cap bf-row"><dt>{k}</dt><dd className={`bf-mono ${k === "Over" && over > 0 ? "bf-over" : ""}`}>{v}</dd></div>
            ))}
          </dl>
          {hint && <p className="bf-hint">{hint}</p>}
          {action && <div className="bf-action">{action}</div>}
        </div>
      </div>
    </section>
  );
}
