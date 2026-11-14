"use client";
import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, Select } from "@/components/ui";
import { DataTable, Money, ProofLink, TableToolbar } from "@/components/finance";
import { api, useAsync } from "@/lib/settle";
import { date, usd } from "@/lib/format";

type Dir = "all" | "in" | "out" | "internal";

export default function Transactions() {
  const [dir, setDir] = useState<Dir>("all");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const qs = new URLSearchParams({ ...(dir !== "all" ? { direction: dir } : {}), ...(q ? { q } : {}), ...(category ? { category } : {}) }).toString();
  const list = useAsync(() => api().request("GET", `/v1/transactions?${qs}`), [qs], { pollMs: 10_000 });
  const all = useAsync(() => api().request("GET", "/v1/transactions"), []);
  const categories = useMemo(() => [...new Set<string>((all.data?.data ?? []).map((t: any) => t.category))].sort(), [all.data]);
  const rows = list.data?.data;
  const sum = (pred: (t: any) => boolean) => (rows ?? []).filter(pred).reduce((s: number, t: any) => s + Number(t.net), 0);

  return (
    <>
      <PageHeader title="Transactions" description="Every dollar in and out of your account, reconciled to an on-chain transaction." />
      <Card>
        <TableToolbar
          tabs={[
            { value: "all", label: "All" },
            { value: "in", label: "Money in" },
            { value: "out", label: "Money out" },
            { value: "internal", label: "Treasury" },
          ]}
          tab={dir}
          onTab={setDir}
          search={q}
          onSearch={setQ}
          searchLabel="Search transactions"
          csvPath={`/v1/transactions?${qs}`}
        >
          <label>
            <span className="sr-only">Category</span>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-44 text-[13px]">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </label>
        </TableToolbar>
        {rows && rows.length > 0 && (
          <div className="flex flex-wrap gap-x-8 gap-y-1 border-b px-4 py-2.5 text-xs text-muted-foreground">
            <span>In <span className="ml-1 font-medium text-foreground tnum">{usd(sum((t) => t.direction === "in"))}</span></span>
            <span>Out <span className="ml-1 font-medium text-foreground tnum">{usd(-sum((t) => t.direction === "out"))}</span></span>
            <span>Net operating <span className="ml-1 font-medium text-foreground tnum">{usd(sum((t) => t.direction !== "internal"), { signed: true })}</span></span>
            <span className="ml-auto">Treasury moves are transfers between your own accounts, not income or expense.</span>
          </div>
        )}
        <DataTable
          rows={rows}
          loading={list.loading}
          error={list.error}
          retry={list.reload}
          rowKey={(t: any) => t.id}
          defaultSort={{ key: "date", dir: "desc" }}
          empty={{ icon: <ArrowLeftRight className="size-4" aria-hidden />, title: "No transactions", body: "Payments, payroll, bills and treasury moves will appear here as they settle." }}
          columns={[
            {
              key: "date",
              header: "Date",
              render: (t: any) => (
                <span className="whitespace-nowrap">
                  {date(t.date)}
                  <span className="block text-xs text-muted-foreground">{new Date(t.date * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                </span>
              ),
              sortValue: (t: any) => t.date,
            },
            {
              key: "desc",
              header: "Description",
              render: (t: any) => (
                <div className="min-w-0 max-w-sm">
                  <p className="truncate">{t.description}</p>
                  {(t.counterparty || t.counterparty_name) && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {t.counterparty ? <span className="font-mono">{t.counterparty}</span> : t.counterparty_name}
                    </p>
                  )}
                </div>
              ),
            },
            { key: "cat", header: "Category", render: (t: any) => <span className="whitespace-nowrap text-muted-foreground">{t.category}</span>, sortValue: (t: any) => t.category },
            { key: "gross", header: "Gross", align: "right", render: (t: any) => <Money v={t.gross} muted />, sortValue: (t: any) => Number(t.gross) },
            { key: "fee", header: "Fees", align: "right", render: (t: any) => (Number(t.fee) ? <Money v={t.fee} muted /> : <span className="text-muted-foreground">—</span>) },
            { key: "net", header: "Amount", align: "right", render: (t: any) => <Money v={t.net} signed={t.direction !== "internal"} muted={t.direction === "internal"} className="font-medium" />, sortValue: (t: any) => Number(t.net) },
            { key: "proof", header: "Proof", align: "right", render: (t: any) => <ProofLink href={t.proof_url} /> },
          ]}
        />
      </Card>
    </>
  );
}
