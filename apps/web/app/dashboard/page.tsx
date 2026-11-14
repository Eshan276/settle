"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, FileText, Plus, Receipt, RotateCcw, Wallet } from "lucide-react";
import { BeamHero, type HeroRail } from "@/components/beam-hero";
import { BudgetMixer, type MixerChannel } from "@/components/budget-mixer";
import { Button, Card, CardHeader, cn, Skeleton } from "@/components/ui";
import { DataTable, Kpi, Money, ProofLink } from "@/components/finance";
import { api, useAsync } from "@/lib/settle";
import { date, usd } from "@/lib/format";
import { useBiz } from "./context";

interface Movement {
  id: string;
  date: number;
  category: string;
  description: string;
  counterparty_name: string | null;
  direction: "in" | "out" | "internal";
  net: string;
  proof_url: string | null;
}

const DAY = 86_400;
const BUCKETS: [string, string][] = [["current", "Current"], ["1_30", "1–30 days"], ["31_60", "31–60"], ["61_90", "61–90"], ["over_90", "90+"]];
const dollars = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const dayLabel = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * The treasury balance over time, walked back from today's cash through the ledger. Accounts with two weeks of
 * history get a daily closing balance; younger ones get the balance after each movement, so the curve has shape.
 */
function balanceHistory(rows: Movement[], cash: number) {
  const after = (t: number) => Math.max(0, cash - rows.filter((r) => r.date > t).reduce((s, r) => s + Number(r.net), 0));
  const first = rows.reduce((m, r) => Math.min(m, r.date), Infinity);
  const nowS = Date.now() / 1000;
  let series: number[], days: string[];
  if (first < nowS - 14 * DAY) {
    const today = new Date();
    today.setHours(24, 0, 0, 0);
    const ends = Array.from({ length: 21 }, (_, i) => today.getTime() / 1000 - (20 - i) * DAY);
    series = ends.map(after);
    days = ends.map((e) => dayLabel(e - 1));
  } else {
    const times = [...new Set(rows.map((r) => r.date))].sort((a, b) => a - b).slice(-30);
    const pts = times.length ? [times[0] - 1, ...times] : [nowS - DAY, nowS];
    series = pts.map(after);
    const sameDay = pts.length > 1 && dayLabel(pts[0]) === dayLabel(pts[pts.length - 1]);
    days = pts.map((t) => (sameDay ? new Date(t * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) : dayLabel(t)));
  }
  const start = series[0];
  const change = start >= 1 ? ((cash - start) / start) * 100 : null;
  return { series, days, change: change !== null && Math.abs(change) < 1000 ? change : null };
}

/** Money in on the left rails, money out on the right, over the last 30 days. */
function rails(rows: Movement[], payrollPeople: number | undefined): { inflows: HeroRail[]; outflows: HeroRail[] } {
  const since = Date.now() / 1000 - 30 * DAY;
  const recent = rows.filter((r) => r.date >= since && r.direction !== "internal");
  const sum = (f: (r: Movement) => boolean) => recent.filter(f).reduce((s, r) => s + Number(r.net), 0);
  const viaIntents = (r: Movement) => !!r.counterparty_name?.startsWith("Paid in ");
  const assets = [...new Set(recent.filter(viaIntents).map((r) => r.counterparty_name!.replace(/^Paid in (.+) via NEAR Intents$/, "$1")))];
  const line = (v: number, extra?: string) => (v === 0 ? extra ?? "nothing yet" : `${v > 0 ? "+" : "−"}${dollars(v)} · ${extra ?? "30d"}`);
  const ai = recent.filter((r) => r.category === "Vendor payments" && r.description.includes("AI autopay")).length;
  return {
    inflows: [
      { label: "Invoices", sub: line(sum((r) => r.category === "Customer payments" && r.direction === "in" && !viaIntents(r))) },
      { label: "NEAR Intents", sub: assets.length ? line(sum(viaIntents), assets.slice(0, 3).join(" · ")) : "any chain · any token" },
      { label: "Checkout", sub: line(sum((r) => r.category === "Sales")) },
      { label: "Subscriptions", sub: line(sum((r) => r.category === "Subscriptions" && r.direction === "in")) },
    ],
    outflows: [
      { label: "Payroll", sub: line(sum((r) => r.category === "Payroll" && r.direction === "out"), payrollPeople ? `${payrollPeople} people` : undefined) },
      { label: "Vendors", sub: line(sum((r) => r.category === "Vendor payments" && r.direction === "out"), ai ? `${ai} by AI autopay` : undefined) },
      { label: "Email payouts", sub: line(sum((r) => r.category === "Payouts" && r.direction === "out")) },
      { label: "Transfers", sub: line(sum((r) => r.category === "Transfers" && r.direction === "out")) },
    ],
  };
}

// ------------------------------------------------------------------ operating budget (planned locally, spent from the ledger)
const CHANNELS: { key: string; name: string; match: (r: Movement) => boolean }[] = [
  { key: "vendors", name: "Vendor bills", match: (r) => r.category === "Vendor payments" && !r.description.includes("AI autopay") },
  { key: "ai", name: "AI autopay", match: (r) => r.category === "Vendor payments" && r.description.includes("AI autopay") },
  { key: "payouts", name: "Payouts", match: (r) => r.category === "Payouts" },
  { key: "other", name: "Transfers", match: (r) => r.category === "Transfers" || r.category === "Subscriptions" },
  { key: "reserve", name: "Reserve", match: () => false },
];
type Plan = { total: number; alloc: Record<string, number> };
const planKey = (account: string, month: string) => `settle.budget.v1.${account}.${month}`;
const suggested = (spent: Record<string, number>): Plan => {
  const alloc = Object.fromEntries(CHANNELS.map((c) => [c.key, c.key === "reserve" ? 500 : Math.ceil(Math.max(spent[c.key] * 1.25, 250) / 50) * 50]));
  return { total: Object.values(alloc).reduce((a, b) => a + b, 0), alloc };
};

function OperatingBudget({ rows, account }: { rows: Movement[]; account: string }) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  const spent = useMemo(() => {
    const mtd = rows.filter((r) => r.date >= monthStart && r.direction === "out");
    return Object.fromEntries(CHANNELS.map((c) => [c.key, mtd.filter(c.match).reduce((s, r) => s - Number(r.net), 0)]));
  }, [rows, monthStart]);
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(planKey(account, month));
      setPlan(saved ? JSON.parse(saved) : suggested(spent));
    } catch {
      setPlan(suggested(spent));
    }
    // only on mount / month change: later spend should fill the meters, not move the plan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, month]);
  if (!plan) return <Skeleton className="h-[560px] rounded-[22px]" />;
  const save = (p: Plan) => {
    setPlan(p);
    localStorage.setItem(planKey(account, month), JSON.stringify(p));
  };
  const channels: MixerChannel[] = CHANNELS.map((c) => ({ key: c.key, name: c.name, alloc: plan.alloc[c.key] ?? 0, spent: spent[c.key] ?? 0 }));
  return (
    <BudgetMixer
      channels={channels}
      total={plan.total}
      title={now.toLocaleDateString("en-US", { month: "long" })}
      onChange={(next) => save({ total: plan.total, alloc: Object.fromEntries(next.map((c) => [c.key, c.alloc])) })}
      hint="Faders are your plan: drag one and the others rebalance so the month stays on budget. Meters are real spending from the ledger. Payroll is planned in Pay runs."
      action={
        <Button variant="ghost" size="sm" onClick={() => save(suggested(spent))}>
          <RotateCcw className="size-3.5" aria-hidden /> Re-plan from this month
        </Button>
      }
    />
  );
}

// ------------------------------------------------------------------ home
export default function Home() {
  const { summary: s, me, wallet } = useBiz();
  const router = useRouter();
  const tx = useAsync<{ data: Movement[] }>(() => api().request("GET", "/v1/transactions"), [], { pollMs: 15_000 });
  // refetch when the balance moves, without dropping the rows we have (that would remount the hero)
  const reloadTx = tx.reload;
  useEffect(() => { if (s?.cash !== undefined) reloadTx(); }, [s?.cash]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => tx.data?.data ?? [], [tx.data]);
  const cash = Number(s?.cash ?? 0);
  const history = useMemo(() => balanceHistory(rows, cash), [rows, cash]);
  const flows = useMemo(() => rails(rows, s?.payroll.last_run?.headcount), [rows, s?.payroll.last_run?.headcount]);

  if (!s || (!tx.data && !tx.error)) {
    return (
      <div role="status" aria-label="Loading">
        <div className="grid h-[700px] place-items-center"><Skeleton className="h-[400px] w-[520px] rounded-[34px]" /></div>
        <div className="mx-auto max-w-6xl px-8"><div className="grid gap-4 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-[22px]" />)}</div></div>
      </div>
    );
  }

  const attention = s.attention.approvals.length + s.attention.bills_to_review.length + s.attention.overdue_invoices.length;
  const agingTotal = Number(s.aging.total ?? 0);
  const net = Number(s.cash_flow_30d.net);
  const hour = new Date().getHours();
  const latestIn = rows.filter((r) => r.direction === "in").sort((a, b) => b.date - a.date)[0];

  return (
    <>
      <BeamHero
        cash={cash}
        change={history.change}
        series={history.series}
        days={history.days}
        inflows={flows.inflows}
        outflows={flows.outflows}
        label={`Cash available · ${s.currency === "USD" ? "sUSD" : s.currency} on NEAR`}
      />

      <div className="home-below-hero relative mx-auto -mt-12 max-w-6xl px-4 pb-20 sm:px-8">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[44px] font-light leading-tight tracking-[-0.035em]">Good {hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}.</h1>
            <p className="mt-1 text-[17px] text-muted-foreground">
              {latestIn ? <>{latestIn.counterparty_name?.startsWith("Paid in") ? `${latestIn.description.split(" · ").pop()} paid ${latestIn.counterparty_name.replace(" via NEAR Intents", "").replace("Paid in ", "in ")}` : latestIn.description} · <span className="text-accent-foreground">{usd(latestIn.net, { signed: true })}</span>. </> : `${me.business?.name} is ready to take payments. `}
              {attention ? `${attention} thing${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} you.` : "Nothing needs you right now."}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard/payroll?run=1" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-muted px-[18px] text-sm font-medium shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
              <Wallet className="size-4" aria-hidden /> Run payroll
            </Link>
            <Link href="/dashboard/invoices?new=1" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[image:var(--pill)] px-[18px] text-sm font-medium text-primary-foreground shadow-[var(--pill-glow)] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus className="size-4" aria-hidden /> New invoice
            </Link>
          </div>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key figures">
          <Kpi
            label="Owed to you"
            value={usd(s.receivables.outstanding)}
            sub={Number(s.receivables.overdue) > 0 ? `${usd(s.receivables.overdue)} overdue · ${s.receivables.overdue_count} invoice${s.receivables.overdue_count === 1 ? "" : "s"}` : `${s.receivables.open_count} open invoice${s.receivables.open_count === 1 ? "" : "s"}`}
            tone={Number(s.receivables.overdue) > 0 ? "warn" : undefined}
            href="/dashboard/invoices?tab=outstanding"
          />
          <Kpi
            label="Bills due · 14 days"
            value={usd(s.payables.due_14d)}
            sub={Number(s.payables.overdue) > 0 ? `${usd(s.payables.overdue)} overdue` : `${s.payables.open_count} unpaid bill${s.payables.open_count === 1 ? "" : "s"}`}
            tone={Number(s.payables.overdue) > 0 ? "warn" : undefined}
            href="/dashboard/bills"
          />
          <Kpi
            label="Net cash flow · 30 days"
            value={<span className={net > 0 ? "text-accent-foreground" : undefined}>{usd(s.cash_flow_30d.net, { signed: true })}</span>}
            sub={`${usd(s.cash_flow_30d.inflow)} in · ${usd(s.cash_flow_30d.outflow)} out`}
            href="/dashboard/transactions"
          />
          <Kpi
            label="Last payroll"
            value={s.payroll.last_run ? usd(s.payroll.last_run.total) : "—"}
            sub={s.payroll.last_run ? `${s.payroll.last_run.headcount} people · ${date(s.payroll.last_run.date)}` : "No pay runs yet"}
            href="/dashboard/payroll"
          />
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr] [&>*]:min-w-0">
          <Card>
            <CardHeader title={<>Needs you {attention > 0 && <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 align-[3px] font-mono text-xs text-accent-foreground shadow-[inset_0_0_0_1px_var(--border)]">{attention}</span>}</>} description={attention ? "AI-triaged approvals, risky bills and late invoices" : undefined} />
            {attention === 0 ? (
              <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground">
                <CheckCircle2 className="size-5 text-primary" aria-hidden /> You're all caught up. No approvals, reviews or overdue invoices.
              </div>
            ) : (
              <ul className="divide-y px-2 py-1">
                {s.attention.approvals.slice(0, 3).map((a) => (
                  <AttentionRow key={`a${a.id}`} href="/dashboard/bills?tab=pending_approval" tone="approve" icon={<Receipt className="size-4" aria-hidden />} title={`Approve ${a.memo || "payment"}`} sub={`AI request · ${a.reasons.map((r) => r.replace(/_/g, " ")).join(", ")}`} amount={a.amount} cta="Approve" />
                ))}
                {s.attention.bills_to_review.slice(0, 3).map((b) => (
                  <AttentionRow key={b.id} href={`/dashboard/bills?tab=needs_review&bill=${b.id}`} tone="bad" icon={<AlertTriangle className="size-4" aria-hidden />} title={`Review bill from ${b.vendor}`} sub={b.flags.slice(0, 2).join(" · ") || "Low confidence extraction"} amount={b.amount} cta="Inspect" />
                ))}
                {s.attention.overdue_invoices.slice(0, 3).map((i) => (
                  <AttentionRow key={i.id} href={`/dashboard/invoices/${i.id}`} tone="warn" icon={<FileText className="size-4" aria-hidden />} title={`${i.number} · ${i.customer ?? "Customer"}`} sub={`${i.days_overdue} day${i.days_overdue === 1 ? "" : "s"} overdue`} amount={i.amount_due} cta="Open" />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Receivables aging" description={`${usd(agingTotal)} outstanding`} action={<Link href="/dashboard/reports" className="text-sm text-accent-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Report</Link>} />
            <div className="p-5">
              <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full bg-muted" role="img" aria-label="Receivables aging distribution">
                {agingTotal > 0 &&
                  BUCKETS.map(([k], i) => {
                    const v = Number(s.aging[k] ?? 0);
                    return v > 0 ? <div key={k} style={{ width: `${(v / agingTotal) * 100}%` }} className={cn("rounded-full", i === 0 ? "bg-primary" : i === 1 ? "bg-warning" : "bg-destructive")} /> : null;
                  })}
              </div>
              <dl className="mt-4 grid grid-cols-5 gap-2 text-xs">
                {BUCKETS.map(([k, label]) => (
                  <div key={k}>
                    <dt className="caption !text-[10px] !tracking-[0.1em]">{label}</dt>
                    <dd className="mt-1 font-mono tnum">{usd(s.aging[k] ?? 0)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 border-t pt-4">
                <p className="caption">Payroll</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <dt className="text-muted-foreground">Streaming / month</dt>
                  <dd className="text-right font-mono tnum">{usd(s.payroll.streaming_monthly)} · {s.payroll.active_streams} active</dd>
                  <dt className="text-muted-foreground">Reserved in streams</dt>
                  <dd className="text-right font-mono tnum">{usd(s.payroll.reserved_in_streams)}</dd>
                  <dt className="text-muted-foreground">Unclaimed payouts</dt>
                  <dd className="text-right font-mono tnum">{usd(s.payroll.unclaimed_payouts)}</dd>
                  <dt className="text-muted-foreground">In your wallet</dt>
                  <dd className="text-right font-mono tnum">{usd(s.wallet)}</dd>
                </dl>
              </div>
            </div>
          </Card>
        </div>

        <div className="mt-4">
          <OperatingBudget rows={rows} account={wallet.accountId} />
        </div>

        <Card className="mt-4">
          <CardHeader title="Recent transactions" action={<Link href="/dashboard/transactions" className="inline-flex items-center gap-1 text-sm text-accent-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">All transactions <ArrowRight className="size-3.5" aria-hidden /></Link>} />
          <DataTable
            rows={rows.slice(0, 8)}
            loading={tx.loading}
            error={tx.error}
            retry={tx.reload}
            rowKey={(r) => r.id}
            onRowClick={() => router.push("/dashboard/transactions")}
            empty={{ title: "No money has moved yet", body: "Add funds to your treasury or send your first invoice." }}
            columns={[
              { key: "date", header: "Date", render: (r) => <span className="whitespace-nowrap text-muted-foreground">{date(r.date)}</span> },
              { key: "desc", header: "Description", render: (r) => <span className="line-clamp-1">{r.description}</span> },
              { key: "cat", header: "Category", render: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.category}</span> },
              { key: "net", header: "Amount", align: "right", render: (r) => <Money v={r.net} signed={r.direction !== "internal"} muted={r.direction === "internal"} className="font-mono" /> },
              { key: "proof", header: "", align: "right", render: (r) => <ProofLink href={r.proof_url} /> },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

function AttentionRow({ href, icon, title, sub, amount, tone, cta }: { href: string; icon: React.ReactNode; title: string; sub: string; amount: string; tone: "approve" | "warn" | "bad"; cta: string }) {
  return (
    <li>
      <Link href={href} className="group flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-[rgb(90_150_255/0.05)] focus-visible:bg-muted focus-visible:outline-none">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            tone === "approve" && "bg-accent text-accent-foreground shadow-[inset_0_0_0_1px_var(--input)]",
            tone === "warn" && "bg-warning-soft text-warning shadow-[inset_0_0_0_1px_rgb(255_180_70/0.28)]",
            tone === "bad" && "bg-destructive-soft text-destructive shadow-[inset_0_0_0_1px_rgb(255_110_100/0.3)]",
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{title}</span>
          <span className={cn("block truncate text-xs", tone === "bad" ? "text-destructive" : "text-muted-foreground")}>{sub}</span>
        </span>
        <Money v={amount} className="font-mono text-sm" />
        <span className={cn("hidden h-8 items-center rounded-full px-3.5 text-[13px] font-medium sm:inline-flex", tone === "approve" ? "bg-[image:var(--pill)] text-primary-foreground shadow-[var(--pill-glow)]" : "bg-muted shadow-[inset_0_0_0_1px_var(--border)] group-hover:bg-accent")}>{cta}</span>
      </Link>
    </li>
  );
}
