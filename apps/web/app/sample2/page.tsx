"use client";
// Direction 2 — "Night Shift": dark cinematic. Glass panels over a deep glow, mono numerals, one lime signal colour.
import { useState } from "react";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { ArrowDownLeft, ArrowUpRight, Bot, Command, FileText, Home, Landmark, Plus, Receipt, Search, Settings, ShieldAlert, Users } from "lucide-react";
import { aging, attention, autopay, biz, cashSeries, invoices, kpis, payRuns, people, transactions, usd, usd0 } from "@/lib/sample-data";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--f-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--f-mono" });

const RAIL = [
  [Home, "Home"], [FileText, "Invoices"], [Receipt, "Bills"], [Users, "Payroll"], [Landmark, "Ledger"], [Bot, "Autopay"], [Settings, "Settings"],
] as const;

function Curve() {
  const w = 1240, h = 180, max = Math.max(...cashSeries) * 1.08, min = Math.min(...cashSeries) * 0.85;
  const pts = cashSeries.map((v, i) => [(i / (cashSeries.length - 1)) * w, h - ((v - min) / (max - min)) * h] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts.at(-1)!;
  return (
    <svg viewBox={`0 0 ${w} ${h + 4}`} className="h-[180px] w-full" role="img" aria-label="Cash balance, last 21 days: dipped on payroll day and recovered to $18,420">
      <defs>
        <linearGradient id="s2f" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#C8F55A" stopOpacity=".28" /><stop offset="1" stopColor="#C8F55A" stopOpacity="0" /></linearGradient>
        <filter id="s2g"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="white" strokeOpacity=".05" />)}
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#s2f)" />
      <path d={d} fill="none" stroke="#C8F55A" strokeWidth="5" opacity=".35" filter="url(#s2g)" />
      <path d={d} fill="none" stroke="#C8F55A" strokeWidth="2" className="s2-draw" />
      <line x1={pts[9][0]} x2={pts[9][0]} y1="0" y2={h} stroke="white" strokeOpacity=".18" strokeDasharray="3 4" />
      <text x={pts[9][0] + 8} y="14" fill="white" fillOpacity=".5" fontSize="11" fontFamily="var(--f-mono)">PAYROLL −$10,200</text>
      <circle cx={lx} cy={ly} r="5" fill="#C8F55A" className="s2-pulse" />
    </svg>
  );
}

export default function Sample2() {
  const [active, setActive] = useState("Home");
  const [range, setRange] = useState("21D");
  const agingTotal = aging.reduce((a, b) => a + b.value, 0);

  return (
    <div className={`${display.variable} ${mono.variable} relative min-h-dvh overflow-hidden bg-[#07080A] text-[#E9ECEF] [font-family:var(--f-display)]`}>
      <style>{`
        .s2-mono{font-family:var(--f-mono);font-variant-numeric:tabular-nums}
        .s2-glass{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 20px 60px -30px rgba(0,0,0,.8)}
        .s2-draw{stroke-dasharray:1600;stroke-dashoffset:0}
        @media (prefers-reduced-motion:no-preference){
          .s2-draw{animation:s2d 1.6s cubic-bezier(.6,.1,.2,1) both}
          .s2-pulse{animation:s2p 2.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
          .s2-in{animation:s2i .8s cubic-bezier(.2,.7,.2,1) both}
        }
        @keyframes s2d{from{stroke-dashoffset:1600}}
        @keyframes s2p{50%{transform:scale(1.6);opacity:.5}}
        @keyframes s2i{from{opacity:0;transform:translateY(10px);filter:blur(4px)}to{opacity:1;transform:none;filter:none}}
      `}</style>
      {/* ambient light */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/3 h-[520px] w-[820px] rounded-full bg-[#5B7CFA] opacity-[0.16] blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -right-40 top-40 h-[420px] w-[520px] rounded-full bg-[#C8F55A] opacity-[0.07] blur-[120px]" />

      <div className="relative flex">
        {/* icon rail */}
        <nav aria-label="Primary" className="sticky top-0 flex h-dvh w-[76px] flex-col items-center gap-2 border-r border-white/[0.06] py-5">
          <div className="mb-4 grid size-10 place-items-center rounded-xl bg-[#C8F55A] text-[15px] font-bold text-black">S</div>
          {RAIL.map(([Icon, label]) => (
            <button key={label} aria-label={label} title={label} onClick={() => setActive(label)}
              className={`relative grid size-11 place-items-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-[#C8F55A] ${active === label ? "bg-white/[0.08] text-white" : "text-white/45 hover:bg-white/[0.04] hover:text-white/80"}`}>
              {active === label && <span aria-hidden className="absolute -left-[17px] h-5 w-[3px] rounded-full bg-[#C8F55A]" />}
              <Icon className="size-[18px]" aria-hidden />
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 px-8 pb-16 pt-6">
          {/* top bar */}
          <div className="flex items-center gap-4">
            <div>
              <p className="s2-mono text-[11px] uppercase tracking-[0.2em] text-white/40">{biz.account}</p>
              <h1 className="text-[22px] font-medium">{biz.name}</h1>
            </div>
            <button className="s2-glass ml-auto flex h-10 w-[340px] items-center gap-2 rounded-xl px-3 text-[13px] text-white/45 hover:text-white/70 focus-visible:outline-2 focus-visible:outline-[#C8F55A]">
              <Search className="size-4" aria-hidden /> Search or jump to…
              <span className="s2-mono ml-auto flex items-center gap-0.5 rounded-md border border-white/10 px-1.5 py-0.5 text-[11px]"><Command className="size-3" aria-hidden />K</span>
            </button>
            <button className="s2-glass h-10 rounded-xl px-4 text-[13px] font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#C8F55A]">Move money</button>
            <button className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#C8F55A] px-4 text-[13px] font-semibold text-black shadow-[0_0_30px_-6px_#C8F55A] hover:bg-[#d6ff74] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8F55A]">
              <Plus className="size-4" aria-hidden /> New invoice
            </button>
          </div>

          {/* hero: cash + curve */}
          <section className="s2-glass s2-in mt-6 rounded-2xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] text-white/50">Cash available</p>
                <p className="s2-mono mt-1 text-[52px] font-medium leading-none tracking-tight">{usd(kpis.cash)}</p>
                <p className="mt-2 flex items-center gap-2 text-[13px]">
                  <span className="s2-mono rounded-md bg-[#C8F55A]/15 px-1.5 py-0.5 text-[#C8F55A]">▲ {kpis.cashDelta}%</span>
                  <span className="text-white/45">vs last month · sUSD on NEAR testnet</span>
                </p>
              </div>
              <div role="tablist" aria-label="Range" className="s2-mono flex rounded-lg border border-white/10 p-0.5 text-[11px]">
                {["7D", "21D", "90D", "YTD"].map((r) => (
                  <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)} className={`h-8 rounded-md px-3 focus-visible:outline-2 focus-visible:outline-[#C8F55A] ${range === r ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}>{r}</button>
                ))}
              </div>
            </div>
            <div className="mt-4"><Curve /></div>
            <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06]">
              {[
                ["Owed to you", usd0(kpis.receivables), `${usd0(kpis.overdue)} overdue`, "warn"],
                ["Bills · 14d", usd0(kpis.billsDue14d), "3 unpaid", ""],
                ["In · 30d", usd0(kpis.inflow30d), "11 payments", "good"],
                ["Out · 30d", usd0(kpis.outflow30d), "incl. payroll", ""],
              ].map(([k, v, s, t]) => (
                <div key={k} className="bg-[#0C0E11]/80 px-4 py-3">
                  <p className="text-[12px] text-white/45">{k}</p>
                  <p className="s2-mono mt-0.5 text-[22px]">{v}</p>
                  <p className={`text-[12px] ${t === "warn" ? "text-[#FFB347]" : t === "good" ? "text-[#C8F55A]" : "text-white/40"}`}>{s}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-5 grid grid-cols-[1.35fr_1fr] gap-5 [&>*]:min-w-0">
            {/* attention */}
            <section className="s2-glass s2-in rounded-2xl p-5 [animation-delay:.1s]">
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-medium">Needs you <span className="s2-mono ml-1 rounded-md bg-white/10 px-1.5 text-[12px]">{attention.length}</span></h2>
                <span className="text-[12px] text-white/40">AI triaged · 2 min ago</span>
              </div>
              <ul className="mt-3 space-y-2">
                {attention.map((a) => (
                  <li key={a.title} className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 hover:border-white/15 hover:bg-white/[0.04]">
                    <span className={`grid size-9 place-items-center rounded-lg ${a.kind === "review" ? "bg-[#FF5C5C]/15 text-[#FF8A8A]" : a.kind === "approval" ? "bg-[#5B7CFA]/20 text-[#9DB0FF]" : "bg-[#FFB347]/15 text-[#FFB347]"}`}>
                      {a.kind === "review" ? <ShieldAlert className="size-4" aria-hidden /> : a.kind === "approval" ? <Receipt className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{a.title}</span><span className="block truncate text-[12px] text-white/45">{a.sub}</span></span>
                    <span className="s2-mono text-[14px]">{usd0(a.amount)}</span>
                    <button className={`h-9 rounded-lg px-3 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-[#C8F55A] ${a.kind === "approval" ? "bg-[#C8F55A] text-black hover:bg-[#d6ff74]" : "border border-white/15 hover:bg-white/10"}`}>
                      {a.kind === "approval" ? "Approve" : a.kind === "review" ? "Inspect" : "Nudge"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {/* autopay + aging */}
            <section className="s2-glass s2-in rounded-2xl p-5 [animation-delay:.16s]">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[15px] font-medium"><Bot className="size-4 text-[#C8F55A]" aria-hidden /> AI autopay</h2>
                <span className="s2-mono flex items-center gap-1.5 text-[11px] text-[#C8F55A]"><span className="size-1.5 rounded-full bg-[#C8F55A] shadow-[0_0_8px_#C8F55A]" aria-hidden />ENFORCED ON-CHAIN</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`${usd0(autopay.spentToday)} of ${usd0(autopay.daily)} daily budget used`}>
                <div className="h-full rounded-full bg-gradient-to-r from-[#C8F55A] to-[#7CE0A0]" style={{ width: `${(autopay.spentToday / autopay.daily) * 100}%` }} />
              </div>
              <p className="s2-mono mt-2 text-[12px] text-white/50">{usd0(autopay.spentToday)} / {usd0(autopay.daily)} today · ≤ {usd0(autopay.perTx)} per bill</p>
              <h3 className="mt-6 text-[13px] text-white/50">Receivables aging</h3>
              <div className="mt-2 space-y-2">
                {aging.map((b, i) => (
                  <div key={b.label} className="grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-3 text-[12px]">
                    <span className="text-white/50">{b.label}</span>
                    <div className="h-1.5 rounded-full bg-white/[0.05]"><div className="h-full rounded-full" style={{ width: `${(b.value / agingTotal) * 100}%`, background: i === 0 ? "#C8F55A" : i === 1 ? "#FFB347" : "#FF5C5C" }} /></div>
                    <span className="s2-mono text-right">{usd0(b.value)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="mt-5 grid grid-cols-[1.35fr_1fr] gap-5 [&>*]:min-w-0">
            {/* invoices */}
            <section className="s2-glass s2-in overflow-hidden rounded-2xl [animation-delay:.22s]">
              <div className="flex items-center justify-between px-5 pt-5"><h2 className="text-[15px] font-medium">Invoices</h2><a href="#" className="text-[12px] text-white/50 hover:text-white">View all →</a></div>
              <table className="mt-3 w-full text-[13px]">
                <thead><tr className="border-y border-white/[0.06] text-left text-[11px] uppercase tracking-[0.12em] text-white/35"><th className="px-5 py-2 font-medium">Invoice</th><th className="font-medium">Customer</th><th className="font-medium">Status</th><th className="px-5 text-right font-medium">Amount</th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.number} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                      <td className="s2-mono px-5 py-3 text-white/70">{i.number}</td>
                      <td>{i.customer}{i.via && <span className="ml-2 rounded bg-[#5B7CFA]/15 px-1.5 py-0.5 text-[10px] text-[#9DB0FF]">{i.via}</span>}</td>
                      <td>
                        <span className={`s2-mono rounded-md px-2 py-0.5 text-[11px] ${i.status === "paid" ? "bg-[#C8F55A]/12 text-[#C8F55A]" : i.status === "overdue" ? "bg-[#FF5C5C]/12 text-[#FF8A8A]" : i.status === "partial" ? "bg-[#FFB347]/12 text-[#FFB347]" : "bg-white/[0.06] text-white/60"}`}>
                          {i.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="s2-mono px-5 text-right">{usd(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* payroll + feed */}
            <section className="s2-glass s2-in rounded-2xl p-5 [animation-delay:.28s]">
              <div className="flex items-center justify-between"><h2 className="text-[15px] font-medium">Payroll</h2><button className="rounded-lg border border-white/15 px-3 py-1.5 text-[12px] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#C8F55A]">Run December</button></div>
              <div className="mt-3 flex -space-x-2">
                {people.map((p) => <span key={p.name} title={p.name} className="grid size-9 place-items-center rounded-full border-2 border-[#0C0E11] bg-gradient-to-br from-[#5B7CFA] to-[#8E5BFA] text-[11px] font-semibold">{p.initials}</span>)}
              </div>
              <p className="s2-mono mt-2 text-[12px] text-white/50">Last run {payRuns[0].date} · {usd0(payRuns[0].total)} · {payRuns[0].people} people · 1 tx</p>
              <h3 className="mt-5 text-[13px] text-white/50">Live ledger</h3>
              <ul className="mt-2 space-y-1.5">
                {transactions.slice(0, 5).map((t, k) => (
                  <li key={k} className="flex items-center gap-2.5 text-[13px]">
                    <span className={`grid size-6 place-items-center rounded-md ${t.amount > 0 ? "bg-[#C8F55A]/12 text-[#C8F55A]" : "bg-white/[0.06] text-white/50"}`}>
                      {t.amount > 0 ? <ArrowDownLeft className="size-3.5" aria-hidden /> : <ArrowUpRight className="size-3.5" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t.desc}</span>
                    <span className={`s2-mono ${t.amount > 0 ? "text-[#C8F55A]" : "text-white/70"}`}>{usd(t.amount, true)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <p className="s2-mono mt-8 text-center text-[11px] uppercase tracking-[0.2em] text-white/25">Sample 2 of 3 — “Night Shift”</p>
        </main>
      </div>
    </div>
  );
}
