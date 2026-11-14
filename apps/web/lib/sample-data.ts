// Static Rosa's Bakery snapshot shared by the /sample1–3 design explorations,
// so the three directions can be compared on identical content.

export const biz = { name: "Rosa's Bakery", owner: "Rosa", account: "rosas-bakery.settle.testnet" };

export const kpis = {
  cash: 18_420.5,
  cashDelta: 4.2, // % vs last 30d
  receivables: 2_310,
  overdue: 640,
  overdueCount: 1,
  billsDue14d: 2_215,
  netFlow30d: -1_284.1,
  inflow30d: 9_715.9,
  outflow30d: 11_000,
};

export const cashSeries = [16.1, 16.4, 15.9, 17.2, 17.8, 17.1, 19.4, 19.9, 18.8, 9.6, 10.2, 11.4, 12.9, 13.3, 14.8, 15.2, 16.9, 17.6, 18.1, 17.4, 18.42];

export type InvoiceStatus = "paid" | "open" | "overdue" | "partial";
export const invoices: { number: string; customer: string; amount: number; due: string; status: InvoiceStatus; via?: string; paid?: number }[] = [
  { number: "INV-0007", customer: "Café Nord", amount: 780, due: "Dec 12", status: "paid", via: "SOL · NEAR Intents", paid: 780 },
  { number: "INV-0006", customer: "Patel Wedding", amount: 1_200, due: "Dec 02", status: "partial", paid: 600 },
  { number: "INV-0005", customer: "Hotel Lumen", amount: 640, due: "Oct 28", status: "overdue" },
  { number: "INV-0004", customer: "Green Leaf Co-op", amount: 870, due: "Nov 30", status: "open" },
  { number: "INV-0003", customer: "Café Nord", amount: 420, due: "Nov 01", status: "paid", via: "USDC", paid: 420 },
  { number: "INV-0002", customer: "Morning Table", amount: 1_150, due: "Oct 20", status: "paid", via: "ETH · NEAR Intents", paid: 1_150 },
];

export const attention = [
  { kind: "approval" as const, title: "Approve Oven Repair Co.", sub: "Over $1,000 autopay limit", amount: 1_850 },
  { kind: "review" as const, title: "Review bill from Golden Mills", sub: "New payment account · urgent wording", amount: 2_400 },
  { kind: "overdue" as const, title: "INV-0005 · Hotel Lumen", sub: "15 days overdue", amount: 640 },
];

export const aging = [
  { label: "Current", value: 1_470 },
  { label: "1–30", value: 640 },
  { label: "31–60", value: 200 },
  { label: "61–90", value: 0 },
  { label: "90+", value: 0 },
];

export const people = [
  { name: "Chloé Martin", role: "Head baker", amount: 3_800, method: "Streaming", initials: "CM" },
  { name: "Diego Alvarez", role: "Pastry chef", amount: 2_900, method: "Monthly", initials: "DA" },
  { name: "Priya Shah", role: "Front of house", amount: 2_100, method: "Monthly", initials: "PS" },
  { name: "Sam Okafor", role: "Delivery", amount: 1_400, method: "Monthly", initials: "SO" },
];

export const payRuns = [
  { period: "November 2026", date: "Nov 28", total: 10_200, people: 4, status: "Paid" },
  { period: "October 2026", date: "Oct 31", total: 10_200, people: 4, status: "Paid" },
  { period: "September 2026", date: "Sep 30", total: 9_650, people: 4, status: "Paid" },
];

export const transactions = [
  { date: "Nov 12", desc: "Café Nord · INV-0007", category: "Customer payments", amount: 776.1, via: "SOL → sUSD" },
  { date: "Nov 12", desc: "Oven Repair Co.", category: "Vendor payments", amount: -1_850 },
  { date: "Nov 11", desc: "Golden Mills · Flour", category: "Vendor payments", amount: -640, via: "AI autopay" },
  { date: "Nov 10", desc: "Patel Wedding · INV-0006", category: "Customer payments", amount: 597 },
  { date: "Nov 08", desc: "City Power · Electricity", category: "Vendor payments", amount: -315 },
  { date: "Nov 05", desc: "Payout to sam@…", category: "Payouts", amount: -150 },
  { date: "Oct 31", desc: "October payroll · 4 people", category: "Payroll", amount: -10_200 },
];

export const autopay = { on: true, perTx: 1_000, daily: 3_000, spentToday: 640 };

export const usd = (n: number, signed = false) => {
  const s = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  return n < 0 ? `−${s}` : signed && n > 0 ? `+${s}` : s;
};
export const usd0 = (n: number) => Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
