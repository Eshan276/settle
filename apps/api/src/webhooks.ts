import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { all, newId, now, parseJson, run, get } from "./db.ts";
import { background } from "./background.ts";

/**
 * Stripe-style events + signed webhooks.
 * Header: `Settle-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<body>")>`
 */
export type EventType =
  | "invoice.created"
  | "invoice.paid"
  | "invoice.partially_paid"
  | "invoice.cancelled"
  | "checkout.session.completed"
  | "payment.intent_deposit.received"
  | "payout.email.created"
  | "payout.email.claimed"
  | "bill.parsed"
  | "bill.paid"
  | "bill.pending_approval"
  | "subscription.charged"
  | "subscription.past_due";

export async function emitEvent(accountId: string, type: EventType, data: Record<string, unknown>) {
  const id = newId("evt");
  const created = now();
  await run("INSERT INTO events (id, account_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)", id, accountId, type, JSON.stringify(data), created);
  let queued = 0;
  for (const ep of await all("SELECT * FROM webhook_endpoints WHERE account_id = ? AND disabled_at IS NULL", accountId)) {
    const events = parseJson<string[]>(ep.events, ["*"]);
    if (!events.includes("*") && !events.includes(type)) continue;
    await run(
      "INSERT INTO webhook_deliveries (id, endpoint_id, event_id, status, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)",
      newId("whd"),
      ep.id,
      id,
      created,
      created,
    );
    queued++;
  }
  // Deliver right away instead of waiting for a poller (there is none on serverless).
  if (queued) background("webhook delivery", deliverPending);
  return { id, type, created, data };
}

export function newWebhookSecret() {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export function sign(secret: string, body: string, t = now()) {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export function verify(secret: string, body: string, header: string, toleranceSecs = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now() - t) > toleranceSecs || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const BACKOFF = [10, 60, 300, 1800, 7200, 21600]; // seconds

export async function deliverPending() {
  const due = await all(
    `SELECT d.*, e.url, e.secret, ev.type, ev.data, ev.created_at AS event_created, ev.account_id
     FROM webhook_deliveries d
     JOIN webhook_endpoints e ON e.id = d.endpoint_id
     JOIN events ev ON ev.id = d.event_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= ? LIMIT 25`,
    now(),
  );
  await Promise.all(
    due.map(async (d) => {
      const body = JSON.stringify({
        id: d.event_id,
        object: "event",
        type: d.type,
        created: d.event_created,
        account: d.account_id,
        data: { object: parseJson(d.data, {}) },
      });
      let code: number | null = null;
      let error: string | null = null;
      try {
        const res = await fetch(d.url, {
          method: "POST",
          headers: { "content-type": "application/json", "settle-signature": sign(d.secret, body), "user-agent": "Settle-Webhooks/1.0" },
          body,
          signal: AbortSignal.timeout(8000),
        });
        code = res.status;
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch (e) {
        error = (e as Error).message;
      }
      const attempts = d.attempts + 1;
      if (!error) {
        await run("UPDATE webhook_deliveries SET status='delivered', attempts=?, response_code=?, last_error=NULL WHERE id=?", attempts, code, d.id);
      } else if (attempts >= BACKOFF.length) {
        await run("UPDATE webhook_deliveries SET status='failed', attempts=?, response_code=?, last_error=? WHERE id=?", attempts, code, error, d.id);
      } else {
        await run(
          "UPDATE webhook_deliveries SET attempts=?, response_code=?, last_error=?, next_attempt_at=? WHERE id=?",
          attempts,
          code,
          error,
          now() + BACKOFF[attempts - 1],
          d.id,
        );
      }
    }),
  );
}

export async function eventById(id: string) {
  const e = await get("SELECT * FROM events WHERE id = ?", id);
  return e && { id: e.id, object: "event", type: e.type, created: e.created_at, data: { object: parseJson(e.data, {}) } };
}
