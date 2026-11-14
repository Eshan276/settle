// Screenshot tour of the dashboard as a seeded business. Usage: node test/tour.mjs /tmp/settle-demo-biz.json
import puppeteer from "puppeteer-core";
import { readFileSync, mkdirSync } from "node:fs";
const W = process.env.SETTLE_WEB ?? "http://localhost:3000";
const wallet = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/settle-demo-biz.json", "utf8"));
mkdirSync("/tmp/settle-shots", { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/bin/google-chrome-stable", headless: true, args: ["--no-sandbox", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.goto(`${W}/`);
await page.evaluate((w) => localStorage.setItem("settle.wallet.business.v1", JSON.stringify(w)), wallet);
const waitText = (t, timeout = 180000) => page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout, polling: 300 }, t);
const shot = async (name) => { await new Promise((r) => setTimeout(r, 900)); await page.screenshot({ path: `/tmp/settle-shots/app-${name}.png` }); console.log("✓", name); };
const clickRow = (text) => page.evaluate((text) => [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(text))?.click(), text);
try {
  await page.goto(`${W}/dashboard`); await waitText("Needs you"); await waitText("Recent transactions"); await waitText("Re-plan from this month"); await new Promise((r) => setTimeout(r, 3500)); await shot("home"); await page.screenshot({ path: "/tmp/settle-shots/app-home-full.png", fullPage: true });
  await page.goto(`${W}/dashboard/invoices`); await waitText("Amount due"); await shot("invoices");
  await clickRow("Patel Wedding"); await waitText("Timeline"); await waitText("Payments"); await shot("invoice-detail");
  await page.goto(`${W}/dashboard/customers`); await waitText("Paid to date"); await shot("customers");
  await page.goto(`${W}/dashboard/bills`); await waitText("AI autopay is"); await waitText("Oven Repair"); await shot("bills");
  await clickRow("Oven Repair"); await waitText("Approval trail"); await shot("bill-drawer");
  await page.keyboard.press("Escape");
  await page.goto(`${W}/dashboard/payroll`); await waitText("Payroll · October"); await shot("payroll");
  await clickRow("October"); await waitText("paid atomically"); await shot("payrun-drawer");
  await page.keyboard.press("Escape");
  await page.goto(`${W}/dashboard/payroll?run=1`); await waitText("Who are you paying"); await waitText("Alice"); await shot("run-payroll");
  await page.goto(`${W}/dashboard/people`); await waitText("Paid YTD"); await shot("people");
  await page.goto(`${W}/dashboard/transactions`); await waitText("Net operating"); await shot("transactions");
  await page.goto(`${W}/dashboard/reports`); await waitText("Payroll register"); await shot("reports");
} catch (e) {
  console.error("✖", e.message);
  await page.screenshot({ path: "/tmp/settle-shots/app-failure.png" });
  process.exitCode = 1;
} finally {
  if (errors.length) console.log("page errors:", [...new Set(errors)].slice(0, 6));
  await browser.close();
}
