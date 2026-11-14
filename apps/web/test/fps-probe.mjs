// Measures requestAnimationFrame rate on /sample4 (the WebGL hero) under different Chrome GPU flag sets.
import puppeteer from "puppeteer-core";
const W = process.env.SETTLE_WEB ?? "http://localhost:3000";
const sets = {
  swiftshader: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  gl: ["--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu"],
  vulkan: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--enable-gpu"],
  egl: ["--use-gl=egl", "--ignore-gpu-blocklist", "--enable-gpu"],
};
for (const [name, flags] of Object.entries(sets)) {
  const b = await puppeteer.launch({ executablePath: "/bin/google-chrome-stable", headless: true, args: ["--no-sandbox", ...flags] });
  try {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: 810, deviceScaleFactor: 4 / 3 });
    await p.goto(`${W}/sample4`, { waitUntil: "networkidle0", timeout: 30000 });
    const r = await p.evaluate(async () => {
      const gl = document.createElement("canvas").getContext("webgl");
      const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
      const renderer = gl ? gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : "no webgl";
      let n = 0;
      const t = performance.now();
      await new Promise((res) => { const f = () => { n++; performance.now() - t < 3000 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
      return { renderer, fps: (n / 3).toFixed(1) };
    });
    console.log(name.padEnd(12), r.fps, "fps ·", r.renderer);
  } catch (e) {
    console.log(name.padEnd(12), "failed:", e.message.slice(0, 80));
  }
  await b.close();
}
