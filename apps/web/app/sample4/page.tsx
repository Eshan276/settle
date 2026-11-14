"use client";
// Direction 4 — "Beamfall": uberdesigner's Blue night tech look (beamfall + budget-mixer), applied to Settle.
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Bell, Plus, Search, ShieldAlert } from "lucide-react";
import { attention, autopay, biz, cashSeries, invoices, kpis, payRuns, people, transactions, usd, usd0 } from "@/lib/sample-data";
import { BeamHero } from "@/components/beam-hero";
import { BudgetMixer, type MixerChannel } from "@/components/budget-mixer";
import "./s4.css";

const DAYS = cashSeries.map((_, i) => new Date(Date.UTC(2026, 9, 23 + i)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }));
const SERIES = cashSeries.map((v) => v * 1000);
const IN = [{ label: "Invoices", sub: "+$5,127 · 30d" }, { label: "NEAR Intents", sub: "SOL · ETH · BTC" }, { label: "Checkout", sub: "+$1,210 · 30d" }, { label: "Subscriptions", sub: "+$480 / mo" }];
const OUT = [{ label: "Payroll", sub: "−$10,200 · 4 people" }, { label: "Vendors", sub: "−$2,805 · AI autopay" }, { label: "Email payouts", sub: "−$150 · claimed" }, { label: "Revenue splits", sub: "5% → Chloé" }];
const CHANNELS: MixerChannel[] = [
  { key: "rent", name: "Rent", alloc: 1_600, spent: 1_600, locked: true },
  { key: "supplies", name: "Supplies", alloc: 1_100, spent: 1_170 },
  { key: "utilities", name: "Utilities", alloc: 500, spent: 315 },
  { key: "ai", name: "AI autopay", alloc: 700, spent: 640 },
  { key: "reserve", name: "Reserve", alloc: 300, spent: 0 },
];

const NAV = ["Home", "Invoices", "Bills", "Payroll", "Ledger", "Reports"];
const TABS = ["All", "Outstanding", "Overdue", "Paid"] as const;

export default function Sample4() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [mix, setMix] = useState(CHANNELS);
  const rows = invoices.filter((i) => (tab === "All" ? true : tab === "Paid" ? i.status === "paid" : tab === "Overdue" ? i.status === "overdue" : i.status !== "paid"));

  return (
    <div className="s4">
      <header className="s4-nav">
        <div className="s4-brand"><span className="s4-logo" aria-hidden />Settle<span className="s4-biz">{biz.name}</span></div>
        <nav aria-label="Primary" className="s4-pills">
          {NAV.map((n, i) => <a key={n} href="#" aria-current={i === 0 ? "page" : undefined}>{n}</a>)}
        </nav>
        <div className="s4-actions">
          <button className="s4-icon" aria-label="Search"><Search aria-hidden /></button>
          <button className="s4-icon" aria-label="Notifications, 3 new"><Bell aria-hidden /><i className="s4-badge-dot" /></button>
          <button className="s4-btn s4-ghost">Move money</button>
          <button className="s4-btn s4-blue"><Plus aria-hidden /> New invoice</button>
        </div>
      </header>

      <BeamHero cash={kpis.cash} change={kpis.cashDelta} series={SERIES} days={DAYS} inflows={IN} outflows={OUT} label="Cash available · sUSD on NEAR" />

      <main className="s4-main">
        <section className="s4-greet">
          <h1>Good morning, {biz.owner}.</h1>
          <p>Café Nord paid from Solana overnight. Three things need you before lunch.</p>
        </section>

        <section className="s4-kpis" aria-label="Key figures">
          {[
            ["02 — RECEIVABLES", "Owed to you", usd0(kpis.receivables), `${usd0(kpis.overdue)} overdue`, "warn"],
            ["03 — PAYABLES", "Bills due · 14 days", usd0(kpis.billsDue14d), "3 unpaid", ""],
            ["04 — CASH FLOW", "Net · 30 days", usd(kpis.netFlow30d).replace(/\.\d+$/, ""), `${usd0(kpis.inflow30d)} in · ${usd0(kpis.outflow30d)} out`, ""],
            ["05 — AUTOPAY", "AI spent today", usd0(autopay.spentToday), `of ${usd0(autopay.daily)} · ≤ ${usd0(autopay.perTx)} each`, "good"],
          ].map(([idx, k, v, s, tone]) => (
            <div key={idx} className="s4-panel s4-kpi">
              <span className="s4-index">{idx}</span>
              <p className="s4-kpi-label">{k}</p>
              <p className="s4-kpi-value">{v}</p>
              <p className={`s4-kpi-sub ${tone === "warn" ? "s4-warn" : tone === "good" ? "s4-good" : ""}`}>{s}</p>
            </div>
          ))}
        </section>

        <div className="s4-grid2">
          <section className="s4-panel" aria-labelledby="att-h">
            <div className="s4-panel-head"><h2 id="att-h">Needs you <span className="s4-count">{attention.length}</span></h2><span className="s4-cap">AI triaged · 2 min ago</span></div>
            <ul className="s4-list">
              {attention.map((a) => (
                <li key={a.title}>
                  <span className={`s4-ico ${a.kind}`}>{a.kind === "review" ? <ShieldAlert aria-hidden /> : <span aria-hidden>{a.kind === "approval" ? "$" : "!"}</span>}</span>
                  <span className="s4-grow"><b>{a.title}</b><small className={a.kind === "review" ? "s4-bad" : undefined}>{a.sub}</small></span>
                  <span className="s4-mono">{usd0(a.amount)}</span>
                  <button className={`s4-btn s4-sm ${a.kind === "approval" ? "s4-blue" : "s4-ghost"}`}>{a.kind === "approval" ? "Approve" : a.kind === "review" ? "Inspect" : "Remind"}</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="s4-panel" aria-labelledby="pay-h">
            <div className="s4-panel-head"><h2 id="pay-h">Payroll</h2><button className="s4-btn s4-sm s4-ghost">Run December</button></div>
            <ul className="s4-list">
              {people.map((p) => (
                <li key={p.name}>
                  <span className="s4-avatar" aria-hidden>{p.initials}</span>
                  <span className="s4-grow"><b>{p.name}</b><small>{p.role} · {p.method}</small></span>
                  <span className="s4-mono">{usd0(p.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="s4-foot">Last run {payRuns[0].date} · {usd0(payRuns[0].total)} to {payRuns[0].people} people in one transaction</p>
          </section>
        </div>

        <div className="s4-mixwrap"><BudgetMixer channels={mix} total={4_200} onChange={setMix} title="November" hint="Drag a fader: the others rebalance so the month stays at $4,200. AI autopay is the agent’s allowance, enforced by the contract." /></div>

        <div className="s4-grid2 s4-wide-left">
          <section className="s4-panel s4-flush" aria-labelledby="inv-h">
            <div className="s4-panel-head s4-pad">
              <h2 id="inv-h">Invoices</h2>
              <div role="tablist" aria-label="Filter invoices" className="s4-tabs">
                {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}
              </div>
            </div>
            <table className="s4-table">
              <thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th>Status</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.number}>
                    <td className="s4-mono s4-dim">{i.number}</td>
                    <td>{i.customer}{i.via && <span className="s4-via">{i.via}</span>}</td>
                    <td className="s4-dim">{i.due}</td>
                    <td><span className={`s4-status ${i.status}`}>{i.status === "partial" ? `Partial · ${usd0(i.paid!)}` : i.status}</span></td>
                    <td className="r s4-mono">{usd(i.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="s4-panel" aria-labelledby="led-h">
            <div className="s4-panel-head"><h2 id="led-h">Ledger</h2><a href="#" className="s4-link">Every entry, with proof →</a></div>
            <ul className="s4-list s4-tight">
              {transactions.map((t, k) => (
                <li key={k}>
                  <span className={`s4-dir ${t.amount > 0 ? "in" : ""}`}>{t.amount > 0 ? <ArrowDownLeft aria-hidden /> : <ArrowUpRight aria-hidden />}</span>
                  <span className="s4-grow"><b>{t.desc}</b><small>{t.date} · {t.via ?? t.category}</small></span>
                  <span className={`s4-mono ${t.amount > 0 ? "s4-good" : ""}`}>{usd(t.amount, true)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <footer className="s4-footer">
          <span>Settled on NEAR · gasless · payable from any chain</span>
          <span>Sample 4 — “Beamfall” · built from uberdesigner beamfall + budget-mixer</span>
        </footer>
      </main>
    </div>
  );
}
