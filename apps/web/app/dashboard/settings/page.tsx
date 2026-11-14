"use client";
import Link from "next/link";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui";
import { DefList, ProofLink } from "@/components/finance";
import { date } from "@/lib/format";
import { useBiz } from "../context";

export default function Settings() {
  const { cfg, me, wallet, token } = useBiz();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Business" />
          <div className="p-5">
            <DefList
              items={[
                ["Legal name", me.business?.name ?? "—"],
                ["Billing email", me.business?.email ?? "—"],
                ["Account", <span key="a" className="font-mono text-xs">{wallet.accountId}</span>],
                ["Member since", date(me.business?.created_at)],
                ["Explorer", <ProofLink key="e" href={`${cfg.explorer_url}/address/${wallet.accountId}`} label="View account" />],
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Security & permissions" description="Who can do what with your money." />
          <ul className="divide-y text-sm">
            <li className="flex gap-3 px-5 py-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="font-medium">You (full-access key in this browser)</p>
                <p className="text-muted-foreground">Only you can move money: payroll, withdrawals, approvals, payouts.</p>
              </div>
            </li>
            <li className="flex gap-3 px-5 py-3">
              <CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${me.settle_is_operator ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
              <div>
                <p className="font-medium">Settle API: {me.settle_is_operator ? "can bill on your behalf" : "not authorized"}</p>
                <p className="text-muted-foreground">Creates and voids invoices. Cannot move funds (enforced by the contract).</p>
              </div>
            </li>
            <li className="flex gap-3 px-5 py-3">
              <CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${me.ai_agent_policy?.active ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
              <div>
                <p className="font-medium">AI autopay: {me.ai_agent_policy?.active ? "on" : "off"}</p>
                <p className="text-muted-foreground">
                  Can pay bills only within your on-chain policy. <Link href="/dashboard/bills" className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Manage policy</Link>
                </p>
              </div>
            </li>
          </ul>
        </Card>
        <Card>
          <CardHeader title="Settlement" />
          <div className="p-5">
            <DefList
              items={[
                ["Currency", "US dollar stablecoin"],
                ["Token", <span key="t" className="font-mono text-xs">{token.symbol} · {token.id}</span>],
                ["Network", `NEAR ${cfg.network}`],
                ["Contract", <ProofLink key="c" href={`${cfg.explorer_url}/address/${cfg.contract_id}`} label={cfg.contract_id} />],
                ["Cross-chain payments", cfg.intents_mode === "live" ? "NEAR Intents (live)" : "NEAR Intents (simulated on testnet)"],
                ["Network fees", "Sponsored by Settle (meta transactions)"],
              ]}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
