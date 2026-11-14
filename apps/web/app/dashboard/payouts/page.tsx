"use client";
import { useState } from "react";
import { Mail, Plus, Split as SplitIcon, Trash2 } from "lucide-react";
import { claimUrl } from "@settle/sdk";
import { PageHeader } from "@/components/page-header";
import { Badge, Button, Card, CardHeader, CopyButton, Empty, ErrorState, Field, Input, SkeletonRows } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ago, api, humanError, toBase, useAsync, useTx } from "@/lib/settle";
import { useBiz } from "../context";

export default function PayoutsPage() {
  return (
    <>
      <PageHeader title="Payouts & splits" description="Send money to anyone with an email address, and split incoming revenue automatically." />
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <EmailPayouts />
        <Splits />
      </div>
    </>
  );
}

function EmailPayouts() {
  const { wallet, token, reloadMe } = useBiz();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const list = useAsync(() => api().payouts.email.list(), [], { pollMs: 8_000 });
  const valid = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0 && email.includes("@");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLink(null);
    try {
      const claim = await wallet.createClaim(token.id, toBase(amount, token.decimals), memo || undefined, 30 * 86400);
      const url = claimUrl(window.location.origin, claim.secret);
      await api().payouts.email.create({ public_key: claim.publicKey, recipient_email: email, recipient_name: name || undefined, claim_url: url });
      setLink(url);
      toast({ kind: "success", title: `Sent ${amount} ${token.symbol} to ${email}` });
      setAmount("");
      setMemo("");
      list.reload();
      reloadMe();
    } catch (err) {
      toast({ kind: "error", title: "Payout failed", body: humanError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader title="Send to an email" description="Funds are locked on-chain behind a one-time link. The recipient claims with no wallet and no gas. Unclaimed funds can be reclaimed." />
      <form onSubmit={send} className="grid gap-4 border-b p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Recipient email">{(p) => <Input {...p} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maria@gmail.com" autoComplete="off" />}</Field>
          <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Maria" autoComplete="off" />}</Field>
        </div>
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <Field label={`Amount (${token.symbol})`}>{(p) => <Input {...p} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="200" className="tnum" />}</Field>
          <Field label="Note">{(p) => <Input {...p} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Freelance design, November" maxLength={200} />}</Field>
        </div>
        <Button type="submit" loading={busy} disabled={!valid}>
          <Mail className="size-4" aria-hidden /> Send payout
        </Button>
        {link && (
          <div className="fade-in grid gap-1 rounded-xl bg-accent px-3 py-2 text-accent-foreground">
            <p className="text-xs">Emailed. You can also share this link directly; anyone holding it can claim.</p>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span>
              <CopyButton value={link} label="Copy claim link" />
            </div>
          </div>
        )}
      </form>
      {list.loading && !list.data ? (
        <SkeletonRows rows={2} />
      ) : list.error ? (
        <ErrorState error={list.error} retry={list.reload} />
      ) : list.data?.data.length ? (
        <ul className="divide-y">
          {list.data.data.map((p: any) => (
            <li key={p.public_key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{p.recipient_name ?? p.recipient_email}</p>
                <p className="truncate text-xs text-muted-foreground">{p.claimed_by ? `Claimed by ${p.claimed_by}` : p.recipient_email} · {ago(p.created_at)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tnum">{p.amount} {token.symbol}</span>
                <Badge status={p.status} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<Mail className="size-4" aria-hidden />} title="No payouts yet" body="Pay contractors, refunds or rewards to an email address." />
      )}
    </Card>
  );
}

function Splits() {
  const { cfg, wallet } = useBiz();
  const { run, pending } = useTx();
  const [name, setName] = useState("");
  const [rows, setRows] = useState([{ account_id: "", pct: "" }]);
  const splits = useAsync(() => wallet.view<any[]>("get_splits", { business: wallet.accountId }), [wallet.accountId]);
  const totalPct = rows.reduce((s, r) => s + (Number(r.pct) || 0), 0);
  const valid = name.trim() && rows.every((r) => r.account_id && Number(r.pct) > 0) && totalPct <= 100;

  return (
    <Card className="h-fit">
      <CardHeader title="Revenue splits" description="Attach a split to an invoice and each payment fans out to partners on arrival. You keep the remainder." />
      <form
        className="grid gap-4 border-b p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run("split", `Split "${name}" created`, () => wallet.createSplit(name, rows.map((r) => ({ account_id: r.account_id, bps: Math.round(Number(r.pct) * 100) }))), cfg.explorer_url).then((r) => {
            if (r) {
              setName("");
              setRows([{ account_id: "", pct: "" }]);
            }
            splits.reload();
          });
        }}
      >
        <Field label="Name">{(p) => <Input {...p} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Co-founder share" maxLength={64} />}</Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">Recipients</legend>
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Recipient ${i + 1} account`} value={r.account_id} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, account_id: e.target.value.trim().toLowerCase() } : x)))} placeholder={`partner.${cfg.account_suffix}`} spellCheck={false} required />
              <div className="relative w-24 shrink-0">
                <Input aria-label={`Recipient ${i + 1} percent`} inputMode="decimal" value={r.pct} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value.trim() } : x)))} placeholder="30" className="pr-7 text-right tnum" required />
                <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-muted-foreground" aria-hidden>%</span>
              </div>
              <button type="button" aria-label={`Remove recipient ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-ring">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows([...rows, { account_id: "", pct: "" }])} disabled={rows.length >= 10}>
              <Plus className="size-3.5" aria-hidden /> Add recipient
            </Button>
            <span className={totalPct > 100 ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>You keep {Math.max(0, 100 - totalPct)}%</span>
          </div>
        </fieldset>
        <Button type="submit" disabled={!valid} loading={pending === "split"}>
          <SplitIcon className="size-4" aria-hidden /> Create split
        </Button>
      </form>
      {splits.loading && !splits.data ? (
        <SkeletonRows rows={2} />
      ) : splits.error ? (
        <ErrorState error={splits.error} retry={splits.reload} />
      ) : splits.data?.length ? (
        <ul className="divide-y">
          {splits.data.map((s) => (
            <li key={s.id} className="px-5 py-3 text-sm">
              <p className="font-medium">{s.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.recipients.map((r: any) => `${r.account_id} ${r.bps / 100}%`).join(" · ")}</p>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<SplitIcon className="size-4" aria-hidden />} title="No splits yet" body="Great for marketplaces, agencies and co-founders." />
      )}
    </Card>
  );
}
