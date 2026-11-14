"use client";
// The treasury hero, built from uberdesigner's "beamfall" (Blue night tech): a glass card held in a beam of light.
// The shader, motion curves and sparks follow the template's spec exactly; the card, chart and circuit lines carry
// Settle's own content: the treasury balance, its recent history, and money flowing in on the left rails and out on
// the right ones. Data arrives as props and is read through a ref, so polling never restarts the animation.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import "./beam.css";

export interface HeroRail { label: string; sub: string }
export interface BeamHeroProps {
  cash: number;
  /** % change over the series, null to hide the chip */
  change: number | null;
  /** daily balances in dollars, oldest first (at least 2) */
  series: number[];
  /** one label per point, e.g. "Nov 12" */
  days: string[];
  /** 4 money sources (left) */
  inflows: HeroRail[];
  /** 4 money destinations (right) */
  outflows: HeroRail[];
  index?: string;
  label?: string;
  /** stage rows to show: the beam enters under the page header */
  cropTop?: number;
  cropHeight?: number;
}

// ------------------------------------------------------------------ geometry + motion (beamfall motion.ts)
const STAGE = 1080, CX = 540, TOP = 340, BOT = 740, HW = 260, HH = 200, RAD = 34;
const REDUCED_MOTION_T = 6;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const prog = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
const easeInQuad = (k: number) => k * k;
type Light = { front: number; ign: number; bot: number; splash: number; lit: number };
const light = (t: number): Light => ({
  front: -60 + (TOP + 70) * easeInQuad(prog(t, 0, 0.75)),
  ign: easeOutCubic(prog(t, 0.62, 1.55)),
  bot: BOT + (1160 - BOT) * easeInQuad(prog(t, 1.25, 1.95)),
  splash: easeOutCubic(prog(t, 1.25, 1.7)),
  lit: easeOutCubic(prog(t, 0.55, 1.4)),
});
const cardIn = (t: number) => easeOutCubic(prog(t, 0.9, 1.7));
const countUp = (t: number) => easeOutCubic(prog(t, 1.0, 2.6));
const chartReveal = (t: number) => easeInOutCubic(prog(t, 1.2, 2.6));
const markerIn = (t: number) => prog(t, 2.4, 2.8);
const markerAt = (t: number) => 0.28 + 0.5 * (0.5 + 0.5 * Math.sin(Math.max(0, t - 2.4) * 0.5 - Math.PI / 2));
const livePulse = (t: number) => (t % 1.6) / 1.6;
const tracePulse = (t: number, i: number) => (t * 0.35 + i * 0.27) % 1;

// ------------------------------------------------------------------ the shader (beamfall beam.ts, unchanged)
const VERTEX = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const f = (n: number) => `${n}.`;
const FRAGMENT = `precision highp float;
uniform float uT, uFront, uIgn, uBot, uSplash, uLit;
uniform float uSize, uK;
const float CX=${f(CX)},TOP=${f(TOP)},BOT=${f(BOT)},HW=${f(HW)},HH=${f(HH)},RAD=${f(RAD)};
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
float sdRR(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float column(float dx,float w,float y,float speed,float seed){
  float u=dx/w;
  float core=exp(-u*u*1.6);
  float hot=exp(-u*u*14.)*1.4;
  float fib=fbm(vec2(u*7.5+seed,y*.010-uT*speed));
  float fib2=vn(vec2(u*26.+seed*3.,y*.03-uT*speed*1.6));
  float strands=.45+.9*fib*fib+.35*fib2;
  return core*strands*1.35+hot;
}
void main(){
  vec2 p=vec2(gl_FragCoord.x,uSize-gl_FragCoord.y)/uK;
  float x=p.x,y=p.y,dx=x-CX;
  vec3 blue=vec3(.18,.42,1.), violet=vec3(.42,.3,1.), white=vec3(.86,.93,1.);
  float r=length(p-vec2(CX,(TOP+BOT)*.5));
  vec3 col=vec3(.004,.005,.014)+vec3(.012,.02,.065)*exp(-r/380.)*(.4+.6*uLit);
  float sd=sdRR(p-vec2(CX,(TOP+BOT)*.5),vec2(HW,HH),RAD);
  float I=0.;
  if(y<TOP+6.){
    float d=TOP-y;
    float w=4.5+150.*pow(max(0.,1.-d/190.),2.6)+1.5*sin(y*.02+uT*2.);
    float m=smoothstep(uFront+4.,uFront-40.,y);
    I+=column(dx,w,y,2.6,0.)*m*(1.+.6*exp(-d/50.))*smoothstep(-10.,240.,y);
  }
  if(y>BOT-6.){
    float d=y-BOT;
    float w=4.+146.*exp(-d/50.)+1.2*sin(y*.02-uT*2.);
    float m=smoothstep(uBot+4.,uBot-60.,y);
    float dis=smoothstep(1090.,820.,y);
    I+=column(dx,w,y,3.2,4.)*m*(.85+.5*exp(-d/50.))*dis;
  }
  {
    float yt=min(y,TOP);float wt=4.5+150.*pow(max(0.,1.-(TOP-yt)/190.),2.6);
    float vy=max(0.,y-TOP);
    float gT=exp(-pow(dx/(wt*1.05+22.),2.)-pow(vy/55.,2.))*.34;
    float hT=exp(-length(vec2(dx,vy*1.4))/(wt*.9+80.))*.05;
    float mT=smoothstep(uFront+60.,uFront-60.,yt)*smoothstep(-10.,240.,y+vy*3.);
    I+=(gT+hT)*mT;
    float yb=max(y,BOT);float wb=4.+146.*exp(-(yb-BOT)/50.);
    float vb=max(0.,BOT-y);
    float gB=exp(-pow(dx/(wb*1.05+22.),2.)-pow(vb/55.,2.))*.3;
    float hB=exp(-length(vec2(dx,vb*1.4))/(wb*.9+80.))*.045;
    float mB=smoothstep(uBot+60.,uBot-60.,yb)*smoothstep(1090.,820.,yb);
    I+=(gB+hB)*mB;
  }
  float aTop=abs(dx)+max(0.,y-TOP);
  float aBot=abs(dx)+max(0.,BOT-y);
  float ign=smoothstep(uIgn*820.+20.,uIgn*820.-60.,aTop);
  float fTop=exp(-max(0.,aTop-70.)/250.)*ign;
  float fBot=exp(-max(0.,aBot-60.)/200.)*smoothstep(0.,1.,uSplash*1.2)*.8;
  float shimmer=.72+.28*sin(aTop*.032-uT*5.)+.12*vn(vec2(aTop*.05-uT*3.,0.));
  float F=max(fTop*shimmer,fBot*(.8+.2*sin(aBot*.04-uT*4.)));
  float rim=exp(-abs(sd)/1.4)*1.6+exp(-abs(sd)/5.)*.55;
  float outer=exp(-max(sd,0.)/16.)*.38*step(0.,sd);
  I+=(rim+outer)*F;
  if(sd<0.){
    float lit=uLit;
    vec3 c=mix(vec3(.026,.036,.09),vec3(.022,.03,.078),(y-TOP)/(BOT-TOP));
    float leak=exp(-(y-TOP)/120.)*exp(-pow(dx/230.,2.))*.85*ign;
    float leakB=exp(-(BOT-y)/110.)*exp(-pow(dx/260.,2.))*.35*smoothstep(0.,1.,uSplash);
    c+=blue*(leak*.32+leakB*.4)*lit+violet*leak*.05;
    float sheen=exp(-pow(((x-280.)-(y-340.)*.6-mod(uT*90.,900.)+200.)/90.,2.))*.025;
    c+=vec3(.6,.75,1.)*sheen;
    c+=vec3(.02,.03,.07)*vn(p*.9)*.35;
    col=mix(col,c,smoothstep(1.,-1.5,sd));
    col+=vec3(.25,.35,.7)*exp(-abs(sd+2.)/0.8)*.08;
  }
  vec2 g=floor(p/14.); float hh=h21(g);
  if(hh>.985){vec2 c2=(g+.5+.3*vec2(sin(uT+hh*40.),cos(uT*.8+hh*30.)))*14.;float d2=length(p-c2);
    col+=vec3(.5,.7,1.)*exp(-d2*1.2)*(.4+.6*sin(uT*3.+hh*90.))*exp(-abs(dx)/320.)*.8;}
  vec3 light=mix(blue*1.1,white,smoothstep(.55,2.2,I))*I;
  light+=violet*I*.08;
  col+=light;
  col=1.-exp(-col*1.05);
  col=pow(col,vec3(.92));
  float e=max(smoothstep(430.,540.,abs(dx)),smoothstep(430.,540.,abs(y-540.)));
  col=mix(col,vec3(.004,.005,.012),e);
  col+=(h21(p+fract(uT))-.5)/200.;
  gl_FragColor=vec4(col,1.);
}`;

function createBeam(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "compile failed");
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(program, n);
  const U = { uT: u("uT"), uFront: u("uFront"), uIgn: u("uIgn"), uBot: u("uBot"), uSplash: u("uSplash"), uLit: u("uLit"), uSize: u("uSize"), uK: u("uK") };
  return {
    draw(t: number, l: Light) {
      const size = canvas.width;
      gl.viewport(0, 0, size, size);
      gl.uniform1f(U.uT, t); gl.uniform1f(U.uFront, l.front); gl.uniform1f(U.uIgn, l.ign); gl.uniform1f(U.uBot, l.bot);
      gl.uniform1f(U.uSplash, l.splash); gl.uniform1f(U.uLit, l.lit); gl.uniform1f(U.uSize, size); gl.uniform1f(U.uK, size / STAGE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); },
  };
}

// ------------------------------------------------------------------ sparks (beamfall sparks.ts)
const rand = (i: number, n: number) => { const s = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return s - Math.floor(s); };
const SPARKS = Array.from({ length: 70 }, (_, i) => ({
  beam: rand(i, 1) < 0.5 ? 0 : 1, off: rand(i, 2), speed: 0.12 + rand(i, 3) * 0.22, lat: rand(i, 4) - 0.5, size: 0.6 + rand(i, 5) * 1.6, phase: rand(i, 6) * 6.28,
}));
function drawSparks(ctx: CanvasRenderingContext2D, t: number, front: number, bot: number) {
  ctx.clearRect(0, 0, 1080, 1080);
  ctx.globalCompositeOperation = "lighter";
  for (const s of SPARKS) {
    const y0 = s.beam === 0 ? -20 : BOT;
    const y1 = s.beam === 0 ? Math.min(TOP, front) : Math.min(1060, bot);
    if (y1 <= y0 + 5) continue;
    const k = (s.off + t * s.speed) % 1;
    const y = y0 + (y1 - y0) * k;
    const w = s.beam === 0 ? 5 + 150 * Math.pow(Math.max(0, 1 - (TOP - y) / 190), 2.6) : 4 + 146 * Math.exp(-(y - BOT) / 50);
    const x = CX + s.lat * w * 1.6;
    const a = (0.35 + 0.65 * Math.abs(Math.sin(t * 3 + s.phase))) * Math.sin(Math.PI * k) * (s.beam === 0 ? clamp01(y / 240) : clamp01((1060 - y) / 260));
    const r = s.size * 5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(225,238,255,${a})`);
    g.addColorStop(1, "rgba(120,170,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
  }
}

// ------------------------------------------------------------------ the chart: the treasury's daily balance
const CHART_W = 520, CHART_H = 150, CHART_TOP = 400 - 30 - CHART_H;
type Pt = [number, number];
function buildChart(series: number[], days: string[]) {
  const vals = series.length > 1 ? series : [series[0] ?? 0, series[0] ?? 0];
  const mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || Math.max(1, mx) || 1;
  const lo = mn - span * 0.12, hi = mx + span * 0.08;
  const pts: Pt[] = vals.map((v, i) => [(i / (vals.length - 1)) * CHART_W, CHART_H - 12 - ((v - lo) / (hi - lo)) * (CHART_H - 30)]);
  const segs = pts.slice(0, -1).map((p1, i) => {
    const p0 = pts[Math.max(0, i - 1)], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    return [p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2] as Pt[];
  });
  const line = `M${pts[0][0]} ${pts[0][1]}` + segs.map(([, c1, c2, p2]) => ` C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`).join("");
  const at = (u: number) => {
    const f = u * segs.length, i = Math.min(segs.length - 1, Math.floor(f)), s = f - i;
    const [a, b, c, d] = segs[i], m = 1 - s;
    const y = m * m * m * a[1] + 3 * m * m * s * b[1] + 3 * m * s * s * c[1] + s * s * s * d[1];
    return { x: u * CHART_W, y, v: vals[i] + (vals[i + 1] - vals[i]) * s, day: days[Math.round(f)] ?? "" };
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((u) => (days[Math.round(u * (days.length - 1))] ?? "").toUpperCase());
  return { line, area: `${line} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z`, at, ticks };
}

// ------------------------------------------------------------------ money rails (circuit lines)
const GEOM = [
  { d: "M280 470 H220 L180 430 H120", end: [120, 430], dir: "in" },
  { d: "M280 500 H200 L160 540 H70", end: [70, 540], dir: "in" },
  { d: "M280 560 H236 L196 600 H140", end: [140, 600], dir: "in" },
  { d: "M280 610 H250 L214 646 H90", end: [90, 646], dir: "in" },
  { d: "M800 470 H860 L900 430 H960", end: [960, 430], dir: "out" },
  { d: "M800 500 H880 L920 540 H1010", end: [1010, 540], dir: "out" },
  { d: "M800 560 H844 L884 600 H940", end: [940, 600], dir: "out" },
  { d: "M800 610 H830 L866 646 H990", end: [990, 646], dir: "out" },
] as const;

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BeamHero({ cash, change, series, days, inflows, outflows, index = "01 — TREASURY", label = "Cash available", cropTop = 150, cropHeight = 780 }: BeamHeroProps) {
  const chart = useMemo(() => buildChart(series, days), [series, days]);
  const rails = [...inflows, ...outflows].slice(0, 8);
  const data = useRef({ cash, change, chart });
  data.current = { cash, change, chart };
  const glRef = useRef<HTMLCanvasElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const circuitsRef = useRef<SVGSVGElement>(null);
  const pulses = useRef<(SVGPathElement | null)[]>([]);
  const railLabels = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const vol = useRef<HTMLSpanElement>(null);
  const chg = useRef<HTMLSpanElement>(null);
  const reveal = useRef<SVGRectElement>(null);
  const guide = useRef<SVGLineElement>(null);
  const glow = useRef<SVGCircleElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [buffer, setBuffer] = useState(STAGE);
  const [fallback, setFallback] = useState(false);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const fit = () => {
      const s = Math.min(1, window.innerWidth / 1400);
      setScale(s);
      setBuffer(Math.min(STAGE * 2, Math.max(STAGE, Math.round(STAGE * s * devicePixelRatio))));
    };
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);

  // a layout effect so its cleanup runs in the same commit that detaches the refs: no frame can see a half-unmounted hero
  useLayoutEffect(() => {
    const canvas = glRef.current!, sc = sparkRef.current!;
    let beam: ReturnType<typeof createBeam> = null;
    try { beam = createBeam(canvas); } catch (e) { console.error(e); }
    setFallback(!beam);
    const ctx = sc.getContext("2d")!;
    const draw = (t: number) => {
      if (!circuitsRef.current || !railLabels.current || !card.current || !vol.current || !chg.current || !ring.current || !reveal.current || !guide.current || !glow.current || !dot.current || !tip.current) return;
      const l = light(t);
      beam?.draw(t, l);
      const k = sc.width / STAGE;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawSparks(ctx, t, l.front, l.bot);
      circuitsRef.current!.style.opacity = String(0.4 + 0.6 * l.lit);
      railLabels.current!.style.opacity = String(l.lit);
      pulses.current.forEach((p, i) => {
        if (!p) return;
        const q = tracePulse(t, i);
        p.style.strokeDashoffset = String(GEOM[i].dir === "out" ? -q * 1.1 + 0.12 : -(1 - q) * 1.1 + 0.12);
        p.style.opacity = String(l.lit * 0.9);
      });
      const ci = cardIn(t), cu = countUp(t);
      card.current!.style.opacity = String(ci);
      card.current!.style.transform = `translateY(${(1 - ci) * 8}px)`;
      const D = data.current;
      vol.current!.textContent = money(D.cash * cu);
      chg.current!.textContent = D.change === null ? "" : `${D.change >= 0 ? "▲" : "▼"} ${Math.abs(D.change * cu).toFixed(1)}%`;
      const pl = livePulse(t);
      ring.current!.style.transform = `scale(${1 + pl * 1.8})`;
      ring.current!.style.opacity = String((1 - pl) * 0.9);
      reveal.current!.setAttribute("width", String(CHART_W * chartReveal(t)));
      const m = D.chart.at(markerAt(t)), mi = String(markerIn(t));
      for (const el of [glow.current!, dot.current!]) { el.setAttribute("cx", String(m.x)); el.setAttribute("cy", String(m.y)); el.style.opacity = mi; }
      guide.current!.setAttribute("x1", String(m.x)); guide.current!.setAttribute("x2", String(m.x)); guide.current!.style.opacity = mi;
      tip.current!.style.left = `${m.x}px`; tip.current!.style.top = `${CHART_TOP + m.y}px`; tip.current!.style.opacity = mi;
      tip.current!.textContent = `${money(m.v).replace(/\.\d+$/, "")}${m.day ? ` · ${m.day}` : ""}`;
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { draw(REDUCED_MOTION_T); return () => beam?.dispose(); }
    let raf = 0, start = -1;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (start < 0) start = now;
      draw((now - start) / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); beam?.dispose(); };
  }, [buffer]);

  return (
    <section aria-label={`Treasury: ${money(cash)} ${label.toLowerCase()}`} className="bf-hero" style={{ height: cropHeight * scale }}>
      <div className="bf-stage" style={{ transform: `translate(-50%, ${-cropTop * scale}px) scale(${scale})` }}>
        <canvas ref={glRef} width={buffer} height={buffer} className="bf-canvas" aria-hidden />
        {fallback && <div className="bf-glass-fallback" aria-hidden />}
        <svg ref={circuitsRef} className="bf-circuits" viewBox="0 0 1080 1080" fill="none" aria-hidden>
          <defs>
            <linearGradient id="bf-pulse"><stop offset="0" className="bf-pulse-from" /><stop offset="1" className="bf-pulse-to" /></linearGradient>
          </defs>
          {GEOM.map((r, i) => (
            <g key={r.d} style={{ visibility: rails[i] ? undefined : "hidden" }}>
              <path d={r.d} className="bf-trace" />
              <path d={r.d} pathLength={1} strokeDasharray="0.12 1" className="bf-pulse" ref={(el) => { pulses.current[i] = el; }} />
              <circle cx={r.end[0]} cy={r.end[1]} r="3" className="bf-node" />
            </g>
          ))}
        </svg>
        <div ref={railLabels} aria-hidden>
          {rails.map((r, i) => (
            <div key={i} className={`bf-rail bf-rail-${GEOM[i].dir}`} style={{ left: GEOM[i].end[0], top: GEOM[i].end[1] }}>
              <span className="bf-rail-label">{r.label}</span>
              <span className="bf-rail-sub">{r.sub}</span>
            </div>
          ))}
        </div>
        <div ref={card} className="bf-card">
          <div className="bf-card-row">
            <span className="bf-index">{index}</span>
            <span className="bf-live"><span ref={ring} className="bf-live-ring" /><span className="bf-live-dot" />Live</span>
          </div>
          <div className="bf-card-label">{label}</div>
          <div className="bf-card-values"><span ref={vol} className="bf-volume" /><span ref={chg} className="bf-change" /></div>
          <div className="bf-chart">
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden>
              <defs>
                <linearGradient id="bf-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="bf-fill-top" /><stop offset="1" className="bf-fill-bottom" /></linearGradient>
                <linearGradient id="bf-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" className="bf-line-from" /><stop offset=".55" className="bf-line-mid" /><stop offset="1" className="bf-line-to" /></linearGradient>
                <clipPath id="bf-reveal"><rect ref={reveal} x="0" y="-20" width="0" height="200" /></clipPath>
              </defs>
              <g className="bf-grid">{[30, 70, 110].map((y) => <line key={y} x1="0" x2={CHART_W} y1={y} y2={y} />)}</g>
              <g clipPath="url(#bf-reveal)"><path d={chart.area} fill="url(#bf-fill)" /><path d={chart.line} className="bf-line" /></g>
              <line ref={guide} className="bf-guide" y1="0" y2={CHART_H} />
              <circle ref={glow} className="bf-mglow" r="11" />
              <circle ref={dot} className="bf-mdot" r="4.5" />
            </svg>
          </div>
          <div ref={tip} className="bf-tip" />
          <div className="bf-axis">{chart.ticks.map((d, i) => <span key={i}>{d}</span>)}</div>
        </div>
        <canvas ref={sparkRef} width={buffer} height={buffer} className="bf-canvas bf-sparks" aria-hidden />
      </div>
    </section>
  );
}
