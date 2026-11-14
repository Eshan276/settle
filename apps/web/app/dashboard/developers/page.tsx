"use client";
import { useState } from "react";
import { KeyRound, Trash2, Webhook } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button, Card, CardHeader, CopyButton, Empty, ErrorState, Field, Input, Mono, SkeletonRows } from "@/components/ui";
import { ago, api, API_URL, useAsync, useTx } from "@/lib/settle";

export default function DevelopersPage() {
  return (
    <>
      <PageHeader title="Developers" description="A Stripe-shaped REST API, signed webhooks and a TypeScript SDK. Your backend never touches keys or gas." />
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <ApiKeys />
        <Webhooks />
      </div>
      <Quickstart />
      <EventLog />
    </>
  );
}

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div className="fade-in grid gap-1 rounded-xl border border-primary/30 bg-accent px-3 py-2 text-accent-foreground">
      <p className="text-xs font-medium">{label}. Copy it now; it won't be shown again.</p>
      <div className="flex items-center gap-2">
        <Mono className="min-w-0 flex-1 truncate text-xs">{value}</Mono>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function ApiKeys() {
  const { run, pending } = useTx();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const keys = useAsync(() => api().apiKeys.list(), []);
  return (
    <Card className="h-fit">
      <CardHeader title="API keys" description="Server-side keys can create invoices and checkout sessions, read data and drive the AI agent. They can never withdraw funds." />
      <form
        className="grid gap-3 border-b p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run("key", "API key created", async () => {
            const k = await api().apiKeys.create(name || undefined);
            setSecret(k.secret);
            setName("");
            keys.reload();
            return k;
          });
        }}
      >
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Key name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="production-backend" />}</Field>
          </div>
          <Button type="submit" loading={pending === "key"}>
            <KeyRound className="size-4" aria-hidden /> Create key
          </Button>
        </div>
        {secret && <Secret label="Secret key" value={secret} />}
      </form>
      {keys.loading && !keys.data ? (
        <SkeletonRows rows={2} />
      ) : keys.error ? (
        <ErrorState error={keys.error} retry={keys.reload} />
      ) : keys.data?.data.length ? (
        <ul className="divide-y">
          {keys.data.data.map((k: any) => (
            <li key={k.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{k.name ?? "Unnamed key"}</p>
                <p className="text-xs text-muted-foreground">
                  <Mono className="text-xs">{k.prefix}…</Mono> · created {ago(k.created_at)}
                  {k.last_used_at ? ` · used ${ago(k.last_used_at)}` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" loading={pending === k.id} onClick={() => run(k.id, "Key revoked", () => api().apiKeys.del(k.id)).then(keys.reload)}>
                <Trash2 className="size-3.5" aria-hidden /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<KeyRound className="size-4" aria-hidden />} title="No API keys" body="Create one to call the API from your backend." />
      )}
    </Card>
  );
}

function Webhooks() {
  const { run, pending } = useTx();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const eps = useAsync(() => api().webhookEndpoints.list(), []);
  return (
    <Card className="h-fit">
      <CardHeader title="Webhooks" description="Signed with HMAC-SHA256 in the Settle-Signature header. Failed deliveries retry with backoff for 6 hours." />
      <form
        className="grid gap-3 border-b p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run("wh", "Endpoint added", async () => {
            const r = await api().webhookEndpoints.create({ url });
            setSecret(r.secret);
            setUrl("");
            eps.reload();
            return r;
          });
        }}
      >
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Endpoint URL">{(p) => <Input {...p} type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://acme.com/webhooks/settle" />}</Field>
          </div>
          <Button type="submit" loading={pending === "wh"}>
            <Webhook className="size-4" aria-hidden /> Add
          </Button>
        </div>
        {secret && <Secret label="Signing secret" value={secret} />}
      </form>
      {eps.loading && !eps.data ? (
        <SkeletonRows rows={1} />
      ) : eps.error ? (
        <ErrorState error={eps.error} retry={eps.reload} />
      ) : eps.data?.data.length ? (
        <ul className="divide-y">
          {eps.data.data.map((ep: any) => (
            <li key={ep.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-mono text-[13px]">{ep.url}</p>
                <p className="text-xs text-muted-foreground">{ep.events.join(", ")} · added {ago(ep.created_at)}</p>
              </div>
              <Button variant="ghost" size="sm" loading={pending === ep.id} onClick={() => run(ep.id, "Endpoint removed", () => api().webhookEndpoints.del(ep.id)).then(eps.reload)}>
                <Trash2 className="size-3.5" aria-hidden /> Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<Webhook className="size-4" aria-hidden />} title="No endpoints" body="Get invoice.paid, checkout.session.completed, bill.paid and more." />
      )}
    </Card>
  );
}

function Quickstart() {
  const code = `import { Settle } from "@settle/sdk";
const settle = new Settle(process.env.SETTLE_SECRET_KEY, { baseUrl: "${API_URL || (typeof window !== "undefined" ? window.location.origin : "")}" });

// Bill a customer. They can pay from any chain.
const invoice = await settle.invoices.create({
  customer_email: "ap@cafe.com",
  line_items: [{ description: "Sourdough x40", amount: "120.00" }],
});
console.log(invoice.hosted_url);

// Hosted checkout for your web shop
const session = await settle.checkout.sessions.create({
  amount: "42.00",
  success_url: "https://shop.com/thanks",
});

// Verify webhooks
import { constructEvent } from "@settle/sdk/webhooks";
const event = constructEvent(WHSEC, rawBody, req.headers["settle-signature"]);
if (event.type === "invoice.paid") fulfil(event.data.object);`;
  return (
    <Card className="mt-6">
      <CardHeader title="Quickstart" action={<CopyButton value={code} label="Copy code" />} />
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </Card>
  );
}

function EventLog() {
  const events = useAsync(() => api().events.list({ limit: 25 }), [], { pollMs: 8_000 });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card className="mt-6">
      <CardHeader title="Event log" description="Exactly what your webhook endpoints receive." />
      {events.loading && !events.data ? (
        <SkeletonRows rows={4} />
      ) : events.error ? (
        <ErrorState error={events.error} retry={events.reload} />
      ) : events.data?.data.length ? (
        <ul className="divide-y">
          {events.data.data.map((e: any) => (
            <li key={e.id}>
              <button
                onClick={() => setOpen(open === e.id ? null : e.id)}
                aria-expanded={open === e.id}
                className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <Mono className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.type}</Mono>
                <Mono className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{e.id}</Mono>
                <span className="text-xs text-muted-foreground">{ago(e.created)}</span>
              </button>
              {open === e.id && <pre className="fade-in max-h-80 overflow-auto border-t bg-muted/40 px-5 py-3 font-mono text-xs">{JSON.stringify(e, null, 2)}</pre>}
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No events yet" />
      )}
    </Card>
  );
}
