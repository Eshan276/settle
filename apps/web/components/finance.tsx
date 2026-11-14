"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, ExternalLink, Search, X } from "lucide-react";
import { Button, cn, Empty, ErrorState, Skeleton } from "@/components/ui";
import { downloadCsv, usd } from "@/lib/format";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// ------------------------------------------------------------------- money
export function Money({ v, signed, className, muted }: { v: string | number | null | undefined; signed?: boolean; className?: string; muted?: boolean }) {
  const n = Number(v ?? 0);
  return (
    <span className={cn("tnum whitespace-nowrap", signed && n > 0 && "text-primary", signed && n < 0 && "text-foreground", muted && "text-muted-foreground", className)}>
      {usd(v, { signed })}
    </span>
  );
}

export function ProofLink({ href, label = "Proof" }: { href: string | null | undefined; label?: string }) {
  if (!href) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded text-xs font-medium text-primary hover:underline underline-offset-4", focus)}
    >
      {label} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

export function TokenChip({ symbol, network }: { symbol: string; network: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-full bg-muted px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-foreground/80 shadow-[inset_0_0_0_1px_var(--border)]" title="Balances are held in a USD stablecoin on NEAR">
      <span className="size-1.5 rounded-full bg-ring shadow-[0_0_8px_var(--ring)]" aria-hidden />
      {symbol} · NEAR {network}
    </span>
  );
}

const pillTone: Record<string, string> = {
  paid: "bg-accent text-accent-foreground",
  active: "bg-accent text-accent-foreground",
  approved: "bg-accent text-accent-foreground",
  claimed: "bg-accent text-accent-foreground",
  ready: "bg-accent text-accent-foreground",
  open: "bg-muted text-foreground",
  sent: "bg-muted text-foreground",
  partially_paid: "bg-warning-soft text-warning",
  pending_approval: "bg-warning-soft text-warning",
  needs_review: "bg-warning-soft text-warning",
  past_due: "bg-destructive-soft text-destructive",
  overdue: "bg-destructive-soft text-destructive",
  rejected: "bg-destructive-soft text-destructive",
  failed: "bg-destructive-soft text-destructive",
  void: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
  completed: "bg-muted text-muted-foreground",
  inactive: "bg-muted text-muted-foreground",
};
const pillLabel: Record<string, string> = { pending_approval: "Awaiting approval", needs_review: "Needs review", partially_paid: "Partially paid", past_due: "Past due" };

export function StatusPill({ status, children }: { status: string; children?: React.ReactNode }) {
  const s = status.toLowerCase();
  return (
    <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium", pillTone[s] ?? "bg-muted text-foreground")}>
      {children ?? pillLabel[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")}
    </span>
  );
}

// ---------------------------------------------------------------- toolbar
export function TableToolbar<T extends string>({
  tabs,
  tab,
  onTab,
  counts,
  search,
  onSearch,
  searchLabel = "Search",
  csvPath,
  children,
}: {
  tabs?: { value: T; label: string }[];
  tab?: T;
  onTab?: (t: T) => void;
  counts?: Partial<Record<T, number>>;
  search?: string;
  onSearch?: (s: string) => void;
  searchLabel?: string;
  csvPath?: string;
  children?: React.ReactNode;
}) {
  const [exporting, setExporting] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      {tabs && (
        <div role="tablist" aria-label="Filter" className="-mx-1 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => onTab?.(t.value)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                focus,
                tab === t.value ? "bg-accent text-foreground shadow-[inset_0_0_0_1px_var(--input)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {counts?.[t.value] !== undefined && <span className="tnum rounded-full bg-background/60 px-1.5 font-mono text-[11px] text-muted-foreground">{counts[t.value]}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        {onSearch && (
          <label className="relative">
            <span className="sr-only">{searchLabel}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchLabel}
              className={cn("h-8 w-48 rounded-full border border-input bg-[var(--field)] pl-8 pr-3 text-[13px] placeholder:text-muted-foreground/70", focus)}
            />
          </label>
        )}
        {csvPath && (
          <Button variant="secondary" size="sm" loading={exporting} onClick={() => { setExporting(true); downloadCsv(csvPath).finally(() => setExporting(false)); }}>
            <Download className="size-3.5" aria-hidden /> Export CSV
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- data table
export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  loading,
  error,
  retry,
  empty,
  defaultSort,
  footer,
  selectedKey,
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  loading?: boolean;
  error?: string | null;
  retry?: () => void;
  empty: { title: string; body?: string; action?: React.ReactNode; icon?: React.ReactNode };
  defaultSort?: { key: string; dir: "asc" | "desc" };
  footer?: React.ReactNode;
  selectedKey?: string | null;
}) {
  const [sort, setSort] = useState(defaultSort);
  const sorted = useMemo(() => {
    if (!rows || !sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.sortValue!(a);
      const y = col.sortValue!(b);
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }, [rows, sort, columns]);

  if (error && !rows) return <ErrorState error={error} retry={retry} />;
  if (loading && !rows) {
    return (
      <div role="status" aria-label="Loading" className="divide-y">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-6 px-4 py-3.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    );
  }
  if (!sorted?.length) return <Empty icon={empty.icon} title={empty.title} body={empty.body} action={empty.action} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground [&_button]:uppercase">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined} className={cn("whitespace-nowrap px-4 py-3 font-medium", c.align === "right" ? "text-right" : "text-left")}>
                  {c.sortValue ? (
                    <button
                      onClick={() => setSort({ key: c.key, dir: active && sort!.dir === "desc" ? "asc" : "desc" })}
                      className={cn("inline-flex items-center gap-1 rounded hover:text-foreground", focus, c.align === "right" && "flex-row-reverse")}
                    >
                      {c.header}
                      {active && (sort!.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((r) => {
            const k = rowKey(r);
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(r)) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-selected={selectedKey === k || undefined}
                className={cn(onRowClick && "cursor-pointer transition-colors hover:bg-[rgb(90_150_255/0.05)] focus-visible:bg-muted focus-visible:outline-none", selectedKey === k && "bg-muted")}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3 align-middle", c.align === "right" && "text-right", c.className)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer && <tfoot className="border-t bg-muted/30 text-sm font-medium">{footer}</tfoot>}
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ drawer
export function Drawer({ open, onClose, title, subtitle, children, actions, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="fade-in absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Details"}
        tabIndex={-1}
        className={cn("drawer-in absolute inset-y-0 right-0 flex w-full flex-col bg-[var(--popover)] shadow-[inset_1px_0_0_var(--border),-40px_0_80px_-40px_rgb(40_90_255/0.35)] focus:outline-none", wide ? "max-w-2xl" : "max-w-lg")}
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-normal tracking-[-0.02em]">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" className={cn("-mr-2 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted", focus)}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {actions && <div className="flex flex-wrap items-center justify-end gap-2 border-t px-6 py-3">{actions}</div>}
      </div>
    </div>
  );
}

export function DefList({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({ items }: { items: { at: number; title: string; detail?: string; proof_url?: string | null; tone?: "ok" | "warn" | "muted" }[] }) {
  return (
    <ol className="relative grid gap-4 border-l pl-5">
      {items.map((t, i) => (
        <li key={i} className="relative">
          <span className={cn("absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-card", t.tone === "warn" ? "bg-warning" : t.tone === "muted" ? "bg-muted-foreground" : "bg-primary")} aria-hidden />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-medium">{t.title}</p>
            <time className="text-xs text-muted-foreground">{new Date(t.at * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
          </div>
          {t.detail && <p className="mt-0.5 text-xs text-muted-foreground">{t.detail}</p>}
          {t.proof_url && <div className="mt-1"><ProofLink href={t.proof_url} label="View on-chain proof" /></div>}
        </li>
      ))}
    </ol>
  );
}

export function Kpi({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: "warn" }) {
  const inner = (
    <>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-2 text-[30px] font-medium leading-none tracking-[-0.035em] text-foreground tnum">{value}</p>
      {sub && <p className={cn("mt-2.5 font-mono text-[12px]", tone === "warn" ? "text-warning" : "text-muted-foreground")}>{sub}</p>}
    </>
  );
  const cls = "glass block min-w-0 rounded-[22px] p-5";
  return href ? (
    <a href={href} className={cn(cls, "transition-[filter] hover:brightness-125", focus)}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
