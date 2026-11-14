import pg from "pg";
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";

// Postgres (Neon in production). BIGINT columns hold unix seconds and counts: parse them as JS numbers.
pg.types.setTypeParser(20, (v) => Number(v));

let _pool: pg.Pool | undefined;
function pool() {
  if (!_pool) {
    if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
    _pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.PG_POOL_MAX ?? 5), idleTimeoutMillis: 10_000 });
    _pool.on("error", (e) => console.error("[settle] postgres pool error", e.message));
  }
  return _pool;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS businesses (
  account_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  name TEXT,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  onchain_id BIGINT UNIQUE,
  business TEXT NOT NULL,
  kind TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  amount_paid TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL,
  number TEXT,
  description TEXT,
  customer_name TEXT,
  customer_email TEXT,
  line_items TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  split_id BIGINT,
  due_at BIGINT,
  success_url TEXT,
  cancel_url TEXT,
  paid_at BIGINT,
  last_payer TEXT,
  tx_hash TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_business ON invoices(business, created_at);
CREATE INDEX IF NOT EXISTS invoices_open ON invoices(status, updated_at);
CREATE TABLE IF NOT EXISTS intent_deposits (
  deposit_address TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  mode TEXT NOT NULL,
  origin_asset TEXT NOT NULL,
  amount_in TEXT,
  amount_in_formatted TEXT,
  amount_out TEXT,
  refund_to TEXT,
  status TEXT NOT NULL,
  settled BIGINT NOT NULL DEFAULT 0,
  settle_tx TEXT,
  quote TEXT,
  deadline TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["*"]',
  created_at BIGINT NOT NULL,
  disabled_at BIGINT
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_account ON events(account_id, created_at);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  status TEXT NOT NULL,
  attempts BIGINT NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NOT NULL,
  response_code BIGINT,
  last_error TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_payouts (
  public_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  recipient_email TEXT,
  recipient_name TEXT,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  memo TEXT,
  status TEXT NOT NULL,
  claimed_by TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  vendor_name TEXT,
  vendor_account TEXT,
  vendor_email TEXT,
  invoice_number TEXT,
  amount TEXT,
  currency TEXT,
  due_date TEXT,
  description TEXT,
  line_items TEXT NOT NULL DEFAULT '[]',
  confidence DOUBLE PRECISION,
  risk_flags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  status TEXT NOT NULL,
  approval_id BIGINT,
  settle_invoice_id BIGINT,
  tx_hash TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  account_id TEXT NOT NULL,
  event TEXT NOT NULL,
  data TEXT NOT NULL,
  tx_hash TEXT,
  actor TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger(account_id, created_at);
CREATE INDEX IF NOT EXISTS ledger_event ON ledger(account_id, event, created_at);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  near_account TEXT,
  title TEXT,
  type TEXT NOT NULL DEFAULT 'employee',
  default_amount TEXT,
  active BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS people_account ON people(account_id);
-- Rate limits for the sponsored (gas-costing) endpoints: shared by every serverless instance.
CREATE TABLE IF NOT EXISTS rate_hits (
  key TEXT NOT NULL,
  at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_hits_key ON rate_hits(key, at);
-- Throttles for on-demand background work (invoice sync, cron), shared across instances.
CREATE TABLE IF NOT EXISTS job_runs (
  name TEXT PRIMARY KEY,
  at BIGINT NOT NULL
);
`;

let ready: Promise<unknown> | undefined;
const init = () =>
  (ready ??= pool()
    .query(SCHEMA)
    .catch((e) => {
      ready = undefined;
      throw e;
    }));

/** SQLite-style `?` placeholders → Postgres `$1, $2, …` (no query in this codebase contains a literal `?`). */
const pgSql = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

export type Row = Record<string, any>;
async function query(sql: string, params: unknown[]) {
  await init();
  return pool().query(pgSql(sql), params);
}
export const all = async (sql: string, ...params: unknown[]) => (await query(sql, params)).rows as Row[];
export const get = async (sql: string, ...params: unknown[]) => (await query(sql, params)).rows[0] as Row | undefined;
export const run = async (sql: string, ...params: unknown[]) => ({ changes: (await query(sql, params)).rowCount ?? 0 });
export const closeDb = () => _pool?.end();

/**
 * Run `name` at most once per `everySecs` across all instances: claims the slot atomically, so concurrent
 * serverless invocations don't repeat the same chain sync.
 */
export async function claimJob(name: string, everySecs: number) {
  const t = now();
  const r = await run(
    "INSERT INTO job_runs (name, at) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET at = EXCLUDED.at WHERE job_runs.at <= ?",
    name,
    t,
    t - everySecs,
  );
  return r.changes > 0;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export function newId(prefix: string, len = 18): string {
  const bytes = randomBytes(len);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % 62];
  return `${prefix}_${s}`;
}

export const now = () => Math.floor(Date.now() / 1000);

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
