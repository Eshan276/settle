"use client";
import { createContext, useContext } from "react";
import type { SettleWallet } from "@settle/sdk";
import type { SettleConfig, TokenInfo } from "@/lib/settle";

export interface Me {
  account_id: string;
  business: { name: string; email: string | null; created_at: number } | null;
  settle_is_operator: boolean;
  ai_agent_policy: any;
  balances: { token: TokenInfo; amount: string; amount_base: string }[];
}

export interface Summary {
  currency: string;
  cash: string;
  wallet: string;
  receivables: { outstanding: string; overdue: string; open_count: number; overdue_count: number };
  payables: { due_14d: string; overdue: string; open_count: number };
  cash_flow_30d: { inflow: string; outflow: string; net: string };
  attention: {
    approvals: { id: number; recipient: string; amount: string; memo: string; reasons: string[] }[];
    bills_to_review: { id: string; vendor: string; amount: string; flags: string[] }[];
    overdue_invoices: { id: string; number: string; customer: string; amount_due: string; days_overdue: number }[];
  };
  aging: Record<string, string>;
  payroll: { last_run: { date: number; total: string; headcount: number; reference: string | null } | null; streaming_monthly: string; reserved_in_streams: string; active_streams: number; unclaimed_payouts: string };
}

export interface BizCtx {
  cfg: SettleConfig;
  wallet: SettleWallet;
  me: Me;
  token: TokenInfo;
  summary: Summary | undefined;
  refresh: () => void;
  /** @deprecated use refresh */
  reloadMe: () => void;
  openMoveMoney: (tab?: "deposit" | "withdraw" | "transfer") => void;
}

export const Ctx = createContext<BizCtx | null>(null);
export function useBiz() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBiz outside dashboard");
  return c;
}
