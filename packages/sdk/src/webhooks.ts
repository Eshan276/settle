import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify a `Settle-Signature: t=..,v1=..` header (Node only). */
export function verifyWebhook(secret: string, rawBody: string, header: string, toleranceSecs = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSecs || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function constructEvent<T = any>(secret: string, rawBody: string, header: string): T {
  if (!verifyWebhook(secret, rawBody, header)) throw new Error("Invalid Settle webhook signature");
  return JSON.parse(rawBody) as T;
}
