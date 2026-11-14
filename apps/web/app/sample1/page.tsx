"use client";
// Direction 1 — "Ledger": editorial paper. Warm stock, serif numerals, hairline rules, one ink-blue accent.
import { useState } from "react";
import { Instrument_Serif, Inter_Tight } from "next/font/google";
import { ArrowUpRight, Check, Plus, Search } from "lucide-react";
import { aging, attention, autopay, biz, invoices, kpis, payRuns, people, transactions, usd, usd0 } from "@/lib/sample-data";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--f-serif" });
const sans = Inter_Tight({ subsets: ["latin"], variable: "--f-sans" });

const NAV = ["Overview", "Invoices", "Bills", "Payroll", "Ledger", "Reports"];
const TABS = ["All", "Outstanding", "Overdue", "Paid"] as const;

export default function Sample1() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const rows = invoices.filter((i) =>
    tab === "All" ? true : tab === "Paid" ? i.status === "paid" : tab === "Overdue" ? i.status === "overdue" : i.status !== "paid",
  );
  const agingTotal = aging.reduce((a, b) => a + b.value, 0);

  return (
    <div className={`${serif.variable} ${sans.variable} min-h-dvh bg-[#F4EFE6] text-[#1B1915] [font-family:var(--f-sans)] selection:bg-[#2340D8] selection:text-white`}>
      <style>{`
        .s1-num{font-family:var(--f-serif);font-variant-numeric:lining-nums tabular-nums;letter-spacing:-0.01em}
        .s1-rule{border-color:#1B1915}
        .s1-hair{border-color:rgba(27,25,21,.14)}
        .s1-link{background-image:linear-gradient(currentColor,currentColor);background-size:0 1px;background-repeat:no-repeat;background-position:0 100%;transition:background-size .25s ease}
        .s1-link:hover{background-size:100% 1px}
        @media (prefers-reduced-motion:no-preference){.s1-rise{animation:s1r .7s cubic-bezier(.2,.7,.2,1) both}}
        @keyframes s1r{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      `}</style>

      {/* masthead */}
      <header className="mx-auto max-w-[1240px] px-8 pt-7">
        <div className="flex items-center justify-between text-[12px] uppercase tracking-[0.18em] text-[#6B655A]">
          <span>Thursday, 12 November 2026</span>
          <span>{biz.account}</span>
        </div>
        <div className="s1-rule mt-3 flex items-end justify-between border-b-2 pb-3">
          <h1 className="s1-num text-[44px] leading-none">
            Settle<span className="italic text-[#2340D8]">.</span>
          </h1>
          <nav aria-label="Primary" className="flex gap-7 text-[14px]">
            {NAV.map((n, i) => (
              <a key={n} href="#" className={`s1-link pb-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2340D8] ${i === 0 ? "font-semibold" : "text-[#4A453C]"}`}>{n}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button aria-label="Search" className="grid size-10 place-items-center rounded-full border border-[#1B1915]/20 hover:bg-[#1B1915]/5 focus-visible:outline-2 focus-visible:outline-[#2340D8]"><Search className="size-4" aria-hidden /></button>
            <button className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#1B1915] px-4 text-[14px] font-medium text-[#F4EFE6] hover:bg-[#2340D8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2340D8]">
              <Plus className="size-4" aria-hidden /> New invoice
            </button>
          </div>
        </div>
        <div className="s1-hair border-b py-1" />
      </header>

      <main className="mx-auto max-w-[1240px] px-8 pb-20">
        {/* lede */}
        <section className="s1-rise grid grid-cols-12 gap-8 pt-10">
          <div className="col-span-7">
            <p className="text-[13px] uppercase tracking-[0.18em] text-[#6B655A]">Cash available · {biz.name}</p>
            <p className="s1-num mt-2 text-[120px] leading-[0.9]">
              {usd0(Math.floor(kpis.cash))}<span className="text-[56px] text-[#8C857A]">.{String(Math.round((kpis.cash % 1) * 100)).padStart(2, "0")}</span>
            </p>
            <p className="mt-5 max-w-[46ch] text-[18px] leading-relaxed text-[#3B372F]">
              Good morning, {biz.owner}. You're <span className="italic [font-family:var(--f-serif)] text-[22px]">up {kpis.cashDelta}%</span> on last month. Café Nord paid from Solana overnight, and{" "}
              <a href="#attention" className="s1-link font-medium text-[#2340D8]">three things need you</a> before lunch.
            </p>
          </div>
          <dl className="s1-hair col-span-5 grid grid-cols-2 border-l pl-8">
            {[
              ["Owed to you", usd0(kpis.receivables), `${usd0(kpis.overdue)} overdue`],
              ["Bills · 14 days", usd0(kpis.billsDue14d), "3 unpaid"],
              ["Net flow · 30d", usd(kpis.netFlow30d).replace(/\.\d+$/, ""), `${usd0(kpis.inflow30d)} in`],
              ["Payroll · Nov", usd0(10_200), "4 people · paid"],
            ].map(([k, v, s], i) => (
              <div key={k} className={`s1-hair py-5 ${i % 2 ? "pl-6" : "pr-6 border-r"} ${i > 1 ? "border-t" : ""}`}>
                <dt className="text-[12px] uppercase tracking-[0.16em] text-[#6B655A]">{k}</dt>
                <dd className="s1-num mt-1 text-[40px] leading-none">{v}</dd>
                <dd className={`mt-1.5 text-[13px] ${s.includes("overdue") ? "text-[#B4361E]" : "text-[#6B655A]"}`}>{s}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* attention + aging */}
        <section id="attention" className="s1-rise s1-rule mt-12 grid grid-cols-12 gap-8 border-t pt-6 [animation-delay:.08s]">
          <div className="col-span-7">
            <h2 className="s1-num text-[30px] leading-none">Needs your signature</h2>
            <ol className="mt-4">
              {attention.map((a, i) => (
                <li key={a.title} className="s1-hair group grid grid-cols-[2.5rem_1fr_auto_auto] items-baseline gap-4 border-b py-4">
                  <span className="s1-num text-[22px] text-[#8C857A]">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="block text-[16px] font-medium">{a.title}</span>
                    <span className={`block text-[13px] ${a.kind === "review" ? "text-[#B4361E]" : "text-[#6B655A]"}`}>{a.sub}</span>
                  </span>
                  <span className="s1-num text-[22px]">{usd0(a.amount)}</span>
                  <button className="h-10 rounded-full border border-[#1B1915]/25 px-4 text-[13px] font-medium hover:border-[#2340D8] hover:bg-[#2340D8] hover:text-white focus-visible:outline-2 focus-visible:outline-[#2340D8]">
                    {a.kind === "approval" ? "Approve" : a.kind === "review" ? "Review" : "Remind"}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <aside className="col-span-5">
            <h2 className="s1-num text-[30px] leading-none">Receivables, by age</h2>
            <div className="mt-5 flex h-24 items-end gap-3">
              {aging.map((b, i) => (
                <div key={b.label} className="flex flex-1 flex-col items-center gap-2">
                  <div className="w-full" style={{ height: `${Math.max(2, (b.value / agingTotal) * 96)}px`, background: i === 0 ? "#1B1915" : i === 1 ? "#2340D8" : "#B4361E" }} />
                </div>
              ))}
            </div>
            <div className="s1-rule flex border-t pt-2">
              {aging.map((b) => (
                <div key={b.label} className="flex-1 text-center">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#6B655A]">{b.label}</div>
                  <div className="s1-num text-[18px]">{usd0(b.value)}</div>
                </div>
              ))}
            </div>
            <div className="s1-hair mt-6 flex items-center justify-between border-y py-3 text-[14px]">
              <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#2340D8]" aria-hidden /> AI autopay is on</span>
              <span className="text-[#6B655A]">{usd0(autopay.spentToday)} of {usd0(autopay.daily)} today · ≤ {usd0(autopay.perTx)} each</span>
            </div>
          </aside>
        </section>

        {/* invoices */}
        <section className="s1-rise s1-rule mt-12 border-t pt-6 [animation-delay:.16s]">
          <div className="flex items-end justify-between">
            <h2 className="s1-num text-[30px] leading-none">Invoices</h2>
            <div role="tablist" aria-label="Invoice filter" className="flex gap-6 text-[14px]">
              {TABS.map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`pb-1 focus-visible:outline-2 focus-visible:outline-[#2340D8] ${tab === t ? "border-b-2 border-[#2340D8] font-semibold" : "text-[#6B655A] hover:text-[#1B1915]"}`}>{t}</button>
              ))}
            </div>
          </div>
          <table className="mt-4 w-full text-[15px]">
            <thead>
              <tr className="s1-rule border-b text-left text-[11px] uppercase tracking-[0.16em] text-[#6B655A]">
                <th className="py-2 font-medium">Number</th><th className="font-medium">Customer</th><th className="font-medium">Due</th><th className="font-medium">Status</th><th className="text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.number} className="s1-hair cursor-pointer border-b hover:bg-[#1B1915]/[0.03]">
                  <td className="py-3.5 font-medium">{i.number}</td>
                  <td>{i.customer}{i.via && <span className="ml-2 text-[12px] italic text-[#6B655A] [font-family:var(--f-serif)]">via {i.via}</span>}</td>
                  <td className="text-[#6B655A]">{i.due}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1.5 text-[13px] ${i.status === "paid" ? "text-[#1B1915]" : i.status === "overdue" ? "text-[#B4361E]" : "text-[#2340D8]"}`}>
                      {i.status === "paid" ? <Check className="size-3.5" aria-hidden /> : <span className="size-1.5 rounded-full bg-current" aria-hidden />}
                      {i.status === "partial" ? `Partial · ${usd0(i.paid!)} in` : i.status[0].toUpperCase() + i.status.slice(1)}
                    </span>
                  </td>
                  <td className="s1-num text-right text-[20px]">{usd(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* payroll + ledger */}
        <section className="s1-rise mt-12 grid grid-cols-12 gap-8 [animation-delay:.24s]">
          <div className="s1-rule col-span-5 border-t pt-6">
            <div className="flex items-baseline justify-between">
              <h2 className="s1-num text-[30px] leading-none">Payroll</h2>
              <button className="text-[14px] font-medium text-[#2340D8] s1-link focus-visible:outline-2 focus-visible:outline-[#2340D8]">Run December →</button>
            </div>
            <ul className="mt-4">
              {people.map((p) => (
                <li key={p.name} className="s1-hair flex items-center gap-3 border-b py-3">
                  <span className="grid size-9 place-items-center rounded-full bg-[#1B1915] text-[12px] font-semibold text-[#F4EFE6]">{p.initials}</span>
                  <span className="flex-1"><span className="block text-[15px] font-medium">{p.name}</span><span className="block text-[12px] text-[#6B655A]">{p.role} · {p.method}</span></span>
                  <span className="s1-num text-[20px]">{usd0(p.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-[#6B655A]">Last run {payRuns[0].date}: {usd0(payRuns[0].total)} to {payRuns[0].people} people in one transaction.</p>
          </div>
          <div className="s1-rule col-span-7 border-t pt-6">
            <div className="flex items-baseline justify-between">
              <h2 className="s1-num text-[30px] leading-none">The ledger</h2>
              <a href="#" className="s1-link inline-flex items-center gap-1 text-[14px] font-medium text-[#2340D8]">Every entry, with proof <ArrowUpRight className="size-3.5" aria-hidden /></a>
            </div>
            <ul className="mt-4">
              {transactions.map((t, k) => (
                <li key={k} className="s1-hair grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-4 border-b py-3">
                  <span className="text-[13px] text-[#6B655A]">{t.date}</span>
                  <span><span className="text-[15px]">{t.desc}</span> <span className="text-[12px] text-[#6B655A]">· {t.via ?? t.category}</span></span>
                  <span className={`s1-num text-[20px] ${t.amount > 0 ? "text-[#2340D8]" : ""}`}>{usd(t.amount, true)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="s1-rule mt-16 flex justify-between border-t-2 pt-3 text-[12px] uppercase tracking-[0.16em] text-[#6B655A]">
          <span>Settled on NEAR · every figure has an on-chain receipt</span>
          <span>Sample 1 of 3 — “Ledger”</span>
        </footer>
      </main>
    </div>
  );
}
