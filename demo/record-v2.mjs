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
const OUT = resolve(here, process.env.DEMO_OUT ?? "out-v2");
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

// ================================================================ the demo (v2: finance dashboard)
// Signs in as the seeded "Rosa's Bakery" business (apps/api/test/seed-demo.ts).
import { readFileSync } from "node:fs";
const biz = JSON.parse(readFileSync(process.env.DEMO_BIZ ?? "/tmp/settle-demo-biz.json", "utf8"));
const sections = [];
function section(title, result) {
  sections.push({ title, result, start: now() });
}

await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
await page.evaluate((w) => {
  localStorage.setItem("settle.wallet.business.v1", JSON.stringify(w));
  localStorage.removeItem("settle.wallet.payer.v1");
}, biz);

const clickRow = async (text) => {
  const h = await page.waitForFunction((text) => [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(text)), { timeout: 120000, polling: 300 }, text);
  await h.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await sleep(500);
  const box = await h.boundingBox();
  await moveTo(box.x + Math.min(260, box.width / 3), box.y + box.height / 2);
  await sleep(150);
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  await sleep(300);
};
const glide = async (text) => {
  const h = await page.waitForFunction((t) => [...document.querySelectorAll("p,h1,h2,span,dt")].find((e) => e.textContent.trim().startsWith(t)), { timeout: 60000, polling: 300 }, text);
  const box = await h.boundingBox();
  if (box) await moveTo(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2, 35);
};

const recorder = await page.screencast({ path: resolve(OUT, "raw.webm"), fps: 30, quality: 18 });
t0 = Date.now();

try {
  // 0 — hook
  cap("Businesses want stablecoins. They don't want gas, seed phrases, or “which chain do you accept?”");
  await card(`<div class="logo">S</div><div class="k">Settle · NEAR · “Bring the boring money onchain”</div>
    <h1>Finance software for real businesses.<br/><em>Settled in stablecoins on NEAR.</em></h1>
    <p>Invoicing, bill pay, payroll and reporting — with every dollar traceable to an on-chain transaction.</p>`, 5500);
  cap("Meet Rosa's Bakery: 4 staff, 5 wholesale customers, a dozen bills a month. Live on NEAR testnet.");
  await card(`<div class="k">The customer</div><h1>Rosa's Bakery</h1>
    <div class="pain">
      <div style="animation-delay:.2s"><b>AR</b> Hotels, cafés and weddings pay late, from different chains</div>
      <div style="animation-delay:.6s"><b>AP</b> Flour, power, repairs — and the occasional fake invoice</div>
      <div style="animation-delay:1.0s"><b>HR</b> Four people to pay, on time, every month</div>
    </div>`, 5500);

  // 1 — home
  section("Business at a glance", "cash · AR · bills due · cash flow");
  cap("Home answers the morning questions: how much cash, who owes us, what's due, and what needs me.");
  await page.goto(`${WEB}/dashboard`, { waitUntil: "domcontentloaded" });
  await waitText("Needs your attention", 180000);
  await waitText("Recent transactions", 180000);
  await sleep(1200);
  await glide("Cash available"); await sleep(1300);
  await glide("Outstanding receivables"); await sleep(1300);
  await glide("Bills due"); await sleep(1100);
  cap("Overdue invoices and bills waiting for approval surface automatically. Receivables are aged like any finance tool.");
  await glide("Needs your attention"); await sleep(1800);
  await glide("Receivables aging"); await sleep(2200);

  // 2 — invoice
  section("Invoice created & sent", "INV · $780 · Net 30");
  cap("Rosa bills Café Nord. Invoices are numbered, carry payment terms, and are emailed with a pay link.");
  await click("Invoices", { exact: true });
  await waitText("Outstanding");
  await sleep(1400);
  await click("Overdue");
  await sleep(1800);
  await click("All");
  await sleep(600);
  await click("New invoice");
  await waitText("Line items");
  await sleep(500);
  await type("Customer", "Café Nord");
  await sleep(400);
  await typeSel('[aria-label="Item 1 description"]', "Sourdough loaves");
  await typeSel('[aria-label="Item 1 quantity"]', "0", { clear: true, delay: 10 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type("60", { delay: 40 });
  await typeSel('[aria-label="Item 1 unit price"]', "8");
  await click("Add line");
  await typeSel('[aria-label="Item 2 description"]', "Cinnamon buns, boxed");
  await typeSel('[aria-label="Item 2 unit price"]', "300");
  await sleep(700);
  await click("Create & send");
  await waitText("On-chain record", 120000);
  const number = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim());
  sections.at(-1).result = `${number} · $780 · Net 30`;
  await sleep(1800);

  // 3 — cross-chain payment
  section("Paid from another chain", "SOL → $780 via NEAR Intents");
  cap("The café holds SOL, not stablecoins on NEAR. That's fine: NEAR Intents converts it and Rosa gets exactly $780.");
  const payUrl = await page.evaluate(() => document.querySelector('a[href*="/pay/inv_"]')?.href);
  await page.goto(payUrl, { waitUntil: "domcontentloaded" });
  await waitText("Get deposit address", 120000);
  await sleep(1300);
  const selId = await (await fieldByLabel("Pay with")).evaluate((el) => el.id);
  await page.select(`[id="${selId}"]`, "nep141:sol.omft.near");
  await sleep(400);
  await type("Refund address", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", { startsWith: true, delay: 10 });
  await click("Get deposit address");
  await waitText("Send exactly", 120000);
  await sleep(2600);
  cap("Testnet note: Intents has no testnet, so the swap is simulated. Settlement into the invoice is a real on-chain transaction.");
  await click("Simulate sending");
  await waitText("Payment received", 180000);
  await sleep(2500);

  // 4 — reconciliation
  section("Reconciled to the cent", "$780 gross · $3.90 fee · $776.10 net");
  cap("Back in Rosa's books: paid, with the timeline, the fee, the net amount and a link to on-chain proof.");
  await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
  await waitText("On-chain record", 120000);
  await waitText("Payment received ·", 120000);
  await sleep(1000);
  await glide("Payments"); await sleep(2200);
  await glide("Timeline"); await sleep(2400);

  // 5 — bills + AI autopay
  section("AI autopay, on-chain limits", "≤ $1k auto · $3k/day · $5k cap");
  cap("Bills: AI reads each one and pays routine ones itself. Its limits live in the smart contract, not in the AI.");
  await click("Bills", { exact: false, tag: "a" });
  await waitText("AI autopay is on", 120000);
  await sleep(2200);
  section("Phishing bill blocked", "GM-8842 · flagged, not paid");
  cap("A fake “new payment account” invoice was flagged for review instead of being paid.");
  await click("Needs review");
  await sleep(600);
  await clickRow("Golden Mills");
  await waitText("Risk flags", 60000);
  await sleep(3200);
  await page.keyboard.press("Escape");
  await sleep(500);

  section("Human approval", "Oven repair · $1,850 approved");
  cap("A $1,850 oven repair is over the autopay limit, so the AI could only request it. Rosa approves with one click.");
  await click("Awaiting approval");
  await sleep(600);
  await clickRow("Oven Repair");
  await waitText("Approval trail", 60000);
  await sleep(2200);
  await click("Approve & pay");
  await waitText("Approved", 120000);
  await sleep(2200);
  await page.keyboard.press("Escape");
  await sleep(400);

  // 6 — payroll
  section("Payroll run", "4 people · $10,200 · 1 transaction");
  cap("Payroll: everyone's regular pay is pre-filled, checked against the treasury, and paid in one atomic transaction.");
  await click("Pay runs", { tag: "a" });
  await waitText("Payroll · October", 120000);
  await sleep(1200);
  await click("Run payroll", { tag: "button,[role=tab]" });
  await waitText("Who are you paying", 60000);
  await waitText("Alice", 60000);
  await page.waitForFunction(() => !document.body.innerText.includes("Loading…"), { timeout: 120000, polling: 300 });
  await sleep(1800);
  await click("Pay 4 people");
  await waitText("Paid 4 people", 120000);
  await waitText("Payroll · November", 120000);
  await sleep(800);
  await clickRow("Payroll · November");
  await waitText("paid atomically", 60000);
  cap("Every pay run keeps a per-person register, with the transaction that paid it.");
  await sleep(3500);
  await page.keyboard.press("Escape");
  await sleep(400);

  // 7 — ledger + reports
  section("Ledger & reports", "every $ → proof · CSV export");
  cap("Transactions is the ledger: money in, money out, fees and net, each line linked to its on-chain transaction.");
  await click("Transactions", { tag: "a" });
  await waitText("Net operating", 120000);
  await sleep(3200);
  cap("Reports an accountant expects, like AR aging and cash flow, export straight to CSV.");
  await click("Reports", { tag: "a" });
  await waitText("Payroll register", 120000);
  await sleep(1000);
  await glide("Accounts receivable aging"); await sleep(3000);

  // 8 — close
  section("Done", "");
  cap("Settle: the boring money, onchain. Stablecoins · NEAR Intents · gasless meta transactions.");
  await card(`<div class="logo">S</div><div class="k">Settle</div>
    <h1>The boring money, <em>onchain.</em></h1>
    <div class="grid">
      <div>Invoicing<span>pay from any chain</span></div>
      <div>Bill pay<span>AI with on-chain limits</span></div>
      <div>Payroll<span>runs & salary streams</span></div>
      <div>Reporting<span>ledger · AR aging · CSV</span></div>
      <div>Stablecoins<span>USD on NEAR</span></div>
      <div>NEAR Intents<span>any chain in</span></div>
      <div>Gasless<span>meta transactions</span></div>
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
writeFileSync(resolve(OUT, "sections.json"), JSON.stringify(sections.filter((s) => s.result), null, 2));
console.log(`captions: ${captions.length}, sections: ${sections.length}, duration ≈ ${now().toFixed(1)}s → ${OUT}`);
