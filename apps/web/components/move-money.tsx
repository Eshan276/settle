"use client";
import { useState } from "react";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine } from "lucide-react";
import { Button, Field, Input, Tabs } from "@/components/ui";
import { Drawer, DefList, Money } from "@/components/finance";
import { toBase, useAsync, useTx } from "@/lib/settle";
import { useBiz } from "@/app/dashboard/context";

export type MoveTab = "deposit" | "withdraw" | "transfer";

/** Mercury-style "Move money": wallet ↔ Settle treasury, or pay any account instantly. */
export function MoveMoney({ open, onClose, initial = "deposit" }: { open: boolean; onClose: () => void; initial?: MoveTab }) {
  const { cfg, wallet, token, summary, refresh } = useBiz();
  const { run, pending } = useTx();
  const [tab, setTab] = useState<MoveTab>(initial);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [memo, setMemo] = useState("");
  const walletBal = useAsync(() => wallet.view<string>("ft_balance_of", { account_id: wallet.accountId }, token.id), [wallet.accountId, open]);
  const valid = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0 && (tab !== "transfer" || /\./.test(to));
  const walletUsd = walletBal.data ? Number(walletBal.data) / 10 ** token.decimals : 0;
  const cash = Number(summary?.cash ?? 0);
  const max = tab === "deposit" ? walletUsd : cash;
  const balanceKnown = tab === "deposit" ? walletBal.data !== undefined : summary !== undefined;
  const over = valid && balanceKnown && Number(amount) > max;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const base = toBase(amount, token.decimals);
    const label = tab === "deposit" ? `Deposited $${amount}` : tab === "withdraw" ? `Withdrew $${amount} to your wallet` : `Sent $${amount} to ${to}`;
    const res = await run("move", label, () => (tab === "deposit" ? wallet.deposit(token.id, base) : tab === "withdraw" ? wallet.withdraw(token.id, base) : wallet.transfer(token.id, to, base, memo || undefined)), cfg.explorer_url);
    if (res) {
      setAmount("");
      setTo("");
      setMemo("");
      refresh();
      walletBal.reload();
      onClose();
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Move money" subtitle="Every transfer is gasless and settles in seconds.">
      <form onSubmit={submit} className="grid gap-5">
        <Tabs
          label="Transfer type"
          value={tab}
          onChange={setTab}
          items={[
            { value: "deposit", label: "Add to treasury" },
            { value: "withdraw", label: "Withdraw" },
            { value: "transfer", label: "Pay an account" },
          ]}
        />
        <DefList
          items={[
            ["Settle treasury", <Money key="c" v={summary?.cash} />],
            ["Wallet", walletBal.data !== undefined ? <Money key="w" v={walletUsd} /> : "…"],
          ]}
        />
        {tab === "transfer" && (
          <Field label="Recipient NEAR account" hint="Instant internal transfer between Settle accounts.">
            {(p) => <Input {...p} required value={to} onChange={(e) => setTo(e.target.value.trim().toLowerCase())} placeholder="supplier.near" spellCheck={false} autoComplete="off" />}
          </Field>
        )}
        <Field label="Amount (USD)" error={over ? `Only $${max.toLocaleString("en-US", { minimumFractionDigits: 2 })} available` : null}>
          {(p) => (
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-muted-foreground" aria-hidden>$</span>
              <Input {...p} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="0.00" className="pl-7 tnum" autoFocus />
            </div>
          )}
        </Field>
        {tab === "transfer" && <Field label="Memo">{(p) => <Input {...p} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Deposit for December order" maxLength={200} />}</Field>}
        <Button type="submit" size="lg" disabled={!valid || over} loading={pending === "move"}>
          {tab === "deposit" ? <ArrowDownToLine className="size-4" aria-hidden /> : tab === "withdraw" ? <ArrowUpFromLine className="size-4" aria-hidden /> : <ArrowLeftRight className="size-4" aria-hidden />}
          {tab === "deposit" ? "Add to treasury" : tab === "withdraw" ? "Withdraw to wallet" : "Send payment"}
        </Button>
        <p className="text-xs text-muted-foreground">Settled in {token.symbol} on NEAR {cfg.network}. Network fees are covered by Settle.</p>
      </form>
    </Drawer>
  );
}
