/**
 * Records the Settle product demo against the live app (testnet) and writes:
 *   out/raw.webm      screen recording
 *   out/demo.srt      subtitles timed to what actually happened on screen
 *
 * Then run ./build.sh to burn subtitles and produce the final MP4.
 * Requires: API on :4000, web on :3000, Chrome.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../apps/web/package.json"));
const puppeteer = require("puppeteer-core");

const WEB = process.env.SETTLE_WEB ?? "http://localhost:3000";
const API = process.env.SETTLE_API ?? "http://localhost:4000";
const CHROME = process.env.CHROME_PATH ?? "/bin/google-chrome-stable";
const OUT = resolve(here, "out");
mkdirSync(OUT, { recursive: true });

const cfg = await (await fetch(`${API}/v1/config`)).json();
const SUFFIX = cfg.account_suffix;
const tag = Math.random().toString(36).slice(2, 6);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ captions
const captions = [];
let t0 = 0;
const now = () => (Date.now() - t0) / 1000;
function cap(text) {
  const t = now();
  const prev = captions.at(-1);
  if (prev && prev.end === null) prev.end = t;
  captions.push({ start: t, end: null, text });
}
function endCap() {
  const prev = captions.at(-1);
  if (prev && prev.end === null) prev.end = now();
}
const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, "0")}`;
};

// ------------------------------------------------------------------ browser
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: 1440, height: 810, deviceScaleFactor: 4 / 3 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.warn("pageerror:", e.message));

// Visible cursor + click ripple (headless screencasts have no cursor).
await page.evaluateOnNewDocument(() => {
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    Object.assign(c.style, {
      position: "fixed", left: `${window.__cx ?? 720}px`, top: `${window.__cy ?? 405}px`, width: "22px", height: "22px",
      borderRadius: "50%", background: "rgba(255,255,255,0.92)", border: "2px solid #1f6b4c",
      boxShadow: "0 2px 10px rgba(0,0,0,0.45)", transform: "translate(-50%,-50%)", zIndex: "2147483647",
      pointerEvents: "none", transition: "width 120ms, height 120ms",
    });
    document.documentElement.appendChild(c);
    document.addEventListener("mousemove", (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    document.addEventListener("mousedown", (e) => {
      c.style.width = c.style.height = "16px";
      const r = document.createElement("div");
      Object.assign(r.style, {
        position: "fixed", left: `${e.clientX}px`, top: `${e.clientY}px`, width: "10px", height: "10px", borderRadius: "50%",
        border: "2px solid #56c48f", transform: "translate(-50%,-50%)", zIndex: "2147483646", pointerEvents: "none",
        transition: "all 450ms ease-out", opacity: "1",
      });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => Object.assign(r.style, { width: "56px", height: "56px", opacity: "0" }));
      setTimeout(() => r.remove(), 500);
    }, true);
    document.addEventListener("mouseup", () => { c.style.width = c.style.height = "22px"; }, true);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", install) : install();
});

let mouse = { x: 720, y: 405 };
async function moveTo(x, y, steps = 28) {
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
  await page.evaluate((x, y) => { window.__cx = x; window.__cy = y; }, x, y);
}

const waitText = (t, timeout = 120000) =>
  page.waitForFunction((t) => document.body && document.body.innerText.includes(t), { timeout, polling: 250 }, t);

/** Find an interactive element by visible text (or aria-label), scroll it into view, glide the cursor, click. */
async function click(text, { exact = false, tag = "button,a,[role=tab]" } = {}) {
  const handle = await page.waitForFunction(
    (text, exact, tag) =>
      [...document.querySelectorAll(tag)].find((el) => {
        const label = (el.innerText || el.getAttribute("aria-label") || "").trim();
        return (exact ? label === text : label.includes(text)) && !el.disabled && el.offsetParent !== null;
      }),
    { timeout: 60000, polling: 250 },
    text, exact, tag,
  );
  await handle.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await sleep(550);
  const box = await handle.boundingBox();
  await moveTo(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(180);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(250);
}

async function fieldByLabel(label, { startsWith = false } = {}) {
  const id = await page.waitForFunction(
    (label, startsWith) => {
      const l = [...document.querySelectorAll("label")].find((x) => (startsWith ? x.textContent.trim().startsWith(label) : x.textContent.trim() === label));
      return l?.htmlFor || null;
    },
    { timeout: 30000, polling: 250 },
    label, startsWith,
  );
  return page.$(`[id="${await id.jsonValue()}"]`);
}

async function typeInto(handle, text, { delay = 28, clear = false } = {}) {
  await handle.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await sleep(400);
  const box = await handle.boundingBox();
  await moveTo(box.x + Math.min(box.width / 2, 160), box.y + box.height / 2);
  await handle.click();
  if (clear) {
    await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
  }
  await page.keyboard.type(text, { delay });
  await sleep(150);
}
const type = async (label, text, opts = {}) => typeInto(await fieldByLabel(label, opts), text, opts);
const typeSel = async (sel, text, opts = {}) => typeInto(await page.waitForSelector(sel), text, opts);

/** Paste-style fill for long text (a human would paste, not type 300 chars). */
async function paste(label, text) {
  const h = await fieldByLabel(label);
  await h.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await sleep(400);
  const box = await h.boundingBox();
  await moveTo(box.x + 160, box.y + 40);
  await h.click();
  await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.evaluate((id, text) => {
    const el = document.getElementById(id);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, await h.evaluate((el) => el.id), text);
  await sleep(500);
}

async function scrollToText(text) {
  await page.evaluate((text) => {
    const el = [...document.querySelectorAll("h1,h2,h3,p,span,li")].find((e) => e.textContent.trim().startsWith(text));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, text);
  await sleep(900);
}

// ------------------------------------------------------------- title cards
const CARD_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400&display=swap');
  *{box-sizing:border-box;margin:0}
  html,body{height:100%;background:#12110f;color:#f1efea;font-family:Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  body{display:grid;place-items:center;padding:80px}
  .wrap{max-width:1100px;width:100%;animation:in 700ms cubic-bezier(.2,0,0,1) both}
  .k{font-family:'Geist Mono',monospace;font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:#a8a49c}
  h1{font-size:76px;line-height:1.04;letter-spacing:-.03em;font-weight:600;margin-top:22px}
  h1 em{font-style:normal;color:#56c48f}
  p{font-size:26px;line-height:1.45;color:#b9b5ad;margin-top:24px;max-width:900px}
  .logo{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:10px;background:#56c48f;color:#10231a;font-weight:700;font-size:22px;margin-bottom:28px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#2c2a26;border:1px solid #2c2a26;border-radius:14px;overflow:hidden;margin-top:40px}
  .grid div{background:#191816;padding:20px 22px;font-size:19px;color:#e8e5df}
  .grid div span{display:block;font-size:14px;color:#9b978f;margin-top:6px}
  .pain{display:grid;gap:18px;margin-top:36px}
  .pain div{font-size:30px;color:#d8d4cc;display:flex;gap:16px;align-items:baseline;opacity:0;animation:in 600ms cubic-bezier(.2,0,0,1) both}
  .pain div b{color:#e9776b;font-weight:500;font-family:'Geist Mono',monospace;font-size:22px}
  .meta{margin-top:40px;font-family:'Geist Mono',monospace;font-size:16px;color:#8f8b83;line-height:1.8}
  @keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
`;
async function card(html, holdMs) {
  await page.setContent(`<!doctype html><html><head><style>${CARD_CSS}</style></head><body><div class="wrap">${html}</div></body></html>`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(holdMs);
}

// ================================================================ the demo
const recorder = await page.screencast({ path: resolve(OUT, "raw.webm"), fps: 30, quality: 18 });
t0 = Date.now();

try {
  // 1 — Hook
  cap("Businesses want stablecoins. They don't want gas, seed phrases, or “which chain do you accept?”");
  await card(`<div class="logo">S</div><div class="k">Settle · NEAR hackathon · “Bring the boring money onchain”</div>
    <h1>Stripe-grade payment rails.<br/><em>Settled in stablecoins on NEAR.</em></h1>
    <p>Invoicing, checkout, payroll, payouts and AI accounts payable — that a normal company could use tomorrow.</p>`, 5200);

  cap("Today, paying a supplier onchain means all of this. Settle removes every one.");
  await card(`<div class="k">The problem</div><h1>Crypto payments are still<br/>a crypto product.</h1>
    <div class="pain">
      <div style="animation-delay:.2s"><b>01</b> Buy a gas token before you can send a dollar</div>
      <div style="animation-delay:.6s"><b>02</b> Seed phrases for every employee and customer</div>
      <div style="animation-delay:1.0s"><b>03</b> “Which chain? Which token?” on every invoice</div>
      <div style="animation-delay:1.4s"><b>04</b> No payroll, no approvals, no audit trail</div>
    </div>`, 6000);

  // 2 — Onboarding
  cap("Live on NEAR testnet. A bakery opens a business account — no wallet app, no seed phrase.");
  await page.goto(`${WEB}/dashboard`, { waitUntil: "networkidle2" });
  await waitText("Get started");
  await sleep(600);
  await type("Business name", "Rosa's Bakery");
  await type("Account name", `rosas${tag}`);
  await type("Billing email", "finance@rosas.co", { delay: 18 });
  cap("Keys are generated in the browser. Every transaction is a meta transaction — Settle's relayer pays the gas.");
  await click("Create business account");
  await waitText("Good to see you", 150000);
  await sleep(1800);

  cap("Rosa moves stablecoins into her Settle treasury. Gasless, one click.");
  await typeSel('input[inputmode="decimal"]', "4800", { clear: true });
  await click("Deposit", { exact: true });
  await waitText("Deposited 4800", 60000);
  await sleep(1600);

  // 3 — Invoice
  cap("She bills a wedding client. The Settle API can create invoices for her — but can never move her money.");
  await click("Invoices & checkout");
  await waitText("New invoice");
  await sleep(500);
  await type("Customer", "Patel Wedding");
  await type("Invoice #", "INV-2041");
  await typeSel('[aria-label="Item 1 description"]', "Three-tier wedding cake");
  await typeSel('[aria-label="Item 1 amount"]', "480");
  await click("Add item");
  await typeSel('[aria-label="Item 2 description"]', "Dessert table, 120 guests");
  await typeSel('[aria-label="Item 2 amount"]', "1320");
  await click("Create invoice");
  await waitText("Invoice created", 60000);
  await sleep(1400);
  const payUrl = await page.evaluate(() => [...document.querySelectorAll("span")].map((s) => s.textContent).find((t) => t.includes("/pay/inv_")));

  // 4 — Cross-chain payment
  cap("The client opens the payment link. They hold SOL, not NEAR stablecoins — that's fine.");
  await page.goto(payUrl, { waitUntil: "networkidle2" });
  await waitText("Get deposit address");
  await sleep(1500);
  const selId = await (await fieldByLabel("Pay with")).evaluate((el) => el.id);
  await page.select(`[id="${selId}"]`, "nep141:sol.omft.near");
  await sleep(500);
  await type("Refund address", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", { startsWith: true, delay: 12 });
  cap("NEAR Intents quotes an exact-output swap: Rosa receives exactly 1,800 — whatever the client pays with.");
  await click("Get deposit address");
  await waitText("Send exactly", 60000);
  await sleep(3200);
  cap("Testnet note: Intents has no testnet, so the swap is simulated. Settlement into the invoice is a real onchain transaction.");
  await sleep(1200);
  await click("Simulate sending");
  await waitText("Payment received", 150000);
  cap("Paid. Solvers delivered the stablecoins and Settle settled the invoice onchain.");
  await sleep(3500);

  cap("Back in the dashboard: invoice paid, webhook fired, revenue in the treasury.");
  await page.goto(`${WEB}/dashboard/invoices`, { waitUntil: "networkidle2" });
  await waitText("Paid", 60000);
  await sleep(3000);

  // 5 — AI accounts payable
  cap("Now money out. Rosa lets an AI pay her bills — with limits enforced by the smart contract, not the AI.");
  await click("AI accounts payable");
  await waitText("Turn on AI payments");
  await sleep(1500);
  cap("Auto-pay up to $1,000, $3,000 a day, hard cap $5,000. The agent only holds a key for agent_pay.");
  await click("Turn on AI payments");
  await waitText("Agent policy saved", 60000);
  await sleep(1200);

  cap("A flour bill arrives. The AI reads it, checks it for fraud, and pays it — within policy.");
  await click("Insert a sample bill");
  await sleep(1400);
  await click("Read bill");
  await waitText("Pay with agent", 60000);
  await sleep(1500);
  await click("Pay with agent");
  await waitText("Agent submitted payment", 60000);
  await sleep(2200);

  cap("A phishing bill: “urgent, new payment account.” Flagged and blocked from auto-pay.");
  await paste("Bill text", `Golden Mills Flour Co.\nURGENT: we have a new payment account, please pay immediately.\nInvoice #GM-5522\nPay to: goldenmills-pay.testnet\nTotal due: $900.00`);
  await click("Read bill");
  await waitText("payment details changed", 60000);
  await sleep(3500);

  cap("A $1,850 oven repair is over the auto-pay limit. The agent can only request it…");
  await paste("Bill text", `Oven Repair Ltd\nInvoice #OR-88\nCommercial deck oven repair\nPay to: ovenfix.${SUFFIX}\nDue date: 2026-12-15\nTotal due: $1,850.00`);
  await click("Read bill");
  await waitText("Oven Repair Ltd", 60000);
  await sleep(1200);
  await click("Pay with agent");
  await waitText("Approve & pay", 60000);
  await sleep(1200);
  cap("…and it lands in Rosa's approval queue. One click to approve — the contract executes it.");
  await click("Approve & pay");
  await waitText("Approved and paid", 60000);
  await sleep(2000);

  // 6 — Payroll
  cap("Payroll: paste from a spreadsheet, pay the whole team in one gasless transaction.");
  await click("Payroll", { exact: true });
  await waitText("Run payroll");
  await sleep(600);
  await paste("Payees", `maria.${SUFFIX}, 950\njonas.${SUFFIX}, 800`);
  await click("Pay 2 people");
  await waitText("Paid 2 people", 60000);
  await sleep(1500);
  cap("Or stream salaries by the second — employees withdraw what they've earned, any day.");
  await type("Employee account", `ana${tag}.${SUFFIX}`, { delay: 18 });
  await type(`Monthly (${cfg.default_token.symbol})`, "1200");
  await click("Start stream");
  await waitText("Started streaming", 60000);
  await sleep(3000);

  // 7 — Email payout
  cap("Pay anyone with just an email. Funds lock onchain behind a one-time claim link.");
  await click("Payouts & splits");
  await waitText("Send to an email");
  await sleep(500);
  await type("Recipient email", "sam@gmail.com", { delay: 20 });
  await type("Name", "Sam");
  await type(`Amount (${cfg.default_token.symbol})`, "25");
  await type("Note", "Thanks for the referral!", { delay: 18 });
  await click("Send payout");
  await waitText("Emailed.", 60000);
  await sleep(1500);
  const claimUrl = await page.evaluate(() => [...document.querySelectorAll("span")].map((s) => s.textContent).find((t) => t.includes("/claim#")));

  cap("Sam opens the email link. No wallet, no gas — picks a name and the money is theirs.");
  await page.goto(claimUrl, { waitUntil: "networkidle2" });
  await waitText("sent you", 60000);
  await sleep(1500);
  await type("Pick a name", `sam${tag}`);
  await click("Claim 25");
  await waitText("claimed", 120000);
  await sleep(2500);

  // 8 — Developers
  cap("For developers: a Stripe-shaped API, signed webhooks and a TypeScript SDK.");
  await page.goto(`${WEB}/dashboard/developers`, { waitUntil: "networkidle2" });
  await waitText("API keys", 60000);
  await sleep(800);
  await click("Create key");
  await waitText("Copy it now", 60000);
  await sleep(1200);
  await scrollToText("Quickstart");
  await sleep(3200);

  // 9 — Close
  cap("Settle: the boring money, onchain. Stablecoins · NEAR Intents · Meta transactions.");
  await card(`<div class="logo">S</div><div class="k">Settle</div>
    <h1>The boring money, <em>onchain.</em></h1>
    <div class="grid">
      <div>Invoices & checkout<span>pay from any chain</span></div>
      <div>Payroll & streams<span>paid by the second</span></div>
      <div>AI accounts payable<span>contract-enforced limits</span></div>
      <div>Email payouts<span>no wallet needed</span></div>
      <div>Subscriptions<span>capped pull payments</span></div>
      <div>Revenue splits<span>instant fan-out</span></div>
      <div>Gasless<span>NEP-366 meta transactions</span></div>
      <div>Developer API<span>REST · webhooks · SDK</span></div>
    </div>
    <div class="meta">contract ${cfg.contract_id} · NEAR ${cfg.network}</div>`, 6500);
  endCap();
} catch (e) {
  console.error("✖ recording failed:", e.message);
  await page.screenshot({ path: resolve(OUT, "failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  endCap();
  await recorder.stop();
  await browser.close();
}

const srt = captions
  .filter((c) => c.end - c.start > 0.3)
  .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
  .join("\n");
writeFileSync(resolve(OUT, "demo.srt"), srt);
console.log(`captions: ${captions.length}, duration ≈ ${now().toFixed(1)}s → ${OUT}`);
