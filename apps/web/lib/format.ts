/** Finance formatting: money as $1,234.56 (right-aligned, tabular), absolute dates. */
const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function usd(v: string | number | null | undefined, opts: { signed?: boolean } = {}) {
  const n = Number(v ?? 0);
  const s = usdFmt.format(Math.abs(n));
  if (n < 0) return `−${s}`;
  return opts.signed && n > 0 ? `+${s}` : s;
}

export function date(ts: number | string | null | undefined, opts: { time?: boolean } = {}) {
  if (ts == null || ts === "") return "—";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(`${ts}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(opts.time ? { hour: "numeric", minute: "2-digit" } : {}) });
}

export function daysUntil(ts: number) {
  return Math.ceil((ts * 1000 - Date.now()) / 86400e3);
}

export function downloadCsv(path: string) {
  const token = localStorage.getItem("settle.session.v1");
  const base = process.env.NEXT_PUBLIC_API_URL ?? "";
  return fetch(`${base}${path}${path.includes("?") ? "&" : "?"}format=csv`, { headers: { authorization: `Bearer ${token}` } })
    .then((r) => {
      if (!r.ok) throw new Error(`Export failed (${r.status})`);
      return Promise.all([r.blob(), r.headers.get("content-disposition")]);
    })
    .then(([blob, cd]) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = cd?.match(/filename="([^"]+)"/)?.[1] ?? "export.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    });
}
