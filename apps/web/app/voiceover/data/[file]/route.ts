// Serves the latest composed demo video + voice-over script (written by demo/compose-full.mjs into
// apps/web/voiceover-data/) to the /voiceover recorder. Read at request time, so re-composing needs no rebuild.
// Video supports Range requests so the recorder can seek to each scene.
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";
const DIR = resolve(process.cwd(), "voiceover-data");
const FILES: Record<string, string> = { "script.json": "application/json", "settle-demo.mp4": "video/mp4" };

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const type = FILES[file];
  const path = resolve(DIR, file);
  if (!type || !existsSync(path)) return new Response("Not found. Run demo/compose-full.mjs first.", { status: 404 });
  const size = statSync(path).size;
  const headers = { "content-type": type, "cache-control": "no-store", "accept-ranges": "bytes" };
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && type === "video/mp4") {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
}
