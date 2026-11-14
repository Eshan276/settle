//! # Settle
//!
//! Payment rails for real businesses on NEAR. One contract holds every business'
//! stablecoin treasury as an internal ledger and exposes the primitives a finance
//! team actually needs:
//!
//! * **Invoices & checkout sessions** – payable by anyone with `ft_transfer_call`
//!   (directly, or cross-chain via NEAR Intents through a settlement account).
//! * **Revenue splits** – incoming payments fan out to partners automatically.
//! * **Payroll** – batch payouts and per-second salary streams (earned-wage access).
//! * **Subscriptions** – capped recurring pull payments the subscriber can cancel.
//! * **AI-agent spend policies** – agents can pay bills within limits; anything
//!   outside policy lands in a human approval queue.
//! * **Claim links** – send money to an email/phone; the recipient claims with a
//!   one-time key (gasless via a relayer).
//!
//! Money-moving methods require a 1 yoctoNEAR deposit so that function-call access
//! keys (e.g. a server or agent key) can never move funds on a business' behalf.

use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet, LookupMap, LookupSet};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};

mod agents;
mod claims;
mod events;
mod invoices;
mod payroll;
mod splits;
mod subscriptions;
pub mod types;
mod views;

#[cfg(test)]
mod tests;

pub use types::*;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);
/// NEP-145 storage deposit most NEP-141 tokens require to register a receiver.
const FT_STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Tokens,
    Businesses,
    Operators,
    Balances,
    Invoices,
    Splits,
    Streams,
    Subscriptions,
    Agents,
    AgentSpend,
    Approvals,
    Claims,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Settle {
    pub owner_id: AccountId,
    pub fee_bps: u16,
    pub fee_collector: AccountId,
    pub tokens: IterableSet<TokenId>,
    pub businesses: LookupMap<AccountId, Business>,
    /// (business, operator): operators may create/cancel invoices but never move funds.
    pub operators: LookupSet<(AccountId, AccountId)>,
    /// (account, token) -> balance
    pub balances: LookupMap<(AccountId, TokenId), u128>,
    pub invoices: IterableMap<u64, Invoice>,
    pub splits: IterableMap<u64, Split>,
    pub streams: IterableMap<u64, Stream>,
    pub subscriptions: IterableMap<u64, Subscription>,
    /// (business, agent) -> policy
    pub agents: IterableMap<(AccountId, AccountId), AgentPolicy>,
    pub agent_spend: LookupMap<(AccountId, AccountId), DailySpend>,
    pub approvals: IterableMap<u64, Approval>,
    pub claims: LookupMap<String, Claim>,
    pub next_id: u64,
}

pub(crate) fn now_secs() -> u64 {
    env::block_timestamp_ms() / 1000
}

#[near]
impl Settle {
    #[init]
    pub fn new(owner_id: AccountId, tokens: Vec<TokenId>, fee_bps: Option<u16>) -> Self {
        let fee_bps = fee_bps.unwrap_or(0);
        require!(fee_bps <= 500, "Fee cannot exceed 5%");
        let mut this = Self {
            fee_collector: owner_id.clone(),
            owner_id,
            fee_bps,
            tokens: IterableSet::new(StorageKey::Tokens),
            businesses: LookupMap::new(StorageKey::Businesses),
            operators: LookupSet::new(StorageKey::Operators),
            balances: LookupMap::new(StorageKey::Balances),
            invoices: IterableMap::new(StorageKey::Invoices),
            splits: IterableMap::new(StorageKey::Splits),
            streams: IterableMap::new(StorageKey::Streams),
            subscriptions: IterableMap::new(StorageKey::Subscriptions),
            agents: IterableMap::new(StorageKey::Agents),
            agent_spend: LookupMap::new(StorageKey::AgentSpend),
            approvals: IterableMap::new(StorageKey::Approvals),
            claims: LookupMap::new(StorageKey::Claims),
            next_id: 1,
        };
        for t in tokens {
            this.tokens.insert(t);
        }
        this
    }

    // ------------------------------------------------------------------ admin

    pub fn add_token(&mut self, token: TokenId) {
        self.assert_owner();
        self.tokens.insert(token);
    }

    pub fn remove_token(&mut self, token: TokenId) {
        self.assert_owner();
        self.tokens.remove(&token);
    }

    pub fn set_fee(&mut self, fee_bps: u16, fee_collector: Option<AccountId>) {
        self.assert_owner();
        require!(fee_bps <= 500, "Fee cannot exceed 5%");
        self.fee_bps = fee_bps;
        if let Some(c) = fee_collector {
            self.fee_collector = c;
        }
    }

    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = owner_id;
    }

    // ------------------------------------------------------------- businesses

    /// Register (or rename) the caller as a business.
    pub fn register_business(&mut self, name: String) -> Business {
        require!(!name.is_empty() && name.len() <= 64, "Name must be 1-64 chars");
        let id = env::predecessor_account_id();
        let business = match self.businesses.get(&id) {
            Some(b) => Business { name, created_at: b.created_at },
            None => Business { name, created_at: now_secs() },
        };
        self.businesses.insert(id.clone(), business.clone());
        events::emit("business_registered", near_sdk::serde_json::json!({ "business": id, "name": business.name }));
        business
    }

    /// Allow `operator` (e.g. the Settle API server) to create and cancel invoices for the caller.
    #[payable]
    pub fn add_operator(&mut self, operator: AccountId) {
        near_sdk::assert_one_yocto();
        let business = env::predecessor_account_id();
        self.assert_business(&business);
        self.operators.insert((business, operator));
    }

    #[payable]
    pub fn remove_operator(&mut self, operator: AccountId) {
        near_sdk::assert_one_yocto();
        self.operators.remove(&(env::predecessor_account_id(), operator));
    }

    // ---------------------------------------------------------------- deposits

    /// NEP-141 receiver. See [`TransferMsg`] for accepted messages. An empty `msg` is a deposit.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        require!(self.tokens.contains(&token), "Token not accepted by Settle");
        require!(amount.0 > 0, "Amount must be positive");

        let parsed: TransferMsg = if msg.trim().is_empty() {
            TransferMsg::Deposit { account_id: None }
        } else {
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Invalid msg"))
        };

        let unused = match parsed {
            TransferMsg::Deposit { account_id } => {
                let account = account_id.unwrap_or(sender_id.clone());
                self.credit(&account, &token, amount.0);
                events::emit(
                    "deposit",
                    near_sdk::serde_json::json!({ "account_id": account, "token": token, "amount": amount, "sender_id": sender_id }),
                );
                0
            }
            TransferMsg::PayInvoice { invoice_id, payer } => {
                let payer = payer.unwrap_or(sender_id.clone());
                let used = self.apply_invoice_payment(invoice_id, &payer, &token, amount.0);
                amount.0 - used
            }
            TransferMsg::Subscribe { merchant, amount: per_cycle, interval_secs, max_cycles, reference } => {
                self.credit(&sender_id, &token, amount.0);
                self.internal_create_subscription(
                    sender_id.clone(),
                    merchant,
                    token.clone(),
                    per_cycle.0,
                    interval_secs,
                    max_cycles,
                    reference.unwrap_or_default(),
                );
                0
            }
        };
        PromiseOrValue::Value(U128(unused))
    }

    // ------------------------------------------------------------- transfers

    /// Instant internal transfer between Settle balances (no gas-heavy token call).
    #[payable]
    pub fn transfer(&mut self, token: TokenId, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        require!(amount.0 > 0, "Amount must be positive");
        let sender = env::predecessor_account_id();
        self.debit(&sender, &token, amount.0);
        self.credit(&receiver_id, &token, amount.0);
        events::emit(
            "transfer",
            near_sdk::serde_json::json!({ "from": sender, "to": receiver_id, "token": token, "amount": amount, "memo": memo }),
        );
    }

    /// Withdraw from the Settle ledger to any NEAR account (including a NEAR Intents
    /// 1Click deposit address, which turns the withdrawal into a cross-chain payout).
    /// Attach >= 0.00125 NEAR to also storage-register the receiver with the token.
    #[payable]
    pub fn withdraw(&mut self, token: TokenId, amount: U128, receiver_id: Option<AccountId>, memo: Option<String>) -> Promise {
        let deposit = env::attached_deposit();
        require!(deposit >= NearToken::from_yoctonear(1), "Requires attached deposit of at least 1 yoctoNEAR");
        require!(amount.0 > 0, "Amount must be positive");
        let account = env::predecessor_account_id();
        let receiver = receiver_id.unwrap_or(account.clone());
        self.debit(&account, &token, amount.0);

        let transfer = ext_ft::ext(token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(receiver.clone(), amount, memo);

        let chain = if deposit >= FT_STORAGE_DEPOSIT {
            ext_ft::ext(token.clone())
                .with_attached_deposit(FT_STORAGE_DEPOSIT)
                .with_static_gas(GAS_STORAGE_DEPOSIT)
                .storage_deposit(Some(receiver.clone()), Some(true))
                .then(transfer)
        } else {
            transfer
        };

        chain.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_WITHDRAW_CALLBACK)
                .on_withdraw(account, receiver, token, amount),
        )
    }

    #[private]
    pub fn on_withdraw(
        &mut self,
        account: AccountId,
        receiver: AccountId,
        token: TokenId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            events::emit(
                "withdraw",
                near_sdk::serde_json::json!({ "account_id": account, "receiver_id": receiver, "token": token, "amount": amount }),
            );
            true
        } else {
            // Token transfer failed (e.g. receiver not registered): restore the balance.
            self.credit(&account, &token, amount.0);
            events::emit(
                "withdraw_failed",
                near_sdk::serde_json::json!({ "account_id": account, "receiver_id": receiver, "token": token, "amount": amount }),
            );
            false
        }
    }
}

// ------------------------------------------------------------------ internals
impl Settle {
    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Only the owner can call this");
    }

    pub(crate) fn assert_business(&self, account: &AccountId) {
        require!(self.businesses.contains_key(account), "Account is not a registered business");
    }

    pub(crate) fn assert_token(&self, token: &TokenId) {
        require!(self.tokens.contains(token), "Token not accepted by Settle");
    }

    /// Caller is the business itself or one of its operators.
    pub(crate) fn assert_can_manage(&self, business: &AccountId) {
        let caller = env::predecessor_account_id();
        require!(
            &caller == business || self.operators.contains(&(business.clone(), caller)),
            "Caller is not the business or its operator"
        );
    }

    pub(crate) fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub(crate) fn balance_of(&self, account: &AccountId, token: &TokenId) -> u128 {
        self.balances.get(&(account.clone(), token.clone())).copied().unwrap_or(0)
    }

    pub(crate) fn credit(&mut self, account: &AccountId, token: &TokenId, amount: u128) {
        if amount == 0 {
            return;
        }
        let key = (account.clone(), token.clone());
        let current = self.balances.get(&key).copied().unwrap_or(0);
        self.balances.insert(key, current.checked_add(amount).expect("Balance overflow"));
    }

    pub(crate) fn debit(&mut self, account: &AccountId, token: &TokenId, amount: u128) {
        if amount == 0 {
            return;
        }
        let key = (account.clone(), token.clone());
        let current = self.balances.get(&key).copied().unwrap_or(0);
        require!(current >= amount, "Insufficient Settle balance");
        if current == amount {
            self.balances.remove(&key);
        } else {
            self.balances.insert(key, current - amount);
        }
    }

    /// Take the platform fee from `gross` and return the net amount.
    pub(crate) fn take_fee(&mut self, token: &TokenId, gross: u128) -> u128 {
        let fee = gross * self.fee_bps as u128 / BPS_DENOMINATOR;
        if fee > 0 {
            let collector = self.fee_collector.clone();
            self.credit(&collector, token, fee);
        }
        gross - fee
    }
}
