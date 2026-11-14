//! NEP-297 structured events. Indexers and the Settle API watch for `EVENT_JSON:` logs.
use near_sdk::env;
use near_sdk::serde_json::{json, Value};

pub(crate) fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "settle",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}
