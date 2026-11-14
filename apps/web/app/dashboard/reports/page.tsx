"use client";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui";
import { DataTable, Money, TableToolbar } from "@/components/finance";
import { api, useAsync } from "@/lib/settle";
import { date } from "@/lib/format";

const LABELS: Record<string, string> = { current: "Current", "1_30": "1–30", "31_60": "31–60", "61_90": "61–90", over_90: "90+", total: "Total" };

export default function Reports() {
  const aging = useAsync(() => api().request("GET", "/v1/reports/ar-aging"), []);
  const flow = useAsync(() => api().request("GET", "/v1/reports/cash-flow"), []);
  const payroll = useAsync(() => api().request("GET", "/v1/reports/payroll-register"), []);
  return (
    <>
      <PageHeader title="Reports" description="Exports open cleanly in Excel, Google Sheets and your accounting software. Every line traces to an on-chain transaction." />
      <div className="grid gap-6">
        <Card>
          <CardHeader title="Accounts receivable aging" description="Unpaid invoice balances by days past due." />
          <TableToolbar csvPath="/v1/reports/ar-aging" />
          <DataTable
            rows={aging.data?.rows}
            loading={aging.loading}
            error={aging.error}
            retry={aging.reload}
            rowKey={(r: any) => r.customer}
            empty={{ icon: <BarChart3 className="size-4" aria-hidden />, title: "Nothing outstanding", body: "Every invoice is paid." }}
            columns={[
              { key: "customer", header: "Customer", render: (r: any) => <span className="font-medium">{r.customer}</span> },
              ...["current", "1_30", "31_60", "61_90", "over_90", "total"].map((k) => ({ key: k, header: LABELS[k], align: "right" as const, render: (r: any) => <Money v={r[k]} muted={Number(r[k]) === 0} className={k === "total" ? "font-medium" : undefined} /> })),
            ]}
            footer={aging.data?.rows.length ? <tr>{["customer", "current", "1_30", "31_60", "61_90", "over_90", "total"].map((k) => <td key={k} className={`px-4 py-3 ${k === "customer" ? "" : "text-right"}`}>{k === "customer" ? "Total" : <Money v={aging.data.total[k]} />}</td>)}</tr> : null}
          />
        </Card>

        <Card>
          <CardHeader title="Cash flow by month" description="Operating cash by category. Treasury moves are shown separately and excluded from net." />
          <TableToolbar csvPath="/v1/reports/cash-flow" />
          <DataTable
            rows={flow.data?.data}
            loading={flow.loading}
            error={flow.error}
            retry={flow.reload}
            rowKey={(r: any) => r.month}
            empty={{ title: "No cash movements yet" }}
            columns={[
              { key: "month", header: "Month", render: (r: any) => <span className="font-medium">{new Date(`${r.month}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span> },
              ...((flow.data?.categories ?? []) as string[]).map((c) => ({ key: c, header: c, align: "right" as const, render: (r: any) => <Money v={r[c]} signed={c !== "Treasury transfers"} muted={c === "Treasury transfers" || Number(r[c]) === 0} /> })),
              { key: "net", header: "Net operating", align: "right", render: (r: any) => <Money v={r["Net operating cash flow"]} signed className="font-semibold" /> },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Payroll register" description="One line per person per pay run." />
          <TableToolbar csvPath="/v1/reports/payroll-register" />
          <DataTable
            rows={payroll.data?.data}
            loading={payroll.loading}
            error={payroll.error}
            retry={payroll.reload}
            rowKey={(r: any) => `${r.tx_hash}-${r.pay_to}`}
            empty={{ title: "No pay runs yet" }}
            columns={[
              { key: "date", header: "Pay date", render: (r: any) => <span className="whitespace-nowrap">{date(r.run_date)}</span> },
              { key: "ref", header: "Reference", render: (r: any) => <span className="text-muted-foreground">{r.reference || "—"}</span> },
              { key: "emp", header: "Employee", render: (r: any) => r.employee || <span className="font-mono text-xs text-muted-foreground">{r.pay_to}</span> },
              { key: "to", header: "Paid to", render: (r: any) => <span className="block max-w-56 truncate font-mono text-xs">{r.pay_to}</span> },
              { key: "amt", header: "Amount", align: "right", render: (r: any) => <Money v={r.amount} /> },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
