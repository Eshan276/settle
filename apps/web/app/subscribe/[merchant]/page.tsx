"use client";
import { use, useMemo, useState } from "react";
import { CheckCircle2, Repeat } from "lucide-react";
import { Address, Button, Card, ErrorState, Field, Input, Select, Skeleton } from "@/components/ui";
import { api, createWallet, humanError, loadStoredWallet, money, toBase, useAsync, useConfig, useTx, walletFor } from "@/lib/settle";

/** Hosted subscribe page: /subscribe/<merchant>?plan=Pro&amount=29 */
export default function SubscribePage({ params, searchParams }: { params: Promise<{ merchant: string }>; searchParams: Promise<{ plan?: string; amount?: string }> }) {
  const { merchant } = use(params);
  const q = use(searchParams);
  const plan = q.plan ?? "Subscription";
  const amount = /^\d+(\.\d{1,6})?$/.test(q.amount ?? "") ? q.amount! : "29";
  const config = useConfig();
  const { run, pending } = useTx();
  const [stored, setStored] = useState(() => loadStoredWallet("payer"));
  const [username, setUsername] = useState("");
  const [prepay, setPrepay] = useState("3");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);
  const cfg = config.data;
  const wallet = useMemo(() => (cfg && stored ? walletFor("payer", cfg, stored) : null), [cfg, stored]);
  const bal = useAsync(async () => (wallet && cfg ? wallet.view<string>("ft_balance_of", { account_id: wallet.accountId }, cfg.default_token.id) : null), [wallet], { pollMs: 6000 });

  if (config.error) return <ErrorState error={config.error} retry={config.reload} />;
  if (!cfg) return <div className="mx-auto max-w-md p-10" role="status" aria-label="Loading"><Skeleton className="h-72" /></div>;
  const token = cfg.default_token;
  const per = toBase(amount, token.decimals);
  const prefund = per * BigInt(prepay);
  const enough = bal.data != null && BigInt(bal.data) >= prefund;

  return (
    <div className="mx-auto grid min-h-dvh max-w-md content-center px-5 py-12">
      <Card className="p-6">
        {done ? (
          <div className="fade-in grid place-items-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-10 text-primary" aria-hidden />
            <p className="text-lg font-semibold">You're subscribed to {plan}</p>
            <p className="text-sm text-muted-foreground">First month charged. Manage or cancel any time from your wallet.</p>
            <a href="/wallet" className="mt-2 inline-flex h-10 items-center rounded-full bg-[image:var(--pill)] shadow-[var(--pill-glow)] hover:brightness-110 px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Open wallet</a>
          </div>
        ) : (
          <>
            <div className="grid gap-1">
              <p className="text-sm text-muted-foreground">Subscribe to</p>
              <h1 className="text-xl font-semibold tracking-tight">{plan}</h1>
              <p className="truncate font-mono text-xs text-muted-foreground">{merchant}</p>
              <p className="mt-3 text-4xl font-semibold tracking-tight tnum">{amount} <span className="text-xl text-muted-foreground">{token.symbol} / month</span></p>
            </div>
            <ul className="mt-5 grid gap-1.5 text-sm text-muted-foreground">
              <li className="flex gap-2"><Repeat className="mt-0.5 size-4 shrink-0" aria-hidden /> {merchant} can pull at most {amount} {token.symbol} every 30 days.</li>
              <li className="flex gap-2"><Repeat className="mt-0.5 size-4 shrink-0" aria-hidden /> Unused prepaid balance stays yours. Cancel in one click.</li>
            </ul>
            {!wallet ? (
              <form
                className="mt-6 grid gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setCreating(true);
                  setError(null);
                  try {
                    const w = await createWallet("payer", username.toLowerCase(), cfg);
                    if (cfg.network === "testnet") await api(false).public.faucet(w.accountId, "500").catch(() => undefined);
                    setStored(loadStoredWallet("payer"));
                  } catch (err) {
                    setError(humanError(err));
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                <Field label="Pick a wallet name" error={error}>{(p) => <Input {...p} required value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} placeholder="jane" autoComplete="username" spellCheck={false} />}</Field>
                <Button type="submit" size="lg" loading={creating}>Create free wallet</Button>
              </form>
            ) : (
              <div className="mt-6 grid gap-4">
                <div className="rounded-lg bg-muted px-4 py-3 text-sm">
                  <Address value={wallet.accountId} />
                  <p className="text-muted-foreground tnum">Balance: {bal.data != null ? money(bal.data, token) : "…"}</p>
                </div>
                <Field label="Prepay" hint="Held in your Settle balance and drawn monthly.">
                  {(p) => (
                    <Select {...p} value={prepay} onChange={(e) => setPrepay(e.target.value)}>
                      {["1", "3", "6", "12"].map((m) => <option key={m} value={m}>{m} {m === "1" ? "month" : "months"} · {money((per * BigInt(m)).toString(), token)}</option>)}
                    </Select>
                  )}
                </Field>
                {!enough && bal.data != null && <p className="text-sm text-destructive">Not enough {token.symbol} in your wallet.</p>}
                <Button size="lg" disabled={!enough} loading={pending === "sub"} onClick={() => run("sub", `Subscribed to ${plan}`, () => wallet.subscribe(token.id, merchant, per, 30 * 86400, prefund, plan), cfg.explorer_url).then((r) => r && setDone(true))}>
                  Subscribe · {money(per.toString(), token)} today
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
