// Screenshots the public pages (landing, hosted pay page, wallet, onboarding) in the current theme.
import puppeteer from "puppeteer-core";
const W = process.env.SETTLE_WEB ?? "http://localhost:3000";
const PAY = process.argv[2]; // a /pay/<id> path
const b = await puppeteer.launch({ executablePath: "/bin/google-chrome-stable", headless: true, args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const shot = async (path, name, wait) => {
  await p.goto(`${W}${path}`, { waitUntil: "networkidle0" });
  if (wait) await p.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 60000, polling: 500 }, wait);
  await new Promise((r) => setTimeout(r, 800));
  await p.screenshot({ path: `/tmp/settle-shots/pub-${name}.png` });
  console.log("✓", name);
};
await shot("/", "landing");
if (PAY) await shot(PAY, "pay", "Any chain");
await shot("/wallet", "wallet");
await p.evaluate(() => localStorage.clear());
await shot("/dashboard", "onboarding", "Get started");
console.log("errors:", errs);
await b.close();
