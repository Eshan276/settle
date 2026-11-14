// Screenshots key pages in light and/or dark mode, signed in as the demo business.
//   node test/shoot-themes.mjs [light|dark|both]   (DEMO_BIZ = wallet json, default /tmp/settle-demo-biz-v3.json)
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const W = process.env.SETTLE_WEB ?? "http://localhost:3000";
const biz = JSON.parse(readFileSync(process.env.DEMO_BIZ ?? "/tmp/settle-demo-biz-v3.json", "utf8"));
const which = process.argv[2] ?? "light";
const themes = which === "both" ? ["light", "dark"] : [which];
const b = await puppeteer.launch({ executablePath: "/bin/google-chrome-stable", headless: true, args: ["--no-sandbox", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const waitText = (t) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 120000, polling: 400 }, t);

for (const theme of themes) {
  await p.goto(`${W}/`, { waitUntil: "domcontentloaded" });
  await p.evaluate((w, theme) => {
    localStorage.setItem("settle.wallet.business.v1", JSON.stringify(w));
    localStorage.setItem("settle.theme", theme);
  }, biz, theme);
  const shot = async (path, name, wait, full = false) => {
    await p.goto(`${W}${path}`, { waitUntil: "domcontentloaded" });
    if (wait) await waitText(wait);
    await new Promise((r) => setTimeout(r, 1500));
    await p.screenshot({ path: `/tmp/settle-shots/${theme}-${name}.png`, fullPage: full });
    console.log("✓", theme, name);
  };
  await shot("/", "landing");
  await shot("/dashboard", "home", "Recent transactions", true);
  await shot("/dashboard/invoices", "invoices", "Outstanding");
  await shot("/dashboard/bills", "bills", "AI autopay is on");
  await p.evaluate(() => [...document.querySelectorAll("tbody tr")][0]?.click());
  await new Promise((r) => setTimeout(r, 1200));
  await p.screenshot({ path: `/tmp/settle-shots/${theme}-bill-drawer.png` });
  await shot("/dashboard/transactions", "transactions", "Net operating");
  await shot("/wallet", "wallet");
}
console.log("errors:", errs);
await b.close();
