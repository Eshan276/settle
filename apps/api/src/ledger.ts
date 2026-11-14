/**
 * Ledger: every Settle contract event we observe (relayed meta-txs + server-signed calls),
 * fanned out to each account it touches, with the tx hash as on-chain proof.
 * This is the source of truth for transactions tables, payroll runs and reports.
 */
import { all, now, parseJson, run } from "./db.ts";

const ACCOUNT_FIELDS = ["business", "employer", "employee", "account_id", "from", "to", "creator", "receiver_id", "merchant", "subscriber", "payer", "recipient", "agent"];

export async function recordEvents(events: { event: string; data: any }[], txHash: string | null, actor: string | null) {
  const writes: Promise<unknown>[] = [];
  events.forEach((e, i) => {
    const accounts = new Set<string>();
    if (actor) accounts.add(actor);
    for (const f of ACCOUNT_FIELDS) if (typeof e.data?.[f] === "string") accounts.add(e.data[f]);
    if (e.event === "payroll_run") for (const en of e.data?.entries ?? []) accounts.add(en.account_id);
    for (const a of accounts) {
      writes.push(
        run(
          "INSERT INTO ledger (id, account_id, event, data, tx_hash, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
          `${txHash ?? now()}:${i}:${a}`,
          a,
          e.event,
          JSON.stringify(e.data ?? {}),
          txHash,
          actor,
          now(),
        ),
      );
    }
  });
  await Promise.all(writes);
}

export async function ledgerFor(accountId: string, opts: { events?: string[]; limit?: number; since?: number } = {}) {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const ev = opts.events?.length ? `AND event IN (${opts.events.map(() => "?").join(",")})` : "";
  const rows = await all(
    `SELECT * FROM ledger WHERE account_id = ? ${ev} AND created_at >= ? ORDER BY created_at DESC, seq DESC LIMIT ?`,
    accountId,
    ...(opts.events ?? []),
    opts.since ?? 0,
    limit,
  );
  return rows.map((r) => ({ id: r.id, event: r.event, data: parseJson<any>(r.data, {}), tx_hash: r.tx_hash, actor: r.actor, created_at: r.created_at }));
}
