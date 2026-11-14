"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Gift } from "lucide-react";
import { KeyPair } from "near-api-js";
import { secretFromClaimUrlFragment, signClaim } from "@settle/sdk";
import { Button, Card, ErrorState, Field, Input, Skeleton, Tabs } from "@/components/ui";
import { api, createWallet, humanError, loadStoredWallet, useAsync, useConfig } from "@/lib/settle";

export default function ClaimPage() {
  const config = useConfig();
  const [secret, setSecret] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const s = window.location.hash.slice(1);
    try {
      if (!s) throw new Error();
      const sk = secretFromClaimUrlFragment(s);
      KeyPair.fromString(sk);
      setSecret(sk);
    } catch {
      setSecret(null);
    }
  }, []);
  const publicKey = secret ? KeyPair.fromString(secret as any).getPublicKey().toString() : null;
  const claim = useAsync(async () => (publicKey ? api(false).public.claim(publicKey) : null), [publicKey]);

  return (
    <div className="mx-auto grid min-h-dvh max-w-md content-center px-5 py-12">
      {secret === null ? (
        <Card className="p-6"><ErrorState error="This claim link is incomplete. Open the full link from your email." /></Card>
      ) : !config.data || secret === undefined || (!claim.data && !claim.error) ? (
        <Card className="grid gap-4 p-6" role="status" aria-label="Loading"><Skeleton className="h-6 w-40" /><Skeleton className="h-12 w-48" /><Skeleton className="h-10" /></Card>
      ) : claim.error ? (
        <Card className="p-6"><ErrorState error={claim.error.includes("Unknown") ? "This claim link isn't valid." : claim.error} retry={claim.reload} /></Card>
      ) : (
        <ClaimCard claim={claim.data} secret={secret} cfg={config.data} reload={claim.reload} />
      )}
      <p className="mt-6 text-center text-xs text-muted-foreground">Powered by Settle · stablecoin payouts on NEAR</p>
    </div>
  );
}

function ClaimCard({ claim, secret, cfg, reload }: { claim: any; secret: string; cfg: any; reload: () => void }) {
  const existing = loadStoredWallet("payer");
  const [mode, setMode] = useState<"new" | "existing">(existing ? "existing" : "new");
  const [username, setUsername] = useState("");
  const [accountId, setAccountId] = useState(existing?.accountId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (done || claim.status === "claimed") {
    return (
      <Card className="fade-in grid place-items-center gap-3 p-8 text-center">
        <CheckCircle2 className="size-10 text-primary" aria-hidden />
        <p className="text-lg font-semibold">{claim.amount} {claim.token.symbol} claimed</p>
        <p className="text-sm text-muted-foreground">Sent to {done ?? claim.claimed_by}. You can hold it, send it, or cash out.</p>
        <Link href="/wallet" className="mt-2 inline-flex h-10 items-center rounded-full bg-[image:var(--pill)] shadow-[var(--pill-glow)] hover:brightness-110 px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Open my wallet
        </Link>
      </Card>
    );
  }
  if (claim.status !== "unclaimed") return <Card className="p-6"><ErrorState error="This payout is no longer available. It may have been reclaimed by the sender." /></Card>;

  return (
    <Card className="p-6">
      <div className="grid place-items-center gap-2 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground"><Gift className="size-5" aria-hidden /></div>
        <p className="mt-2 text-sm text-muted-foreground">{claim.from} sent you</p>
        <p className="text-4xl font-semibold tracking-tight tnum">{claim.amount} <span className="text-2xl text-muted-foreground">{claim.token.symbol}</span></p>
        {claim.memo && <p className="text-sm">“{claim.memo}”</p>}
      </div>
      <form
        className="mt-8 grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            let receiver = accountId;
            if (mode === "new") receiver = (await createWallet("payer", username.toLowerCase(), cfg)).accountId;
            const sig = signClaim(secret as any, cfg.contract_id, receiver);
            await api(false).public.redeemClaim({ public_key: sig.publicKey, receiver_id: receiver, signature: sig.signature });
            setDone(receiver);
            reload();
          } catch (err) {
            setError(humanError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Tabs label="Where to send" value={mode} onChange={setMode} items={[{ value: "new", label: "New wallet" }, { value: "existing", label: "I have a NEAR account" }]} />
        {mode === "new" ? (
          <Field label="Pick a name" hint={username ? `${username.toLowerCase()}.${cfg.account_suffix} · free, no seed phrase` : "Free, no seed phrase, no fees"}>
            {(p) => <Input {...p} required value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} placeholder="maria" autoComplete="username" spellCheck={false} />}
          </Field>
        ) : (
          <Field label="NEAR account">{(p) => <Input {...p} required value={accountId} onChange={(e) => setAccountId(e.target.value.trim().toLowerCase())} placeholder="maria.near" spellCheck={false} />}</Field>
        )}
        {error && <p role="alert" className="rounded-xl bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" loading={busy}>Claim {claim.amount} {claim.token.symbol}</Button>
      </form>
    </Card>
  );
}
