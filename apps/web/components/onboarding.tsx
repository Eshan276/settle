"use client";
import { useState } from "react";
import { ArrowRight, KeyRound, Wallet } from "lucide-react";
import { KeyPair, type KeyPairString } from "near-api-js";
import { Button, Card, Field, Input, Tabs } from "@/components/ui";
import { api, connectWallet, createWallet, ensureSession, humanError, storeWallet, walletFor, walletName, type SettleConfig } from "@/lib/settle";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const STEPS = ["Creating your NEAR account", "Registering your business on-chain", "Signing you in", "Adding test funds"];

export function Onboarding({
  cfg,
  onDone,
  connected,
  connectError,
  onReset,
}: {
  cfg: SettleConfig;
  onDone: () => void;
  /** An account whose key is already in this browser (e.g. just approved in the wallet) but isn't a business yet. */
  connected?: string;
  connectError?: string | null;
  onReset?: () => void;
}) {
  const [mode, setMode] = useState<"new" | "import">(connectError ? "import" : "new");
  const [connecting, setConnecting] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [accountId, setAccountId] = useState("");
  const [secret, setSecret] = useState("");
  const [step, setStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const busy = step >= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setStep(0);
      let w;
      if (connected) {
        w = walletFor("business", cfg)!;
        setStep(1);
      } else if (mode === "new") {
        w = await createWallet("business", username.toLowerCase(), cfg);
      } else {
        KeyPair.fromString(secret as KeyPairString); // validate
        storeWallet("business", { accountId, secretKey: secret as KeyPairString });
        w = walletFor("business", cfg)!;
      }
      setStep(1);
      await w.onboardBusiness(name, cfg.relayer_account_id);
      setStep(2);
      await ensureSession(w);
      await api().request("POST", "/v1/businesses", { name, email: email || undefined });
      if (cfg.network === "testnet") {
        setStep(3);
        await api(false).public.faucet(w.accountId, "5000").catch(() => undefined);
      }
      onDone();
    } catch (e) {
      setError(humanError(e));
      setStep(-1);
    }
  }

  const form = (
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Business name">{(p) => <Input {...p} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Bakery" autoComplete="organization" maxLength={64} />}</Field>
          {connected ? null : mode === "new" ? (
            <Field label="Account name" hint={username ? `${username.toLowerCase()}.${cfg.account_suffix}` : "Lowercase letters, numbers, - and _"}>
              {(p) => (
                <Input
                  {...p}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                  placeholder="acme"
                  autoComplete="username"
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{1,30}"
                  spellCheck={false}
                />
              )}
            </Field>
          ) : (
            <>
              <Field label="NEAR account ID">{(p) => <Input {...p} required value={accountId} onChange={(e) => setAccountId(e.target.value.trim())} placeholder="acme.testnet" spellCheck={false} autoComplete="username" />}</Field>
              <Field label="Full-access private key" hint="Stays in this browser. Used to sign gasless transactions.">
                {(p) => <Input {...p} required type="password" value={secret} onChange={(e) => setSecret(e.target.value.trim())} placeholder="ed25519:…" autoComplete="off" spellCheck={false} />}
              </Field>
            </>
          )}
          <Field label="Billing email" hint="Optional. Shown on invoices.">
            {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="finance@acme.com" autoComplete="email" />}
          </Field>
          {error && (
            <p role="alert" className="rounded-xl bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" loading={busy} className="mt-2">
            {busy ? STEPS[step] : "Create business account"} {!busy && <ArrowRight className="size-4" aria-hidden />}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <KeyRound className="size-3.5" aria-hidden /> {connected ? "Approved in your wallet. The key stays in this browser." : "Your key is generated and kept in this browser."}
          </p>
        </form>
  );

  return (
    <div className="mx-auto grid min-h-dvh max-w-5xl items-center gap-10 px-6 py-12 lg:grid-cols-[1fr_420px]">
      <div className="hidden lg:block">
        <div className="flex items-center gap-4">
          <Logo size={30} />
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{cfg.network}</span>
          <ThemeToggle className="ml-auto" />
        </div>
        <h1 className="mt-4 text-[44px] font-light leading-[1.08] tracking-[-0.035em] text-balance">Open a business account in under a minute.</h1>
        <p className="mt-4 max-w-md text-muted-foreground">
          No seed phrase, no gas, no exchange. You get a NEAR account, a stablecoin treasury, invoicing, payroll and an AI that pays your bills within the limits you set.
        </p>
        <ul className="mt-8 grid gap-3 text-sm">
          {["Customers pay from any chain via NEAR Intents", "Every fee is sponsored, so you never buy NEAR", "Settle can bill on your behalf but can never move your money"].map((t) => (
            <li key={t} className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <Card className="p-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{connected ? "Finish setup" : "Get started"}</h2>
          {!connected && (
            <Tabs
              label="Account type"
              value={mode}
              onChange={setMode}
              items={[
                { value: "new", label: "New account" },
                { value: "import", label: "Use existing" },
              ]}
            />
          )}
        </div>

        {connected && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-xl bg-muted px-3.5 py-3 text-sm">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="size-2 shrink-0 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]" aria-hidden />
              <span className="truncate font-mono">{connected}</span>
            </span>
            <button
              type="button"
              onClick={onReset}
              className="shrink-0 rounded-md text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Use a different account
            </button>
          </div>
        )}

        {!connected && mode === "import" ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Approve one request in {walletName}. It adds a Settle key for this browser to your account, so every payment after that is gasless with no
              pop-ups. You can remove the key from your wallet at any time.
            </p>
            {connectError && (
              <p role="alert" className="rounded-xl bg-destructive-soft px-3 py-2 text-sm text-destructive">
                {connectError}
              </p>
            )}
            <Button
              type="button"
              size="lg"
              loading={connecting}
              onClick={() => {
                setConnecting(true);
                connectWallet(cfg).catch((e) => {
                  setError(humanError(e));
                  setConnecting(false);
                });
              }}
            >
              <Wallet className="size-4" aria-hidden /> Connect with {walletName}
            </Button>
            <details className="mt-3 rounded-xl border border-border px-4 py-3">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Advanced: paste a private key instead
              </summary>
              <div className="mt-4">{form}</div>
            </details>
          </div>
        ) : (
          form
        )}
      </Card>
    </div>
  );
}
