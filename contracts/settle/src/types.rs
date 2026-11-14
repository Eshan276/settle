use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

pub type TokenId = AccountId;

pub const MAX_REFERENCE_LEN: usize = 256;
pub const MAX_BATCH: usize = 100;
pub const MAX_SPLIT_RECIPIENTS: usize = 10;
pub const BPS_DENOMINATOR: u128 = 10_000;
pub const SECONDS_PER_DAY: u64 = 86_400;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Business {
    pub name: String,
    pub created_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceKind {
    /// A bill sent to a customer. Stays payable after `due_at` (it is just overdue).
    Invoice,
    /// A checkout session. Not payable after `due_at` (it expires).
    Checkout,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceStatus {
    Open,
    Paid,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Invoice {
    pub id: u64,
    pub business: AccountId,
    pub kind: InvoiceKind,
    pub token: TokenId,
    pub amount: U128,
    pub amount_paid: U128,
    pub status: InvoiceStatus,
    /// Free-form reference (e.g. the off-chain invoice number or order id).
    pub reference: String,
    pub split_id: Option<u64>,
    pub created_at: u64,
    pub due_at: Option<u64>,
    pub paid_at: Option<u64>,
    pub last_payer: Option<AccountId>,
    pub payment_count: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SplitRecipient {
    pub account_id: AccountId,
    /// Share in basis points (1/100th of a percent). The remainder goes to the business.
    pub bps: u16,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Split {
    pub id: u64,
    pub business: AccountId,
    pub name: String,
    pub recipients: Vec<SplitRecipient>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PayrollEntry {
    pub account_id: AccountId,
    pub amount: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Stream {
    pub id: u64,
    pub employer: AccountId,
    pub employee: AccountId,
    pub token: TokenId,
    pub total: U128,
    pub withdrawn: U128,
    pub start_at: u64,
    pub duration_secs: u64,
    pub cancelled_at: Option<u64>,
    pub memo: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StreamView {
    #[serde(flatten)]
    pub stream: Stream,
    /// Total earned so far (vested), including what was already withdrawn.
    pub accrued: U128,
    /// Earned and not yet withdrawn.
    pub available: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionStatus {
    Active,
    PastDue,
    Cancelled,
    Completed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Subscription {
    pub id: u64,
    pub subscriber: AccountId,
    pub merchant: AccountId,
    pub token: TokenId,
    pub amount: U128,
    pub interval_secs: u64,
    pub next_charge_at: u64,
    pub cycles_charged: u32,
    pub max_cycles: Option<u32>,
    pub status: SubscriptionStatus,
    pub created_at: u64,
    pub reference: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentPolicy {
    /// Hard cap. Requests above this are rejected outright.
    pub per_tx_limit: U128,
    /// Rolling UTC-day budget. Requests that would exceed it go to human approval.
    pub daily_limit: U128,
    /// Requests above this amount go to human approval.
    pub approval_threshold: U128,
    /// If set, payments to anyone else go to human approval.
    pub allowed_recipients: Option<Vec<AccountId>>,
    pub label: String,
    pub active: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct DailySpend {
    pub day: u64,
    pub spent: u128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Approval {
    pub id: u64,
    pub business: AccountId,
    pub agent: AccountId,
    pub token: TokenId,
    pub recipient: AccountId,
    pub amount: U128,
    pub invoice_id: Option<u64>,
    pub memo: String,
    pub reasons: Vec<String>,
    pub status: ApprovalStatus,
    pub created_at: u64,
    pub decided_at: Option<u64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentPayResult {
    /// "paid" or "pending_approval"
    pub status: String,
    pub approval_id: Option<u64>,
    pub reasons: Vec<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub public_key: String,
    pub creator: AccountId,
    pub token: TokenId,
    pub amount: U128,
    pub created_at: u64,
    pub expires_at: Option<u64>,
    pub memo: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub owner_id: AccountId,
    pub fee_bps: u16,
    pub fee_collector: AccountId,
    pub tokens: Vec<TokenId>,
}

/// `msg` payload accepted by `ft_on_transfer`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TransferMsg {
    /// Top up an internal Settle balance (defaults to the sender).
    Deposit { account_id: Option<AccountId> },
    /// Pay (or partially pay) an invoice / checkout session. Any excess is refunded.
    PayInvoice {
        invoice_id: u64,
        /// Who the payment is on behalf of (informational; e.g. the original payer of a cross-chain intent).
        payer: Option<AccountId>,
    },
    /// Deposit and start a recurring pull-payment subscription in one step. The first cycle is charged immediately.
    Subscribe {
        merchant: AccountId,
        amount: U128,
        interval_secs: u64,
        max_cycles: Option<u32>,
        reference: Option<String>,
    },
}
