"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ChevronDown, Code2, Droplets, LogOut, Plus, Settings } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Onboarding } from "@/components/onboarding";
import { MoveMoney, type MoveTab } from "@/components/move-money";
import { TokenChip } from "@/components/finance";
import { Button, cn, CopyButton, ErrorState, Skeleton } from "@/components/ui";
import { api, ensureSession, finishWalletConnect, loadConfig, loadStoredWallet, storeWallet, useAsync, useConfig, useTx, walletFor } from "@/lib/settle";
import { Ctx, type Me, type Summary } from "./context";

type Section = { label: string; href: string; pages: [string, string][]; badge?: number; inNav?: boolean };
const isOn = (path: string, href: string) => (href === "/dashboard" ? path === href : path === href || path.startsWith(`${href}/`));

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const config = useConfig();
  const path = usePathname();
  const [stored, setStored] = useState<ReturnType<typeof loadStoredWallet> | undefined>(undefined);
  const [move, setMove] = useState<{ open: boolean; tab: MoveTab }>({ open: false, tab: "deposit" });
  const { run, pending } = useTx();
  const [connectError, setConnectError] = useState<string | null>(null);
  useEffect(() => {
    // Returning from the NEAR wallet? Adopt the key it approved before reading the stored wallet.
    loadConfig()
      .then(finishWalletConnect)
      .catch(() => null)
      .then((r) => {
        if (r?.error) setConnectError(r.error);
        setStored(loadStoredWallet("business"));
      });
  }, []);

  const wallet = useMemo(() => (config.data && stored ? walletFor("business", config.data, stored) : null), [config.data, stored]);
  const me = useAsync<Me | null>(
    async () => {
      if (!wallet) return null;
      await ensureSession(wallet);
      return api().me();
    },
    [wallet],
    { pollMs: 20_000 },
  );
  const summary = useAsync<Summary | null>(async () => (me.data?.business ? api().request("GET", "/v1/summary") : null), [me.data?.account_id, me.data?.business?.name], { pollMs: 10_000 });
  const refresh = useCallback(() => {
    me.reload();
    summary.reload();
  }, [me, summary]);

  if (config.error) return <ErrorState error={`Can't reach the Settle API (${config.error}).`} retry={config.reload} />;
  if (!config.data || stored === undefined) return <ShellSkeleton />;
  const cfg = config.data;
  if (!stored || (me.data && !me.data.business)) return (
      <Onboarding
        cfg={cfg}
        connected={stored && me.data ? stored.accountId : undefined}
        connectError={connectError}
        onReset={() => { storeWallet("business", null); setStored(null); }}
        onDone={() => { setStored(loadStoredWallet("business")); me.reload(); }}
      />
    );
  if (me.error && !me.data) return <ErrorState error={me.error} retry={me.reload} />;
  if (!me.data || !wallet) return <ShellSkeleton />;

  const s = summary.data ?? undefined;
  const billsBadge = (s?.attention.approvals.length ?? 0) + (s?.attention.bills_to_review.length ?? 0);
  const SECTIONS: Section[] = [
    { label: "Home", href: "/dashboard", pages: [["/dashboard", "Home"]], inNav: true },
    { label: "Receivables", href: "/dashboard/invoices", pages: [["/dashboard/invoices", "Invoices"], ["/dashboard/customers", "Customers"]], inNav: true },
    { label: "Payables", href: "/dashboard/bills", pages: [["/dashboard/bills", "Bills"]], badge: billsBadge, inNav: true },
    { label: "Payroll", href: "/dashboard/payroll", pages: [["/dashboard/payroll", "Pay runs"], ["/dashboard/people", "People"]], inNav: true },
    { label: "Money", href: "/dashboard/transactions", pages: [["/dashboard/transactions", "Transactions"], ["/dashboard/payouts", "Payouts & splits"], ["/dashboard/reports", "Reports"]], inNav: true },
    { label: "Account", href: "/dashboard/settings", pages: [["/dashboard/settings", "Settings"], ["/dashboard/developers", "Developers"]] },
  ];
  const current = SECTIONS.find((x) => x.pages.some(([h]) => isOn(path, h)));
  const home = path === "/dashboard";
  const signOut = () => { storeWallet("business", null); setStored(null); };

  return (
    <Ctx.Provider value={{ cfg, wallet, me: me.data, token: cfg.default_token, summary: s, refresh, reloadMe: refresh, openMoveMoney: (tab = "deposit") => setMove({ open: true, tab }) }}>
      <div data-theme={home ? "dark" : undefined} className={cn("z-30 w-full", home ? "absolute inset-x-0 top-0" : "sticky top-0 bg-background/80 backdrop-blur-xl")}>
        {cfg.network === "testnet" && (
          <div className="flex h-8 items-center justify-center gap-3 border-b border-[rgb(255_180_70/0.15)] bg-[rgb(255_180_70/0.06)] px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-warning/90">
            <span>Testnet · balances are test {cfg.default_token.symbol}, not real money</span>
            <button
              disabled={pending === "faucet"}
              onClick={() => run("faucet", "Added $5,000 test funds to your wallet", () => api(false).public.faucet(wallet.accountId, "5000")).then(refresh)}
              className="inline-flex items-center gap-1 font-medium text-warning underline-offset-4 hover:underline disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Droplets className="size-3.5" aria-hidden /> {pending === "faucet" ? "Adding…" : "Add test funds"}
            </button>
          </div>
        )}
        <header className="flex items-center gap-4 px-4 py-3.5 sm:px-8">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-ring">
            <Logo size={26} />
            <span className="hidden truncate border-l border-input pl-3 text-sm text-muted-foreground md:inline">{me.data.business?.name}</span>
          </Link>
          <nav aria-label="Dashboard" className="mx-auto flex min-w-0 gap-0.5 overflow-x-auto rounded-full bg-[var(--nav)] p-1 shadow-[inset_0_0_0_1px_var(--input)] backdrop-blur-md">
            {SECTIONS.filter((x) => x.inNav).map((x) => {
              const active = current === x;
              return (
                <Link
                  key={x.label}
                  href={x.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    active ? "bg-accent text-foreground shadow-[inset_0_0_0_1px_var(--input)]" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {x.label}
                  {!!x.badge && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warning px-1 font-mono text-[10px] font-semibold text-[var(--warning-foreground)] tnum" aria-label={`${x.badge} need attention`}>{x.badge}</span>}
                </Link>
              );
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden xl:inline-flex"><TokenChip symbol={cfg.default_token.symbol} network={cfg.network} /></span>
            <Button variant="secondary" size="sm" onClick={() => setMove({ open: true, tab: "deposit" })}>
              <ArrowLeftRight className="size-3.5" aria-hidden /> Move money
            </Button>
            <Link href="/dashboard/invoices?new=1" className="hidden h-8 items-center gap-1.5 rounded-full bg-[image:var(--pill)] px-3.5 text-[13px] font-medium text-primary-foreground shadow-[var(--pill-glow)] transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-flex">
              <Plus className="size-3.5" aria-hidden /> New invoice
            </Link>
            <ThemeToggle />
            <details className="group relative">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-1 rounded-full pl-1 pr-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden" aria-label="Account menu">
                <span className="grid size-6 place-items-center rounded-full bg-[radial-gradient(circle_at_50%_20%,#fff,#a9c8ff_55%,#5b8cff)] font-mono text-[10px] font-semibold text-[#020615]" aria-hidden>
                  {(me.data.business?.name ?? "S").slice(0, 1).toUpperCase()}
                </span>
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="glass absolute right-0 top-10 z-40 w-72 rounded-2xl p-2">
                <div className="flex items-center gap-1 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={wallet.accountId}>{wallet.accountId}</span>
                  <CopyButton value={wallet.accountId} label="Copy account id" />
                </div>
                <div className="my-1 h-px bg-border" />
                <Link href="/dashboard/settings" className="flex h-9 items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Settings className="size-4 text-muted-foreground" aria-hidden /> Settings</Link>
                <Link href="/dashboard/developers" className="flex h-9 items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Code2 className="size-4 text-muted-foreground" aria-hidden /> Developers</Link>
                <button onClick={signOut} className="flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><LogOut className="size-4 text-muted-foreground" aria-hidden /> Sign out</button>
              </div>
            </details>
          </div>
        </header>
        {!home && current && current.pages.length > 1 && (
          <nav aria-label={current.label} className="flex gap-1 overflow-x-auto px-4 pb-3 sm:px-8">
            <div className="mx-auto flex w-full max-w-6xl gap-1">
              {current.pages.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isOn(path, href) ? "page" : undefined}
                  className={cn(
                    "flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    isOn(path, href) ? "bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        )}
        {!home && <div className="h-px bg-gradient-to-r from-transparent via-[var(--input)] to-transparent" aria-hidden />}
      </div>
      {home ? children : (
        <main className="px-4 py-8 sm:px-8 lg:py-10">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      )}
      <MoveMoney key={`${move.tab}-${move.open}`} open={move.open} initial={move.tab} onClose={() => setMove((m) => ({ ...m, open: false }))} />
    </Ctx.Provider>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-dvh" role="status" aria-label="Loading dashboard">
      <div className="flex items-center gap-4 px-8 py-4">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="mx-auto h-11 w-[440px] rounded-full" />
        <Skeleton className="h-8 w-40 rounded-full" />
      </div>
      <div className="mx-auto max-w-6xl p-8">
        <Skeleton className="h-10 w-56" />
        <div className="mt-8 grid gap-4 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-[22px]" />)}</div>
      </div>
    </div>
  );
}
