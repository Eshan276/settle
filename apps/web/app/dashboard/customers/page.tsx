"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui";
import { DataTable, Money, TableToolbar } from "@/components/finance";
import { api, useAsync } from "@/lib/settle";
import { date } from "@/lib/format";

export default function Customers() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const list = useAsync(() => api().request("GET", "/v1/customers"), [], { pollMs: 15_000 });
  const rows = (list.data?.data ?? undefined)?.filter((c: any) => !q || `${c.name} ${c.email ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const total = (k: string) => (rows ?? []).reduce((s: number, c: any) => s + Number(c[k]), 0);
  return (
    <>
      <PageHeader title="Customers" description="Everyone you bill, with what they owe and how they pay." />
      <Card>
        <TableToolbar search={q} onSearch={setQ} searchLabel="Search customers" />
        <DataTable
          rows={list.data ? rows : undefined}
          loading={list.loading}
          error={list.error}
          retry={list.reload}
          rowKey={(c: any) => c.key}
          onRowClick={(c: any) => router.push(`/dashboard/invoices?customer=${encodeURIComponent(c.key)}`)}
          defaultSort={{ key: "outstanding", dir: "desc" }}
          empty={{ icon: <UserRound className="size-4" aria-hidden />, title: "No customers yet", body: "Customers appear here when you invoice them." }}
          columns={[
            { key: "name", header: "Customer", render: (c: any) => <div className="min-w-0"><p className="truncate font-medium">{c.name}</p>{c.email && <p className="truncate text-xs text-muted-foreground">{c.email}</p>}</div>, sortValue: (c: any) => c.name.toLowerCase() },
            { key: "invoices", header: "Invoices", align: "right", render: (c: any) => <span className="tnum">{c.invoices}</span>, sortValue: (c: any) => c.invoices },
            { key: "outstanding", header: "Outstanding", align: "right", render: (c: any) => <Money v={c.outstanding} className="font-medium" />, sortValue: (c: any) => Number(c.outstanding) },
            { key: "overdue", header: "Overdue", align: "right", render: (c: any) => <Money v={c.overdue} className={Number(c.overdue) > 0 ? "text-destructive" : "text-muted-foreground"} />, sortValue: (c: any) => Number(c.overdue) },
            { key: "paid", header: "Paid to date", align: "right", render: (c: any) => <Money v={c.paid} />, sortValue: (c: any) => Number(c.paid) },
            { key: "last", header: "Last payment", render: (c: any) => <span className="whitespace-nowrap text-muted-foreground">{date(c.last_payment_at)}</span>, sortValue: (c: any) => c.last_payment_at ?? 0 },
          ]}
          footer={
            rows?.length ? (
              <tr>
                <td className="px-4 py-3">Total</td>
                <td />
                <td className="px-4 py-3 text-right"><Money v={total("outstanding")} /></td>
                <td className="px-4 py-3 text-right"><Money v={total("overdue")} /></td>
                <td className="px-4 py-3 text-right"><Money v={total("paid")} /></td>
                <td />
              </tr>
            ) : null
          }
        />
      </Card>
    </>
  );
}
