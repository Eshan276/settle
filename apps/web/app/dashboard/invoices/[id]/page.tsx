"use client";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Mail } from "lucide-react";
import { Button, Card, CardHeader, CopyButton, ErrorState, Skeleton } from "@/components/ui";
import { DataTable, DefList, Money, ProofLink, StatusPill, Timeline } from "@/components/finance";
import { api, useAsync, useTx } from "@/lib/settle";
import { date, usd } from "@/lib/format";
import { useBiz } from "../../context";

export default function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { cfg, refresh } = useBiz();
  const { run, pending } = useTx();
  const inv = useAsync(() => api().invoices.retrieve(id), [id], { pollMs: 6_000 });
  const tl = useAsync(() => api().request("GET", `/v1/invoices/${id}/timeline`), [id, inv.data?.amount_paid, inv.data?.status], { pollMs: 6_000 });

  if (inv.error && !inv.data) return <ErrorState error={inv.error} retry={inv.reload} />;
  if (!inv.data) return <div role="status" aria-label="Loading"><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-64" /></div>;
  const i = inv.data;
  const paidNet = (tl.data?.payments ?? []).reduce((s: number, p: any) => s + Number(p.net), 0);
  const paidFee = (tl.data?.payments ?? []).reduce((s: number, p: any) => s + Number(p.fee), 0);

  return (
    <>
      <Link href="/dashboard/invoices" className="mb-4 inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <ArrowLeft className="size-3.5" aria-hidden /> Invoices
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{i.number ?? i.id}</h1>
            <StatusPill status={i.display_status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {i.customer_name ?? "Customer"}
            {i.customer_email ? ` · ${i.customer_email}` : ""} · issued {date(i.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-xl border border-input bg-[var(--field)] pl-3 text-sm">
            Payment link
            <CopyButton value={i.hosted_url} label="Copy payment link" />
          </span>
          <a href={i.hosted_url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3.5 text-sm font-medium shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
            <ExternalLink className="size-3.5" aria-hidden /> View as customer
          </a>
          {i.customer_email && i.display_status !== "paid" && i.display_status !== "void" && (
            <Button variant="secondary" size="sm" className="h-9" loading={pending === "send"} onClick={() => run("send", `Invoice sent to ${i.customer_email}`, () => api().request("POST", `/v1/invoices/${i.id}/send`, {}))}>
              <Mail className="size-3.5" aria-hidden /> {i.display_status === "overdue" ? "Send reminder" : "Resend"}
            </Button>
          )}
          {i.status === "open" && Number(i.amount_paid) === 0 && (
            <Button variant="ghost" size="sm" className="h-9" loading={pending === "void"} onClick={() => run("void", `${i.number} voided`, () => api().invoices.cancel(i.id)).then(() => { inv.reload(); refresh(); })}>
              Void
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <div className="grid h-fit grid-cols-1 gap-6">
          <Card>
            <div className="grid gap-6 p-5 sm:grid-cols-4">
              {[
                ["Amount", usd(i.amount)],
                ["Paid", usd(i.amount_paid)],
                ["Amount due", usd(i.amount_due)],
                ["Due date", date(i.due_at)],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-[13px] text-muted-foreground">{k}</p>
                  <p className={`mt-1 text-lg font-semibold tnum ${k === "Due date" && i.display_status === "overdue" ? "text-destructive" : ""}`}>{v}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Line items" />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">Description</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Qty</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Unit price</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {i.line_items.map((li: any, k: number) => (
                  <tr key={k}>
                    <td className="px-5 py-3">{li.description}</td>
                    <td className="px-3 py-3 text-right tnum">{li.quantity ?? 1}</td>
                    <td className="px-3 py-3 text-right"><Money v={li.unit_amount ?? li.amount} /></td>
                    <td className="px-5 py-3 text-right"><Money v={li.amount} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t">
                <tr>
                  <td colSpan={3} className="px-5 py-3 text-right font-medium">Total</td>
                  <td className="px-5 py-3 text-right font-semibold"><Money v={i.amount} /></td>
                </tr>
              </tfoot>
            </table>
          </Card>

          <Card>
            <CardHeader title="Payments" description={tl.data?.payments.length ? `${usd(paidNet)} net to you after ${usd(paidFee)} in fees and split shares` : undefined} />
            <DataTable
              rows={tl.data?.payments}
              loading={tl.loading}
              error={tl.error}
              retry={tl.reload}
              rowKey={(p: any) => p.id}
              empty={{ title: "No payments yet", body: "Share the payment link. Customers can pay from any chain or a Settle wallet." }}
              columns={[
                { key: "date", header: "Date", render: (p: any) => <span className="whitespace-nowrap text-muted-foreground">{date(p.date, { time: true })}</span> },
                { key: "from", header: "From", render: (p: any) => (p.counterparty ? <span className="block max-w-40 truncate font-mono text-xs" title={p.counterparty}>{p.counterparty}</span> : <span className="block max-w-48 truncate text-xs">{p.counterparty_name}</span>) },
                { key: "gross", header: "Gross", align: "right", render: (p: any) => <Money v={p.gross} /> },
                { key: "fee", header: "Fees & splits", align: "right", render: (p: any) => <Money v={p.fee} muted /> },
                { key: "net", header: "Net", align: "right", render: (p: any) => <Money v={p.net} className="font-medium" /> },
                { key: "proof", header: "", align: "right", render: (p: any) => <ProofLink href={p.tx_hash ? `${cfg.explorer_url}/txns/${p.tx_hash}` : null} /> },
              ]}
            />
          </Card>
        </div>

        <div className="grid h-fit grid-cols-1 gap-6">
          <Card>
            <CardHeader title="Timeline" />
            <div className="p-5">
              {tl.data ? (
                <Timeline
                  items={tl.data.data.map((t: any) => ({
                    at: t.at,
                    title: t.title,
                    detail: t.detail,
                    proof_url: t.proof_url,
                    tone: t.type === "void" ? "muted" : t.type === "payment_attempt" && t.status !== "SUCCESS" ? "warn" : "ok",
                  }))}
                />
              ) : (
                <Skeleton className="h-24" />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="On-chain record" description="The invoice lives in the Settle contract. Anyone can verify it." />
            <div className="p-5">
              <DefList
                items={[
                  ["Contract", <span key="c" className="font-mono text-xs">{cfg.contract_id}</span>],
                  ["Invoice ID", <span key="o" className="font-mono text-xs">#{i.onchain_id}</span>],
                  ["Reference", <span key="r" className="font-mono text-xs">{i.id}</span>],
                  ["Settles in", <span key="t" className="text-xs">{i.token.symbol} · NEAR {cfg.network}</span>],
                  ["Created", <ProofLink key="p" href={i.tx_hash ? `${cfg.explorer_url}/txns/${i.tx_hash}` : null} label="Creation tx" />],
                ]}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
