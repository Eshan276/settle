use crate::*;
use near_sdk::serde_json::json;

#[near]
impl Settle {
    /// Authorize an AI agent (or any automated account) to spend from the caller's balance
    /// within `policy`. The agent should hold only a function-call access key restricted to
    /// `agent_pay` / `agent_pay_invoice` on this contract.
    #[payable]
    pub fn set_agent_policy(&mut self, agent_id: AccountId, policy: AgentPolicy) {
        near_sdk::assert_one_yocto();
        let business = env::predecessor_account_id();
        self.assert_business(&business);
        require!(policy.approval_threshold.0 <= policy.per_tx_limit.0, "approval_threshold must be <= per_tx_limit");
        require!(policy.label.len() <= 64, "Label too long");
        self.agents.insert((business.clone(), agent_id.clone()), policy.clone());
        events::emit("agent_policy_set", json!({ "business": business, "agent_id": agent_id, "policy": policy }));
    }

    #[payable]
    pub fn remove_agent(&mut self, agent_id: AccountId) {
        near_sdk::assert_one_yocto();
        let business = env::predecessor_account_id();
        self.agents.remove(&(business.clone(), agent_id.clone()));
        events::emit("agent_removed", json!({ "business": business, "agent_id": agent_id }));
    }

    /// Agent-initiated payment to any account. Executes immediately when within policy,
    /// otherwise queues a human approval.
    pub fn agent_pay(
        &mut self,
        business: AccountId,
        token: TokenId,
        recipient: AccountId,
        amount: U128,
        memo: Option<String>,
    ) -> AgentPayResult {
        let agent = env::predecessor_account_id();
        self.assert_token(&token);
        self.agent_request(business, agent, token, recipient, amount.0, None, memo.unwrap_or_default())
    }

    /// Agent-initiated payment of the remaining balance of a Settle invoice (e.g. a vendor bill).
    pub fn agent_pay_invoice(&mut self, business: AccountId, invoice_id: u64, memo: Option<String>) -> AgentPayResult {
        let agent = env::predecessor_account_id();
        let invoice = self.invoices.get(&invoice_id).expect("Invoice not found").clone();
        require!(invoice.status == InvoiceStatus::Open, "Invoice is not open");
        let remaining = invoice.amount.0 - invoice.amount_paid.0;
        self.agent_request(
            business,
            agent,
            invoice.token,
            invoice.business,
            remaining,
            Some(invoice_id),
            memo.unwrap_or_else(|| invoice.reference.clone()),
        )
    }

    /// Human approves a queued agent payment. Executes it from the business balance.
    #[payable]
    pub fn approve_payment(&mut self, approval_id: u64) {
        near_sdk::assert_one_yocto();
        let approval = self.approvals.get(&approval_id).expect("Approval not found").clone();
        require!(approval.business == env::predecessor_account_id(), "Not your approval");
        require!(approval.status == ApprovalStatus::Pending, "Approval already decided");
        {
            let a = self.approvals.get_mut(&approval_id).unwrap();
            a.status = ApprovalStatus::Approved;
            a.decided_at = Some(now_secs());
        }
        self.execute_payment(
            &approval.business,
            &approval.token,
            &approval.recipient,
            approval.amount.0,
            approval.invoice_id,
        );
        events::emit(
            "approval_approved",
            json!({ "approval_id": approval_id, "business": approval.business, "agent": approval.agent, "recipient": approval.recipient, "amount": approval.amount, "token": approval.token }),
        );
    }

    pub fn reject_payment(&mut self, approval_id: u64) {
        let approval = self.approvals.get(&approval_id).expect("Approval not found").clone();
        require!(approval.business == env::predecessor_account_id(), "Not your approval");
        require!(approval.status == ApprovalStatus::Pending, "Approval already decided");
        let a = self.approvals.get_mut(&approval_id).unwrap();
        a.status = ApprovalStatus::Rejected;
        a.decided_at = Some(now_secs());
        events::emit("approval_rejected", json!({ "approval_id": approval_id, "business": approval.business }));
    }
}

impl Settle {
    #[allow(clippy::too_many_arguments)]
    fn agent_request(
        &mut self,
        business: AccountId,
        agent: AccountId,
        token: TokenId,
        recipient: AccountId,
        amount: u128,
        invoice_id: Option<u64>,
        memo: String,
    ) -> AgentPayResult {
        let key = (business.clone(), agent.clone());
        let policy = self.agents.get(&key).cloned().unwrap_or_else(|| env::panic_str("Agent is not authorized by this business"));
        require!(policy.active, "Agent is paused");
        require!(amount > 0, "Amount must be positive");
        require!(amount <= policy.per_tx_limit.0, "Exceeds the agent's per-transaction hard limit");
        require!(memo.len() <= MAX_REFERENCE_LEN, "Memo too long");

        let today = now_secs() / SECONDS_PER_DAY;
        let spent_today = match self.agent_spend.get(&key) {
            Some(s) if s.day == today => s.spent,
            _ => 0,
        };

        let mut reasons = Vec::new();
        if amount > policy.approval_threshold.0 {
            reasons.push("amount_above_approval_threshold".to_string());
        }
        if spent_today + amount > policy.daily_limit.0 {
            reasons.push("daily_limit_exceeded".to_string());
        }
        if let Some(list) = &policy.allowed_recipients {
            if !list.contains(&recipient) {
                reasons.push("recipient_not_allowlisted".to_string());
            }
        }

        if !reasons.is_empty() {
            let id = self.take_id();
            self.approvals.insert(
                id,
                Approval {
                    id,
                    business: business.clone(),
                    agent: agent.clone(),
                    token: token.clone(),
                    recipient: recipient.clone(),
                    amount: U128(amount),
                    invoice_id,
                    memo: memo.clone(),
                    reasons: reasons.clone(),
                    status: ApprovalStatus::Pending,
                    created_at: now_secs(),
                    decided_at: None,
                },
            );
            events::emit(
                "approval_requested",
                json!({ "approval_id": id, "business": business, "agent": agent, "recipient": recipient, "amount": U128(amount), "token": token, "invoice_id": invoice_id, "memo": memo, "reasons": reasons }),
            );
            return AgentPayResult { status: "pending_approval".into(), approval_id: Some(id), reasons };
        }

        self.execute_payment(&business, &token, &recipient, amount, invoice_id);
        self.agent_spend.insert(key, DailySpend { day: today, spent: spent_today + amount });
        events::emit(
            "agent_payment",
            json!({ "business": business, "agent": agent, "recipient": recipient, "amount": U128(amount), "token": token, "invoice_id": invoice_id, "memo": memo }),
        );
        AgentPayResult { status: "paid".into(), approval_id: None, reasons }
    }

    /// Move funds from the business balance to a recipient or into an invoice.
    pub(crate) fn execute_payment(
        &mut self,
        business: &AccountId,
        token: &TokenId,
        recipient: &AccountId,
        amount: u128,
        invoice_id: Option<u64>,
    ) {
        self.debit(business, token, amount);
        match invoice_id {
            Some(id) => {
                let used = self.apply_invoice_payment(id, business, token, amount);
                self.credit(business, token, amount - used);
            }
            None => self.credit(recipient, token, amount),
        }
    }
}
