/**
 * Moves testnet NEAR from the relayer / agent accounts to the contract account, which pays for its own storage.
 *   npx tsx test/fund-contract.ts <relayerNear> <agentNear>
 * Keys come from .env and are never printed.
 */
import "../src/config.ts"; // loads .env
import { Account, JsonRpcProvider, nearToYocto } from "near-api-js";

const rpc = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL! });
const contract = process.env.SETTLE_CONTRACT_ID!;
const [relayerNear = "0", agentNear = "0"] = process.argv.slice(2);
const legs: [string | undefined, string | undefined, string][] = [
  [process.env.RELAYER_ACCOUNT_ID, process.env.RELAYER_PRIVATE_KEY, relayerNear],
  [process.env.AGENT_ACCOUNT_ID, process.env.AGENT_PRIVATE_KEY, agentNear],
];
for (const [id, key, amount] of legs) {
  if (!id || !key || Number(amount) <= 0) continue;
  const acct = new Account(id, rpc, key as any);
  await acct.transfer({ receiverId: contract, amount: nearToYocto(amount as any) } as any);
  console.log(`sent ${amount} NEAR ${id} → ${contract}`);
}
const bal = async (a: string) => Number(BigInt((await rpc.viewAccount({ accountId: a })).amount) / 10n ** 20n) / 1e4;
for (const a of [contract, process.env.RELAYER_ACCOUNT_ID!, process.env.AGENT_ACCOUNT_ID!]) console.log(a, (await bal(a)).toFixed(3), "NEAR");
