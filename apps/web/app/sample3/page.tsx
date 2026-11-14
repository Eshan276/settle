"use client";
// Direction 3 — "Counter": tactile, shop-counter objects. Split-flap cash board, receipt-paper invoices,
// a real toggle for autopay, pay stubs for payroll. Bold orange on warm stone.
import { useState } from "react";
import { Bricolage_Grotesque, DM_Mono } from "next/font/google";
import { Check, Printer, RotateCw } from "lucide-react";
import { attention, autopay, biz, invoices, kpis, payRuns, people, transactions, usd, usd0 } from "@/lib/sample-data";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--f-display" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono" });

function Flap({ text, k }: { text: string; k: number }) {
  return (
    <div className="flex gap-[5px]" aria-label={text} role="img" key={k}>
      {[...text].map((c, i) => (
        <span key={i} aria-hidden className={`s3-flap relative grid h-[92px] place-items-center rounded-[6px] text-[64px] font-medium leading-none [font-family:var(--f-mono)] ${/[\d$]/.test(c) ? "w-[60px] bg-[#1E1C19] text-[#F6F1E7]" : "w-[22px] items-end pb-2 text-[#1E1C19]"}`}
          style={{ animationDelay: `${i * 70}ms` }}>
          {c}
          {/[\d$]/.test(c) && <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#0B0A09]" />}
        </span>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-[44px] w-[84px] rounded-full border-2 border-[#1E1C19] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF5A1F] ${on ? "bg-[#FF5A1F]" : "bg-[#D8D0C0]"} shadow-[inset_0_3px_0_rgba(0,0,0,.15)]`}>
      <span className={`absolute top-[3px] size-[34px] rounded-full border-2 border-[#1E1C19] bg-[#F6F1E7] shadow-[0_3px_0_#1E1C19] transition-[left] duration-200 ${on ? "left-[42px]" : "left-[3px]"}`} />
    </button>
  );
}

const Btn = ({ children, primary, className = "" }: { children: React.ReactNode; primary?: boolean; className?: string }) => (
  <button className={`inline-flex h-11 items-center gap-2 rounded-xl border-2 border-[#1E1C19] px-4 text-[14px] font-semibold shadow-[0_4px_0_#1E1C19] transition-[transform,box-shadow] duration-100 active:translate-y-[4px] active:shadow-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF5A1F] ${primary ? "bg-[#FF5A1F] text-[#1E1C19]" : "bg-[#F6F1E7] hover:bg-white"} ${className}`}>{children}</button>
);

export default function Sample3() {
  const [k, setK] = useState(0);
  const [auto, setAuto] = useState(autopay.on);
  const [open, setOpen] = useState(invoices[0].number);

  return (
    <div className={`${display.variable} ${mono.variable} min-h-dvh bg-[#E7DFD0] text-[#1E1C19] [font-family:var(--f-display)]`}
      style={{ backgroundImage: "radial-gradient(rgba(30,28,25,.07) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
      <style>{`
        .s3-m{font-family:var(--f-mono);font-variant-numeric:tabular-nums}
        .s3-card{background:#F6F1E7;border:2px solid #1E1C19;border-radius:18px;box-shadow:0 6px 0 #1E1C19}
        .s3-receipt{background:#FFFDF8;--z:10px;-webkit-mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) 50%/var(--z) 100%;mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) 50%/var(--z) 100%;padding-bottom:calc(var(--z) + 14px);filter:drop-shadow(0 6px 10px rgba(30,28,25,.12))}
        @media (prefers-reduced-motion:no-preference){
          .s3-flap{animation:s3f .5s cubic-bezier(.3,.6,.4,1) both;transform-origin:50% 50%}
          .s3-print{animation:s3p .9s steps(12) both}
        }
        @keyframes s3f{0%{transform:rotateX(90deg);filter:brightness(.6)}60%{transform:rotateX(-12deg)}100%{transform:none}}
        @keyframes s3p{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
      `}</style>

      <div className="mx-auto max-w-[1280px] px-8 pb-16 pt-6">
        {/* top bar */}
        <header className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl border-2 border-[#1E1C19] bg-[#FF5A1F] text-[20px] font-bold shadow-[0_4px_0_#1E1C19]">S</div>
          <div>
            <p className="text-[20px] font-bold leading-none">{biz.name}</p>
            <p className="s3-m mt-1 text-[11px] text-[#6E665A]">{biz.account}</p>
          </div>
          <nav aria-label="Primary" className="ml-8 flex gap-1 rounded-2xl border-2 border-[#1E1C19] bg-[#F6F1E7] p-1">
            {["Counter", "Invoices", "Bills", "Payroll", "Ledger"].map((n, i) => (
              <a key={n} href="#" className={`rounded-xl px-4 py-2 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-[#FF5A1F] ${i === 0 ? "bg-[#1E1C19] text-[#F6F1E7]" : "hover:bg-[#E7DFD0]"}`}>{n}</a>
            ))}
          </nav>
          <div className="ml-auto flex gap-3"><Btn>Move money</Btn><Btn primary>+ New invoice</Btn></div>
        </header>

        {/* split-flap board */}
        <section className="s3-card mt-8 grid grid-cols-[1fr_auto] items-end gap-8 p-7">
          <div>
            <div className="flex items-center gap-3">
              <p className="text-[13px] font-semibold uppercase tracking-[0.16em]">Cash in the till</p>
              <button onClick={() => setK((x) => x + 1)} aria-label="Refresh balance" className="grid size-8 place-items-center rounded-lg border-2 border-[#1E1C19] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#FF5A1F]"><RotateCw className="size-3.5" aria-hidden /></button>
            </div>
            <div className="mt-4 [perspective:600px]"><Flap text={usd(kpis.cash)} k={k} /></div>
            <p className="mt-4 text-[15px] text-[#4E473D]">Up <b className="text-[#1E1C19]">{kpis.cashDelta}%</b> this month. Stablecoins on NEAR, so this balance is real money, not a pending number.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Owed to you", usd0(kpis.receivables), `${usd0(kpis.overdue)} late`, true],
              ["Bills · 14d", usd0(kpis.billsDue14d), "3 to pay", false],
              ["In · 30d", usd0(kpis.inflow30d), "11 payments", false],
              ["Out · 30d", usd0(kpis.outflow30d), "incl. payroll", false],
            ].map(([a, b, c, warn]) => (
              <div key={a as string} className="w-[170px] rounded-xl border-2 border-[#1E1C19] bg-[#FFFDF8] p-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6E665A]">{a}</p>
                <p className="s3-m mt-1 text-[24px] font-medium">{b}</p>
                <p className={`text-[12px] font-semibold ${warn ? "text-[#D2400C]" : "text-[#6E665A]"}`}>{c}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-8 grid grid-cols-[1.25fr_1fr] gap-8 [&>*]:min-w-0">
          {/* receipts */}
          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-[26px] font-bold">Invoices</h2>
              <span className="s3-m text-[12px] text-[#6E665A]">tap a receipt to unroll it</span>
            </div>
            <div className="mt-4 grid grid-cols-3 items-start gap-4">
              {invoices.map((i) => {
                const isOpen = open === i.number;
                return (
                  <button key={i.number} onClick={() => setOpen(i.number)} aria-expanded={isOpen}
                    className="s3-receipt group rounded-t-md px-4 pt-4 text-left transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF5A1F]">
                    <div className="s3-m flex justify-between text-[11px] text-[#6E665A]"><span>{i.number}</span><span>due {i.due}</span></div>
                    <p className="mt-2 text-[16px] font-bold leading-tight">{i.customer}</p>
                    <div className="my-2 border-t-2 border-dashed border-[#1E1C19]/25" />
                    {isOpen && (
                      <div className="s3-print s3-m space-y-1 text-[11px] text-[#4E473D]">
                        <div className="flex justify-between"><span>Subtotal</span><span>{usd(i.amount)}</span></div>
                        <div className="flex justify-between"><span>Paid</span><span>{usd(i.paid ?? 0)}</span></div>
                        {i.via && <div className="flex justify-between"><span>Via</span><span>{i.via}</span></div>}
                        <div className="my-1.5 border-t border-dashed border-[#1E1C19]/25" />
                      </div>
                    )}
                    <p className="s3-m text-[22px] font-medium">{usd(i.amount)}</p>
                    <span className={`mt-2 inline-block -rotate-3 rounded-md border-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${i.status === "paid" ? "border-[#1F7A4D] text-[#1F7A4D]" : i.status === "overdue" ? "border-[#D2400C] text-[#D2400C]" : "border-[#1E1C19]/50 text-[#1E1C19]/70"}`}>
                      {i.status === "partial" ? "half paid" : i.status}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="space-y-8">
            {/* autopay with a real switch */}
            <section className="s3-card p-5">
              <div className="flex items-center justify-between">
                <div><h2 className="text-[20px] font-bold">AI autopay</h2><p className="text-[13px] text-[#6E665A]">Pays routine bills. Limits are locked in the contract.</p></div>
                <Toggle on={auto} onChange={setAuto} label="AI autopay" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[["Per bill", usd0(autopay.perTx)], ["Per day", usd0(autopay.daily)], ["Used today", usd0(autopay.spentToday)]].map(([a, b]) => (
                  <div key={a} className="rounded-xl border-2 border-[#1E1C19] bg-[#FFFDF8] px-3 py-2"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6E665A]">{a}</p><p className="s3-m text-[18px]">{b}</p></div>
                ))}
              </div>
            </section>

            {/* attention as a ticket spike */}
            <section className="s3-card p-5">
              <h2 className="text-[20px] font-bold">On the spike <span className="s3-m ml-1 rounded-md bg-[#FF5A1F] px-1.5 text-[13px]">{attention.length}</span></h2>
              <ul className="mt-3 space-y-2.5">
                {attention.map((a) => (
                  <li key={a.title} className="flex items-center gap-3 rounded-xl border-2 border-[#1E1C19] bg-[#FFFDF8] px-3 py-2.5">
                    <span className={`size-3 rounded-full border-2 border-[#1E1C19] ${a.kind === "review" ? "bg-[#D2400C]" : a.kind === "approval" ? "bg-[#FF5A1F]" : "bg-[#F2C14E]"}`} aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{a.title}</span><span className="block truncate text-[12px] text-[#6E665A]">{a.sub}</span></span>
                    <span className="s3-m text-[15px]">{usd0(a.amount)}</span>
                    <button className="h-10 rounded-lg border-2 border-[#1E1C19] bg-[#F6F1E7] px-3 text-[12px] font-bold shadow-[0_3px_0_#1E1C19] active:translate-y-[3px] active:shadow-none focus-visible:outline-2 focus-visible:outline-[#FF5A1F]">
                      {a.kind === "approval" ? "Approve" : a.kind === "review" ? "Check" : "Nudge"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-[1.25fr_1fr] gap-8 [&>*]:min-w-0">
          {/* pay stubs */}
          <section>
            <div className="flex items-center justify-between"><h2 className="text-[26px] font-bold">Payroll</h2><Btn primary><Printer className="size-4" aria-hidden /> Run December</Btn></div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {people.map((p, i) => (
                <div key={p.name} className="s3-card p-3" style={{ transform: `rotate(${[-1.5, 1, -0.5, 1.5][i]}deg)` }}>
                  <div className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-full border-2 border-[#1E1C19] bg-[#F2C14E] text-[12px] font-bold">{p.initials}</span><span className="s3-m text-[10px] uppercase text-[#6E665A]">{p.method}</span></div>
                  <p className="mt-2 text-[14px] font-bold leading-tight">{p.name}</p>
                  <p className="text-[12px] text-[#6E665A]">{p.role}</p>
                  <p className="s3-m mt-2 border-t-2 border-dashed border-[#1E1C19]/25 pt-2 text-[18px]">{usd0(p.amount)}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 flex items-center gap-2 text-[14px] text-[#4E473D]"><Check className="size-4 text-[#1F7A4D]" aria-hidden /> {payRuns[0].period}: {usd0(payRuns[0].total)} to {payRuns[0].people} people in one transaction.</p>
          </section>

          {/* tape */}
          <section className="s3-receipt rounded-t-md px-5 pt-5">
            <div className="flex items-baseline justify-between"><h2 className="text-[20px] font-bold">Today's tape</h2><span className="s3-m text-[11px] text-[#6E665A]">every line has an on-chain receipt</span></div>
            <ul className="s3-m mt-3 text-[13px]">
              {transactions.map((t, k) => (
                <li key={k} className="flex gap-3 border-b border-dashed border-[#1E1C19]/20 py-2">
                  <span className="w-12 text-[#6E665A]">{t.date}</span>
                  <span className="min-w-0 flex-1 truncate">{t.desc}</span>
                  <span className={t.amount > 0 ? "font-medium text-[#1F7A4D]" : ""}>{usd(t.amount, true)}</span>
                </li>
              ))}
            </ul>
            <p className="s3-m mt-3 text-center text-[11px] tracking-[0.3em] text-[#6E665A]">* * * THANK YOU * * *</p>
          </section>
        </div>

        <p className="s3-m mt-10 text-center text-[11px] uppercase tracking-[0.2em] text-[#6E665A]">Sample 3 of 3 — “Counter”</p>
      </div>
    </div>
  );
}
