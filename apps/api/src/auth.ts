import { createHash, randomBytes } from "node:crypto";
import type { Context, Next } from "hono";
import { KeyPair, PublicKey } from "near-api-js";
import { get, newId, now, run } from "./db.ts";
import { HttpError, provider } from "./near.ts";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const loginMessage = (accountId: string, timestamp: number) => `Sign in to Settle\naccount: ${accountId}\ntimestamp: ${timestamp}`;

/**
 * Sign-in with NEAR: the browser signs a timestamped message with one of the account's
 * on-chain full-access keys. We verify the signature and that the key belongs to the account.
 */
export async function login(accountId: string, publicKey: string, timestamp: number, signatureB64: string) {
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) throw new HttpError(401, "Login message expired", "auth_expired");
  const pk = PublicKey.fromString(publicKey);
  const ok = pk.verify(new TextEncoder().encode(loginMessage(accountId, timestamp)), Buffer.from(signatureB64, "base64"));
  if (!ok) throw new HttpError(401, "Bad signature", "auth_invalid");
  try {
    const key = await provider.viewAccessKey({ accountId, publicKey });
    if ((key as any).permission !== "FullAccess") throw new Error("not full access");
  } catch {
    throw new HttpError(401, "Key is not a full-access key of this account", "auth_invalid");
  }
  const token = `sess_${randomBytes(24).toString("hex")}`;
  await run("INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)", token, accountId, now() + 7 * 86400);
  return { token, account_id: accountId, expires_at: now() + 7 * 86400 };
}

export async function createApiKey(accountId: string, name?: string) {
  const secret = `sk_${randomBytes(24).toString("hex")}`;
  const id = newId("key", 12);
  await run(
    "INSERT INTO api_keys (id, account_id, key_hash, prefix, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    accountId,
    sha256(secret),
    secret.slice(0, 10),
    name ?? null,
    now(),
  );
  return { id, secret, prefix: secret.slice(0, 10), name: name ?? null };
}

export type AuthVars = { Variables: { accountId: string; authKind: "session" | "api_key" } };

export async function requireAuth(c: Context<AuthVars>, next: Next) {
  const header = c.req.header("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token.startsWith("sk_")) {
    const key = await get("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL", sha256(token));
    if (!key) throw new HttpError(401, "Invalid API key", "auth_invalid");
    await run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", now(), key.id);
    c.set("accountId", key.account_id);
    c.set("authKind", "api_key");
  } else if (token.startsWith("sess_")) {
    const s = await get("SELECT * FROM sessions WHERE token = ? AND expires_at > ?", token, now());
    if (!s) throw new HttpError(401, "Session expired", "auth_expired");
    c.set("accountId", s.account_id);
    c.set("authKind", "session");
  } else {
    throw new HttpError(401, "Missing Authorization: Bearer <sk_... | sess_...>", "auth_required");
  }
  await next();
}

/** Used by tests / scripts to sign the login message with a raw key. */
export function signLogin(keyPair: KeyPair, accountId: string, timestamp: number) {
  const { signature } = keyPair.sign(new TextEncoder().encode(loginMessage(accountId, timestamp)));
  return Buffer.from(signature).toString("base64");
}
