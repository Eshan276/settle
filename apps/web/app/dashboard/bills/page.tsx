"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Bot, Check, FileUp, Plus, Receipt, ShieldCheck, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button, Card, Field, Input, Tabs, Textarea } from "@/components/ui";
import { DataTable, DefList, Drawer, Money, StatusPill, TableToolbar, Timeline } from "@/components/finance";
import { useToast } from "@/components/toast";
import { api, fromBase, humanError, toBase, useAsync, useTx } from "@/lib/settle";
import { date, daysUntil, usd } from "@/lib/format";
import { useBiz } from "../context";

type Tab = "needs_review" | "ready" | "pending_approval" | "paid" | "rejected" | "all";
const TABS: { value: Tab; label: string }[] = [
  { value: "needs_review", label: "Needs review" },
  { value: "ready", label: "Ready to pay" },
  { value: "pending_approval", label: "Awaiting approval" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

/** A row is either a parsed bill, or an on-chain approval request with no bill attached. */
type Row = { key: string; bill?: any; approval?: any; status: string; vendor: string; number: string | null; due: string | null; amount: number; payTo: string | null; flags: string[] };

export default function Page() {
  return (
    <Suspense>
      <Bills />
    </Suspense>
  );
}

function Bills() {
  const { wallet, token, me, summary } = useBiz();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? "all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(params.get("bill"));
  const bills = useAsync(() => api().bills.list(), [], { pollMs: 8_000 });
  const approvals = useAsync(() => wallet.view<any[]>("get_approvals", { business: wallet.accountId, status: "pending" }), [wallet.accountId, summary?.attention.approvals.length], { pollMs: 8_000 });

  const rows: Row[] | undefined = useMemo(() => {
    if (!bills.data || !approvals.data) return undefined;
    const byApproval = new Map<number, any>();
    const out: Row[] = bills.data.data.map((b: any) => {
      if (b.approval_id != null) byApproval.set(b.approval_id, b);
      return { key: b.id, bill: b, status: b.status, vendor: b.vendor_name, number: b.invoice_number, due: b.due_date, amount: Number(b.amount), payTo: b.vendor_account, flags: b.risk_flags };
    });
    for (const a of approvals.data) {
      const b = byApproval.get(a.id);
      if (b) out.find((r) => r.bill === b)!.approval = a;
      else out.push({ key: `apr-${a.id}`, approval: a, status: "pending_approval", vendor: a.memo || "Payment request", number: null, due: null, amount: Number(fromBase(a.amount, token.decimals)), payTo: a.recipient, flags: a.reasons.map((r: string) => r.replace(/_/g, " ")) });
    }
    return out;
  }, [bills.data, approvals.data, token.decimals]);

  const counts = useMemo(() => {
    const c: Partial<Record<Tab, number>> = { all: rows?.length ?? 0 };
    for (const r of rows ?? []) c[r.status as Tab] = (c[r.status as Tab] ?? 0) + 1;
    return c;
  }, [rows]);
  const filtered = rows?.filter((r) => (tab === "all" || r.status === tab) && (!q || `${r.vendor} ${r.number ?? ""} ${r.payTo ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const sel = rows?.find((r) => r.key === selected) ?? null;
  const reloadAll = () => {
    bills.reload();
    approvals.reload();
  };

  const policy = me.ai_agent_policy;
  return (
    <>
      <PageHeader
        title="Bills"
        description="Forward a vendor bill. AI reads it, checks it for fraud and pays it within limits enforced on-chain."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> Add bill
          </Button>
        }
      />
      <AutopayBar policy={policy} onEdit={() => setPolicyOpen(true)} />
      <Card className="mt-4">
        <TableToolbar tabs={TABS} tab={tab} onTab={setTab} counts={counts} search={q} onSearch={setQ} searchLabel="Search bills" />
        <DataTable
          rows={filtered}
          loading={bills.loading || approvals.loading}
          error={bills.error ?? approvals.error}
          retry={reloadAll}
          rowKey={(r) => r.key}
          selectedKey={selected}
          onRowClick={(r) => setSelected(r.key)}
          defaultSort={{ key: "due", dir: "asc" }}
          empty={{
            icon: <Receipt className="size-4" aria-hidden />,
            title: tab === "all" ? "No bills yet" : `Nothing in ${TABS.find((t) => t.value === tab)?.label.toLowerCase()}`,
            body: tab === "all" ? "Add a vendor bill and AI autopay will handle it within your spending policy." : undefined,
            action: tab === "all" ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add bill</Button> : undefined,
          }}
          columns={[
            { key: "vendor", header: "Vendor", render: (r) => <span className="block max-w-56 truncate font-medium">{r.vendor}</span>, sortValue: (r) => r.vendor.toLowerCase() },
            { key: "num", header: "Bill #", render: (r) => <span className="text-muted-foreground">{r.number ?? "—"}</span> },
            {
              key: "due",
              header: "Due",
              render: (r) => {
                if (!r.due) return <span className="text-muted-foreground">—</span>;
                const d = daysUntil(new Date(`${r.due}T23:59:59`).getTime() / 1000);
                const open = !["paid", "rejected"].includes(r.status);
                return (
                  <span className="whitespace-nowrap">
                    {date(r.due)}
                    {open && d < 0 && <span className="block text-xs text-destructive">{-d}d overdue</span>}
                    {open && d >= 0 && d <= 7 && <span className="block text-xs text-warning">due in {d}d</span>}
                  </span>
                );
              },
              sortValue: (r) => r.due ?? "9999",
            },
            { key: "amount", header: "Amount", align: "right", render: (r) => <Money v={r.amount} className="font-medium" />, sortValue: (r) => r.amount },
            { key: "payto", header: "Pay to", render: (r) => <span className="block max-w-48 truncate font-mono text-xs">{r.payTo ?? "—"}</span> },
            { key: "risk", header: "Risk", render: (r) => (r.flags.length ? <span className="inline-flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3.5" aria-hidden />{r.flags.length}</span> : <span className="text-xs text-muted-foreground">—</span>) },
            { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} />, sortValue: (r) => r.status },
          ]}
        />
      </Card>
      <BillDrawer row={sel} onClose={() => setSelected(null)} onChanged={reloadAll} />
      <AddBill open={adding} onClose={() => setAdding(false)} onParsed={(b) => { setAdding(false); reloadAll(); setTab("all"); setSelected(b.id); }} />
      <PolicyDrawer open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </>
  );
}

function AutopayBar({ policy, onEdit }: { policy: any; onEdit: () => void }) {
  const { cfg, wallet, token } = useBiz();
  const spent = useAsync(() => wallet.view<string>("get_agent_spent_today", { business: wallet.accountId, agent_id: cfg.agent_account_id }), [policy], { pollMs: 8_000 });
  const f = (v: string) => usd(fromBase(v, token.decimals));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 glass rounded-[22px] px-5 py-3.5 text-sm">
      <span className={`grid size-8 place-items-center rounded-full ${policy?.active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
        <Bot className="size-4" aria-hidden />
      </span>
      {policy?.active ? (
        <p className="min-w-0 flex-1">
          <span className="font-medium">AI autopay is on.</span>{" "}
          <span className="text-muted-foreground">
            Pays bills up to {f(policy.approval_threshold)} automatically · {spent.data !== undefined ? f(spent.data) : "…"} of {f(policy.daily_limit)} used today (UTC) · hard cap {f(policy.per_tx_limit)}. Limits are enforced by the Settle contract.
          </span>
        </p>
      ) : (
        <p className="min-w-0 flex-1">
          <span className="font-medium">AI autopay is off.</span> <span className="text-muted-foreground">Set limits and it will pay routine bills for you, sending anything unusual to you for approval.</span>
        </p>
      )}
      <Button variant={policy?.active ? "secondary" : "primary"} size="sm" onClick={onEdit}>
        <ShieldCheck className="size-3.5" aria-hidden /> {policy?.active ? "Edit policy" : "Turn on autopay"}
      </Button>
    </div>
  );
}

function PolicyDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { cfg, wallet, me, token, refresh } = useBiz();
  const { run, pending } = useTx();
  const p = me.ai_agent_policy;
  const d = (v: string | undefined, f: string) => (v ? fromBase(v, token.decimals) : f);
  const [threshold, setThreshold] = useState(d(p?.approval_threshold, "1000"));
  const [daily, setDaily] = useState(d(p?.daily_limit, "3000"));
  const [perTx, setPerTx] = useState(d(p?.per_tx_limit, "5000"));
  const [allow, setAllow] = useState((p?.allowed_recipients ?? []).join("\n"));
  const num = (s: string) => /^\d+(\.\d{1,6})?$/.test(s);
  const valid = num(perTx) && num(daily) && num(threshold) && Number(threshold) <= Number(perTx);
  const save = (active: boolean) => {
    const allowed = allow.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean);
    run(
      "policy",
      active ? "Autopay policy saved on-chain" : "Autopay paused",
      () => wallet.setAgentPolicy(cfg.agent_account_id, { label: "AP autopilot", per_tx_limit: toBase(perTx, token.decimals), daily_limit: toBase(daily, token.decimals), approval_threshold: toBase(threshold, token.decimals), allowed_recipients: allowed.length ? allowed : null, active }),
      cfg.explorer_url,
    ).then((r) => {
      if (r) {
        refresh();
        onClose();
      }
    });
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Autopay policy"
      subtitle="Written to the Settle contract. The AI can't change or exceed it."
      actions={
        <>
          {p?.active && <Button variant="ghost" className="mr-auto" loading={pending === "policy"} onClick={() => save(false)}>Pause autopay</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={pending === "policy"} onClick={() => save(true)}>Save policy</Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label="Pay automatically up to" hint="Bills above this go to you for approval.">{(fp) => <Input {...fp} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value.trim())} className="tnum" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Daily budget (UTC day)">{(fp) => <Input {...fp} inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value.trim())} className="tnum" />}</Field>
          <Field label="Hard cap per bill" error={valid || !num(perTx) ? null : "Must be at least the auto-pay limit"}>{(fp) => <Input {...fp} inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value.trim())} className="tnum" />}</Field>
        </div>
        <Field label="Trusted vendors" hint="Optional, one NEAR account per line. Payments to anyone else need approval.">
          {(fp) => <Textarea {...fp} value={allow} onChange={(e) => setAllow(e.target.value)} className="min-h-24 font-mono text-[13px]" placeholder="mills.near" spellCheck={false} />}
        </Field>
        <div className="rounded-lg bg-muted px-4 py-3 text-xs text-muted-foreground">
          The AI agent (<span className="font-mono">{cfg.agent_account_id}</span>) holds a key that can only call <span className="font-mono">agent_pay</span>. It cannot withdraw, change this policy or approve its own requests.
        </div>
      </div>
    </Drawer>
  );
}

function BillDrawer({ row, onClose, onChanged }: { row: Row | null; onClose: () => void; onChanged: () => void }) {
  const { cfg, wallet, refresh } = useBiz();
  const { run, pending } = useTx();
  const [payTo, setPayTo] = useState("");
  const detail = useAsync(async () => (row?.bill ? api().request("GET", `/v1/bills/${row.bill.id}`) : null), [row?.bill?.id, row?.status]);
  useEffect(() => setPayTo(row?.payTo ?? ""), [row?.key, row?.payTo]);
  if (!row) return null;
  const b = detail.data;
  const done = () => {
    onChanged();
    refresh();
    detail.reload();
  };
  const canPay = row.bill && ["ready", "needs_review"].includes(row.status);

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={row.vendor}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill status={row.status} />
          {row.number && <span>{row.number}</span>}
          {row.due && <span>· due {date(row.due)}</span>}
        </span>
      }
      actions={
        <>
          {canPay && (
            <Button variant="ghost" className="mr-auto" loading={pending === "rej"} onClick={() => run("rej", "Bill rejected", () => api().request("POST", `/v1/bills/${row.bill.id}/reject`, {})).then(done)}>
              <X className="size-4" aria-hidden /> Reject
            </Button>
          )}
          {row.status === "pending_approval" && row.approval && (
            <>
              <Button variant="secondary" loading={pending === "deny"} onClick={() => run("deny", "Payment rejected", () => wallet.rejectPayment(row.approval.id), cfg.explorer_url).then(done)}>
                <X className="size-4" aria-hidden /> Reject
              </Button>
              <Button loading={pending === "appr"} onClick={() => run("appr", `Approved · ${usd(row.amount)} paid`, () => wallet.approvePayment(row.approval.id), cfg.explorer_url).then(done)}>
                <Check className="size-4" aria-hidden /> Approve & pay {usd(row.amount)}
              </Button>
            </>
          )}
          {canPay && (
            <Button
              disabled={!/\./.test(payTo)}
              loading={pending === "pay"}
              onClick={() =>
                run(
                  "pay",
                  "Bill sent to AI autopay",
                  async () => {
                    const res = await api().bills.pay(row.bill.id, { vendor_account: payTo, override_review: row.status === "needs_review" });
                    if (res.agent_result?.status === "pending_approval") return { ...res, txHash: res.tx_hash };
                    return { ...res, txHash: res.tx_hash };
                  },
                  cfg.explorer_url,
                ).then(done)
              }
            >
              <Bot className="size-4" aria-hidden /> {row.status === "needs_review" ? "Mark reviewed & pay" : "Pay with autopay"}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-6">
        {row.flags.length > 0 && (
          <div className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
            <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" aria-hidden /> {row.status === "pending_approval" ? "Why this needs you" : "Risk flags"}</p>
            <ul className="mt-1.5 grid gap-0.5 pl-6 text-[13px]">{row.flags.map((f) => <li key={f} className="list-disc">{f}</li>)}</ul>
          </div>
        )}
        <DefList
          items={[
            ["Amount", <Money key="a" v={row.amount} className="font-semibold" />],
            ...(b ? ([["Issued by", b.vendor_name], ["Vendor email", b.vendor_email ?? "—"], ["Description", b.description ?? "—"], ["AI confidence", `${Math.round((b.confidence ?? 0) * 100)}% · ${b.source === "claude" ? "Claude" : "offline parser"}`]] as [string, React.ReactNode][]) : []),
          ]}
        />
        {canPay ? (
          <Field label="Pay to (NEAR account)" hint={row.flags.some((f) => /payment details|instructions/i.test(f)) ? "Payment details on this bill look suspicious. Confirm with the vendor through a known channel first." : "Taken from the bill. Edit if your records differ."}>
            {(p) => <Input {...p} value={payTo} onChange={(e) => setPayTo(e.target.value.trim().toLowerCase())} className="font-mono text-[13px]" spellCheck={false} />}
          </Field>
        ) : (
          <DefList items={[["Pay to", <span key="p" className="font-mono text-xs">{row.payTo ?? "—"}</span>]]} />
        )}
        {b?.line_items?.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium">Line items</p>
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {b.line_items.map((li: any, i: number) => (
                  <tr key={i}>
                    <td className="py-2">{li.description}</td>
                    <td className="py-2 text-right"><Money v={li.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {b?.trail && (
          <div>
            <p className="mb-3 text-[13px] font-medium">Approval trail</p>
            <Timeline items={b.trail.map((t: any) => ({ ...t, tone: /reject/i.test(t.title) ? "muted" : /requested/i.test(t.title) ? "warn" : "ok" }))} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function AddBill({ open, onClose, onParsed }: { open: boolean; onClose: () => void; onParsed: (b: any) => void }) {
  const { cfg } = useBiz();
  const toast = useToast();
  const [mode, setMode] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sample = () =>
    setText(`Golden Mills Flour Co.\nInvoice #GM-${Math.floor(1000 + Math.random() * 9000)}\nFlour delivery, 40 sacks (November)\nPay to: mills.${cfg.account_suffix}\nDue date: ${new Date(Date.now() + 14 * 86400e3).toISOString().slice(0, 10)}\nTotal due: $640.00`);

  async function parse(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let payload: Record<string, string>;
      if (mode === "file" && file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        payload = { file_base64: btoa(s), media_type: file.type || "application/pdf" };
      } else payload = { text };
      const bill = await api().bills.parse(payload);
      toast({ kind: "success", title: `Read bill from ${bill.vendor_name}`, body: bill.status === "ready" ? "Ready to pay." : "Flagged for your review." });
      setText("");
      setFile(null);
      onParsed(bill);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add a bill"
      subtitle={cfg.ai_enabled ? "Claude extracts the details and checks for fraud signals." : "AI extraction with fraud checks."}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-bill" loading={busy} disabled={mode === "text" ? text.trim().length < 10 : !file}>
            <FileUp className="size-4" aria-hidden /> Read bill
          </Button>
        </>
      }
    >
      <form id="add-bill" onSubmit={parse} className="grid gap-4">
        <Tabs label="Input" value={mode} onChange={setMode} items={[{ value: "text", label: "Paste email or text" }, { value: "file", label: "Upload PDF or image" }]} />
        {mode === "text" ? (
          <Field label="Bill" hint={cfg.network === "testnet" ? <button type="button" onClick={sample} className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Use a sample bill</button> : undefined}>
            {(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.target.value)} className="min-h-56 font-mono text-[13px]" placeholder="Paste the invoice email or bill text…" />}
          </Field>
        ) : (
          <Field label="PDF or image" hint={cfg.ai_enabled ? "PDF, PNG, JPG or WEBP" : "File upload needs Claude enabled on the server (ANTHROPIC_API_KEY)."}>
            {(p) => <Input {...p} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={!cfg.ai_enabled} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-2" />}
          </Field>
        )}
        {error && <p role="alert" className="rounded-xl bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}
      </form>
    </Drawer>
  );
}
