"use client";
import { use, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { CheckCircle2, Globe, Loader2, Wallet } from "lucide-react";
import { Address, Badge, Button, Card, ErrorState, Field, Input, Select, Skeleton, Tabs } from "@/components/ui";
import { api, createWallet, humanError, loadStoredWallet, money, toBase, useAsync, useConfig, useTx, walletFor, type SettleConfig } from "@/lib/settle";
import { LogoMark } from "@/components/logo";

export default function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const config = useConfig();
  const inv = useAsync(() => api(false).public.invoice(id), [id], { pollMs: 4_000 });

  if (inv.error && !inv.data) return <Shell><ErrorState error={inv.error.includes("No such") ? "This payment link doesn't exist." : inv.error} retry={inv.reload} /></Shell>;
  if (!inv.data || !config.data) return <Shell><PaySkeleton /></Shell>;
  const i = inv.data;
  const cfg = config.data;
  const expired = i.object === "checkout.session" && i.expires_at && i.status === "open" && i.expires_at * 1000 < Date.now();

  return (
    <Shell>
      <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
        <section aria-labelledby="summary" className="grid h-fit gap-6">
          <div>
            <p className="text-sm text-muted-foreground">{i.object === "invoice" ? "Invoice from" : "Pay"}</p>
            <h1 id="summary" className="mt-0.5 text-xl font-semibold tracking-tight">{i.business_name}</h1>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{i.status === "paid" ? "Paid" : "Amount due"}</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight tnum">
              {i.status === "paid" ? i.amount : i.amount_due} <span className="text-2xl text-muted-foreground">{i.token.symbol}</span>
            </p>
            {i.due_at && i.object === "invoice" && <p className="mt-1 text-sm text-muted-foreground">Due {new Date(i.due_at * 1000).toLocaleDateString(undefined, { dateStyle: "medium" })}</p>}
          </div>
          {i.line_items.length > 0 && (
            <dl className="grid gap-2 border-t pt-4 text-sm">
              {i.line_items.map((li: any, k: number) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{li.description}</dt>
                  <dd className="tnum">{li.amount}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t pt-2 font-medium">
                <dt>Total</dt>
                <dd className="tnum">{i.amount} {i.token.symbol}</dd>
              </div>
            </dl>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {i.number && <span>{i.number}</span>}
            {i.customer_name && <span>Billed to {i.customer_name}</span>}
            <span className="font-mono">{i.id}</span>
          </div>
        </section>

        <Card className="p-5">
          {i.status === "paid" ? (
            <Paid inv={i} />
          ) : i.status === "cancelled" ? (
            <p className="py-10 text-center text-muted-foreground">This invoice was cancelled by {i.business_name}.</p>
          ) : expired ? (
            <p className="py-10 text-center text-muted-foreground">This checkout link has expired. Ask {i.business_name} for a new one.</p>
          ) : (
            <PayMethods inv={i} cfg={cfg} onPaid={inv.reload} />
          )}
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-5 py-10 sm:py-16">
      <main className="flex-1">{children}</main>
      <footer className="mt-12 text-center text-xs text-muted-foreground">
        Secured by <LogoMark size={14} className="mx-1 inline-block align-[-2px]" /><span className="font-medium text-foreground">Settle</span> · stablecoin rails on NEAR
      </footer>
    </div>
  );
}

function PaySkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2" role="status" aria-label="Loading invoice">
      <div className="grid gap-4"><Skeleton className="h-6 w-40" /><Skeleton className="h-12 w-56" /><Skeleton className="h-24" /></div>
      <Skeleton className="h-80" />
    </div>
  );
}

function Paid({ inv }: { inv: any }) {
  return (
    <div className="fade-in grid place-items-center gap-3 py-10 text-center">
      <CheckCircle2 className="size-10 text-primary" aria-hidden />
      <p className="text-lg font-semibold">Payment received</p>
      <p className="text-sm text-muted-foreground">
        {inv.business_name} has been paid {inv.amount} {inv.token.symbol}
        {inv.paid_at ? ` on ${new Date(inv.paid_at * 1000).toLocaleString()}` : ""}.
      </p>
      {inv.success_url && (
        <a href={inv.success_url} className="mt-2 inline-flex h-10 items-center rounded-full bg-[image:var(--pill)] shadow-[var(--pill-glow)] hover:brightness-110 px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Return to {new URL(inv.success_url).hostname}
        </a>
      )}
    </div>
  );
}

function PayMethods({ inv, cfg, onPaid }: { inv: any; cfg: SettleConfig; onPaid: () => void }) {
  const [method, setMethod] = useState<"wallet" | "chain">("chain");
  return (
    <div className="grid gap-5">
      <Tabs label="Payment method" value={method} onChange={setMethod} items={[{ value: "chain", label: "Any chain or token" }, { value: "wallet", label: "Settle wallet" }]} />
      {method === "chain" ? <PayCrossChain inv={inv} cfg={cfg} /> : <PayWallet inv={inv} cfg={cfg} onPaid={onPaid} />}
    </div>
  );
}

function PayWallet({ inv, cfg, onPaid }: { inv: any; cfg: SettleConfig; onPaid: () => void }) {
  const { run, pending } = useTx();
  const [stored, setStored] = useState(() => loadStoredWallet("payer"));
  const [username, setUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = useMemo(() => (stored ? walletFor("payer", cfg, stored) : null), [stored, cfg]);
  const bal = useAsync(async () => (wallet ? wallet.view<string>("ft_balance_of", { account_id: wallet.accountId }, inv.token.id) : null), [wallet], { pollMs: 6_000 });
  const due = BigInt(inv.amount_base) - toBase(inv.amount_paid, inv.token.decimals);
  const enough = bal.data != null && BigInt(bal.data) >= due;

  if (!wallet) {
    return (
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setCreating(true);
          setError(null);
          try {
            const w = await createWallet("payer", username.toLowerCase(), cfg);
            if (cfg.network === "testnet") await api(false).public.faucet(w.accountId, "1000").catch(() => undefined);
            setStored(loadStoredWallet("payer"));
          } catch (err) {
            setError(humanError(err));
          } finally {
            setCreating(false);
          }
        }}
      >
        <p className="text-sm text-muted-foreground">Create a free wallet in seconds. No app, no seed phrase, no network fees.</p>
        <Field label="Pick a name" hint={username ? `${username.toLowerCase()}.${cfg.account_suffix}` : undefined} error={error}>
          {(p) => <Input {...p} required value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} placeholder="jane" autoComplete="username" spellCheck={false} />}
        </Field>
        <Button type="submit" size="lg" loading={creating}>
          <Wallet className="size-4" aria-hidden /> Create wallet{cfg.network === "testnet" ? " + test funds" : ""}
        </Button>
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg bg-muted px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <Address value={wallet.accountId} />
          <button onClick={() => { localStorage.removeItem("settle.wallet.payer.v1"); setStored(null); }} className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            Switch
          </button>
        </div>
        <p className="mt-1 text-muted-foreground tnum">Balance: {bal.data != null ? money(bal.data, inv.token) : "…"}</p>
      </div>
      {!enough && bal.data != null && (
        <p className="text-sm text-destructive">
          Not enough {inv.token.symbol}.{" "}
          {cfg.network === "testnet" && (
            <button className="font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => run("faucet", "Test funds added", () => api(false).public.faucet(wallet.accountId, "1000")).then(bal.reload)}>
              Get test funds
            </button>
          )}
        </p>
      )}
      <Button size="lg" disabled={!enough} loading={pending === "pay"} onClick={() => run("pay", "Payment sent", () => wallet.payInvoice(inv.token.id, inv.onchain_id, due), cfg.explorer_url).then(onPaid)}>
        Pay {money(due.toString(), inv.token)}
      </Button>
      <p className="text-center text-xs text-muted-foreground">Network fee: $0.00, covered by {inv.business_name}</p>
    </div>
  );
}

function PayCrossChain({ inv, cfg }: { inv: any; cfg: SettleConfig }) {
  const tokens = useAsync(() => api(false).public.intentTokens(), []);
  const [asset, setAsset] = useState("");
  const [refund, setRefund] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const status = useAsync(async () => (quote ? api(false).public.intentDeposit(quote.deposit_address) : null), [quote], { pollMs: quote ? 2_500 : undefined });

  const list: any[] = useMemo(() => {
    const t: any[] = tokens.data?.tokens ?? [];
    const preferred = ["USDC", "USDT", "ETH", "SOL", "BTC", "wNEAR"];
    return t.filter((x) => preferred.includes(x.symbol)).sort((a, b) => preferred.indexOf(a.symbol) - preferred.indexOf(b.symbol)).slice(0, 30);
  }, [tokens.data]);
  useEffect(() => {
    if (!asset && list[0]) setAsset(list[0].assetId);
  }, [list, asset]);
  useEffect(() => {
    if (quote) QRCode.toDataURL(quote.deposit_address, { margin: 1, width: 192 }).then(setQr);
  }, [quote]);

  const sel = list.find((t) => t.assetId === asset);

  if (tokens.loading && !tokens.data) return <div className="grid gap-3" role="status" aria-label="Loading tokens"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-12" /></div>;
  if (tokens.error) return <ErrorState error={tokens.error} retry={tokens.reload} />;

  if (quote) {
    const s = status.data?.status ?? "PENDING_DEPOSIT";
    const steps = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
    const idx = Math.max(0, steps.indexOf(s));
    return (
      <div className="fade-in grid gap-4">
        <div className="flex items-start gap-4">
          {qr ? <img src={qr} alt={`QR code for deposit address ${quote.deposit_address}`} className="size-32 shrink-0 rounded-md border bg-white p-1" /> : <Skeleton className="size-32" />}
          <div className="min-w-0 grid gap-2 text-sm">
            <p className="text-muted-foreground">Send exactly</p>
            <p className="text-2xl font-semibold tnum">{quote.amount_in_formatted} {quote.origin_symbol}</p>
            <p className="text-xs text-muted-foreground">on {quote.origin_chain} · quote valid until {new Date(quote.deadline).toLocaleTimeString()}</p>
          </div>
        </div>
        <Field label="Deposit address">{() => <div className="flex items-center rounded-xl border bg-muted/50 px-3"><Address value={quote.deposit_address} className="min-w-0 flex-1" /></div>}</Field>
        <ol className="grid gap-2 text-sm" aria-label="Payment progress">
          {["Waiting for your deposit", "Deposit detected", "Solvers swapping to " + inv.token.symbol, `Settled to ${inv.business_name}`].map((label, k) => (
            <li key={label} className="flex items-center gap-2.5">
              {k < idx || s === "SUCCESS" ? <CheckCircle2 className="size-4 text-primary" aria-hidden /> : k === idx ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : <span className="size-4 rounded-full border" aria-hidden />}
              <span className={k <= idx ? "" : "text-muted-foreground"}>{label}</span>
            </li>
          ))}
        </ol>
        {["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(s) && <Badge status="failed">{s.replace(/_/g, " ").toLowerCase()} · funds return to your refund address</Badge>}
        {quote.mode === "simulated" && s === "PENDING_DEPOSIT" && (
          <div className="grid gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">
            <p>Testnet demo: NEAR Intents has no testnet, so the swap is simulated. Settlement into the invoice is a real testnet transaction.</p>
            <Button size="sm" variant="secondary" onClick={() => api(false).public.intentDepositSent(quote.deposit_address).then(status.reload)}>
              Simulate sending {quote.amount_in_formatted} {quote.origin_symbol}
            </Button>
          </div>
        )}
        {status.data?.settle_explorer_url && (
          <a href={status.data.settle_explorer_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            View settlement on NEAR
          </a>
        )}
        <Button variant="ghost" size="sm" onClick={() => setQuote(null)}>Use a different token</Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setQuote(await api(false).public.intentQuote(inv.id, { origin_asset: asset, refund_to: refund }));
        } catch (err) {
          setError(humanError(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">Pay with what you already hold. NEAR Intents solvers convert it, and {inv.business_name} receives exactly {inv.amount_due} {inv.token.symbol}.</p>
      <Field label="Pay with">
        {(p) => (
          <Select {...p} value={asset} onChange={(e) => setAsset(e.target.value)}>
            {list.map((t) => <option key={t.assetId} value={t.assetId}>{t.symbol} on {t.blockchain}</option>)}
          </Select>
        )}
      </Field>
      <Field label={`Refund address on ${sel?.blockchain ?? "origin chain"}`} hint="If the swap can't complete, your funds go back here.">
        {(p) => <Input {...p} required value={refund} onChange={(e) => setRefund(e.target.value.trim())} placeholder={sel?.blockchain === "sol" ? "So1…" : sel?.blockchain === "btc" ? "bc1…" : sel?.blockchain === "near" ? "you.near" : "0x…"} spellCheck={false} autoComplete="off" />}
      </Field>
      {error && <p role="alert" className="rounded-xl bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" loading={busy} disabled={!asset || refund.length < 3}>
        <Globe className="size-4" aria-hidden /> Get deposit address
      </Button>
      {cfg.intents_mode === "simulated" && <p className="text-center text-xs text-muted-foreground">Testnet: cross-chain swap simulated</p>}
    </form>
  );
}
