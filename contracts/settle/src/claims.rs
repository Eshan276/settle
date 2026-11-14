//! Claim links: send money to someone who has no wallet yet.
//!
//! The sender generates a one-time ed25519 keypair, locks funds against the public key and
//! shares the secret key in a link (`https://settle.app/claim#<secret>`), e.g. by email.
//! The recipient signs `settle-claim:<contract>:<public_key>:<receiver_id>` with the secret
//! and anyone (typically the gasless relayer) submits `claim`. The signature binds the
//! receiver, so a front-runner cannot redirect the funds.
use crate::*;
use near_sdk::serde_json::json;
use near_sdk::{CurveType, PublicKey};

#[near]
impl Settle {
    #[payable]
    pub fn create_claim(
        &mut self,
        public_key: PublicKey,
        token: TokenId,
        amount: U128,
        expires_in_secs: Option<u64>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        require!(public_key.curve_type() == CurveType::ED25519, "Claim keys must be ed25519");
        self.assert_token(&token);
        require!(amount.0 > 0, "Amount must be positive");
        let memo = memo.unwrap_or_default();
        require!(memo.len() <= MAX_REFERENCE_LEN, "Memo too long");
        let key = String::from(&public_key);
        require!(!self.claims.contains_key(&key), "Claim key already used");
        let creator = env::predecessor_account_id();
        self.debit(&creator, &token, amount.0);
        let now = now_secs();
        self.claims.insert(
            key.clone(),
            Claim {
                public_key: key.clone(),
                creator: creator.clone(),
                token: token.clone(),
                amount,
                created_at: now,
                expires_at: expires_in_secs.map(|s| now + s),
                memo,
            },
        );
        events::emit("claim_created", json!({ "public_key": key, "creator": creator, "token": token, "amount": amount }));
    }

    /// Redeem a claim into `receiver_id`'s Settle balance. `signature` is the hex-encoded
    /// ed25519 signature of `settle-claim:<contract_id>:<public_key>:<receiver_id>`.
    pub fn claim(&mut self, public_key: PublicKey, receiver_id: AccountId, signature: String) -> U128 {
        let key = String::from(&public_key);
        let claim = self.claims.get(&key).cloned().unwrap_or_else(|| env::panic_str("Claim not found or already redeemed"));
        if let Some(exp) = claim.expires_at {
            require!(now_secs() <= exp, "Claim expired");
        }
        let pk: [u8; 32] = public_key.as_bytes()[1..].try_into().unwrap_or_else(|_| env::panic_str("Bad public key"));
        let sig_bytes = decode_hex(&signature).unwrap_or_else(|| env::panic_str("Signature must be hex"));
        let sig: [u8; 64] = sig_bytes.try_into().unwrap_or_else(|_| env::panic_str("Signature must be 64 bytes"));
        let message = claim_message(&env::current_account_id(), &key, &receiver_id);
        require!(env::ed25519_verify(&sig, message.as_bytes(), &pk), "Invalid claim signature");

        self.claims.remove(&key);
        self.credit(&receiver_id, &claim.token, claim.amount.0);
        events::emit(
            "claim_redeemed",
            json!({ "public_key": key, "creator": claim.creator, "receiver_id": receiver_id, "token": claim.token, "amount": claim.amount }),
        );
        claim.amount
    }

    /// Sender takes back an unclaimed payout.
    pub fn reclaim(&mut self, public_key: PublicKey) -> U128 {
        let key = String::from(&public_key);
        let claim = self.claims.get(&key).cloned().unwrap_or_else(|| env::panic_str("Claim not found or already redeemed"));
        require!(claim.creator == env::predecessor_account_id(), "Only the creator can reclaim");
        self.claims.remove(&key);
        self.credit(&claim.creator, &claim.token, claim.amount.0);
        events::emit("claim_reclaimed", json!({ "public_key": key, "creator": claim.creator, "amount": claim.amount }));
        claim.amount
    }
}

pub(crate) fn claim_message(contract: &AccountId, public_key: &str, receiver: &AccountId) -> String {
    format!("settle-claim:{}:{}:{}", contract, public_key, receiver)
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}
