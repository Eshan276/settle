use crate::*;
use near_sdk::serde_json::json;

#[near]
impl Settle {
    /// Pay up to 100 people in one transaction from the caller's Settle balance.
    #[payable]
    pub fn run_payroll(&mut self, token: TokenId, entries: Vec<PayrollEntry>, reference: Option<String>) -> U128 {
        near_sdk::assert_one_yocto();
        let employer = env::predecessor_account_id();
        self.assert_business(&employer);
        require!(!entries.is_empty() && entries.len() <= MAX_BATCH, "1-100 entries per payroll run");
        let total: u128 = entries.iter().map(|e| e.amount.0).sum();
        self.debit(&employer, &token, total);
        for e in &entries {
            require!(e.amount.0 > 0, "Payroll amounts must be positive");
            self.credit(&e.account_id, &token, e.amount.0);
        }
        events::emit(
            "payroll_run",
            json!({
                "employer": employer,
                "token": token,
                "total": U128(total),
                "count": entries.len(),
                "entries": entries,
                "reference": reference,
            }),
        );
        U128(total)
    }

    /// Lock `total` from the caller's balance and stream it to `employee` linearly over
    /// `duration_secs`, starting at `start_at` (defaults to now). The employee can
    /// withdraw what they've earned at any second.
    #[payable]
    pub fn create_stream(
        &mut self,
        employee: AccountId,
        token: TokenId,
        total: U128,
        duration_secs: u64,
        start_at: Option<u64>,
        memo: Option<String>,
    ) -> u64 {
        near_sdk::assert_one_yocto();
        let employer = env::predecessor_account_id();
        self.assert_business(&employer);
        self.assert_token(&token);
        require!(total.0 > 0, "Total must be positive");
        require!(duration_secs > 0, "Duration must be positive");
        let start_at = start_at.unwrap_or_else(now_secs);
        self.debit(&employer, &token, total.0);
        let id = self.take_id();
        let stream = Stream {
            id,
            employer: employer.clone(),
            employee: employee.clone(),
            token: token.clone(),
            total,
            withdrawn: U128(0),
            start_at,
            duration_secs,
            cancelled_at: None,
            memo: memo.unwrap_or_default(),
        };
        self.streams.insert(id, stream);
        events::emit(
            "stream_created",
            json!({ "stream_id": id, "employer": employer, "employee": employee, "token": token, "total": total, "start_at": start_at, "duration_secs": duration_secs }),
        );
        id
    }

    /// Move everything earned so far into the employee's Settle balance.
    pub fn withdraw_stream(&mut self, stream_id: u64) -> U128 {
        let stream = self.streams.get(&stream_id).expect("Stream not found").clone();
        require!(env::predecessor_account_id() == stream.employee, "Only the employee can withdraw");
        let available = Self::stream_accrued(&stream, now_secs()) - stream.withdrawn.0;
        require!(available > 0, "Nothing to withdraw yet");
        self.streams.get_mut(&stream_id).unwrap().withdrawn = U128(stream.withdrawn.0 + available);
        self.credit(&stream.employee, &stream.token, available);
        events::emit(
            "stream_withdrawn",
            json!({ "stream_id": stream_id, "employee": stream.employee, "token": stream.token, "amount": U128(available) }),
        );
        U128(available)
    }

    /// Stop a stream. Earned-but-unwithdrawn salary goes to the employee, the rest back to the employer.
    #[payable]
    pub fn cancel_stream(&mut self, stream_id: u64) {
        near_sdk::assert_one_yocto();
        let stream = self.streams.get(&stream_id).expect("Stream not found").clone();
        require!(env::predecessor_account_id() == stream.employer, "Only the employer can cancel");
        require!(stream.cancelled_at.is_none(), "Already cancelled");
        let now = now_secs();
        let accrued = Self::stream_accrued(&stream, now);
        let to_employee = accrued - stream.withdrawn.0;
        let refund = stream.total.0 - accrued;
        {
            let s = self.streams.get_mut(&stream_id).unwrap();
            s.cancelled_at = Some(now);
            s.total = U128(accrued);
            s.withdrawn = U128(accrued);
        }
        self.credit(&stream.employee, &stream.token, to_employee);
        self.credit(&stream.employer, &stream.token, refund);
        events::emit(
            "stream_cancelled",
            json!({ "stream_id": stream_id, "paid_to_employee": U128(to_employee), "refunded": U128(refund) }),
        );
    }
}

impl Settle {
    pub(crate) fn stream_accrued(stream: &Stream, now: u64) -> u128 {
        if stream.cancelled_at.is_some() {
            return stream.total.0;
        }
        if now <= stream.start_at {
            return 0;
        }
        let elapsed = (now - stream.start_at).min(stream.duration_secs);
        stream.total.0 * elapsed as u128 / stream.duration_secs as u128
    }
}
