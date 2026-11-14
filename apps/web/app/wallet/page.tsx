"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, Repeat, Timer, Wallet } from "lucide-react";
import { Address, Badge, Button, Card, CardHeader, Empty, ErrorState, Field, Input, Skeleton, SkeletonRows, Stat } from "@/components/ui";
import { createWallet, fromBase, humanError, loadStoredWallet, money, storeWallet, useAsync, useConfig, useTx, walletFor, type SettleConfig } from "@/lib/settle";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/** Personal wallet: employees withdraw streamed salary, recipients cash out, subscribers manage plans. */
export default function WalletPage() {
  const config = useConfig();
  const [stored, setStored] = useState<ReturnType<typeof loadStoredWallet> | undefined>(undefined);
  useEffect(() => setStored(loadStoredWallet("payer")), []);
  if (config.error) return <ErrorState error={config.error} retry={config.reload} />;
  if (!config.data || stored === undefined) return <div className="mx-auto max-w-3xl p-10" role="status" aria-label="Loading"><Skeleton className="h-40" /></div>;
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="rounded-full focus-visible:outline-2 focus-visible:outline-ring"><Logo size={24} wordClassName="text-base" /> <span className="ml-1 text-muted-foreground">wallet</span></Link>
        <span className="flex items-center gap-1">
        <ThemeToggle />
        {stored && <Button variant="ghost" size="sm" onClick={() => { storeWallet("payer", null); setStored(null); }}>Sign out</Button>}
        </span>
      </header>
      {stored ? <WalletView cfg={config.data} stored={stored} /> : <CreatePersonal cfg={config.data} onDone={() => setStored(loadStoredWallet("payer"))} />}
    </div>
  );
}

function CreatePersonal({ cfg, onDone }: { cfg: SettleConfig; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold tracking-tight">Your Settle wallet</h1>
      <p className="mt-1 text-sm text-muted-foreground">Get paid, stream your salary, and cash out. Every action is free.</p>
      <form
        className="mt-6 grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await createWallet("payer", username.toLowerCase(), cfg);
            onDone();
          } catch (err) {
            setError(humanError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Pick a name" hint={username ? `${username.toLowerCase()}.${cfg.account_suffix}` : undefined} error={error}>
          {(p) => <Input {...p} required value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} placeholder="alice" autoComplete="username" spellCheck={false} />}
        </Field>
        <Button type="submit" loading={busy}><Wallet className="size-4" aria-hidden /> Create wallet</Button>
      </form>
    </Card>
  );
}

function WalletView({ cfg, stored }: { cfg: SettleConfig; stored: NonNullable<ReturnType<typeof loadStoredWallet>> }) {
  const wallet = useMemo(() => walletFor("payer", cfg, stored)!, [cfg, stored]);
  const token = cfg.default_token;
  const { run, pending } = useTx();
  const settleBal = useAsync(() => wallet.view<string>("get_balance", { account_id: wallet.accountId, token: token.id }), [wallet], { pollMs: 5_000 });
  const walletBal = useAsync(() => wallet.view<string>("ft_balance_of", { account_id: wallet.accountId }, token.id), [wallet], { pollMs: 8_000 });
  const streams = useAsync(() => wallet.view<any[]>("get_streams", { account_id: wallet.accountId }), [wallet], { pollMs: 3_000 });
  const subs = useAsync(() => wallet.view<any[]>("get_subscriptions", { account_id: wallet.accountId }), [wallet]);
  const reloadAll = () => {
    settleBal.reload();
    walletBal.reload();
    streams.reload();
    subs.reload();
  };
  const mine = (streams.data ?? []).filter((s) => s.employee === wallet.accountId);
  const mySubs = (subs.data ?? []).filter((s) => s.subscriber === wallet.accountId);
  const settleBase = settleBal.data ?? "0";

  return (
    <div className="grid gap-6">
      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <Stat label="Ready to cash out" value={settleBal.data !== undefined ? money(settleBase, token) : "…"} sub="Payouts, wages and refunds held in Settle" />
        <Stat label="In your wallet" value={walletBal.data !== undefined ? money(walletBal.data, token) : "…"} sub={<Address value={wallet.accountId} />} />
        <div className="sm:col-span-2">
          <Button disabled={BigInt(settleBase) === 0n} loading={pending === "out"} onClick={() => run("out", "Cashed out to your wallet", () => wallet.withdraw(token.id, BigInt(settleBase)), cfg.explorer_url).then(reloadAll)}>
            <ArrowUpFromLine className="size-4" aria-hidden /> Cash out {BigInt(settleBase) > 0n ? money(settleBase, token) : ""}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Salary streams" description="Your pay accrues every second. Withdraw whenever you like." />
        {streams.loading && !streams.data ? (
          <SkeletonRows rows={1} />
        ) : streams.error ? (
          <ErrorState error={streams.error} retry={streams.reload} />
        ) : mine.length ? (
          <ul className="divide-y">
            {mine.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-medium">{s.memo || "Salary"} <span className="font-normal text-muted-foreground">from {s.employer}</span></p>
                  <p className="text-2xl font-semibold tracking-tight tnum">{fromBase(s.available, token.decimals)} <span className="text-base text-muted-foreground">{token.symbol} available</span></p>
                  <p className="text-xs text-muted-foreground tnum">{fromBase(s.accrued, token.decimals)} of {money(s.total, token)} earned</p>
                </div>
                <Button disabled={BigInt(s.available) === 0n} loading={pending === `s${s.id}`} onClick={() => run(`s${s.id}`, "Wages withdrawn to your Settle balance", () => wallet.withdrawStream(s.id), cfg.explorer_url).then(reloadAll)}>
                  Withdraw earned
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<Timer className="size-4" aria-hidden />} title="No salary streams" body={`Share ${wallet.accountId} with your employer to get paid by the second.`} />
        )}
      </Card>

      <Card>
        <CardHeader title="Subscriptions" description="Plans you've authorized. Cancel any time; no further pulls happen." />
        {subs.loading && !subs.data ? (
          <SkeletonRows rows={1} />
        ) : subs.error ? (
          <ErrorState error={subs.error} retry={subs.reload} />
        ) : mySubs.length ? (
          <ul className="divide-y">
            {mySubs.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.reference || `Plan #${s.id}`}</p>
                  <p className="truncate text-xs text-muted-foreground">{s.merchant} · {money(s.amount, token)} every {Math.round(s.interval_secs / 86400)} days · next {new Date(s.next_charge_at * 1000).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge status={s.status} />
                  {["active", "past_due"].includes(s.status) && (
                    <Button variant="ghost" size="sm" loading={pending === `c${s.id}`} onClick={() => run(`c${s.id}`, "Subscription cancelled", () => wallet.cancelSubscription(s.id), cfg.explorer_url).then(reloadAll)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<Repeat className="size-4" aria-hidden />} title="No subscriptions" />
        )}
      </Card>
    </div>
  );
}
