import puppeteer from "puppeteer-core";
const W = process.env.SETTLE_WEB ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/bin/google-chrome-stable";
import { mkdirSync } from "node:fs"; mkdirSync("/tmp/settle-shots", { recursive: true });
const rnd = Math.random().toString(36).slice(2, 7);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `/tmp/settle-shots/ui-${n}.png` });
const waitText = (t, timeout = 180000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 500 }, t);
const fill = async (label, value) => {
  const id = await page.evaluate((label) => [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === label)?.htmlFor, label);
  await page.type(`[id="${id}"]`, value);
};
const click = async (text) => {
  // Wait until an enabled button with this label exists (drawers render after state updates).
  const h = await page.waitForFunction((text) => [...document.querySelectorAll("button")].reverse().find((b) => b.innerText.includes(text) && !b.disabled), { timeout: 180000, polling: 300 }, text);
  await h.evaluate((b) => b.click());
};

try {
  console.log("1. onboarding");
  await page.goto(`${W}/dashboard`);
  await waitText("Get started");
  await fill("Business name", "UI Test Co");
  await fill("Account name", `ui${rnd}`);
  await click("Create business account");
  await waitText("Cash available");
  await shot("overview");
  console.log("   ✓ business onboarded in-browser (key gen + 2 meta txs + login + faucet)");

  console.log("2. deposit to treasury");
  await click("Move money");
  await waitText("Add to treasury");
  await fill("Amount (USD)", "1000");
  await click("Add to treasury");
  await waitText("Deposited $1000");
  console.log("   ✓ deposit via Move money (meta tx signed in browser)");

  console.log("3. create invoice");
  await page.goto(`${W}/dashboard/invoices?new=1`);
  await waitText("Line items");
  await fill("Customer", "Patel Wedding");
  await page.type('[aria-label="Item 1 description"]', "Wedding cake");
  await page.type('[aria-label="Item 1 unit price"]', "180");
  await click("Create invoice");
  await waitText("On-chain record");
  await waitText("INV-0001");
  const url = await page.evaluate(() => document.querySelector('a[href*="/pay/inv_"]')?.href);
  await shot("invoices");
  console.log("   ✓", url);

  console.log("4. customer pays cross-chain (simulated intents)");
  const pay = await browser.newPage();
  await pay.setViewport({ width: 1280, height: 900 });
  pay.on("pageerror", (e) => errors.push(e.message));
  await pay.goto(url);
  await pay.waitForFunction(() => document.body.innerText.includes("Get deposit address"), { timeout: 60000, polling: 500 });
  const refundId = await pay.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.startsWith("Refund address"))?.htmlFor);
  await pay.type(`[id="${refundId}"]`, "0xRefundAddress000000000000000000000000001");
  await pay.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Get deposit address")).click());
  await pay.waitForFunction(() => document.body.innerText.includes("Send exactly"), { timeout: 60000, polling: 500 });
  await pay.screenshot({ path: "/tmp/settle-shots/ui-pay-quote.png" });
  await pay.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Simulate sending")).click());
  await pay.waitForFunction(() => document.body.innerText.includes("Payment received"), { timeout: 120000, polling: 500 });
  await new Promise((r) => setTimeout(r, 600));
  await pay.screenshot({ path: "/tmp/settle-shots/ui-pay-done.png" });
  console.log("   ✓ invoice paid via intents → settled on-chain");
  await pay.close();

  console.log("5. AI bill → agent");
  await page.bringToFront();
  await page.goto(`${W}/dashboard/bills`);
  await waitText("AI autopay is off");
  await click("Turn on autopay");
  await click("Save policy");
  await waitText("Autopay policy saved");
  await waitText("AI autopay is on");
  await click("Add bill");
  await click("Use a sample bill");
  await click("Read bill");
  await waitText("Approval trail");
  await click("Pay with autopay");
  await waitText("Bill sent to AI autopay");
  await page.keyboard.press("Escape");
  await waitText("Paid");
  await shot("agent");
  console.log("   ✓ bill parsed and paid by AI autopay within policy");

  console.log("6. email payout");
  await page.bringToFront();
  await page.goto(`${W}/dashboard/payouts`);
  await waitText("Send to an email");
  await fill("Recipient email", "maria@example.com");
  await page.evaluate(() => {
    const l = [...document.querySelectorAll("label")].find((l) => l.textContent.startsWith("Amount"));
    return l.htmlFor;
  }).then((id) => page.type(`[id="${id}"]`, "25"));
  await click("Send payout");
  await waitText("Emailed.", 60000);
  const claim = await page.evaluate(() => [...document.querySelectorAll("span")].find((s) => s.textContent.includes("/claim#"))?.textContent);
  const c = await browser.newPage();
  c.on("pageerror", (e) => errors.push(e.message));
  await c.goto(claim);
  await c.waitForFunction(() => document.body.innerText.includes("sent you"), { timeout: 60000, polling: 500 });
  const uid = await c.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent === "Pick a name")?.htmlFor);
  await c.type(`[id="${uid}"]`, `maria${rnd}`);
  await c.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.startsWith("Claim")).click());
  await c.waitForFunction(() => document.body.innerText.includes("claimed"), { timeout: 90000, polling: 500 });
  await c.screenshot({ path: "/tmp/settle-shots/ui-claimed.png" });
  console.log("   ✓ recipient claimed into a new gasless wallet");
} catch (e) {
  console.error("✖ UI test failed:", e.message);
  let k = 0; for (const pg of await browser.pages()) { await pg.screenshot({ path: `/tmp/settle-shots/fail-${k++}.png` }).catch(() => {}); console.log("tab", k - 1, pg.url()); }
  process.exitCode = 1;
} finally {
  if (errors.length) console.log("page errors:", [...new Set(errors)].slice(0, 8));
  await browser.close();
}
