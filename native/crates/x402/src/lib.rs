//! clawpowers-x402 — HTTP 402 Payment Required client.
//!
//! Implements the [x402 payment protocol](https://x402.org) for automatically
//! handling `402 Payment Required` responses from API endpoints.
//!
//! # Protocol flow
//!
//! 1. Client makes a request; server responds `402` with `X-Payment-*` headers.
//! 2. Client parses the payment requirements via
//!    [`X402Client::parse_402_response`].
//! 3. Wallet signs the payment descriptor off-chain.
//! 4. Client retries with the `X-Payment` header set via
//!    [`X402Client::create_payment_header`].
//!
//! # Example
//!
//! ```rust,ignore
//! let client  = X402Client::new();
//! let payment = client.parse_402_response(&response.headers())?;
//! let sig     = wallet.sign(&payment).await?;
//! let header  = client.create_payment_header(&payment, &sig);
//! let resp    = client.request_with_payment(url, "GET", &header).await?;
//! ```

use reqwest::{
    Client, Method,
    header::{HeaderMap, HeaderValue},
};
use std::str::FromStr;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/// Errors produced by the x402 payment client.
#[derive(Debug, Error)]
pub enum X402Error {
    /// An underlying HTTP transport error.
    #[error("HTTP error: {0}")]
    HttpError(#[from] reqwest::Error),

    /// A required x402 header was absent from the `402` response.
    #[error("missing required x402 header: {0}")]
    MissingHeader(String),

    /// A header value could not be parsed into the expected type.
    #[error("invalid payment parameter: {0}")]
    InvalidPayment(String),

    /// The server rejected the payment (non-2xx after retry).
    #[error("payment failed: {0}")]
    PaymentFailed(String),
}

// ---------------------------------------------------------------------------
// X402PaymentRequired
// ---------------------------------------------------------------------------

/// Payment requirements parsed from a `402 Payment Required` response.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct X402PaymentRequired {
    /// URL the client should use to submit payment or retrieve further info.
    pub payment_url: String,
    /// Human-readable amount string (e.g. `"1.00"` — interpreted relative to
    /// the token's decimal precision).
    pub amount: String,
    /// Token symbol or contract address accepted for payment.
    pub token: String,
    /// EVM chain identifier.
    pub chain_id: u64,
    /// Address of the recipient that must receive the payment.
    pub recipient: String,
    /// Optional human-readable memo attached to the payment.
    pub memo: Option<String>,
}

// ---------------------------------------------------------------------------
// X402Client
// ---------------------------------------------------------------------------

/// HTTP client that handles the x402 payment flow.
///
/// Wraps [`reqwest::Client`] and adds helpers for parsing `402` responses and
/// attaching payment proofs to retry requests.
#[derive(Debug, Clone)]
pub struct X402Client {
    inner: Client,
}

impl X402Client {
    /// Creates a new [`X402Client`] with default [`reqwest`] settings.
    pub fn new() -> Self {
        Self {
            inner: Client::new(),
        }
    }

    /// Parses x402 payment requirements from a `HeaderMap`.
    ///
    /// Required headers:
    /// - `X-Payment-URL`
    /// - `X-Payment-Amount`
    /// - `X-Payment-Token`
    /// - `X-Payment-ChainId`
    /// - `X-Payment-Recipient`
    ///
    /// Optional headers:
    /// - `X-Payment-Memo`
    ///
    /// # Errors
    ///
    /// Returns [`X402Error::MissingHeader`] if any required header is absent,
    /// or [`X402Error::InvalidPayment`] if a header value is malformed.
    pub fn parse_402_response(headers: &HeaderMap) -> Result<X402PaymentRequired, X402Error> {
        let payment_url = Self::required_str(headers, "x-payment-url")?;
        let amount = Self::required_str(headers, "x-payment-amount")?;
        let token = Self::required_str(headers, "x-payment-token")?;
        let chain_id_str = Self::required_str(headers, "x-payment-chainid")?;
        let recipient = Self::required_str(headers, "x-payment-recipient")?;
        let memo = Self::optional_str(headers, "x-payment-memo")?;

        let chain_id = chain_id_str
            .parse::<u64>()
            .map_err(|_| X402Error::InvalidPayment(format!("invalid chain_id: {chain_id_str}")))?;

        Ok(X402PaymentRequired {
            payment_url,
            amount,
            token,
            chain_id,
            recipient,
            memo,
        })
    }

    /// Formats the `X-Payment` header value for the follow-up request.
    ///
    /// The format is:
    /// `<recipient>:<amount>:<token>:<chain_id>:<signature>[:<memo>]`
    pub fn create_payment_header(payment: &X402PaymentRequired, signature: &str) -> String {
        let mut parts = vec![
            payment.recipient.clone(),
            payment.amount.clone(),
            payment.token.clone(),
            payment.chain_id.to_string(),
            signature.to_string(),
        ];
        if let Some(memo) = &payment.memo {
            parts.push(memo.clone());
        }
        parts.join(":")
    }

    /// Makes an authenticated request carrying a pre-built `X-Payment` header.
    ///
    /// # Errors
    ///
    /// Returns [`X402Error::HttpError`] on transport failure, or
    /// [`X402Error::PaymentFailed`] if the server responds with a non-2xx
    /// status code.
    pub async fn request_with_payment(
        &self,
        url: &str,
        method: &str,
        payment_header: &str,
    ) -> Result<reqwest::Response, X402Error> {
        let method = Method::from_str(method)
            .map_err(|_| X402Error::InvalidPayment(format!("unknown HTTP method: {method}")))?;

        let header_value = HeaderValue::from_str(payment_header).map_err(|_| {
            X402Error::InvalidPayment("payment header contains invalid characters".to_string())
        })?;

        let response = self
            .inner
            .request(method, url)
            .header("x-payment", header_value)
            .send()
            .await?;

        if response.status().is_success() {
            Ok(response)
        } else {
            Err(X402Error::PaymentFailed(format!(
                "server returned {}",
                response.status()
            )))
        }
    }

    /// Executes the full x402 flow: initial request → parse 402 → sign →
    /// retry with payment.
    ///
    /// `sign_fn` is a synchronous callback that receives a reference to the
    /// parsed [`X402PaymentRequired`] and returns the hex-encoded signature
    /// string to include in the `X-Payment` header.
    ///
    /// # Errors
    ///
    /// - [`X402Error::HttpError`] — transport failure on either leg.
    /// - [`X402Error::MissingHeader`] / [`X402Error::InvalidPayment`] — bad 402 headers.
    /// - [`X402Error::PaymentFailed`] — server rejects the payment on retry.
    pub async fn execute_with_payment(
        &self,
        url: &str,
        method: &str,
        sign_fn: impl Fn(&X402PaymentRequired) -> String,
    ) -> Result<reqwest::Response, X402Error> {
        let method_obj = Method::from_str(method)
            .map_err(|_| X402Error::InvalidPayment(format!("unknown HTTP method: {method}")))?;

        // First attempt — expect a 402.
        let initial = self.inner.request(method_obj, url).send().await?;

        if initial.status() != reqwest::StatusCode::PAYMENT_REQUIRED {
            if initial.status().is_success() {
                return Ok(initial);
            }
            return Err(X402Error::PaymentFailed(format!(
                "unexpected status: {}",
                initial.status()
            )));
        }

        let payment = Self::parse_402_response(initial.headers())?;
        let signature = sign_fn(&payment);
        let payment_header = Self::create_payment_header(&payment, &signature);

        self.request_with_payment(url, method, &payment_header)
            .await
    }

    // -------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------

    fn required_str(headers: &HeaderMap, name: &str) -> Result<String, X402Error> {
        headers
            .get(name)
            .ok_or_else(|| X402Error::MissingHeader(name.to_string()))
            .and_then(|v| {
                v.to_str()
                    .map(str::to_owned)
                    .map_err(|_| X402Error::InvalidPayment(format!("non-UTF8 value in {name}")))
            })
    }

    fn optional_str(headers: &HeaderMap, name: &str) -> Result<Option<String>, X402Error> {
        match headers.get(name) {
            None => Ok(None),
            Some(v) => v
                .to_str()
                .map(|s| Some(s.to_owned()))
                .map_err(|_| X402Error::InvalidPayment(format!("non-UTF8 value in {name}"))),
        }
    }
}

impl Default for X402Client {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

    // Helper: build a HeaderMap from key-value pairs.
    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in pairs {
            map.insert(
                HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        map
    }

    fn full_402_headers() -> HeaderMap {
        headers(&[
            ("x-payment-url", "https://pay.example.com/pay"),
            ("x-payment-amount", "1.00"),
            ("x-payment-token", "USDC"),
            ("x-payment-chainid", "8453"),
            (
                "x-payment-recipient",
                "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            ),
        ])
    }

    // --- parse_402_response ---

    #[test]
    fn parse_full_402_headers() {
        let hdrs = full_402_headers();
        let payment = X402Client::parse_402_response(&hdrs).unwrap();
        assert_eq!(payment.payment_url, "https://pay.example.com/pay");
        assert_eq!(payment.amount, "1.00");
        assert_eq!(payment.token, "USDC");
        assert_eq!(payment.chain_id, 8453);
        assert_eq!(
            payment.recipient,
            "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
        );
        assert_eq!(payment.memo, None);
    }

    #[test]
    fn parse_402_with_memo() {
        let mut hdrs = full_402_headers();
        hdrs.insert(
            HeaderName::from_static("x-payment-memo"),
            HeaderValue::from_static("invoice-42"),
        );
        let payment = X402Client::parse_402_response(&hdrs).unwrap();
        assert_eq!(payment.memo, Some("invoice-42".to_string()));
    }

    #[test]
    fn parse_missing_url_header() {
        let hdrs = headers(&[
            ("x-payment-amount", "1.00"),
            ("x-payment-token", "USDC"),
            ("x-payment-chainid", "1"),
            ("x-payment-recipient", "0xabc"),
        ]);
        let err = X402Client::parse_402_response(&hdrs).unwrap_err();
        assert!(matches!(err, X402Error::MissingHeader(h) if h == "x-payment-url"));
    }

    #[test]
    fn parse_missing_amount_header() {
        let hdrs = headers(&[
            ("x-payment-url", "https://pay.example.com/pay"),
            ("x-payment-token", "USDC"),
            ("x-payment-chainid", "1"),
            ("x-payment-recipient", "0xabc"),
        ]);
        let err = X402Client::parse_402_response(&hdrs).unwrap_err();
        assert!(matches!(err, X402Error::MissingHeader(h) if h == "x-payment-amount"));
    }

    #[test]
    fn parse_invalid_chain_id() {
        let hdrs = headers(&[
            ("x-payment-url", "https://pay.example.com/pay"),
            ("x-payment-amount", "1.00"),
            ("x-payment-token", "USDC"),
            ("x-payment-chainid", "not-a-number"),
            ("x-payment-recipient", "0xabc"),
        ]);
        let err = X402Client::parse_402_response(&hdrs).unwrap_err();
        assert!(matches!(err, X402Error::InvalidPayment(_)));
    }

    // --- create_payment_header ---

    #[test]
    fn create_payment_header_without_memo() {
        let payment = X402PaymentRequired {
            payment_url: "https://pay.example.com/pay".to_string(),
            amount: "1.00".to_string(),
            token: "USDC".to_string(),
            chain_id: 8453,
            recipient: "0xrecipient".to_string(),
            memo: None,
        };
        let header = X402Client::create_payment_header(&payment, "0xsig");
        assert_eq!(header, "0xrecipient:1.00:USDC:8453:0xsig");
    }

    #[test]
    fn create_payment_header_with_memo() {
        let payment = X402PaymentRequired {
            payment_url: "https://pay.example.com/pay".to_string(),
            amount: "2.50".to_string(),
            token: "ETH".to_string(),
            chain_id: 1,
            recipient: "0xrecipient".to_string(),
            memo: Some("purchase-99".to_string()),
        };
        let header = X402Client::create_payment_header(&payment, "0xsig");
        assert_eq!(header, "0xrecipient:2.50:ETH:1:0xsig:purchase-99");
    }

    // --- X402Client construction ---

    #[test]
    fn client_new_and_default_are_equivalent() {
        // Both constructors should produce a usable client (structural test).
        let _a = X402Client::new();
        let _b = X402Client::default();
    }

    // --- Error display ---

    #[test]
    fn missing_header_error_display() {
        let err = X402Error::MissingHeader("x-payment-url".to_string());
        assert!(err.to_string().contains("x-payment-url"));
    }

    #[test]
    fn invalid_payment_error_display() {
        let err = X402Error::InvalidPayment("bad chain_id".to_string());
        assert!(err.to_string().contains("bad chain_id"));
    }

    #[test]
    fn payment_failed_error_display() {
        let err = X402Error::PaymentFailed("server returned 402".to_string());
        assert!(err.to_string().contains("402"));
    }
}
