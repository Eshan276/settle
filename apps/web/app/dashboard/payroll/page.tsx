"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Timer, UserPlus, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button, Card, CardHeader, Field, Input, Select, Tabs } from "@/components/ui";
import { DataTable, DefList, Drawer, Money, ProofLink, StatusPill, TableToolbar } from "@/components/finance";
import { api, fromBase, toBase, useAsync, useTx } from "@/lib/settle";
import { date, usd } from "@/lib/format";
import { useBiz } from "../context";

type View = "runs" | "run" | "streams";

export default function Page() {
  return (
    <Suspense>
      <Payroll />
    </Suspense>
  );
}

function Payroll() {
  const params = useSearchParams();
  const [view, setView] = useState<View>(params.get("run") === "1" ? "run" : "runs");
  const runs = useAsync(() => api().request("GET", "/v1/payroll/runs"), [], { pollMs: 15_000 });
  const [openRun, setOpenRun] = useState<any>(null);
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Pay your team in one gasless transaction, or stream salaries by the second."
        action={
          <Tabs
            label="Payroll view"
            value={view}
            onChange={setView}
            items={[
              { value: "runs", label: "Pay runs" },
              { value: "run", label: "Run payroll" },
              { value: "streams", label: "Salary streams" },
            ]}
          />
        }
      />
      {view === "runs" && (
        <Card>
          <TableToolbar csvPath="/v1/reports/payroll-register">
            <Button size="sm" onClick={() => setView("run")}>
              <Wallet className="size-3.5" aria-hidden /> Run payroll
            </Button>
          </TableToolbar>
          <DataTable
            rows={runs.data?.data}
            loading={runs.loading}
            error={runs.error}
            retry={runs.reload}
            rowKey={(r: any) => r.id}
            onRowClick={setOpenRun}
            defaultSort={{ key: "date", dir: "desc" }}
            empty={{ icon: <Wallet className="size-4" aria-hidden />, title: "No pay runs yet", body: "Add your team on the People page, then run payroll.", action: <Button onClick={() => setView("run")}>Run payroll</Button> }}
            columns={[
              { key: "date", header: "Pay date", render: (r: any) => <span className="whitespace-nowrap">{date(r.date, { time: true })}</span>, sortValue: (r: any) => r.date },
              { key: "ref", header: "Reference", render: (r: any) => <span className="font-medium">{r.reference ?? "Payroll"}</span> },
              { key: "people", header: "People", align: "right", render: (r: any) => <span className="tnum">{r.headcount}</span>, sortValue: (r: any) => r.headcount },
              { key: "total", header: "Total", align: "right", render: (r: any) => <Money v={r.total} className="font-medium" />, sortValue: (r: any) => Number(r.total) },
              { key: "status", header: "Status", render: () => <StatusPill status="paid" /> },
              { key: "proof", header: "Proof", align: "right", render: (r: any) => <ProofLink href={r.proof_url} /> },
            ]}
          />
        </Card>
      )}
      {view === "run" && <RunPayroll onDone={() => { runs.reload(); setView("runs"); }} />}
      {view === "streams" && <Streams />}
      <RunDrawer run={openRun} onClose={() => setOpenRun(null)} />
    </>
  );
}

function RunDrawer({ run, onClose }: { run: any; onClose: () => void }) {
  if (!run) return null;
  return (
    <Drawer open onClose={onClose} wide title={run.reference ?? "Pay run"} subtitle={`${date(run.date, { time: true })} · ${run.headcount} people · paid atomically in one transaction`}>
      <div className="grid gap-6">
        <DefList items={[["Total paid", <Money key="t" v={run.total} className="font-semibold" />], ["Status", <StatusPill key="s" status="paid" />], ["Transaction", <ProofLink key="p" href={run.proof_url} label="View on-chain proof" />]]} />
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-2 text-left font-medium">Employee</th>
              <th scope="col" className="py-2 text-left font-medium">Paid to</th>
              <th scope="col" className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {run.lines.map((l: any) => (
              <tr key={l.account_id}>
                <td className="py-2.5">{l.name ?? <Link href="/dashboard/people" className="text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Add to People</Link>}</td>
                <td className="py-2.5"><span className="block max-w-64 truncate font-mono text-xs">{l.account_id}</span></td>
                <td className="py-2.5 text-right"><Money v={l.amount} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t font-medium">
            <tr>
              <td className="py-2.5" colSpan={2}>Total</td>
              <td className="py-2.5 text-right"><Money v={run.total} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Drawer>
  );
}

function RunPayroll({ onDone }: { onDone: () => void }) {
  const { cfg, wallet, token, summary, refresh, openMoveMoney } = useBiz();
  const { run, pending } = useTx();
  const people = useAsync(() => api().request("GET", "/v1/people"), []);
  const active = useMemo(() => (people.data?.data ?? []).filter((p: any) => p.active && p.near_account), [people.data]);
  const [sel, setSel] = useState<Record<string, { on: boolean; amount: string }>>({});
  const [reference, setReference] = useState(`Payroll · ${new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}`);
  useEffect(() => {
    setSel(Object.fromEntries(active.map((p: any) => [p.id, { on: true, amount: p.default_amount ?? "" }])));
  }, [active]);

  const lines = active.filter((p: any) => sel[p.id]?.on);
  const valid = lines.length > 0 && lines.every((p: any) => /^\d+(\.\d{1,6})?$/.test(sel[p.id].amount) && Number(sel[p.id].amount) > 0);
  const total = lines.reduce((s: number, p: any) => s + (Number(sel[p.id]?.amount) || 0), 0);
  const cashKnown = summary !== undefined;
  const cash = Number(summary?.cash ?? 0);
  // Never claim a shortfall until the real balance has loaded.
  const short = cashKnown && total > cash;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
      <Card>
        <CardHeader title="Who are you paying?" description="Amounts default to each person's regular pay. Edit for bonuses or partial periods." action={<Link href="/dashboard/people" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"><UserPlus className="size-3.5" aria-hidden /> Manage people</Link>} />
        <DataTable
          rows={people.data ? active : undefined}
          loading={people.loading}
          error={people.error}
          retry={people.reload}
          rowKey={(p: any) => p.id}
          empty={{ icon: <UserPlus className="size-4" aria-hidden />, title: "No one to pay yet", body: "Add employees and contractors with their NEAR account and regular pay.", action: <Link href="/dashboard/people" className="inline-flex h-10 items-center rounded-full bg-[image:var(--pill)] shadow-[var(--pill-glow)] hover:brightness-110 px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Add people</Link> }}
          columns={[
            {
              key: "on",
              header: "",
              render: (p: any) => <input type="checkbox" aria-label={`Include ${p.name}`} checked={sel[p.id]?.on ?? false} onChange={(e) => setSel({ ...sel, [p.id]: { ...sel[p.id], on: e.target.checked } })} className="size-4 accent-[var(--primary)]" />,
            },
            { key: "name", header: "Name", render: (p: any) => <div className="min-w-0"><p className="truncate font-medium">{p.name}</p><p className="truncate text-xs text-muted-foreground">{p.title ?? (p.type === "contractor" ? "Contractor" : "Employee")}</p></div> },
            { key: "to", header: "Paid to", render: (p: any) => <span className="block max-w-52 truncate font-mono text-xs">{p.near_account}</span> },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              render: (p: any) => (
                <div className="relative ml-auto w-32">
                  <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-muted-foreground" aria-hidden>$</span>
                  <Input aria-label={`Amount for ${p.name}`} inputMode="decimal" value={sel[p.id]?.amount ?? ""} disabled={!sel[p.id]?.on} onChange={(e) => setSel({ ...sel, [p.id]: { ...sel[p.id], amount: e.target.value.trim() } })} className="h-9 pl-6 text-right tnum" />
                </div>
              ),
            },
          ]}
        />
      </Card>
      <div className="h-fit lg:sticky lg:top-20">
        <Card className="p-5">
          <p className="text-[13px] font-medium">Review</p>
          <div className="mt-4 grid gap-4">
            <Field label="Reference">{(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
            <DefList
              items={[
                ["People", <span key="n" className="tnum">{lines.length}</span>],
                ["Total", <span key="t" className="font-semibold tnum">{usd(total)}</span>],
                ["Treasury", cashKnown ? <span key="c" className={`tnum ${short ? "text-destructive" : ""}`}>{usd(cash)}</span> : <span key="c" className="text-muted-foreground">Loading…</span>],
                ["Network fee", "$0.00"],
              ]}
            />
            {short && (
              <p className="rounded-xl bg-destructive-soft px-3 py-2 text-xs text-destructive">
                You're {usd(total - cash)} short.{" "}
                <button onClick={() => openMoveMoney("deposit")} className="font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Add funds</button>
              </p>
            )}
            <Button
              size="lg"
              disabled={!valid || short || !cashKnown}
              loading={pending === "pay"}
              onClick={() =>
                run("pay", `Paid ${lines.length} ${lines.length === 1 ? "person" : "people"} · ${usd(total)}`, () => wallet.runPayroll(token.id, lines.map((p: any) => ({ account_id: p.near_account, amount: toBase(sel[p.id].amount, token.decimals) })), reference), cfg.explorer_url).then((r) => {
                  if (r) {
                    refresh();
                    onDone();
                  }
                })
              }
            >
              Pay {lines.length} {lines.length === 1 ? "person" : "people"} · {usd(total)}
            </Button>
            <p className="text-xs text-muted-foreground">Everyone is paid in a single on-chain transaction. Either all payments go through or none do.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Streams() {
  const { cfg, wallet, token, refresh } = useBiz();
  const { run, pending } = useTx();
  const people = useAsync(() => api().request("GET", "/v1/people"), []);
  const streams = useAsync(() => wallet.view<any[]>("get_streams", { account_id: wallet.accountId }), [wallet.accountId], { pollMs: 5_000 });
  const [person, setPerson] = useState("");
  const [monthly, setMonthly] = useState("");
  const [months, setMonths] = useState("1");
  const list = (streams.data ?? []).filter((s) => s.employer === wallet.accountId).reverse();
  const nameOf = (acct: string) => (people.data?.data ?? []).find((p: any) => p.near_account === acct)?.name;
  const target = (people.data?.data ?? []).find((p: any) => p.id === person);
  const valid = target?.near_account && /^\d+(\.\d{1,6})?$/.test(monthly) && Number(monthly) > 0;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title="Start a salary stream" description="Pay unlocks every second. Employees withdraw what they've earned from their Settle wallet, any day." />
        <form
          className="flex flex-wrap items-end gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const total = toBase(monthly, token.decimals) * BigInt(months);
            run("stream", `Streaming ${usd(monthly)}/mo to ${target.name}`, () => wallet.createStream(target.near_account, token.id, total, Number(months) * 30 * 86400, `Salary · ${target.name}`), cfg.explorer_url).then(() => {
              streams.reload();
              refresh();
              setMonthly("");
            });
          }}
        >
          <div className="w-56">
            <Field label="Person">
              {(p) => (
                <Select {...p} value={person} onChange={(e) => { setPerson(e.target.value); const t = (people.data?.data ?? []).find((x: any) => x.id === e.target.value); if (t?.default_amount) setMonthly(t.default_amount); }} required>
                  <option value="">Select…</option>
                  {(people.data?.data ?? []).filter((x: any) => x.active && x.near_account).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <div className="w-36"><Field label="Monthly pay">{(p) => <Input {...p} inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value.trim())} placeholder="4000" className="tnum" required />}</Field></div>
          <div className="w-28"><Field label="Months">{(p) => <Input {...p} type="number" min={1} max={24} value={months} onChange={(e) => setMonths(e.target.value)} className="tnum" />}</Field></div>
          <Button type="submit" disabled={!valid} loading={pending === "stream"}>
            <Timer className="size-4" aria-hidden /> Start stream{valid ? ` · locks ${usd(Number(monthly) * Number(months))}` : ""}
          </Button>
        </form>
      </Card>
      <Card>
        <DataTable
          rows={streams.data ? list : undefined}
          loading={streams.loading}
          error={streams.error}
          retry={streams.reload}
          rowKey={(s: any) => String(s.id)}
          empty={{ icon: <Timer className="size-4" aria-hidden />, title: "No salary streams", body: "Streams let people access earned wages before payday." }}
          columns={[
            { key: "who", header: "Employee", render: (s: any) => <div className="min-w-0"><p className="truncate font-medium">{nameOf(s.employee) ?? s.memo ?? "Employee"}</p><p className="truncate font-mono text-[11px] text-muted-foreground">{s.employee}</p></div> },
            { key: "started", header: "Started", render: (s: any) => <span className="whitespace-nowrap text-muted-foreground">{date(s.start_at)}</span> },
            {
              key: "progress",
              header: "Earned",
              render: (s: any) => {
                const pct = Number((BigInt(s.accrued) * 10000n) / BigInt(s.total || "1")) / 100;
                return (
                  <div className="w-40">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Earned so far">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(pct, 0.5)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground tnum">{usd(fromBase(s.accrued, token.decimals))} of {usd(fromBase(s.total, token.decimals))}</p>
                  </div>
                );
              },
            },
            { key: "withdrawn", header: "Withdrawn", align: "right", render: (s: any) => <Money v={fromBase(s.withdrawn, token.decimals)} /> },
            {
              key: "status",
              header: "",
              align: "right",
              render: (s: any) =>
                s.cancelled_at !== null ? (
                  <StatusPill status="cancelled">Stopped</StatusPill>
                ) : (
                  <Button variant="ghost" size="sm" loading={pending === `c${s.id}`} onClick={() => run(`c${s.id}`, "Stream stopped. Unearned pay returned to treasury.", () => wallet.cancelStream(s.id), cfg.explorer_url).then(() => { streams.reload(); refresh(); })}>
                    Stop
                  </Button>
                ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
