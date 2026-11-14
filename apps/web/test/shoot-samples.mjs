import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/bin/google-chrome-stable", headless: true, args: ["--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
for (const n of [1,2,3]) { await p.goto(`http://localhost:3000/sample${n}`, { waitUntil: "networkidle0" }); await new Promise(r=>setTimeout(r,2000)); await p.screenshot({ path: `/tmp/sample${n}.png`, fullPage: true }); }
console.log("errors:", errs); await b.close();
