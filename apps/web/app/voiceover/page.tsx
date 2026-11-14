"use client";
// Voice-over recorder for the demo video: a teleprompter that plays each scene (muted) while you read its line.
// Takes download as settle-vo-NN.webm; demo/compose-full.mjs picks them up from ~/Downloads and times the video to them.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Mic, Play, Square } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { LogoMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

interface Line { n: number; text: string; start: number; end: number; words: number; say: number }
interface Take { url: string; blob: Blob; secs: number }

const nn = (n: number) => String(n).padStart(2, "0");
// Target length of a take: a natural narration pace of about 2.5 words a second (150 wpm).
const aimFor = (l: Line) => Math.max(3, Math.round(l.words / 2.5));
const range = (aim: number) => [Math.max(2, aim - 1), aim + 2] as const;
function fit(secs: number, aim: number) {
  const [lo, hi] = range(aim);
  if (secs < lo) return { tone: "warn", text: "A bit quick. Fine if it sounds natural; the scene speeds up to match." } as const;
  if (secs > hi + 1) return { tone: "warn", text: "A bit long. The scene slows down to fit, so try a slightly faster read if it drags." } as const;
  return { tone: "ok", text: "Good length." } as const;
}

export default function Voiceover() {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cur, setCur] = useState(0);
  const [takes, setTakes] = useState<Record<number, Take>>({});
  const [rec, setRec] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const t0 = useRef(0);

  useEffect(() => {
    fetch("/voiceover/data/script.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No script yet. Run demo/compose-full.mjs first."))))
      .then((d) => setLines(d.lines))
      .catch((e) => setErr(e.message));
  }, []);

  const line = lines?.[cur];

  const playScene = useCallback(() => {
    const v = video.current;
    if (!v || !line) return;
    v.currentTime = line.start;
    v.play().catch(() => {});
  }, [line]);

  // stop the preview at the end of its scene
  useEffect(() => {
    const v = video.current;
    if (!v || !line) return;
    const onTime = () => { if (v.currentTime >= line.end && !rec) v.pause(); };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [line, rec]);

  useEffect(() => {
    if (!rec) return;
    const id = setInterval(() => setElapsed((performance.now() - t0.current) / 1000), 100);
    return () => clearInterval(id);
  }, [rec]);

  async function start() {
    if (!line) return;
    try {
      stream.current ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 1 } });
    } catch {
      setErr("Microphone access was blocked. Allow it in the address bar and try again.");
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream.current, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 160_000 });
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const n = line.n;
    r.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const secs = (performance.now() - t0.current) / 1000;
      setTakes((t) => {
        if (t[n]) URL.revokeObjectURL(t[n].url);
        return { ...t, [n]: { blob, url: URL.createObjectURL(blob), secs } };
      });
    };
    recorder.current = r;
    t0.current = performance.now();
    setElapsed(0);
    r.start();
    setRec(true);
    playScene();
  }

  function stop() {
    recorder.current?.state === "recording" && recorder.current.stop();
    video.current?.pause();
    setRec(false);
  }

  function save(n: number) {
    const t = takes[n];
    if (!t) return;
    const a = document.createElement("a");
    a.href = t.url;
    a.download = `settle-vo-${nn(n)}.webm`;
    a.click();
  }

  // Space = record / stop, ← → = previous / next line
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!lines || (e.target as HTMLElement)?.closest("button,input,textarea")) return;
      if (e.code === "Space") { e.preventDefault(); rec ? stop() : start(); }
      if (!rec && e.key === "ArrowRight") setCur((c) => Math.min(lines.length - 1, c + 1));
      if (!rec && e.key === "ArrowLeft") setCur((c) => Math.max(0, c - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const done = Object.keys(takes).length;
  const aim = line ? aimFor(line) : 0;
  const [lo, hi] = range(aim);
  const take = line ? takes[line.n] : undefined;
  const verdict = take && fit(take.secs, aim);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <LogoMark size={26} />
        <h1 className="text-xl font-light tracking-[-0.02em]">Voice-over recorder</h1>
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">{lines ? `${done}/${lines.length} recorded` : ""}</span>
        <ThemeToggle className="ml-auto" />
      </header>

      {err && <p role="alert" className="mb-4 rounded-xl bg-destructive-soft px-3 py-2 text-sm text-destructive">{err}</p>}
      {!lines && !err && <p className="text-muted-foreground">Loading script…</p>}

      {lines && line && (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <section className="grid gap-4">
            <video ref={video} src="/voiceover/data/settle-demo.mp4" muted playsInline className="aspect-video w-full rounded-2xl bg-black shadow-[var(--glass-shadow)]" />
            <div className="glass rounded-[22px] p-6">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Line {nn(line.n)} · {line.words} words
              </p>
              <p className="mt-2 text-sm">
                Aim for <strong className="font-semibold">about {aim} seconds</strong>
                <span className="text-muted-foreground"> ({lo}–{hi} s is fine)</span>
              </p>
              <p className="mt-3 text-[28px] font-light leading-snug tracking-[-0.015em] text-balance">{line.text}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {rec ? (
                  <Button variant="destructive" size="lg" onClick={stop}><Square className="size-4" aria-hidden /> Stop · {elapsed.toFixed(1)} / ~{aim}s</Button>
                ) : (
                  <Button size="lg" onClick={start}><Mic className="size-4" aria-hidden /> {takes[line.n] ? "Record again" : "Record"}</Button>
                )}
                <Button variant="secondary" size="lg" onClick={playScene} disabled={rec}><Play className="size-4" aria-hidden /> Preview scene</Button>
                {takes[line.n] && !rec && (
                  <>
                    <audio ref={audio} src={takes[line.n].url} controls className="h-10" />
                    <Button variant="secondary" size="lg" onClick={() => save(line.n)}><Download className="size-4" aria-hidden /> Save {nn(line.n)}</Button>
                  </>
                )}
              </div>
              {rec && (
                <div className="mt-4" aria-hidden>
                  <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-100", elapsed > hi ? "bg-warning" : "bg-primary")}
                      style={{ width: `${Math.min(100, (elapsed / (hi + 1)) * 100)}%` }}
                    />
                    <div className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${(aim / (hi + 1)) * 100}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-xs text-muted-foreground">
                    <span>0s</span>
                    <span>{elapsed > hi ? "Wrap up" : elapsed >= lo ? "Good time to finish" : `Target ~${aim}s`}</span>
                  </div>
                </div>
              )}
              {take && verdict && !rec && (
                <p className={cn("mt-4 text-sm", verdict.tone === "ok" ? "text-primary" : "text-warning")}>
                  Your take: {take.secs.toFixed(1)} s. {verdict.text}
                </p>
              )}
              <p className="mt-4 text-sm text-muted-foreground">
                Space starts and stops recording. ← → move between lines. The scene plays silently while you read, so you can follow it. The timer is a guide, not a limit: the video is re-timed to your voice, and silence at the start and end of each take is trimmed.
              </p>
            </div>
          </section>

          <aside className="glass flex max-h-[80dvh] flex-col rounded-[22px] p-2">
            <ol className="min-h-0 flex-1 overflow-y-auto">
              {lines.map((l, i) => (
                <li key={l.n}>
                  <button
                    onClick={() => !rec && setCur(i)}
                    className={cn("flex w-full gap-3 rounded-xl px-3 py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring", i === cur ? "bg-accent" : "hover:bg-muted")}
                  >
                    <span className="mt-0.5 font-mono text-xs text-muted-foreground">{nn(l.n)}</span>
                    <span className="line-clamp-2 flex-1">{l.text}</span>
                    <span className="mt-0.5 flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground">
                      {takes[l.n] ? <>{takes[l.n].secs.toFixed(0)}s <Check className="size-4 text-primary" aria-label="recorded" /></> : `~${aimFor(l)}s`}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <Button className="m-2" disabled={!done} onClick={() => Object.keys(takes).forEach((n, k) => setTimeout(() => save(Number(n)), k * 350))}>
              <Download className="size-4" aria-hidden /> Save all {done ? `(${done})` : ""}
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}
