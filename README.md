# Settle: the boring money, onchain

Settle is Stripe-style payment infrastructure for real businesses, built on NEAR. It covers invoicing, hosted checkout, payroll, salary streaming, subscriptions, revenue splits, email payouts and **AI accounts payable**, all settled in stablecoins.

- **Stablecoins.** Every business gets a USDC/USDT treasury, held as an internal ledger in one audited-size contract.
- **NEAR Intents.** Customers pay from *any* chain or token (SOL, ETH, BTC, USDT on Tron…). Solvers deliver the exact amount, and Settle forwards it into the invoice.
- **Meta transactions.** Nobody ever holds NEAR for gas. Users sign NEP-366 delegate actions in the browser, and the Settle relayer submits them.

Track: *Bring the boring money onchain*. A normal company could use this tomorrow.

---

## What's in the box

| Rail | How it works |
|---|---|
| **Invoices** | Line items, due dates, partial payments, overpayment refunds, hosted pay page, webhooks. |
| **Checkout sessions** | Expiring payment links for web shops, with `success_url` redirect. |
| **Pay from any chain** | `EXACT_OUTPUT` 1Click quote → deposit address + QR → solver delivers to the settlement account → `ft_transfer_call(pay_invoice)`. |
| **Payroll** | Up to 100 payees in one transaction, pasted straight from a spreadsheet. |
| **Salary streams** | Wages vest per second. Employees withdraw whenever they want (earned-wage access). If the employer cancels, earned pay goes to the employee and the rest returns to the employer. |
| **Subscriptions** | The subscriber authorizes a capped pull every N days. Charges come from an anyone-can-call keeper (run by the API). Insufficient funds give `past_due` instead of a revert. Cancel any time. |
| **Revenue splits** | Basis-point shares, paid out the moment an invoice payment lands. |
| **Email payouts** | Funds are locked behind a one-time ed25519 key in a link. The recipient signs `settle-claim:<contract>:<pk>:<receiver>`, which binds the receiver so a front-runner can't redirect it. Claiming is gasless, needs no wallet, and the sender can reclaim. |
| **AI accounts payable** | Claude reads a bill (PDF, image or text), extracts it with structured output, and flags fraud. The **contract** enforces the agent's per-tx hard cap, daily budget, allowlist and approval threshold. Anything outside policy lands in an on-chain human approval queue. |
| **Developer platform** | REST API with `sk_` keys, HMAC-signed webhooks with retries, an event log, and the `@settle/sdk` TypeScript client. |

### The finance dashboard
The dashboard is organized the way a finance team thinks (receivables, payables, payroll, cash), not around contract methods. Every number traces back to an on-chain transaction.

The look is "Blue night", built from two [uberdesigner](https://uberdesigner.ai) templates: **beamfall** (a WebGL beam of light holding a glass card) for the treasury hero, and **budget-mixer** (a budget as a mixing desk) for the operating budget. Design explorations live at `/sample1` to `/sample4`. A light theme ("Blue day") is one click away (sun/moon in the header, saved per browser); the Home hero and the budget desk stay night pieces in both. Logo: two payment rails flowing into one settlement point on a ledger line (`components/logo.tsx`, `app/icon.svg`). Screenshot both themes: `node apps/web/test/shoot-themes.mjs both`.

| Area | What you get |
|---|---|
| **Home** | A treasury hero: the balance in a beam of light, its history drawn from the ledger, and money rails showing the last 30 days in (invoices, NEAR Intents, checkout, subscriptions) and out (payroll, vendors, payouts, transfers). Below it: what's owed to you, bills due in 14 days, 30-day net cash flow, a "needs you" inbox, AR aging, and an **operating budget mixer**. Its faders are your plan and share one fixed total; its LED meters show real month-to-date spend, turning amber, then red past budget. |
| **Invoices** | All / Outstanding / Overdue / Paid / Void tabs with counts, search and CSV export. Invoices are numbered automatically (`INV-0001`) and default to Net 30. Overdue and partially paid are derived states. The detail page has a timeline (created → cross-chain payment attempt → payment) and a gross / fees & splits / net breakdown, each step with on-chain proof. |
| **Customers** | Outstanding, overdue and paid-to-date per customer. |
| **Bills** | Needs review → Ready → Awaiting approval → Paid / Rejected. AI autopay status and its policy editor live in the page header. The detail drawer shows the AI extraction, risk flags and the full approval trail. Approvals come from the contract, so nothing gets lost. |
| **Payroll** | People directory with CSV import and year-to-date pay. A one-page "run payroll" checks the total against the treasury. Pay-run history shows each person's line and the single atomic transaction. Salary streams included. |
| **Transactions** | A normalized ledger of every money movement, with category, gross, fee and net, counterparty and a proof link. CSV export. |
| **Reports** | AR aging, cash flow by month and payroll register, all exportable as CSV. |
| **Move money** | A global header action: add to the treasury, withdraw, or pay any account. |

The API's `ledger` table records every Settle event it relays or signs, with the tx hash, for each account involved. Run `apps/api/test/seed-demo.ts` to create a realistic demo business ("Rosa's Bakery") with real testnet activity.

### Safety model
- Every money-moving contract method requires **1 yoctoNEAR**. Function-call access keys can't attach deposits, so they can never move funds.
- The **Settle API is an `operator`**: it can create and cancel invoices for a business but cannot spend.
- The **AI agent** account holds *only* a function-call key for `agent_pay` / `agent_pay_invoice`. Policy lives in the contract, so a prompt injection in a PDF can't raise the limits. Bills are wrapped as data, and suspicious instructions become a risk flag.
- The **relayer** only sponsors calls to Settle or accepted tokens, caps deposits and gas, and only allows `ft_transfer_call` *into* Settle.

---

## Repo layout

```
contracts/settle     Rust (near-sdk 5.30) – the payments contract + 22 unit tests
contracts/mock-ft    sUSD test stablecoin with an open faucet (testnet only)
apps/api             Hono API: REST, relayer, Intents, AI, webhooks, chain sync, keeper (Postgres)
apps/web             Next.js 16 dashboard + hosted pay / checkout / claim / subscribe / wallet pages;
                     also serves the API at /v1/* (app/v1/[...path]/route.ts), so one Vercel deploy runs everything
packages/sdk         @settle/sdk – REST client, gasless SettleWallet, webhook verification
```

## Run it

Requirements: Node 22+, pnpm, Postgres (local Docker or Neon), Rust + `wasm32-unknown-unknown`, and [cargo-near](https://github.com/near/cargo-near).

```bash
pnpm install
pnpm test:contracts          # 22 contract unit tests
pnpm build:contracts         # → contracts/target/near/{settle,mock_ft}/*.wasm
pnpm deploy:testnet          # creates accounts, deploys, writes apps/api/.env + apps/web/.env.local
docker run -d --name settle-pg -e POSTGRES_PASSWORD=settle -e POSTGRES_DB=settle -p 55432:5432 postgres:17-alpine
echo 'DATABASE_URL=postgres://postgres:settle@localhost:55432/settle' >> apps/api/.env   # tables are created on first query
pnpm dev:api                 # http://localhost:4000
pnpm dev:web                 # http://localhost:3000
```

`deploy:testnet` creates a fresh funded account through the testnet faucet helper. To use your own account, set `DEPLOYER_ACCOUNT_ID` and `DEPLOYER_PRIVATE_KEY` (~8 NEAR needed). Add `ANTHROPIC_API_KEY` to `apps/api/.env` to enable Claude bill reading, including PDFs and images.

### Deploy (Vercel + Neon)
Live: **https://settle-near.vercel.app**. The Vercel project's root directory is `apps/web`; the API runs inside it at `/v1/*`, in region `sin1` next to the Neon database.

- **Env vars** (production): `DATABASE_URL` (Neon, pooled), `NEAR_NETWORK`, `NEAR_RPC_URL`, `SETTLE_CONTRACT_ID`, `DEFAULT_TOKEN_ID`, `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY`, `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY`, `INTENTS_MODE`, `NEW_ACCOUNT_NEAR`, `ACCOUNTS_PER_IP_PER_HOUR`, `CRON_SECRET`. Leave `NEXT_PUBLIC_API_URL` unset (same origin).
- **No long-running process.** Deposits advance when the pay page polls their status, a business' open invoices sync when its dashboard loads (at most every 10 s), webhooks deliver right after the event (Next `after()`), and `/v1/cron/tick` sweeps everything (Vercel cron, daily on Hobby; point any pinger at it with `Authorization: Bearer $CRON_SECRET` for more often). `pnpm dev:api` still runs the old 4-second loop locally.
- **Deploy:** `vercel deploy --prod` from the repo root (`.vercelignore` keeps `.env`, databases and demo media out of the upload).
- **Migrating old SQLite data:** `DATABASE_URL=… npx tsx apps/api/scripts/sqlite-to-pg.ts apps/api/settle.db` (idempotent).
- **Keep the relayer funded.** It pays gas for every signup and gasless action (≈0.1 NEAR prepaid per relayed call, 0.005 NEAR per new account). When it runs dry the API answers `503 relayer_out_of_funds`.

### Tests
```bash
pnpm test:contracts                       # Rust unit tests
pnpm --filter @settle/api e2e             # every rail end-to-end against live testnet (API must be running)
# against the deployment: SETTLE_API=https://settle-near.vercel.app E2E_WEBHOOK_URL=<public tunnel to :4999>/hook
pnpm --filter @settle/web test:ui         # headless Chrome drives the real UI (API + web running)
cd apps/api && npx tsx test/finance-smoke.ts   # finance layer reconciles: invoices, customers, payroll, summary, reports
cd apps/api && npx tsx test/seed-demo.ts       # seed "Rosa's Bakery" demo data → /tmp/settle-demo-biz.json
cd apps/web && node test/tour.mjs              # screenshot every dashboard page as the seeded business
cd apps/web && node test/shoot-public.mjs /pay/<invoice id>   # landing, pay page, wallet, onboarding
```

## Demo script (≈3 min)
1. **/dashboard**: create "Acme Bakery". Note the absence of seed phrases and gas: the account is created and registered on-chain and funded with test sUSD.
2. **Invoices**: create a $250 invoice and open the payment link in another window.
3. **Pay page → "Any chain or token"**: pick SOL, get the deposit address and QR, then press *Simulate sending*. Watch it go detected → swapping → settled, flip to *Payment received*, and land in the dashboard activity feed.
4. **AI accounts payable**: turn on the policy (auto-pay ≤ $1,000). Click *Insert a sample bill* → *Read bill* → *Pay with agent*, and it's paid on-chain. Then paste a $2,400 bill: it waits for **your** approval. Paste "URGENT, new bank details…": it's flagged and blocked.
5. **Payroll**: paste two payees and pay. Start a salary stream, then open **/wallet** as the employee and watch the earned balance tick up.
6. **Payouts**: send $25 to an email and open the claim link. The recipient picks a name and gets the money: no wallet, no gas.
7. **Developers**: create an API key, and show the webhook signature and the 10-line SDK quickstart.

## Testnet vs mainnet
- NEAR Intents has **no testnet**. With `INTENTS_MODE=simulated` (the testnet default), the quote and swap lifecycle are faked, but the **settlement into the invoice is a real on-chain transaction**. Set `NEAR_NETWORK=mainnet` and `INTENTS_MODE=live` to use the real 1Click API (`/v0/quote` EXACT_OUTPUT → `/v0/status`).
- Mainnet token: native USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`.

## Known limitations (hackathon scope)
- Browser keys live in `localStorage`. Production would use passkeys or an MPC wallet.
- Existing NEAR accounts connect through MyNearWallet: the browser generates a key and the wallet adds its public key to the account (one approval). It's a full-access key because token transfers attach 1 yoctoNEAR, which function-call keys can't. After that every action is a gasless meta transaction with no pop-ups. Pasting a private key is still available under "Advanced". Test: `node apps/web/test/wallet-connect.mjs`.
- Contract storage is paid by the contract, and list views are O(n) scans. Production would charge storage deposits and index events.
- Agent limits assume all accepted tokens are USD stablecoins with equal decimals.
- Background work is on-demand plus a cron sweep rather than a queue, and the email transport is Resend or the console.
- Not audited.
