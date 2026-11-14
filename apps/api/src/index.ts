import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { assertChainConfig, config } from "./config.ts";
import { startWatcher } from "./watcher.ts";

assertChainConfig();
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[settle] API on http://localhost:${info.port}  network=${config.network} contract=${config.contractId || "(unset)"} intents=${config.intentsMode} ai=${config.aiEnabled ? config.anthropicModel : "heuristic"}`);
});
startWatcher();
