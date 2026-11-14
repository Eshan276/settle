import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVars } from "./auth.ts";
import { config } from "./config.ts";
import { all, get, newId, now, parseJson, run } from "./db.ts";
import { arAging, assetSymbol, csv, customerKey, customers, intentLabel, invoiceStatus, normalize, payRuns, summary } from "./finance.ts";
import { serializeInvoice, findInvoice } from "./invoices.ts";
import { ledgerFor } from "./ledger.ts";
import { syncBusinessSoon } from "./watcher.ts";
import { explorerTx, fromBase, HttpError, tokenInfo } from "./near.ts";

const accountId = z.string().regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "invalid NEAR account id").min(2).max(64);
const money = z.union([z.string(), z.number()]).transform(String).refine((s) => /^\d+(\.\d{1,6})?$/.test(s), "invalid amount");
const body = async <T extends z.ZodType>(c: any, s: T): Promise<z.infer<T>> => s.parse(await c.req.json().catch(() => ({})));
const sendCsv = (c: any, name: string, content: string) =>
  c.body(content, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` });

export function registerFinance(v1: Hono<AuthVars>) {
  // ------------------------------------------------------------- summary
  v1.get("/summary", async (c) => {
    await syncBusinessSoon(c.get("accountId"));
    return c.json(await summary(c.get("accountId")));
  });

  // -------------------------------------------------------- transactions
  v1.get("/transactions", async (c) => {
    const me = c.get("accountId");
    const q = c.req.query();
    let rows = await normalize(me);
    if (q.category) rows = rows.filter((r) => r.category === q.category);
    if (q.direction) rows = rows.filter((r) => r.direction === q.direction);
    if (q.from) rows = rows.filter((r) => r.date >= Number(q.from));
    if (q.to) rows = rows.filter((r) => r.date <= Number(q.to));
    if (q.q) {
      const s = q.q.toLowerCase();
      rows = rows.filter((r) => `${r.description} ${r.counterparty ?? ""} ${r.counterparty_name ?? ""}`.toLowerCase().includes(s));
    }
    if (q.format === "csv") {
      return sendCsv(
        c,
        "settle-transactions.csv",
        csv(
          rows.map((r) => ({ ...r, date: new Date(r.date * 1000).toISOString(), proof: r.tx_hash ? explorerTx(r.tx_hash) : "" })),
          ["date", "description", "category", "direction", "counterparty_name", "counterparty", "gross", "fee", "net", "reference", "tx_hash", "proof"],
        ),
      );
    }
    return c.json({ object: "list", data: rows.map((r) => ({ ...r, proof_url: r.tx_hash ? explorerTx(r.tx_hash) : null })) });
  });

  // ------------------------------------------------------------- invoices
  v1.get("/receivables/invoices", async (c) => {
    const me = c.get("accountId");
    const tab = c.req.query("tab") ?? "all";
    const q = (c.req.query("q") ?? "").toLowerCase();
    const customer = c.req.query("customer");
    await syncBusinessSoon(me);
    const rows = (await all("SELECT * FROM invoices WHERE business = ? AND kind = 'invoice' ORDER BY created_at DESC", me)).map((r) => ({ r, s: invoiceStatus(r).status }));
    const counts = { all: rows.length, outstanding: 0, overdue: 0, paid: 0, void: 0 };
    for (const { s } of rows) {
      if (["open", "partially_paid", "overdue"].includes(s)) counts.outstanding++;
      if (s === "overdue") counts.overdue++;
      if (s === "paid") counts.paid++;
      if (s === "void") counts.void++;
    }
    const keep = rows.filter(({ r, s }) => {
      if (tab === "outstanding" && !["open", "partially_paid", "overdue"].includes(s)) return false;
      if (tab === "overdue" && s !== "overdue") return false;
      if (tab === "paid" && s !== "paid") return false;
      if (tab === "void" && s !== "void") return false;
      if (customer && customerKey(r) !== customer) return false;
      if (q && !`${r.number ?? ""} ${r.customer_name ?? ""} ${r.customer_email ?? ""} ${r.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (tab === "outstanding" || tab === "overdue") keep.sort((a, b) => (a.r.due_at ?? Infinity) - (b.r.due_at ?? Infinity));
    const data = await Promise.all(keep.map(({ r }) => serializeInvoice(r)));
    if (c.req.query("format") === "csv") {
      return sendCsv(c, "settle-invoices.csv", csv(data.map((i) => ({ ...i, issued: new Date(i.created_at * 1000).toISOString().slice(0, 10), due: i.due_at ? new Date(i.due_at * 1000).toISOString().slice(0, 10) : "" })), ["number", "customer_name", "customer_email", "issued", "due", "amount", "amount_paid", "amount_due", "display_status", "hosted_url"]));
    }
    return c.json({ object: "list", counts, data });
  });

  /** Everything that happened to an invoice, oldest first, each with on-chain proof. */
  v1.get("/invoices/:id/timeline", async (c) => {
    const me = c.get("accountId");
    const inv = await findInvoice(c.req.param("id"), me);
    const info = await tokenInfo(inv.token);
    const $ = (base: string) => `$${Number(fromBase(base, info.decimals)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const items: any[] = [{ at: inv.created_at, type: "created", title: `Invoice ${inv.number ?? inv.id} created`, detail: `${$(inv.amount)} due${inv.due_at ? ` by ${new Date(inv.due_at * 1000).toDateString().slice(4)}` : ""}`, tx_hash: inv.tx_hash }];
    for (const d of await all("SELECT * FROM intent_deposits WHERE invoice_id = ? ORDER BY created_at", inv.id)) {
      items.push({
        at: d.created_at,
        type: "payment_attempt",
        title: `Customer paying ${d.amount_in_formatted} ${assetSymbol(d.origin_asset)}`,
        detail: `NEAR Intents · ${d.status.replace(/_/g, " ").toLowerCase()}${d.mode === "simulated" ? " · simulated swap (testnet)" : ""}`,
        status: d.status,
        tx_hash: d.settle_tx,
      });
    }
    const rows = await all(
      "SELECT * FROM ledger WHERE account_id = ? AND event IN ('invoice_paid','invoice_partially_paid','invoice_cancelled') AND (data::jsonb->>'invoice_id') = ? ORDER BY created_at",
      me,
      String(inv.onchain_id),
    );
    for (const r of rows) {
      const e = parseJson<any>(r.data, {});
      if (r.event === "invoice_cancelled") items.push({ at: r.created_at, type: "void", title: "Invoice voided", tx_hash: r.tx_hash });
      else {
        const via = e.payer === config.relayerAccountId ? await intentLabel(inv.id) : null;
        items.push({ at: r.created_at, type: "payment", title: `Payment received · ${$(e.amount)}`, detail: via ? `${via}, settled to your treasury` : `from ${e.payer}`, tx_hash: r.tx_hash });
      }
    }
    items.sort((a, b) => a.at - b.at);
    const payments = (await normalize(me, await ledgerFor(me, { events: ["invoice_paid", "invoice_partially_paid"], limit: 1000 }))).filter((m) => m.reference === inv.id);
    return c.json({ data: items.map((i) => ({ ...i, proof_url: i.tx_hash ? explorerTx(i.tx_hash) : null })), payments });
  });

  // ------------------------------------------------------------- customers
  v1.get("/customers", async (c) => c.json({ object: "list", data: await customers(c.get("accountId")) }));

  // ---------------------------------------------------------------- people
  const personSchema = z.object({
    name: z.string().min(1).max(120),
    email: z.string().email().optional().nullable(),
    near_account: accountId.optional().nullable(),
    title: z.string().max(80).optional().nullable(),
    type: z.enum(["employee", "contractor"]).optional(),
    default_amount: money.optional().nullable(),
    active: z.boolean().optional(),
  });
  const serializePerson = (p: any) => ({ ...p, active: Boolean(p.active) });

  v1.get("/people", async (c) => {
    const me = c.get("accountId");
    const runs = await payRuns(me);
    const ytdStart = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
    const ytd = new Map<string, number>();
    for (const r of runs) if (r.date >= ytdStart) for (const l of r.lines) ytd.set(l.account_id, (ytd.get(l.account_id) ?? 0) + Number(l.amount));
    return c.json({
      object: "list",
      data: (await all("SELECT * FROM people WHERE account_id = ? ORDER BY active DESC, lower(name)", me)).map((p) => ({ ...serializePerson(p), paid_ytd: (ytd.get(p.near_account) ?? 0).toFixed(2) })),
    });
  });

  v1.post("/people", async (c) => {
    const b = await body(c, personSchema);
    const id = newId("per", 12);
    await run(
      "INSERT INTO people (id, account_id, name, email, near_account, title, type, default_amount, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, c.get("accountId"), b.name, b.email ?? null, b.near_account ?? null, b.title ?? null, b.type ?? "employee", b.default_amount ?? null, b.active === false ? 0 : 1, now(),
    );
    return c.json(serializePerson(await get("SELECT * FROM people WHERE id = ?", id)));
  });

  v1.patch("/people/:id", async (c) => {
    const b = await body(c, personSchema.partial());
    const p = await get("SELECT * FROM people WHERE id = ? AND account_id = ?", c.req.param("id"), c.get("accountId"));
    if (!p) throw new HttpError(404, "No such person", "not_found");
    const merged = { ...p, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) } as any;
    await run(
      "UPDATE people SET name=?, email=?, near_account=?, title=?, type=?, default_amount=?, active=? WHERE id=?",
      merged.name, merged.email, merged.near_account, merged.title, merged.type, merged.default_amount, merged.active === false || merged.active === 0 ? 0 : 1, p.id,
    );
    return c.json(serializePerson(await get("SELECT * FROM people WHERE id = ?", p.id)));
  });

  v1.delete("/people/:id", async (c) => {
    await run("UPDATE people SET active = 0 WHERE id = ? AND account_id = ?", c.req.param("id"), c.get("accountId"));
    return c.json({ id: c.req.param("id"), archived: true });
  });

  /** CSV: name,email,near_account,amount[,title] */
  v1.post("/people/import", async (c) => {
    const { csv: text } = await body(c, z.object({ csv: z.string().max(100_000) }));
    const me = c.get("accountId");
    const created: any[] = [];
    const errors: string[] = [];
    for (const [i, line] of text.split("\n").entries()) {
      const cols = line.split(/[,\t;]/).map((s) => s.trim());
      if (!line.trim() || /^name\b/i.test(cols[0])) continue;
      const parsed = personSchema.safeParse({ name: cols[0], email: cols[1] || null, near_account: cols[2] || null, default_amount: cols[3] || null, title: cols[4] || null });
      if (!parsed.success) {
        errors.push(`Line ${i + 1}: ${parsed.error.issues[0].message}`);
        continue;
      }
      const id = newId("per", 12);
      const p = parsed.data;
      await run("INSERT INTO people (id, account_id, name, email, near_account, title, type, default_amount, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 'employee', ?, 1, ?)", id, me, p.name, p.email ?? null, p.near_account ?? null, p.title ?? null, p.default_amount ?? null, now());
      created.push(id);
    }
    return c.json({ created: created.length, errors });
  });

  // --------------------------------------------------------------- payroll
  v1.get("/payroll/runs", async (c) => c.json({ object: "list", data: (await payRuns(c.get("accountId"))).map((r) => ({ ...r, proof_url: r.tx_hash ? explorerTx(r.tx_hash) : null })) }));

  // --------------------------------------------------------------- bills
  v1.get("/bills/:id", async (c) => {
    const me = c.get("accountId");
    const b = await get("SELECT * FROM bills WHERE id = ? AND account_id = ?", c.req.param("id"), me);
    if (!b) throw new HttpError(404, "No such bill", "not_found");
    const trail: any[] = [{ at: b.created_at, title: `Read by ${b.source === "claude" ? "Claude" : "offline parser"}`, detail: `${Math.round((b.confidence ?? 0) * 100)}% confidence${parseJson<string[]>(b.risk_flags, []).length ? ` · ${parseJson<string[]>(b.risk_flags, []).length} risk flag(s)` : ""}` }];
    if (b.tx_hash) {
      for (const r of await all("SELECT * FROM ledger WHERE account_id = ? AND tx_hash = ?", me, b.tx_hash)) {
        const e = parseJson<any>(r.data, {});
        if (r.event === "agent_payment") trail.push({ at: r.created_at, title: "Paid by AI autopay (within policy)", detail: `to ${e.recipient}`, tx_hash: r.tx_hash });
        if (r.event === "approval_requested") trail.push({ at: r.created_at, title: "AI requested approval", detail: (e.reasons ?? []).map((x: string) => x.replace(/_/g, " ")).join(", "), tx_hash: r.tx_hash });
      }
    }
    if (b.approval_id != null) {
      for (const r of await all("SELECT * FROM ledger WHERE account_id = ? AND event IN ('approval_approved','approval_rejected') AND (data::jsonb->>'approval_id') = ?", me, String(b.approval_id))) {
        trail.push({ at: r.created_at, title: r.event === "approval_approved" ? "Approved by you · paid" : "Rejected by you", tx_hash: r.tx_hash });
      }
    }
    if (b.status === "rejected" && !trail.some((t) => t.title.startsWith("Rejected"))) trail.push({ at: b.updated_at, title: "Rejected" });
    trail.sort((x, y) => x.at - y.at);
    return c.json({ ...b, line_items: parseJson(b.line_items, []), risk_flags: parseJson(b.risk_flags, []), trail: trail.map((t) => ({ ...t, proof_url: t.tx_hash ? explorerTx(t.tx_hash) : null })) });
  });

  v1.post("/bills/:id/reject", async (c) => {
    const b = await get("SELECT * FROM bills WHERE id = ? AND account_id = ?", c.req.param("id"), c.get("accountId"));
    if (!b) throw new HttpError(404, "No such bill", "not_found");
    if (!["needs_review", "ready"].includes(b.status)) throw new HttpError(409, `Bill is ${b.status}`, "bill_not_rejectable");
    await run("UPDATE bills SET status = 'rejected', updated_at = ? WHERE id = ?", now(), b.id);
    return c.json({ id: b.id, status: "rejected" });
  });

  // --------------------------------------------------------------- reports
  v1.get("/reports/ar-aging", async (c) => {
    const r = await arAging(c.get("accountId"));
    if (c.req.query("format") === "csv") return sendCsv(c, "settle-ar-aging.csv", csv([...r.rows, r.total], ["customer", ...r.buckets, "total"]));
    return c.json(r);
  });

  v1.get("/reports/payroll-register", async (c) => {
    const runs = await payRuns(c.get("accountId"));
    const lines = runs.flatMap((r) => r.lines.map((l: any) => ({ run_date: new Date(r.date * 1000).toISOString().slice(0, 10), reference: r.reference ?? "", employee: l.name ?? "", pay_to: l.account_id, amount: l.amount, tx_hash: r.tx_hash ?? "", proof: r.tx_hash ? explorerTx(r.tx_hash) : "" })));
    if (c.req.query("format") === "csv") return sendCsv(c, "settle-payroll-register.csv", csv(lines, ["run_date", "reference", "employee", "pay_to", "amount", "tx_hash", "proof"]));
    return c.json({ object: "list", data: lines });
  });

  v1.get("/reports/cash-flow", async (c) => {
    const rows = await normalize(c.get("accountId"));
    const months = new Map<string, Map<string, number>>();
    for (const m of rows) {
      const month = new Date(m.date * 1000).toISOString().slice(0, 7);
      const cat = m.direction === "internal" ? `Treasury transfers` : m.category;
      const byCat = months.get(month) ?? new Map();
      byCat.set(cat, (byCat.get(cat) ?? 0) + Number(m.net));
      months.set(month, byCat);
    }
    const cats = [...new Set(rows.map((m) => (m.direction === "internal" ? "Treasury transfers" : m.category)))];
    const out = [...months.entries()].sort().map(([month, byCat]) => {
      const row: Record<string, string> = { month };
      let net = 0;
      for (const cat of cats) {
        const v = byCat.get(cat) ?? 0;
        row[cat] = v.toFixed(2);
        if (cat !== "Treasury transfers") net += v;
      }
      row["Net operating cash flow"] = net.toFixed(2);
      return row;
    });
    if (c.req.query("format") === "csv") return sendCsv(c, "settle-cash-flow.csv", csv(out, ["month", ...cats, "Net operating cash flow"]));
    return c.json({ categories: cats, data: out });
  });
}

export { customerKey, config };
