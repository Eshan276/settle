use crate::*;
use near_sdk::serde_json::json;

#[near]
impl Settle {
    /// Create a revenue split. Every payment to an invoice using this split is fanned out
    /// to `recipients` by basis points; the remainder stays with the business.
    #[payable]
    pub fn create_split(&mut self, name: String, recipients: Vec<SplitRecipient>) -> u64 {
        near_sdk::assert_one_yocto();
        let business = env::predecessor_account_id();
        self.assert_business(&business);
        require!(!recipients.is_empty() && recipients.len() <= MAX_SPLIT_RECIPIENTS, "1-10 recipients");
        let total: u32 = recipients.iter().map(|r| r.bps as u32).sum();
        require!(total <= BPS_DENOMINATOR as u32, "Split shares exceed 100%");
        require!(recipients.iter().all(|r| r.bps > 0), "Each share must be > 0");
        let id = self.take_id();
        self.splits.insert(id, Split { id, business: business.clone(), name, recipients });
        events::emit("split_created", json!({ "split_id": id, "business": business }));
        id
    }

    #[payable]
    pub fn delete_split(&mut self, split_id: u64) {
        near_sdk::assert_one_yocto();
        let split = self.splits.get(&split_id).expect("Split not found");
        require!(split.business == env::predecessor_account_id(), "Not your split");
        self.splits.remove(&split_id);
    }
}

impl Settle {
    /// Credit `net` to the business, routing shares through the split if any.
    pub(crate) fn distribute(&mut self, business: &AccountId, token: &TokenId, net: u128, split_id: Option<u64>) {
        let recipients = split_id
            .and_then(|id| self.splits.get(&id))
            .map(|s| s.recipients.clone())
            .unwrap_or_default();
        let mut remaining = net;
        for r in recipients {
            let share = net * r.bps as u128 / BPS_DENOMINATOR;
            if share > 0 {
                self.credit(&r.account_id, token, share);
                remaining -= share;
            }
        }
        self.credit(business, token, remaining);
    }
}
