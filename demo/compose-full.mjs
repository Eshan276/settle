/**
 * Post-production, full-frame (no side panel):
 *   - builds the video from the timestamped CDP frames written by record-v3.mjs
 *   - tightens slow stretches: each caption's stretch plays at normal speed for as long as it takes to read, and any
 *     waiting beyond that (testnet round trips, software-rendered WebGL) is sped up, never more than 6x
 *   - subtitles in a translucent navy box near the bottom edge, retimed to the tightened video
 *   - voice-over (optional): put one clip per caption in <out>/vo/ named 01.*, 02.*, … (any audio format, or the
 *     settle-vo-NN.webm files from the /voiceover page). Each caption's stretch is then timed to YOUR clip, the clips
 *     are placed at the start of their scene, and the mix is loudness-normalised (-16 LUFS). Optional <out>/music.*
 *     is laid underneath and ducks under the voice.
 *   - writes <out>/VOICEOVER.md (the script with timings) and apps/web/public/voiceover/ (for the /voiceover recorder)
 *   DEMO_OUT=out-v3 node compose-full.mjs   →  <out>/settle-demo.mp4, <out>/demo.srt (final timing), <out>/thumbnail.png
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, process.env.DEMO_OUT ?? "out-v3");
const MAX_SPEED = Number(process.env.MAX_SPEED ?? 6);

const toSec = (t) => {
  const [h, m, rest] = t.split(":");
  const [s, ms] = rest.split(",");
  return +h * 3600 + +m * 60 + +s + +ms / 1000;
};
const caps = readFileSync(resolve(OUT, "demo.raw.srt"), "utf8")
  .trim()
  .split(/\n\n+/)
  .map((block) => {
    const [, times, ...text] = block.split("\n");
    const [a, b] = times.split(" --> ");
    return { start: toSec(a), end: toSec(b), text: text.join(" ") };
  });
const frames = JSON.parse(readFileSync(resolve(OUT, "frames.json"), "utf8"));
const end = Math.max(frames.at(-1).t, caps.at(-1).end);

// ------------------------------------------------------------ voice-over clips (optional)
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const VO = resolve(OUT, "vo");
// Takes saved by the /voiceover recorder land in ~/Downloads as settle-vo-NN.webm ("settle-vo-NN (1).webm" for
// re-saves): copy the newest of each into <out>/vo/ first.
{
  const dl = resolve(process.env.HOME ?? "", "Downloads");
  if (existsSync(dl)) {
    const newest = {};
    for (const f of readdirSync(dl)) {
      const m = f.match(/^settle-vo-(\d{2})(?: \(\d+\))?\.webm$/);
      if (!m) continue;
      const t = statSync(resolve(dl, f)).mtimeMs;
      if (!newest[m[1]] || t > newest[m[1]].t) newest[m[1]] = { f, t };
    }
    if (Object.keys(newest).length) mkdirSync(VO, { recursive: true });
    for (const [n, { f, t }] of Object.entries(newest)) {
      const dest = resolve(VO, `settle-vo-${n}.webm`);
      if (!existsSync(dest) || statSync(dest).mtimeMs < t) copyFileSync(resolve(dl, f), dest);
    }
  }
}
const voFiles = existsSync(VO) ? readdirSync(VO) : [];
// Trim dead air at both ends of a take (the pause after pressing record, the key press at the end), keeping 0.15 s.
const TRIM = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15";
const trimmed = (src, n) => {
  const dir = resolve(VO, ".trimmed");
  mkdirSync(dir, { recursive: true });
  const dest = resolve(dir, `${n}.wav`);
  if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs) {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-af", `${TRIM},areverse,${TRIM},areverse`, "-ar", "48000", dest]);
    // nothing left above the threshold (a very quiet take): keep it whole. Always decode, since browser
    // recordings carry no duration in their header.
    if (!(probe(dest) > 0.5)) execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-ar", "48000", dest]);
  }
  return dest;
};
const vo = caps.map((_, i) => {
  const n = String(i + 1).padStart(2, "0");
  const f = voFiles.find((x) => x.startsWith(`${n}.`) || x.startsWith(`settle-vo-${n}.`));
  if (!f) return null;
  const file = trimmed(resolve(VO, f), n);
  return { file, dur: probe(file) };
});
const LEAD = 0.35; // voice starts this long after its scene starts
if (vo.some(Boolean)) console.log(`voice-over: ${vo.filter(Boolean).length}/${caps.length} clips`);

// ------------------------------------------------------------ time map (raw → output), piecewise linear per caption
const words = (text) => text.split(/\s+/).length;
const speakTime = (text) => 1.0 + words(text) / 2.6; // a relaxed speaking pace
const knots = [{ raw: 0, out: 0 }];
caps.forEach((c, i) => {
  const len = c.end - c.start;
  const target = vo[i] ? Math.max(vo[i].dur + LEAD + 0.45, len / MAX_SPEED) : Math.max(Math.min(len, speakTime(c.text) + 1.5), speakTime(c.text), len / MAX_SPEED);
  if (len / target < 0.6) console.log(`  note: scene ${i + 1} plays at ${(len / target).toFixed(2)}x to fit its line`);
  knots.push({ raw: c.end, out: knots.at(-1).out + target });
});
if (end > knots.at(-1).raw) knots.push({ raw: end, out: knots.at(-1).out + (end - knots.at(-1).raw) });
const map = (t) => {
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1], b = knots[i];
    if (t <= b.raw) return a.out + ((t - a.raw) / Math.max(1e-6, b.raw - a.raw)) * (b.out - a.out);
  }
  return knots.at(-1).out;
};
const duration = map(end);

// ------------------------------------------------------------ frames → concat list with output-time durations
const list = [];
for (let i = 0; i < frames.length; i++) {
  const from = map(Math.max(0, frames[i].t));
  const to = i + 1 < frames.length ? map(frames[i + 1].t) : duration;
  if (to - from <= 0) continue;
  list.push(`file 'frames/${frames[i].name}'\nduration ${(to - from).toFixed(4)}`);
}
list.push(`file 'frames/${frames.at(-1).name}'`);
writeFileSync(resolve(OUT, "frames.txt"), list.join("\n") + "\n");

// ------------------------------------------------------------ subtitles, retimed
const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const out = caps.map((c) => ({ ...c, start: map(c.start), end: map(c.end) }));
writeFileSync(resolve(OUT, "demo.srt"), out.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n"));
const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
// BorderStyle 3 = box behind the text; colours are &HAABBGGRR. Box = #060914 at ~80% opacity.
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Noto Sans,38,&H00FFF3EE,&H00FFF3EE,&H33140906,&H33140906,0,0,0,0,100,100,0,0,3,16,0,2,280,280,56,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${out.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,{\\fad(150,150)}${c.text}`).join("\n")}
`;
const assPath = resolve(OUT, "demo.ass");
writeFileSync(assPath, ass);

// ------------------------------------------------------------ encode
const final = resolve(OUT, "settle-demo.mp4");
console.log(`${frames.length} frames · raw ${end.toFixed(1)}s → ${duration.toFixed(1)}s`);
const clips = vo.map((v, i) => (v ? { ...v, at: out[i].start + LEAD } : null)).filter(Boolean);
const music = existsSync(OUT) ? readdirSync(OUT).find((f) => /^music\.(mp3|wav|m4a|ogg|flac)$/.test(f)) : undefined;
const ainputs = [...clips.flatMap((c) => ["-i", c.file]), ...(music ? ["-stream_loop", "-1", "-i", resolve(OUT, music)] : [])];
let afc = "";
if (clips.length) {
  clips.forEach((c, k) => (afc += `[${k + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=80,adelay=${Math.round(c.at * 1000)}:all=1[v${k}];`));
  afc += `${clips.map((_, k) => `[v${k}]`).join("")}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad,atrim=0:${duration.toFixed(3)}[voice];`;
  if (music) {
    const m = clips.length + 1;
    afc += `[voice]asplit[vmain][vkey];[${m}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.22,atrim=0:${duration.toFixed(3)},afade=t=out:st=${(duration - 3).toFixed(2)}:d=3[bed];`;
    afc += `[bed][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked];[vmain][ducked]amix=inputs=2:normalize=0[mix];[mix]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  } else afc += `[voice]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
}
execFileSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", resolve(OUT, "frames.txt"), ...ainputs,
    "-filter_complex", `[0:v]fps=30,scale=1920:1080:flags=lanczos,setsar=1,ass=${assPath}[vout]${afc ? ";" + afc : ""}`,
    "-map", "[vout]", ...(afc ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : []), "-t", duration.toFixed(3),
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", final],
  { stdio: "inherit", cwd: OUT },
);

// ------------------------------------------------------------ the voice-over script + recorder data
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const script = out.map((c, i) => ({ n: i + 1, text: c.text, start: +c.start.toFixed(2), end: +c.end.toFixed(2), words: words(c.text), say: +speakTime(c.text).toFixed(1), aim: Math.max(3, Math.round(words(c.text) / 2.5)) }));
writeFileSync(resolve(OUT, "VOICEOVER.md"), `# Settle demo: voice-over script

${script.length} lines · video ${mmss(duration)}. Record **one file per line**, named \`01\`, \`02\`, … (any audio format), into \`${OUT}/vo/\`,
or use the recorder at http://localhost:3000/voiceover. Then run \`DEMO_OUT=${OUT.split("/").pop()} node compose-full.mjs\`.
Each scene is re-timed to your clip, so read naturally; don't rush to fit the times below.

| # | Aim for | In video | Line |
|---|---|---|---|
${script.map((l) => `| ${String(l.n).padStart(2, "0")} | ~${l.aim} s | ${mmss(l.start)}–${mmss(l.end)} | ${l.text} |`).join("\n")}

Pronunciation: NEAR = "near" · sUSD = "S-U-S-D" (or just "dollars") · SOL = "sol" · Settle = "settle".
`);
const pub = process.env.RECORDER_DATA === "0" ? resolve(OUT, ".recorder-data") : resolve(here, "../apps/web/voiceover-data");
mkdirSync(pub, { recursive: true });
writeFileSync(resolve(pub, "script.json"), JSON.stringify({ duration, lines: script }));
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(Math.min(duration - 1, out[2].start + 4)), "-i", final, "-frames:v", "1", resolve(OUT, "thumbnail.png")]);
copyFileSync(final, resolve(pub, "settle-demo.mp4"));
console.log(`✓ ${final}`);
