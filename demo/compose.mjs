/**
 * Post-production for the Settle demo:
 *   - 1920x1080 canvas: app recording (native 1440x810) + live progress table (480x810) + subtitle bar (1920x270)
 *   - progress table: ✓ done steps with their real on-chain result, ▶ current step, upcoming steps dimmed
 *   - subtitles rendered as ASS in the bottom bar (never over the UI)
 *
 *   node compose.mjs   →  out/settle-demo.mp4, out/demo.srt (sidecar), out/thumbnail.png
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, process.env.DEMO_OUT ?? "out");
const PANELS = resolve(OUT, "panels");
mkdirSync(PANELS, { recursive: true });
const puppeteer = createRequire(resolve(here, "../apps/web/package.json"))("puppeteer-core");

// ------------------------------------------------------------ subtitles in
const toSec = (t) => {
  const [h, m, rest] = t.split(":");
  const [s, ms] = rest.split(",");
  return +h * 3600 + +m * 60 + +s + +ms / 1000;
};
const caps = readFileSync(resolve(OUT, "demo.srt"), "utf8")
  .trim()
  .split(/\n\n+/)
  .map((block) => {
    const [, times, ...text] = block.split("\n");
    const [a, b] = times.split(" --> ");
    return { start: toSec(a), end: toSec(b), text: text.join(" ") };
  });
const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", resolve(OUT, "raw.webm")]).toString().trim()) || caps.at(-1).end;

// ------------------------------------------------------------ the sections
// `cap` = index (0-based) of the caption where the step starts. `result` = what's on-chain once done.
const SECTIONS = [
  { cap: 2, title: "Gasless business account", result: "rosashzej.…testnet · $0 gas" },
  { cap: 4, title: "Treasury deposit", result: "4,800 sUSD in treasury" },
  { cap: 5, title: "Invoice created", result: "INV-2041 · 1,800 sUSD" },
  { cap: 6, title: "Paid from another chain", result: "SOL → 1,800 sUSD via Intents" },
  { cap: 11, title: "AI spending policy", result: "≤ $1k auto · $3k/day · $5k cap" },
  { cap: 13, title: "AI pays a vendor bill", result: "Golden Mills · $640 paid" },
  { cap: 14, title: "Phishing bill blocked", result: "GM-5522 · flagged, not paid" },
  { cap: 15, title: "Human approval", result: "Oven repair · $1,850 approved" },
  { cap: 17, title: "Payroll batch", result: "2 people · 1,750 sUSD · 1 tx" },
  { cap: 18, title: "Salary stream", result: "1,200 sUSD/mo by the second" },
  { cap: 19, title: "Email payout", result: "$25 → sam@gmail.com · claimed" },
  { cap: 21, title: "Developer API", result: "API key · webhooks · SDK" },
];
const END_CAP = 22; // closing card: everything done
// Recorder v2 writes exact section timings; v1 maps sections to caption indexes.
const recorded = existsSync(resolve(OUT, "sections.json")) ? JSON.parse(readFileSync(resolve(OUT, "sections.json"), "utf8")) : null;
if (recorded) SECTIONS.splice(0, SECTIONS.length, ...recorded);
const starts = recorded ? recorded.map((s) => s.start) : SECTIONS.map((s) => caps[s.cap].start);
const endStart = recorded ? caps.at(-1).start : caps[END_CAP]?.start ?? duration;

// state -1 = agenda (intro), 0..n-1 = current step, n = all done
const states = [{ id: -1, from: 0, to: starts[0] }];
SECTIONS.forEach((_, i) => states.push({ id: i, from: starts[i], to: i + 1 < SECTIONS.length ? starts[i + 1] : endStart }));
states.push({ id: SECTIONS.length, from: endStart, to: duration + 1 });

// ------------------------------------------------------------ render panels
const panelHtml = (cur) => {
  const n = SECTIONS.length;
  const done = Math.max(0, Math.min(cur, n));
  const rows = SECTIONS.map((s, i) => {
    const state = i < cur ? "done" : i === cur ? "now" : "todo";
    const mark = state === "done" ? "✓" : state === "now" ? "▶" : String(i + 1).padStart(2, "0");
    const sub = state === "done" ? s.result : state === "now" ? "in progress…" : "";
    return `<tr class="${state}"><td class="m">${mark}</td><td><div class="t">${s.title}</div>${sub ? `<div class="r">${sub}</div>` : ""}</td></tr>`;
  }).join("");
  return `<!doctype html><html><head><style>
    @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');
    *{box-sizing:border-box;margin:0}
    body{width:480px;height:810px;background:#161512;color:#f1efea;font-family:Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased;border-left:1px solid #2c2a26;padding:26px 24px 20px;display:flex;flex-direction:column}
    .h{display:flex;align-items:baseline;justify-content:space-between}
    .k{font-family:'Geist Mono',monospace;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#a8a49c}
    .c{font-family:'Geist Mono',monospace;font-size:13px;color:#56c48f}
    .bar{height:4px;border-radius:4px;background:#2c2a26;margin:12px 0 14px;overflow:hidden}
    .bar i{display:block;height:100%;width:${(done / n) * 100}%;background:#56c48f;border-radius:4px}
    table{width:100%;border-collapse:collapse}
    tr td{padding:7px 0;vertical-align:top;border-top:1px solid #23211e}
    tr:first-child td{border-top:0}
    td.m{width:34px;font-family:'Geist Mono',monospace;font-size:13px;padding-top:9px}
    .t{font-size:16px;font-weight:500;line-height:1.3}
    .r{font-size:12.5px;color:#9fd9b9;margin-top:2px;font-family:'Geist Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px}
    tr.done td.m{color:#56c48f}
    tr.done .t{color:#d8d4cc}
    tr.now td{background:#1f2a23}
    tr.now td.m{color:#56c48f;padding-left:6px}
    tr.now .t{color:#fff}
    tr.now .r{color:#a8a49c}
    tr.todo td.m,tr.todo .t{color:#5f5b54}
    .f{margin-top:auto;font-family:'Geist Mono',monospace;font-size:11.5px;color:#7d7970;line-height:1.6}
  </style></head><body>
    <div class="h"><span class="k">${cur < 0 ? "Demo agenda" : "Shipped in this demo"}</span><span class="c">${done}/${n} done</span></div>
    <div class="bar"><i></i></div>
    <table>${rows}</table>
    <div class="f">Live on NEAR testnet · pay.settle-6cc0225d.testnet<br/>every ✓ happened on-chain in this recording</div>
  </body></html>`;
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/bin/google-chrome-stable", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 810, deviceScaleFactor: 1 });
for (const s of states) {
  await page.setContent(panelHtml(s.id), { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(PANELS, `p${s.id + 1}.png`) });
}
await browser.close();

// ------------------------------------------------------------ ASS subtitles
const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Noto Sans,44,&H00F4F1EC,&H00F4F1EC,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,160,160,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${caps.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,{\\pos(960,945)\\fad(150,150)}${c.text.replace(/\n/g, "\\N")}`).join("\n")}
`;
writeFileSync(resolve(OUT, "demo.ass"), ass);

// ------------------------------------------------------------ ffmpeg compose
const inputs = ["-i", resolve(OUT, "raw.webm"), ...states.flatMap((s) => ["-loop", "1", "-i", resolve(PANELS, `p${s.id + 1}.png`)])];
let fc = `color=c=0x12110f:s=1920x1080:r=30:d=${duration.toFixed(3)}[bg];`;
fc += `[0:v]fps=30,scale=1440:810:flags=lanczos,setsar=1[app];`;
fc += `[bg][app]overlay=0:0[v0];`;
fc += `[v0]drawbox=x=0:y=810:w=1920:h=1:color=0x2c2a26:t=fill[v1];`;
let last = "v1";
states.forEach((s, i) => {
  const out = `p${i}`;
  fc += `[${last}][${i + 1}:v]overlay=1440:0:enable='between(t,${s.from.toFixed(3)},${Math.min(s.to, duration + 1).toFixed(3)})'[${out}];`;
  last = out;
});
fc += `[${last}]ass=${resolve(OUT, "demo.ass")}[vout]`;

const final = resolve(OUT, "settle-demo.mp4");
console.log(`composing ${states.length} table states over ${duration.toFixed(1)}s …`);
execFileSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", fc, "-map", "[vout]", "-t", duration.toFixed(3),
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", final],
  { stdio: "inherit" },
);
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String((starts[3] ?? 10) + 12), "-i", final, "-frames:v", "1", resolve(OUT, "thumbnail.png")]);
console.log(`✓ ${final}`);
