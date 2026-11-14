/** "12.5" -> 12500000n (6 decimals) */
export function toBase(amount: string | number, decimals: number): bigint {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: ${s}`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`Too many decimal places (max ${decimals})`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** 12500000n -> "12.5" */
export function fromBase(base: string | bigint | number, decimals: number): string {
  const v = BigInt(base);
  const d = 10n ** BigInt(decimals);
  const frac = (v % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${v / d}.${frac}` : `${v / d}`;
}

export function formatMoney(base: string | bigint | number, decimals: number, symbol = "") {
  const s = fromBase(base, decimals);
  const [w, f = ""] = s.split(".");
  const whole = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = f.padEnd(2, "0").slice(0, Math.max(2, Math.min(f.length, decimals)));
  return `${whole}.${frac}${symbol ? ` ${symbol}` : ""}`;
}
