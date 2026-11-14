/**
 * One-shot testnet deployment.
 *
 *   pnpm deploy:testnet
 *
 * Uses DEPLOYER_ACCOUNT_ID + DEPLOYER_PRIVATE_KEY if set (a funded testnet account, ~8 NEAR),
 * otherwise creates a fresh `settle-xxxx.testnet` via the testnet faucet helper.
 *
 * Creates:
 *   pay.<root>    – the Settle contract (owner = root, 0.5% fee)
 *   susd.<root>   – demo stablecoin "sUSD" with an open faucet
 *   agent.<root>  – the AI AP agent; ends up holding ONLY a function-call key for agent_pay*
 *   <root>        – relayer / operator / intents settlement account
 *
 * Writes apps/api/.env and apps/web/.env.local.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Account, JsonRpcProvider, KeyPair, KeyPairString, actions, nearToYocto, teraToGas } from "near-api-js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const provider = new JsonRpcProvider({ url: RPC });
const wasm = (p: string) => {
  const f = resolve(repo, "contracts/target/near", p);
  if (!existsSync(f)) throw new Error(`Missing ${f}. Run \`pnpm build:contracts\` first.`);
  return new Uint8Array(readFileSync(f));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log("›", ...a);

async function exists(accountId: string) {
  return provider.viewAccount({ accountId }).then(() => true, () => false);
}

async function createRoot(): Promise<{ id: string; key: KeyPairString }> {
  if (process.env.DEPLOYER_ACCOUNT_ID && process.env.DEPLOYER_PRIVATE_KEY) {
    return { id: process.env.DEPLOYER_ACCOUNT_ID, key: process.env.DEPLOYER_PRIVATE_KEY as KeyPairString };
  }
  const id = `settle-${randomBytes(4).toString("hex")}.testnet`;
  const kp = KeyPair.fromRandom("ed25519");
  log(`creating ${id} via testnet faucet helper…`);
  const res = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) {
    throw new Error(
      `Faucet helper failed (${res.status}: ${await res.text()}).\nCreate a testnet account in any NEAR wallet, fund it with ~8 NEAR from https://near-faucet.io, then rerun with DEPLOYER_ACCOUNT_ID and DEPLOYER_PRIVATE_KEY set.`,
    );
  }
  for (let i = 0; i < 20 && !(await exists(id)); i++) await sleep(1500);
  return { id, key: kp.toString() };
}

async function main() {
  const root = await createRoot();
  const rootAcc = new Account(root.id, provider, root.key);
  const rootPk = KeyPair.fromString(root.key).getPublicKey().toString();
  const state = await rootAcc.getState();
  log(`root ${root.id} balance ${(Number(state.balance.available) / 1e24).toFixed(2)} NEAR`);

  const contractId = `pay.${root.id}`;
  const tokenId = `susd.${root.id}`;
  const agentId = `agent.${root.id}`;

  // ---- token
  if (!(await exists(tokenId))) {
    log(`creating ${tokenId}`);
    await rootAcc.createSubAccount({ accountOrPrefix: "susd", publicKey: rootPk, nearToTransfer: nearToYocto(2) });
    const tokenAcc = new Account(tokenId, provider, root.key);
    await tokenAcc.signAndSendTransaction({
      receiverId: tokenId,
      actions: [actions.deployContract(wasm("mock_ft/mock_ft.wasm")), actions.functionCall("new", {}, teraToGas(30), 0n)],
    });
  }

  // ---- settle
  if (!(await exists(contractId))) {
    log(`creating ${contractId}`);
    await rootAcc.createSubAccount({ accountOrPrefix: "pay", publicKey: rootPk, nearToTransfer: nearToYocto(4.6) });
    const payAcc = new Account(contractId, provider, root.key);
    await payAcc.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.deployContract(wasm("settle/settle.wasm")),
        actions.functionCall("new", { owner_id: root.id, tokens: [tokenId], fee_bps: 50 }, teraToGas(30), 0n),
      ],
    });
  }

  // ---- storage registrations on the token (Settle must be registered to receive ft_transfer_call)
  for (const acct of [contractId, root.id]) {
    await rootAcc.callFunction({
      contractId: tokenId,
      methodName: "storage_deposit",
      args: { account_id: acct, registration_only: true },
      deposit: 1_250_000_000_000_000_000_000n,
      gas: teraToGas(10),
    });
  }

  // ---- AI agent with a function-call-only key
  const agentFc = KeyPair.fromRandom("ed25519");
  if (!(await exists(agentId))) {
    log(`creating ${agentId} (function-call key only)`);
    const agentFull = KeyPair.fromRandom("ed25519");
    await rootAcc.createSubAccount({ accountOrPrefix: "agent", publicKey: agentFull.getPublicKey().toString(), nearToTransfer: nearToYocto(0.5) });
    const agentAcc = new Account(agentId, provider, agentFull.toString());
    await agentAcc.signAndSendTransaction({
      receiverId: agentId,
      actions: [
        actions.addFunctionCallAccessKey(agentFc.getPublicKey(), contractId, ["agent_pay", "agent_pay_invoice"], nearToYocto(1)),
        actions.deleteKey(agentFull.getPublicKey()),
      ],
    });
  } else {
    throw new Error(`${agentId} already exists; set AGENT_PRIVATE_KEY manually in apps/api/.env`);
  }

  // ---- sanity
  const cfg = await provider.callFunction({ contractId, method: "get_config", args: {} });
  log("contract config", cfg);

  const apiEnv = `# generated by scripts/deploy-testnet.ts — ${new Date().toISOString()}
NEAR_NETWORK=testnet
NEAR_RPC_URL=${RPC}
SETTLE_CONTRACT_ID=${contractId}
DEFAULT_TOKEN_ID=${tokenId}
RELAYER_ACCOUNT_ID=${root.id}
RELAYER_PRIVATE_KEY=${root.key}
AGENT_ACCOUNT_ID=${agentId}
AGENT_PRIVATE_KEY=${agentFc.toString()}
INTENTS_MODE=simulated
PUBLIC_WEB_URL=http://localhost:3000
PORT=4000
# ANTHROPIC_API_KEY=sk-ant-...   (enables Claude bill parsing; heuristic parser otherwise)
# RESEND_API_KEY=...             (enables real email delivery for payouts)
`;
  writeFileSync(resolve(repo, "apps/api/.env"), apiEnv, { mode: 0o600 });
  writeFileSync(resolve(repo, "apps/web/.env.local"), `NEXT_PUBLIC_API_URL=http://localhost:4000\n`);
  log("wrote apps/api/.env and apps/web/.env.local");
  console.log(`\n✅ Settle deployed\n   contract  ${contractId}\n   token     ${tokenId}\n   relayer   ${root.id}\n   agent     ${agentId}\n   explorer  https://testnet.nearblocks.io/address/${contractId}\n`);
}

main().catch((e) => {
  console.error("\n✖", e.message ?? e);
  process.exit(1);
});
