use crate::*;
use near_sdk::serde_json::json;

#[near]
impl Settle {
    /// Authorize `merchant` to pull `amount` every `interval_secs` from the caller's Settle
    /// balance. The first cycle is charged immediately. Cancel any time.
    #[payable]
    pub fn create_subscription(
        &mut self,
        merchant: AccountId,
        token: TokenId,
        amount: U128,
        interval_secs: u64,
        max_cycles: Option<u32>,
        reference: Option<String>,
    ) -> u64 {
        near_sdk::assert_one_yocto();
        self.internal_create_subscription(
            env::predecessor_account_id(),
            merchant,
            token,
            amount.0,
            interval_secs,
            max_cycles,
            reference.unwrap_or_default(),
        )
    }

    /// Charge a subscription if a cycle is due. Callable by anyone (merchant, keeper, cron).
    /// Never panics on insufficient funds: the subscription is marked `past_due` instead.
    pub fn charge_subscription(&mut self, subscription_id: u64) -> bool {
        let sub = self.subscriptions.get(&subscription_id).expect("Subscription not found").clone();
        require!(
            matches!(sub.status, SubscriptionStatus::Active | SubscriptionStatus::PastDue),
            "Subscription is not chargeable"
        );
        require!(now_secs() >= sub.next_charge_at, "Next cycle not due yet");
        self.internal_charge(subscription_id)
    }

    pub fn cancel_subscription(&mut self, subscription_id: u64) {
        let sub = self.subscriptions.get(&subscription_id).expect("Subscription not found").clone();
        let caller = env::predecessor_account_id();
        require!(caller == sub.subscriber || caller == sub.merchant, "Only subscriber or merchant can cancel");
        require!(
            matches!(sub.status, SubscriptionStatus::Active | SubscriptionStatus::PastDue),
            "Subscription already ended"
        );
        self.subscriptions.get_mut(&subscription_id).unwrap().status = SubscriptionStatus::Cancelled;
        events::emit(
            "subscription_cancelled",
            json!({ "subscription_id": subscription_id, "cancelled_by": caller, "merchant": sub.merchant, "subscriber": sub.subscriber }),
        );
    }
}

impl Settle {
    pub(crate) fn internal_create_subscription(
        &mut self,
        subscriber: AccountId,
        merchant: AccountId,
        token: TokenId,
        amount: u128,
        interval_secs: u64,
        max_cycles: Option<u32>,
        reference: String,
    ) -> u64 {
        self.assert_business(&merchant);
        self.assert_token(&token);
        require!(amount > 0, "Amount must be positive");
        require!(interval_secs >= 60, "Interval must be at least 60 seconds");
        require!(max_cycles.map_or(true, |m| m > 0), "max_cycles must be > 0");
        require!(reference.len() <= MAX_REFERENCE_LEN, "Reference too long");
        let id = self.take_id();
        let now = now_secs();
        self.subscriptions.insert(
            id,
            Subscription {
                id,
                subscriber: subscriber.clone(),
                merchant: merchant.clone(),
                token: token.clone(),
                amount: U128(amount),
                interval_secs,
                next_charge_at: now,
                cycles_charged: 0,
                max_cycles,
                status: SubscriptionStatus::Active,
                created_at: now,
                reference,
            },
        );
        events::emit(
            "subscription_created",
            json!({ "subscription_id": id, "subscriber": subscriber, "merchant": merchant, "token": token, "amount": U128(amount), "interval_secs": interval_secs }),
        );
        let charged = self.internal_charge(id);
        require!(charged, "Insufficient balance for the first cycle");
        id
    }

    pub(crate) fn internal_charge(&mut self, id: u64) -> bool {
        let sub = self.subscriptions.get(&id).unwrap().clone();
        if self.balance_of(&sub.subscriber, &sub.token) < sub.amount.0 {
            self.subscriptions.get_mut(&id).unwrap().status = SubscriptionStatus::PastDue;
            events::emit(
                "subscription_past_due",
                json!({ "subscription_id": id, "subscriber": sub.subscriber, "merchant": sub.merchant, "amount": sub.amount }),
            );
            return false;
        }
        self.debit(&sub.subscriber, &sub.token, sub.amount.0);
        let net = self.take_fee(&sub.token, sub.amount.0);
        self.credit(&sub.merchant, &sub.token, net);
        let cycles = sub.cycles_charged + 1;
        {
            let s = self.subscriptions.get_mut(&id).unwrap();
            s.cycles_charged = cycles;
            // Keep the billing anchor; if cycles were missed, skip ahead instead of back-charging.
            let now = now_secs();
            let next = sub.next_charge_at + sub.interval_secs;
            s.next_charge_at = if next <= now { now + sub.interval_secs } else { next };
            s.status = if sub.max_cycles.map_or(false, |m| cycles >= m) {
                SubscriptionStatus::Completed
            } else {
                SubscriptionStatus::Active
            };
        }
        events::emit(
            "subscription_charged",
            json!({ "subscription_id": id, "subscriber": sub.subscriber, "merchant": sub.merchant, "token": sub.token, "amount": sub.amount, "cycle": cycles }),
        );
        true
    }
}
