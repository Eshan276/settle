use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PublicKey};

const USDC: &str = "usdc.test";
const SEC: u64 = 1_000_000_000;
const T0: u64 = 1_700_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: u128, now_secs: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("settle.test"))
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now_secs * SEC)
        .build());
}

fn setup(fee_bps: u16) -> Settle {
    ctx("owner.test", 0, T0);
    let mut c = Settle::new(acc("owner.test"), vec![acc(USDC)], Some(fee_bps));
    for b in ["acme.test", "vendor.test"] {
        ctx(b, 0, T0);
        c.register_business(b.to_string());
    }
    c
}

/// Simulate `usdc.test.ft_transfer_call(settle, amount, msg)` from `sender`.
fn ft_in(c: &mut Settle, sender: &str, amount: u128, msg: &str, now: u64) -> u128 {
    ctx(USDC, 0, now);
    match c.ft_on_transfer(acc(sender), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("expected value"),
    }
}

fn bal(c: &Settle, who: &str) -> u128 {
    c.get_balance(acc(who), acc(USDC)).0
}

#[test]
fn deposit_and_transfer() {
    let mut c = setup(0);
    assert_eq!(ft_in(&mut c, "acme.test", 1_000, "", T0), 0);
    assert_eq!(bal(&c, "acme.test"), 1_000);
    ctx("acme.test", 1, T0);
    c.transfer(acc(USDC), acc("bob.test"), U128(400), None);
    assert_eq!(bal(&c, "acme.test"), 600);
    assert_eq!(bal(&c, "bob.test"), 400);
}

#[test]
#[should_panic(expected = "Token not accepted")]
fn rejects_unknown_token() {
    let mut c = setup(0);
    ctx("scam.test", 0, T0);
    let _ = c.ft_on_transfer(acc("x.test"), U128(1), String::new());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn transfer_requires_full_access_key() {
    let mut c = setup(0);
    ft_in(&mut c, "acme.test", 1_000, "", T0);
    ctx("acme.test", 0, T0);
    c.transfer(acc(USDC), acc("bob.test"), U128(1), None);
}

#[test]
fn invoice_partial_then_full_with_fee_split_and_refund() {
    let mut c = setup(100); // 1% fee
    ctx("acme.test", 1, T0);
    let split = c.create_split(
        "cofounders".into(),
        vec![SplitRecipient { account_id: acc("partner.test"), bps: 2_500 }],
    );
    ctx("acme.test", 0, T0);
    let id = c.create_invoice(None, None, acc(USDC), U128(10_000), "INV-001".into(), None, Some(split));

    // Partial payment.
    let unused = ft_in(&mut c, "customer.test", 4_000, &format!(r#"{{"action":"pay_invoice","invoice_id":{id}}}"#), T0);
    assert_eq!(unused, 0);
    let inv = c.get_invoice(id).unwrap();
    assert_eq!(inv.status, InvoiceStatus::Open);
    assert_eq!(inv.amount_paid.0, 4_000);

    // Overpayment: only the remaining 6_000 is used, 1_000 refunded.
    let unused = ft_in(&mut c, "customer.test", 7_000, &format!(r#"{{"action":"pay_invoice","invoice_id":{id}}}"#), T0 + 5);
    assert_eq!(unused, 1_000);
    let inv = c.get_invoice(id).unwrap();
    assert_eq!(inv.status, InvoiceStatus::Paid);
    assert_eq!(inv.paid_at, Some(T0 + 5));
    assert_eq!(inv.payment_count, 2);

    // 1% fee = 100, net 9_900, partner 25% = 2_475 (computed per payment: 990 + 1_485).
    assert_eq!(bal(&c, "owner.test"), 100);
    assert_eq!(bal(&c, "partner.test"), 990 + 1_485);
    assert_eq!(bal(&c, "acme.test"), 9_900 - 2_475);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"invoice_paid\"")));
}

#[test]
fn operator_can_create_invoice_but_not_move_money() {
    let mut c = setup(0);
    ctx("acme.test", 1, T0);
    c.add_operator(acc("api.test"));
    ctx("api.test", 0, T0);
    let id = c.create_invoice(Some(acc("acme.test")), None, acc(USDC), U128(5), "x".into(), None, None);
    assert_eq!(c.get_invoice(id).unwrap().business, acc("acme.test"));
    c.cancel_invoice(id);
    assert_eq!(c.get_invoice(id).unwrap().status, InvoiceStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Caller is not the business or its operator")]
fn stranger_cannot_create_invoice() {
    let mut c = setup(0);
    ctx("mallory.test", 0, T0);
    c.create_invoice(Some(acc("acme.test")), None, acc(USDC), U128(5), "x".into(), None, None);
}

#[test]
#[should_panic(expected = "Checkout session expired")]
fn checkout_expires() {
    let mut c = setup(0);
    ctx("acme.test", 0, T0);
    let id = c.create_invoice(None, Some(InvoiceKind::Checkout), acc(USDC), U128(50), "order_1".into(), Some(T0 + 1800), None);
    ft_in(&mut c, "customer.test", 50, &format!(r#"{{"action":"pay_invoice","invoice_id":{id}}}"#), T0 + 1801);
}

#[test]
fn pay_invoice_from_balance_b2b() {
    let mut c = setup(0);
    ctx("vendor.test", 0, T0);
    let id = c.create_invoice(None, None, acc(USDC), U128(300), "bill".into(), None, None);
    ft_in(&mut c, "acme.test", 1_000, "", T0);
    ctx("acme.test", 1, T0);
    assert_eq!(c.pay_invoice_from_balance(id).0, 300);
    assert_eq!(bal(&c, "acme.test"), 700);
    assert_eq!(bal(&c, "vendor.test"), 300);
}

#[test]
fn batch_payroll() {
    let mut c = setup(0);
    ft_in(&mut c, "acme.test", 10_000, "", T0);
    ctx("acme.test", 1, T0);
    let total = c.run_payroll(
        acc(USDC),
        vec![
            PayrollEntry { account_id: acc("alice.test"), amount: U128(3_000) },
            PayrollEntry { account_id: acc("bob.test"), amount: U128(2_500) },
        ],
        Some("Nov 2026".into()),
    );
    assert_eq!(total.0, 5_500);
    assert_eq!(bal(&c, "alice.test"), 3_000);
    assert_eq!(bal(&c, "bob.test"), 2_500);
    assert_eq!(bal(&c, "acme.test"), 4_500);
}

#[test]
fn salary_stream_accrues_and_cancels_fairly() {
    let mut c = setup(0);
    ft_in(&mut c, "acme.test", 1_000_000, "", T0);
    ctx("acme.test", 1, T0);
    let id = c.create_stream(acc("alice.test"), acc(USDC), U128(1_000_000), 1_000, None, Some("salary".into()));
    assert_eq!(bal(&c, "acme.test"), 0);

    ctx("alice.test", 0, T0 + 250);
    assert_eq!(c.get_stream(id).unwrap().available.0, 250_000);
    assert_eq!(c.withdraw_stream(id).0, 250_000);
    assert_eq!(bal(&c, "alice.test"), 250_000);

    ctx("acme.test", 1, T0 + 600);
    c.cancel_stream(id);
    assert_eq!(bal(&c, "alice.test"), 600_000);
    assert_eq!(bal(&c, "acme.test"), 400_000);
    let s = c.get_stream(id).unwrap();
    assert_eq!(s.available.0, 0);
}

#[test]
fn subscription_charges_on_schedule_and_goes_past_due() {
    let mut c = setup(0);
    let msg = r#"{"action":"subscribe","merchant":"vendor.test","amount":"100","interval_secs":2592000,"reference":"pro_plan"}"#;
    ft_in(&mut c, "acme.test", 250, msg, T0);
    // First cycle charged immediately.
    assert_eq!(bal(&c, "vendor.test"), 100);
    assert_eq!(bal(&c, "acme.test"), 150);
    let id = c.get_subscriptions(acc("acme.test"), None, None)[0].id;

    ctx("keeper.test", 0, T0 + 2_592_000);
    assert_eq!(c.get_due_subscriptions(None), vec![id]);
    assert!(c.charge_subscription(id));
    assert_eq!(bal(&c, "vendor.test"), 200);

    ctx("keeper.test", 0, T0 + 2 * 2_592_000);
    assert!(!c.charge_subscription(id)); // only 50 left
    assert_eq!(c.get_subscription(id).unwrap().status, SubscriptionStatus::PastDue);

    // Top up, retry succeeds.
    ft_in(&mut c, "acme.test", 100, "", T0 + 2 * 2_592_000 + 10);
    ctx("keeper.test", 0, T0 + 2 * 2_592_000 + 20);
    assert!(c.charge_subscription(id));
    assert_eq!(c.get_subscription(id).unwrap().status, SubscriptionStatus::Active);

    ctx("acme.test", 0, T0 + 2 * 2_592_000 + 30);
    c.cancel_subscription(id);
    assert_eq!(c.get_subscription(id).unwrap().status, SubscriptionStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Next cycle not due yet")]
fn subscription_cannot_be_charged_early() {
    let mut c = setup(0);
    let msg = r#"{"action":"subscribe","merchant":"vendor.test","amount":"100","interval_secs":3600}"#;
    ft_in(&mut c, "acme.test", 500, msg, T0);
    ctx("vendor.test", 0, T0 + 10);
    c.charge_subscription(c.get_subscriptions(acc("acme.test"), None, None)[0].id);
}

fn agent_setup() -> Settle {
    let mut c = setup(0);
    ft_in(&mut c, "acme.test", 100_000, "", T0);
    ctx("acme.test", 1, T0);
    c.set_agent_policy(
        acc("cfo-bot.test"),
        AgentPolicy {
            per_tx_limit: U128(20_000),
            daily_limit: U128(10_000),
            approval_threshold: U128(5_000),
            allowed_recipients: Some(vec![acc("vendor.test"), acc("cloud.test")]),
            label: "AP autopilot".into(),
            active: true,
        },
    );
    c
}

#[test]
fn agent_pays_within_policy() {
    let mut c = agent_setup();
    ctx("cfo-bot.test", 0, T0);
    let r = c.agent_pay(acc("acme.test"), acc(USDC), acc("vendor.test"), U128(4_000), Some("hosting".into()));
    assert_eq!(r.status, "paid");
    assert_eq!(bal(&c, "vendor.test"), 4_000);
    assert_eq!(c.get_agent_spent_today(acc("acme.test"), acc("cfo-bot.test")).0, 4_000);
}

#[test]
fn agent_out_of_policy_goes_to_approval_then_human_approves() {
    let mut c = agent_setup();
    ctx("cfo-bot.test", 0, T0);
    // Above approval threshold AND not allowlisted.
    let r = c.agent_pay(acc("acme.test"), acc(USDC), acc("newvendor.test"), U128(8_000), None);
    assert_eq!(r.status, "pending_approval");
    assert_eq!(r.reasons, vec!["amount_above_approval_threshold", "recipient_not_allowlisted"]);
    assert_eq!(bal(&c, "newvendor.test"), 0);

    ctx("acme.test", 1, T0 + 60);
    c.approve_payment(r.approval_id.unwrap());
    assert_eq!(bal(&c, "newvendor.test"), 8_000);
    assert_eq!(c.get_approval(r.approval_id.unwrap()).unwrap().status, ApprovalStatus::Approved);
}

#[test]
fn agent_daily_limit_resets_next_day() {
    let mut c = agent_setup();
    ctx("cfo-bot.test", 0, T0);
    for _ in 0..2 {
        assert_eq!(c.agent_pay(acc("acme.test"), acc(USDC), acc("cloud.test"), U128(5_000), None).status, "paid");
    }
    let r = c.agent_pay(acc("acme.test"), acc(USDC), acc("cloud.test"), U128(1), None);
    assert_eq!(r.reasons, vec!["daily_limit_exceeded"]);
    ctx("cfo-bot.test", 0, T0 + SECONDS_PER_DAY);
    assert_eq!(c.agent_pay(acc("acme.test"), acc(USDC), acc("cloud.test"), U128(1), None).status, "paid");
}

#[test]
#[should_panic(expected = "hard limit")]
fn agent_hard_limit() {
    let mut c = agent_setup();
    ctx("cfo-bot.test", 0, T0);
    c.agent_pay(acc("acme.test"), acc(USDC), acc("vendor.test"), U128(20_001), None);
}

#[test]
#[should_panic(expected = "Agent is not authorized")]
fn unknown_agent_rejected() {
    let mut c = agent_setup();
    ctx("rogue.test", 0, T0);
    c.agent_pay(acc("acme.test"), acc(USDC), acc("rogue.test"), U128(1), None);
}

#[test]
fn agent_pays_vendor_invoice() {
    let mut c = agent_setup();
    ctx("vendor.test", 0, T0);
    let id = c.create_invoice(None, None, acc(USDC), U128(3_000), "VEND-77".into(), None, None);
    ctx("cfo-bot.test", 0, T0);
    let r = c.agent_pay_invoice(acc("acme.test"), id, None);
    assert_eq!(r.status, "paid");
    assert_eq!(c.get_invoice(id).unwrap().status, InvoiceStatus::Paid);
    assert_eq!(bal(&c, "vendor.test"), 3_000);
    assert_eq!(bal(&c, "acme.test"), 97_000);
}

fn claim_keys(seed: u8) -> (SigningKey, PublicKey, String) {
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let pk_str = format!("ed25519:{}", bs58::encode(sk.verifying_key().to_bytes()).into_string());
    (sk, pk_str.parse().unwrap(), pk_str)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn claim_link_flow() {
    let mut c = setup(0);
    ft_in(&mut c, "acme.test", 1_000, "", T0);
    let (sk, pk, pk_str) = claim_keys(7);
    ctx("acme.test", 1, T0);
    c.create_claim(pk.clone(), acc(USDC), U128(200), Some(86_400), Some("Welcome bonus".into()));
    assert_eq!(bal(&c, "acme.test"), 800);
    assert!(c.get_claim(pk.clone()).is_some());

    let msg = claims::claim_message(&acc("settle.test"), &pk_str, &acc("maria.test"));
    let sig = hex(&sk.sign(msg.as_bytes()).to_bytes());
    // Submitted by the relayer, not by maria.
    ctx("relayer.test", 0, T0 + 100);
    assert_eq!(c.claim(pk.clone(), acc("maria.test"), sig).0, 200);
    assert_eq!(bal(&c, "maria.test"), 200);
    assert!(c.get_claim(pk).is_none());
}

#[test]
#[should_panic(expected = "Invalid claim signature")]
fn claim_signature_binds_receiver() {
    let mut c = setup(0);
    ft_in(&mut c, "acme.test", 1_000, "", T0);
    let (sk, pk, pk_str) = claim_keys(9);
    ctx("acme.test", 1, T0);
    c.create_claim(pk.clone(), acc(USDC), U128(200), None, None);
    let msg = claims::claim_message(&acc("settle.test"), &pk_str, &acc("maria.test"));
    let sig = hex(&sk.sign(msg.as_bytes()).to_bytes());
    // Front-runner tries to redirect to themselves with maria's signature.
    ctx("mallory.test", 0, T0);
    c.claim(pk, acc("mallory.test"), sig);
}

#[test]
fn reclaim_unclaimed() {
    let mut c = setup(0);
    ft_in(&mut c, "acme.test", 1_000, "", T0);
    let (_, pk, _) = claim_keys(3);
    ctx("acme.test", 1, T0);
    c.create_claim(pk.clone(), acc(USDC), U128(200), None, None);
    ctx("acme.test", 0, T0);
    assert_eq!(c.reclaim(pk).0, 200);
    assert_eq!(bal(&c, "acme.test"), 1_000);
}

#[test]
fn withdraw_debits_and_failed_callback_restores() {
    let mut c = setup(0);
    ft_in(&mut c, "acme.test", 1_000, "", T0);
    ctx("acme.test", 1, T0);
    let _ = c.withdraw(acc(USDC), U128(600), None, None);
    assert_eq!(bal(&c, "acme.test"), 400);
    ctx("settle.test", 0, T0);
    let ok = c.on_withdraw(acc("acme.test"), acc("acme.test"), acc(USDC), U128(600), Err(PromiseError::Failed));
    assert!(!ok);
    assert_eq!(bal(&c, "acme.test"), 1_000);
}
