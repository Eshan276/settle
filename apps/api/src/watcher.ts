/**
 * Chain sync jobs. There is no always-on poller in production (serverless): each job runs on demand,
 *  - deposits advance when the pay page polls their status,
 *  - a business' open invoices sync when its dashboard loads (throttled),
 *  - webhooks deliver right after the event that queued them,
 *  - and /v1/cron/tick runs everything (Vercel cron / an external pinger).
 * The standalone Node server (index.ts) still runs all of it on a timer.
 */
import { background } from "./background.ts";
import { config } from "./config.ts";
import { all, claimJob, now, run, type Row } from "./db.ts";
import * as intents from "./intents.ts";
import { syncInvoice } from "./invoices.ts";
import { call, relayer, settleEvents, view } from "./near.ts";
import { deliverPending, emitEvent } from "./webhooks.ts";

/** Forward funds delivered by NEAR Intents into the invoice. Safe to call concurrently from many instances. */
export async function settleDeposit(dep: Row) {
  const lock = `settle:${dep.deposit_address}`;
  if (!(await claimJob(lock, 120))) return; // another instance is settling it
  try {
    const inv = (await all("SELECT * FROM invoices WHERE id = ?", dep.invoice_id))[0];
    const chain = await view<any>("get_invoice", { invoice_id: inv.onchain_id });
    const remaining = BigInt(chain.amount) - BigInt(chain.amount_paid);
    if (chain.status !== "open" || remaining <= 0n) {
      await run("UPDATE intent_deposits SET settled = 1, status = 'SUCCESS', updated_at = ? WHERE deposit_address = ?", now(), dep.deposit_address);
      return;
    }
    const amount = dep.mode === "simulated" ? remaining : BigInt(dep.amount_out ?? remaining);
    if (dep.mode === "simulated") {
      // Testnet stand-in for the solver delivering funds to our settlement account.
      await call(relayer(), "mint", { account_id: config.relayerAccountId, amount: amount.toString() }, { contractId: inv.token, tgas: 30 });
    }
    const res = await call(
      relayer(),
      "ft_transfer_call",
      {
        receiver_id: config.contractId,
        amount: amount.toString(),
        msg: JSON.stringify({ action: "pay_invoice", invoice_id: inv.onchain_id, payer: dep.refund_to && /\.(near|testnet)$/.test(dep.refund_to) ? dep.refund_to : null }),
      },
      { contractId: inv.token, deposit: 1n, tgas: 120 },
    );
    await run(
      "UPDATE intent_deposits SET settled = 1, status = 'SUCCESS', settle_tx = ?, updated_at = ? WHERE deposit_address = ?",
      res.txHash,
      now(),
      dep.deposit_address,
    );
    await emitEvent(inv.business, "payment.intent_deposit.received", {
      invoice_id: inv.id,
      deposit_address: dep.deposit_address,
      origin_asset: dep.origin_asset,
      amount_in: dep.amount_in_formatted,
      settle_tx: res.txHash,
      mode: dep.mode,
    });
    await syncInvoice(inv);
  } catch (e) {
    console.error("[settle] settlement failed", dep.deposit_address, (e as Error).message);
    await run("DELETE FROM job_runs WHERE name = ?", lock); // let the next poll retry
  }
}

/** Move one deposit forward: the testnet simulator's state machine, or 1Click's status on mainnet. */
export async function advanceDeposit(dep: Row) {
  if (dep.settled || ["REFUNDED", "FAILED"].includes(dep.status)) return;
  if (dep.mode === "simulated") {
    const age = now() - dep.updated_at;
    if (dep.status === "KNOWN_DEPOSIT_TX" && age >= 3) {
      await run("UPDATE intent_deposits SET status = 'PROCESSING', updated_at = ? WHERE deposit_address = ? AND status = 'KNOWN_DEPOSIT_TX'", now(), dep.deposit_address);
    } else if (dep.status === "PROCESSING" && age >= 4) {
      await settleDeposit(dep);
    }
    return;
  }
  const s = await intents.status(dep.deposit_address);
  if (s.status !== dep.status) {
    await run(
      "UPDATE intent_deposits SET status = ?, amount_out = COALESCE(?, amount_out), updated_at = ? WHERE deposit_address = ?",
      s.status,
      s.amountOut ?? null,
      now(),
      dep.deposit_address,
    );
  }
  if (s.status === "SUCCESS") await settleDeposit({ ...dep, amount_out: s.amountOut ?? dep.amount_out });
}

export async function pollDeposits(business?: string) {
  const pending = await all(
    `SELECT d.* FROM intent_deposits d JOIN invoices i ON i.id = d.invoice_id
     WHERE d.settled = 0 AND d.status NOT IN ('REFUNDED','FAILED') AND d.created_at > ? ${business ? "AND i.business = ?" : ""}`,
    now() - 86400,
    ...(business ? [business] : []),
  );
  for (const dep of pending) {
    await advanceDeposit(dep).catch((e) => console.error("[settle] deposit poll failed", dep.deposit_address, (e as Error).message));
  }
}

export async function syncOpenInvoices(business?: string) {
  const rows = business
    ? await all("SELECT * FROM invoices WHERE status = 'open' AND business = ? ORDER BY updated_at ASC LIMIT 100", business)
    : await all("SELECT * FROM invoices WHERE status = 'open' ORDER BY updated_at ASC LIMIT 100");
  // One at a time: public RPCs rate-limit bursts.
  for (const inv of rows) {
    await syncInvoice(inv).catch((e) => console.error("[settle] invoice sync failed", inv.id, (e as Error).message));
  }
}

/** Anyone can charge a due subscription; Settle runs the keeper so merchants don't have to. */
async function chargeDueSubscriptions() {
  if (!(await claimJob("keeper", 30))) return;
  const due = await view<number[]>("get_due_subscriptions", { limit: 20 });
  for (const id of due) {
    try {
      const res = await call<boolean>(relayer(), "charge_subscription", { subscription_id: id }, { tgas: 30 });
      for (const e of settleEvents(res.logs)) {
        if (e.event === "subscription_charged") await emitEvent(e.data.merchant, "subscription.charged", { ...e.data, tx_hash: res.txHash });
        if (e.event === "subscription_past_due") await emitEvent(e.data.merchant, "subscription.past_due", { ...e.data, tx_hash: res.txHash });
      }
    } catch (e) {
      console.error("[settle] keeper charge failed", id, (e as Error).message);
    }
  }
}

/** Everything, once: what the old 4-second poller did on each tick. */
export async function runAllJobs() {
  if (!config.contractId || !config.relayerAccountId) return { skipped: true };
  const results = await Promise.allSettled([pollDeposits(), syncOpenInvoices(), deliverPending(), chargeDueSubscriptions()]);
  return { jobs: ["deposits", "invoices", "webhooks", "subscriptions"].map((name, i) => ({ name, ok: results[i].status === "fulfilled" })) };
}

/** Called when a dashboard loads: catch this business up with the chain in the background, at most every 10 s. */
export async function syncBusinessSoon(business: string) {
  if (!config.contractId || !(await claimJob(`sync:${business}`, 10))) return;
  background("business sync", () => Promise.all([pollDeposits(business), syncOpenInvoices(business)]));
}

export function startWatcher() {
  if (!config.contractId || !config.relayerAccountId) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAllJobs();
    } finally {
      running = false;
    }
  };
  setInterval(tick, config.watcherIntervalMs);
  void tick();
}
