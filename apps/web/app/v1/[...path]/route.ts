// The Settle API (apps/api, a Hono app) served from the same Next.js deployment: /v1/* on this origin.
// Postgres (Neon) holds the state; chain syncs run on demand and via /v1/cron/tick instead of a long-running poller.
import { after } from "next/server";
import { app } from "@settle/api/app";
import { setBackgroundRunner } from "@settle/api/background";

// Keep the function alive for post-response work (webhook delivery, deposit settlement, invoice sync).
setBackgroundRunner((p) => after(p));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // relays can wait on a slow RPC, then look the transaction up by hash

const handler = (req: Request) => app.fetch(req);
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE, handler as OPTIONS };
