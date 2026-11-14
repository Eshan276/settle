"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { DataTable, Drawer, Money, StatusPill, TableToolbar } from "@/components/finance";
import { useToast } from "@/components/toast";
import { api, humanError, useAsync } from "@/lib/settle";
import { date } from "@/lib/format";
import { useBiz } from "../context";

type Tab = "all" | "outstanding" | "overdue" | "paid" | "void";
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "outstanding", label: "Outstanding" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

export default function Page() {
  return (
    <Suspense>
      <Invoices />
    </Suspense>
  );
}

function Invoices() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? "all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(params.get("new") === "1");
  // The header's "New invoice" links here with ?new=1, also when this page is already open.
  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);
  const customer = params.get("customer");
  const qs = new URLSearchParams({ tab, ...(q ? { q } : {}), ...(customer ? { customer } : {}) }).toString();
  const list = useAsync(() => api().request("GET", `/v1/receivables/invoices?${qs}`), [qs], { pollMs: 8_000 });

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Bill customers and get paid from any chain. Every payment settles on NEAR with on-chain proof."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> New invoice
          </Button>
        }
      />
      <Card>
        <TableToolbar tabs={TABS} tab={tab} onTab={setTab} counts={list.data?.counts} search={q} onSearch={setQ} searchLabel="Search invoices" csvPath={`/v1/receivables/invoices?${qs}`}>
          {customer && (
            <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/invoices")}>
              Clear customer filter
            </Button>
          )}
        </TableToolbar>
        <DataTable
          rows={list.data?.data}
          loading={list.loading}
          error={list.error}
          retry={list.reload}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => router.push(`/dashboard/invoices/${r.id}`)}
          defaultSort={tab === "outstanding" || tab === "overdue" ? { key: "due", dir: "asc" } : { key: "issued", dir: "desc" }}
          empty={{
            icon: <FileText className="size-4" aria-hidden />,
            title: tab === "all" ? "No invoices yet" : `No ${TABS.find((t) => t.value === tab)?.label.toLowerCase()} invoices`,
            body: tab === "all" ? "Bill a customer and they can pay from any chain in one click." : undefined,
            action: tab === "all" ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New invoice</Button> : undefined,
          }}
          columns={[
            { key: "number", header: "Invoice", render: (r: any) => <span className="font-medium">{r.number ?? "—"}</span>, sortValue: (r: any) => r.number ?? "" },
            {
              key: "customer",
              header: "Customer",
              render: (r: any) => (
                <div className="min-w-0 max-w-56">
                  <p className="truncate">{r.customer_name ?? "—"}</p>
                  {r.customer_email && <p className="truncate text-xs text-muted-foreground">{r.customer_email}</p>}
                </div>
              ),
              sortValue: (r: any) => (r.customer_name ?? "").toLowerCase(),
            },
            { key: "issued", header: "Issued", render: (r: any) => <span className="whitespace-nowrap text-muted-foreground">{date(r.created_at)}</span>, sortValue: (r: any) => r.created_at },
            {
              key: "due",
              header: "Due",
              render: (r: any) => (
                <span className="whitespace-nowrap">
                  {date(r.due_at)}
                  {r.display_status === "overdue" && <span className="block text-xs text-destructive">{r.days_overdue}d overdue</span>}
                </span>
              ),
              sortValue: (r: any) => r.due_at ?? 0,
            },
            { key: "amount", header: "Amount", align: "right", render: (r: any) => <Money v={r.amount} />, sortValue: (r: any) => Number(r.amount) },
            { key: "due_amt", header: "Amount due", align: "right", render: (r: any) => <Money v={r.amount_due} muted={Number(r.amount_due) === 0} />, sortValue: (r: any) => Number(r.amount_due) },
            {
              key: "status",
              header: "Status",
              render: (r: any) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusPill status={r.display_status} />
                  {r.paid_via && <span className="whitespace-nowrap text-[11px] text-muted-foreground">via {r.paid_via.origin_asset.includes("sol") ? "SOL" : r.paid_via.origin_asset.includes("btc") ? "BTC" : r.paid_via.origin_asset.includes("eth") ? "ETH" : "Intents"}</span>}
                </span>
              ),
              sortValue: (r: any) => r.display_status,
            },
          ]}
        />
      </Card>
      <NewInvoice open={creating} onClose={() => setCreating(false)} onCreated={(inv) => { setCreating(false); list.reload(); router.push(`/dashboard/invoices/${inv.id}`); }} />
    </>
  );
}

type Item = { description: string; qty: string; price: string };
const TERMS = [
  { value: "0", label: "Due on receipt" },
  { value: "7", label: "Net 7" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "60", label: "Net 60" },
];

function NewInvoice({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (inv: any) => void }) {
  const { wallet, refresh } = useBiz();
  const toast = useToast();
  const [customer, setCustomer] = useState("");
  const [email, setEmail] = useState("");
  const [terms, setTerms] = useState("30");
  const [memo, setMemo] = useState("");
  const [splitId, setSplitId] = useState("");
  const [send, setSend] = useState(true);
  const [items, setItems] = useState<Item[]>([{ description: "", qty: "1", price: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customers = useAsync(() => (open ? api().request("GET", "/v1/customers") : Promise.resolve({ data: [] })), [open]);
  const splits = useAsync(() => (open ? wallet.view<any[]>("get_splits", { business: wallet.accountId }) : Promise.resolve([])), [open]);
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const lineTotal = (i: Item) => (Number(i.qty) || 0) * (Number(i.price) || 0);
  const total = items.reduce((s, i) => s + lineTotal(i), 0);
  const valid = customer.trim() && items.every((i) => i.description.trim() && Number(i.qty) > 0 && /^\d+(\.\d{1,2})?$/.test(i.price) && Number(i.price) > 0);
  const dueAt = Math.floor(Date.now() / 1000) + Number(terms) * 86400 + (terms === "0" ? 3600 : 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const inv = await api().invoices.create({
        customer_name: customer.trim(),
        customer_email: email || undefined,
        due_at: dueAt,
        description: memo || items[0].description,
        line_items: items.map((i) => ({ description: i.description.trim(), quantity: Number(i.qty), unit_amount: i.price, amount: lineTotal(i).toFixed(2) })),
        split_id: splitId ? Number(splitId) : undefined,
        send: send && Boolean(email),
      });
      toast({ kind: "success", title: `${inv.number} created`, body: send && email ? `Sent to ${email}` : "Copy the payment link from the invoice page." });
      setItems([{ description: "", qty: "1", price: "" }]);
      setCustomer("");
      setEmail("");
      setMemo("");
      refresh();
      onCreated(inv);
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
      wide
      title="New invoice"
      actions={
        <>
          <span className="mr-auto text-sm text-muted-foreground">
            Total <span className="ml-1 text-base font-semibold text-foreground tnum">${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-invoice" loading={busy} disabled={!valid}>
            {send && email ? "Create & send" : "Create invoice"}
          </Button>
        </>
      }
    >
      <form id="new-invoice" onSubmit={submit} className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer">
            {(p) => (
              <>
                <Input
                  {...p}
                  required
                  list="customers-list"
                  value={customer}
                  onChange={(e) => {
                    setCustomer(e.target.value);
                    const match = customers.data?.data.find((c: any) => c.name === e.target.value);
                    if (match?.email) setEmail(match.email);
                  }}
                  placeholder="Jane's Café"
                  autoComplete="off"
                />
                <datalist id="customers-list">{customers.data?.data.map((c: any) => <option key={c.key} value={c.name} />)}</datalist>
              </>
            )}
          </Field>
          <Field label="Billing email">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@cafe.com" autoComplete="off" />}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment terms" hint={`Due ${date(dueAt)}`}>
            {(p) => (
              <Select {...p} value={terms} onChange={(e) => setTerms(e.target.value)}>
                {TERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            )}
          </Field>
          {(splits.data?.length ?? 0) > 0 ? (
            <Field label="Revenue split" hint="Partner shares are paid automatically.">
              {(p) => (
                <Select {...p} value={splitId} onChange={(e) => setSplitId(e.target.value)}>
                  <option value="">None</option>
                  {splits.data!.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              )}
            </Field>
          ) : (
            <div />
          )}
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Line items</legend>
          <div className="grid grid-cols-[1fr_64px_112px_96px_40px] gap-2 px-1 pb-1.5 text-xs text-muted-foreground" aria-hidden>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit price</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          <div className="grid gap-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px_112px_96px_40px] items-center gap-2">
                <Input aria-label={`Item ${i + 1} description`} value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="Three-tier wedding cake" required />
                <Input aria-label={`Item ${i + 1} quantity`} inputMode="numeric" value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^\d]/g, "") } : x)))} className="text-right tnum" />
                <Input aria-label={`Item ${i + 1} unit price`} inputMode="decimal" value={it.price} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, price: e.target.value.trim() } : x)))} placeholder="0.00" className="text-right tnum" required />
                <span className="text-right text-sm tnum">${lineTotal(it).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <button type="button" aria-label={`Remove item ${i + 1}`} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-ring">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setItems([...items, { description: "", qty: "1", price: "" }])} disabled={items.length >= 30}>
            <Plus className="size-3.5" aria-hidden /> Add line
          </Button>
        </fieldset>

        <Field label="Memo" hint="Shown to the customer on the payment page.">{(p) => <Input {...p} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Thank you for your business" maxLength={300} />}</Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Email the invoice to the customer
        </label>
        {error && <p role="alert" className="rounded-xl bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}
      </form>
    </Drawer>
  );
}
