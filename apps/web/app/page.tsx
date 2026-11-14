import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const RAILS = [
  ["Invoices & checkout", "Hosted payment pages. Customers pay from any chain or token through NEAR Intents, and you receive exact stablecoins."],
  ["Payroll & salary streams", "Pay 100 people in one transaction, or stream wages by the second so employees can withdraw any day."],
  ["AI accounts payable", "Forward a bill and Claude reads it, flags fraud, and pays it within limits enforced by the contract."],
  ["Email payouts", "Send money to an email address. The recipient claims it with no wallet, no seed phrase and no gas."],
  ["Subscriptions", "Capped recurring pull payments the customer can cancel in one click. Past-due handling included."],
  ["Revenue splits", "Partners, co-founders and marketplace sellers get their share the moment a payment lands."],
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-6">
      <header className="flex h-16 items-center justify-between">
        <Logo size={26} />
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link href="/wallet" className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Wallet</Link>
          <Link href="/dashboard" className="rounded-md px-3 py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">Dashboard</Link>
          <ThemeToggle />
        </nav>
      </header>

      <section className="grid gap-10 py-20 lg:grid-cols-[1.2fr_1fr] lg:py-28">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Stablecoins · NEAR Intents · Meta transactions</p>
          <h1 className="mt-5 text-5xl font-light leading-[1.02] tracking-[-0.04em] text-balance sm:text-7xl">The boring money, onchain.</h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground text-pretty">
            Settle is payment infrastructure a normal company can use tomorrow: invoicing, checkout, payroll, payouts and accounts payable in stablecoins. No gas, no seed phrases, and payable from any chain.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="inline-flex h-12 items-center gap-2 rounded-full bg-[image:var(--pill)] px-5 font-medium text-primary-foreground shadow-[var(--pill-glow)] transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              Open a business account <ArrowRight className="size-4" aria-hidden />
            </Link>
            <a href="#rails" className="inline-flex h-12 items-center rounded-full bg-muted px-5 font-medium shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">What's included</a>
          </div>
        </div>
        <div className="glass rounded-[22px] p-6 font-mono text-[13px] leading-relaxed">
          <p className="text-muted-foreground">// 3 lines to get paid from any chain</p>
          <p className="mt-3"><span className="text-primary">const</span> invoice = <span className="text-primary">await</span> settle.invoices.create({"{"}</p>
          <p className="pl-4">customer_email: <span className="text-accent-foreground">"ap@cafe.com"</span>,</p>
          <p className="pl-4">amount: <span className="text-accent-foreground">"250.50"</span>,</p>
          <p>{"}"});</p>
          <p className="mt-3 text-muted-foreground">// → invoice.hosted_url</p>
          <p className="text-muted-foreground">// customer pays in SOL, ETH, BTC, USDT…</p>
          <p className="text-muted-foreground">// you receive 250.50 USDC on NEAR</p>
          <p className="mt-3"><span className="text-primary">on</span>(<span className="text-accent-foreground">"invoice.paid"</span>, ship)</p>
        </div>
      </section>

      <section id="rails" aria-labelledby="rails-h" className="border-t py-16">
        <h2 id="rails-h" className="text-2xl font-semibold tracking-tight">One account. Every money movement a business needs.</h2>
        <div className="mt-8 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {RAILS.map(([t, d]) => (
            <div key={t} className="bg-card p-6">
              <h3 className="font-medium">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="trust-h" className="grid gap-8 border-t py-16 md:grid-cols-3">
        <h2 id="trust-h" className="text-2xl font-semibold tracking-tight">Safe by construction</h2>
        <p className="text-sm text-muted-foreground">Every money-moving call needs your full-access key. The Settle API and the AI agent hold function-call keys, so they can bill and propose payments but never withdraw.</p>
        <p className="text-sm text-muted-foreground">Agent spending limits, allowlists and approval thresholds live in the smart contract. A prompt injection in a PDF can't raise them.</p>
      </section>

      <footer className="border-t py-8 text-sm text-muted-foreground">Built on NEAR for the “Bring the boring money onchain” track.</footer>
    </div>
  );
}
