use crate::*;
use near_sdk::serde_json::json;

#[near]
impl Settle {
    /// Create an invoice or checkout session. Callable by the business or its operator.
    pub fn create_invoice(
        &mut self,
        business: Option<AccountId>,
        kind: Option<InvoiceKind>,
        token: TokenId,
        amount: U128,
        reference: String,
        due_at: Option<u64>,
        split_id: Option<u64>,
    ) -> u64 {
        let business = business.unwrap_or_else(env::predecessor_account_id);
        self.assert_business(&business);
        self.assert_can_manage(&business);
        self.assert_token(&token);
        require!(amount.0 > 0, "Amount must be positive");
        require!(reference.len() <= MAX_REFERENCE_LEN, "Reference too long");
        let kind = kind.unwrap_or(InvoiceKind::Invoice);
        if kind == InvoiceKind::Checkout {
            require!(due_at.is_some(), "Checkout sessions need an expiry (due_at)");
        }
        if let Some(sid) = split_id {
            let split = self.splits.get(&sid).expect("Split not found");
            require!(split.business == business, "Split belongs to another business");
        }
        let id = self.take_id();
        let invoice = Invoice {
            id,
            business: business.clone(),
            kind,
            token: token.clone(),
            amount,
            amount_paid: U128(0),
            status: InvoiceStatus::Open,
            reference: reference.clone(),
            split_id,
            created_at: now_secs(),
            due_at,
            paid_at: None,
            last_payer: None,
            payment_count: 0,
        };
        self.invoices.insert(id, invoice);
        events::emit(
            "invoice_created",
            json!({ "invoice_id": id, "business": business, "kind": kind, "token": token, "amount": amount, "reference": reference }),
        );
        id
    }

    pub fn cancel_invoice(&mut self, invoice_id: u64) {
        let invoice = self.invoices.get(&invoice_id).expect("Invoice not found").clone();
        self.assert_can_manage(&invoice.business);
        require!(invoice.status == InvoiceStatus::Open, "Invoice is not open");
        require!(invoice.amount_paid.0 == 0, "Invoice is partially paid; refund instead");
        self.invoices.get_mut(&invoice_id).unwrap().status = InvoiceStatus::Cancelled;
        events::emit("invoice_cancelled", json!({ "invoice_id": invoice_id, "business": invoice.business }));
    }

    /// Pay an invoice from the caller's Settle balance.
    #[payable]
    pub fn pay_invoice_from_balance(&mut self, invoice_id: u64) -> U128 {
        near_sdk::assert_one_yocto();
        let payer = env::predecessor_account_id();
        let invoice = self.invoices.get(&invoice_id).expect("Invoice not found").clone();
        let remaining = invoice.amount.0 - invoice.amount_paid.0;
        self.debit(&payer, &invoice.token, remaining);
        let used = self.apply_invoice_payment(invoice_id, &payer, &invoice.token, remaining);
        U128(used)
    }
}

impl Settle {
    /// Apply up to `amount` of `token` to an invoice. Returns the amount actually used.
    pub(crate) fn apply_invoice_payment(&mut self, invoice_id: u64, payer: &AccountId, token: &TokenId, amount: u128) -> u128 {
        let now = now_secs();
        let invoice = self.invoices.get(&invoice_id).expect("Invoice not found").clone();
        require!(invoice.status == InvoiceStatus::Open, "Invoice is not open");
        require!(&invoice.token == token, "Wrong token for this invoice");
        if invoice.kind == InvoiceKind::Checkout {
            require!(invoice.due_at.map_or(true, |d| now <= d), "Checkout session expired");
        }

        let remaining = invoice.amount.0 - invoice.amount_paid.0;
        let used = amount.min(remaining);
        require!(used > 0, "Nothing to pay");
        let paid_total = invoice.amount_paid.0 + used;
        let fully_paid = paid_total == invoice.amount.0;

        {
            let inv = self.invoices.get_mut(&invoice_id).unwrap();
            inv.amount_paid = U128(paid_total);
            inv.last_payer = Some(payer.clone());
            inv.payment_count += 1;
            if fully_paid {
                inv.status = InvoiceStatus::Paid;
                inv.paid_at = Some(now);
            }
        }

        let net = self.take_fee(token, used);
        self.distribute(&invoice.business, token, net, invoice.split_id);

        events::emit(
            if fully_paid { "invoice_paid" } else { "invoice_partially_paid" },
            json!({
                "invoice_id": invoice_id,
                "business": invoice.business,
                "kind": invoice.kind,
                "payer": payer,
                "token": token,
                "amount": U128(used),
                "amount_paid": U128(paid_total),
                "amount_due": invoice.amount,
                "reference": invoice.reference,
            }),
        );
        used
    }
}
