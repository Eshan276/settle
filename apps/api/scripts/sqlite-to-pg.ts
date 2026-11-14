/**
 * One-time copy of the old SQLite database into Postgres (Neon).
 *   DATABASE_URL=postgres://… npx tsx scripts/sqlite-to-pg.ts [settle.db]
 * Idempotent: rows that already exist are skipped. Events and ledger rows keep their original order.
 */
import { DatabaseSync } from "node:sqlite";
import { all, closeDb, run } from "../src/db.ts";

const file = process.argv[2] ?? "settle.db";
const src = new DatabaseSync(file, { readOnly: true });

// Parent tables before the tables that reference them.
const TABLES: [string, string][] = [
  ["businesses", "account_id"],
  ["sessions", "token"],
  ["api_keys", "id"],
  ["invoices", "id"],
  ["intent_deposits", "deposit_address"],
  ["webhook_endpoints", "id"],
  ["events", "id"],
  ["webhook_deliveries", "id"],
  ["email_payouts", "public_key"],
  ["bills", "id"],
  ["ledger", "id"],
  ["people", "id"],
];

await all("SELECT 1"); // creates the schema
for (const [table, key] of TABLES) {
  const exists = src.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) continue;
  const rows = src.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];
  let copied = 0;
  for (const r of rows) {
    const cols = Object.keys(r);
    const res = await run(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT (${key}) DO NOTHING`,
      ...cols.map((c) => r[c]),
    );
    copied += res.changes;
  }
  console.log(`${table.padEnd(20)} ${String(copied).padStart(5)} copied of ${rows.length}`);
}
await closeDb();
