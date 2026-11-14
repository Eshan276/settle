use crate::*;
use near_sdk::PublicKey;

const DEFAULT_LIMIT: u32 = 50;
const MAX_LIMIT: u32 = 200;

fn page(from_index: Option<u32>, limit: Option<u32>) -> (usize, usize) {
    (from_index.unwrap_or(0) as usize, limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize)
}

#[near]
impl Settle {
    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            fee_bps: self.fee_bps,
            fee_collector: self.fee_collector.clone(),
            tokens: self.tokens.iter().cloned().collect(),
        }
    }

    pub fn get_business(&self, account_id: AccountId) -> Option<Business> {
        self.businesses.get(&account_id).cloned()
    }

    pub fn is_operator(&self, business: AccountId, operator: AccountId) -> bool {
        self.operators.contains(&(business, operator))
    }

    pub fn get_balance(&self, account_id: AccountId, token: TokenId) -> U128 {
        U128(self.balance_of(&account_id, &token))
    }

    /// Balances across every accepted token.
    pub fn get_balances(&self, account_id: AccountId) -> Vec<(TokenId, U128)> {
        self.tokens.iter().map(|t| (t.clone(), U128(self.balance_of(&account_id, t)))).collect()
    }

    pub fn get_invoice(&self, invoice_id: u64) -> Option<Invoice> {
        self.invoices.get(&invoice_id).cloned()
    }

    pub fn get_invoices(&self, business: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let (skip, take) = page(from_index, limit);
        self.invoices.values().filter(|i| i.business == business).skip(skip).take(take).cloned().collect()
    }

    pub fn get_split(&self, split_id: u64) -> Option<Split> {
        self.splits.get(&split_id).cloned()
    }

    pub fn get_splits(&self, business: AccountId) -> Vec<Split> {
        self.splits.values().filter(|s| s.business == business).take(MAX_LIMIT as usize).cloned().collect()
    }

    pub fn get_stream(&self, stream_id: u64) -> Option<StreamView> {
        self.streams.get(&stream_id).map(|s| self.stream_view(s))
    }

    /// Streams where `account_id` is the employer or the employee.
    pub fn get_streams(&self, account_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<StreamView> {
        let (skip, take) = page(from_index, limit);
        self.streams
            .values()
            .filter(|s| s.employer == account_id || s.employee == account_id)
            .skip(skip)
            .take(take)
            .map(|s| self.stream_view(s))
            .collect()
    }

    pub fn get_subscription(&self, subscription_id: u64) -> Option<Subscription> {
        self.subscriptions.get(&subscription_id).cloned()
    }

    /// Subscriptions where `account_id` is the merchant or the subscriber.
    pub fn get_subscriptions(&self, account_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<Subscription> {
        let (skip, take) = page(from_index, limit);
        self.subscriptions
            .values()
            .filter(|s| s.merchant == account_id || s.subscriber == account_id)
            .skip(skip)
            .take(take)
            .cloned()
            .collect()
    }

    /// Subscriptions with a cycle due now (for keepers / cron).
    pub fn get_due_subscriptions(&self, limit: Option<u32>) -> Vec<u64> {
        let now = now_secs();
        self.subscriptions
            .values()
            .filter(|s| s.status == SubscriptionStatus::Active && s.next_charge_at <= now)
            .take(limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize)
            .map(|s| s.id)
            .collect()
    }

    pub fn get_agent_policy(&self, business: AccountId, agent_id: AccountId) -> Option<AgentPolicy> {
        self.agents.get(&(business, agent_id)).cloned()
    }

    pub fn get_agents(&self, business: AccountId) -> Vec<(AccountId, AgentPolicy)> {
        self.agents
            .iter()
            .filter(|((b, _), _)| *b == business)
            .map(|((_, a), p)| (a.clone(), p.clone()))
            .collect()
    }

    pub fn get_agent_spent_today(&self, business: AccountId, agent_id: AccountId) -> U128 {
        let today = now_secs() / SECONDS_PER_DAY;
        match self.agent_spend.get(&(business, agent_id)) {
            Some(s) if s.day == today => U128(s.spent),
            _ => U128(0),
        }
    }

    pub fn get_approval(&self, approval_id: u64) -> Option<Approval> {
        self.approvals.get(&approval_id).cloned()
    }

    pub fn get_approvals(&self, business: AccountId, status: Option<ApprovalStatus>, from_index: Option<u32>, limit: Option<u32>) -> Vec<Approval> {
        let (skip, take) = page(from_index, limit);
        self.approvals
            .values()
            .filter(|a| a.business == business && status.map_or(true, |s| a.status == s))
            .skip(skip)
            .take(take)
            .cloned()
            .collect()
    }

    pub fn get_claim(&self, public_key: PublicKey) -> Option<Claim> {
        self.claims.get(&String::from(&public_key)).cloned()
    }
}

impl Settle {
    fn stream_view(&self, s: &Stream) -> StreamView {
        let accrued = Self::stream_accrued(s, now_secs());
        StreamView { stream: s.clone(), accrued: U128(accrued), available: U128(accrued - s.withdrawn.0) }
    }
}
