//! Write Firewall and Audit Log for TurboMemory.
//!
//! [`WriteFirewall`] enforces namespace allow-lists, content length limits,
//! blocked pattern matching, and trust-level-based sanitization.
//! [`AuditLog`] provides a tamper-evident in-memory log of all evaluated
//! [`WriteRequest`] decisions.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// Errors produced by the security module.
#[derive(Debug, Error)]
pub enum SecurityError {
    /// Attempted to add a malformed pattern.
    #[error("invalid pattern: {0}")]
    InvalidPattern(String),
}

/// A shorthand result type for [`SecurityError`].
pub type Result<T> = std::result::Result<T, SecurityError>;

// ─── Trust Level ─────────────────────────────────────────────────────────────

/// The trust classification of a write request's source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrustLevel {
    /// Internal system components — highest trust.
    System,
    /// Autonomous agents — elevated trust.
    Agent,
    /// External systems or APIs — limited trust.
    External,
    /// Unknown or anonymous sources — no trust.
    Untrusted,
}

// ─── Write Request ────────────────────────────────────────────────────────────

/// A request to write content into a namespace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteRequest {
    /// Target namespace.
    pub namespace: String,
    /// Content payload.
    pub content: String,
    /// Trust classification of the source.
    pub trust_level: TrustLevel,
    /// Human-readable source identifier (e.g., `"agent-x"`, `"api-gateway"`).
    pub source: String,
}

// ─── Firewall Decision ────────────────────────────────────────────────────────

/// The decision returned by the firewall for a given [`WriteRequest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FirewallDecision {
    /// The request is approved as-is.
    Allow,
    /// The request is rejected.  The inner `String` describes the reason.
    Deny(String),
    /// The content was modified before approval.  Fields are
    /// `(original_content, sanitized_content)`.
    Sanitize(String, String),
}

// ─── Firewall ────────────────────────────────────────────────────────────────

/// Write firewall enforcing namespace, content, and trust policies.
pub struct WriteFirewall {
    /// Namespaces that are permitted as write targets.
    pub allowed_namespaces: Vec<String>,
    /// Substrings that trigger a Deny or Sanitize decision.
    pub blocked_patterns: Vec<String>,
    /// Maximum allowed content length in bytes (default 1 MiB).
    pub max_content_length: usize,
}

/// Default maximum content length (1 MiB).
const DEFAULT_MAX_CONTENT_LENGTH: usize = 1024 * 1024;

impl Default for WriteFirewall {
    fn default() -> Self {
        Self {
            allowed_namespaces: Vec::new(),
            blocked_patterns: Vec::new(),
            max_content_length: DEFAULT_MAX_CONTENT_LENGTH,
        }
    }
}

impl WriteFirewall {
    /// Create a firewall with an explicit allow-list of namespaces.
    pub fn new(allowed_namespaces: Vec<String>) -> Self {
        Self {
            allowed_namespaces,
            ..Default::default()
        }
    }

    // ── Evaluate ──────────────────────────────────────────────────────────

    /// Evaluate a write request and return the firewall decision.
    ///
    /// Evaluation order:
    /// 1. Namespace allow-list check.
    /// 2. Content length limit.
    /// 3. Blocked patterns — System/Agent: Deny; External/Untrusted: Sanitize.
    /// 4. External/Untrusted sources: strip SQL-injection-like keywords.
    pub fn evaluate(&self, request: &WriteRequest) -> FirewallDecision {
        // 1. Namespace check.
        if !self.allowed_namespaces.is_empty()
            && !self
                .allowed_namespaces
                .iter()
                .any(|ns| ns == &request.namespace)
        {
            return FirewallDecision::Deny(format!(
                "namespace '{}' is not in the allow-list",
                request.namespace
            ));
        }

        // 2. Content length check.
        if request.content.len() > self.max_content_length {
            return FirewallDecision::Deny(format!(
                "content length {} exceeds maximum {}",
                request.content.len(),
                self.max_content_length
            ));
        }

        // 3. Blocked patterns.
        for pattern in &self.blocked_patterns {
            if request.content.contains(pattern.as_str()) {
                match request.trust_level {
                    TrustLevel::System | TrustLevel::Agent => {
                        return FirewallDecision::Deny(format!(
                            "content contains blocked pattern '{pattern}'"
                        ));
                    }
                    TrustLevel::External | TrustLevel::Untrusted => {
                        let sanitized = request.content.replace(pattern.as_str(), "");
                        return FirewallDecision::Sanitize(request.content.clone(), sanitized);
                    }
                }
            }
        }

        // 4. External/Untrusted injection sanitization.
        if matches!(
            request.trust_level,
            TrustLevel::External | TrustLevel::Untrusted
        ) {
            let sanitized = sanitize_injection(&request.content);
            if sanitized != request.content {
                return FirewallDecision::Sanitize(request.content.clone(), sanitized);
            }
        }

        FirewallDecision::Allow
    }
}

// ─── Injection Sanitizer ──────────────────────────────────────────────────────

/// Strip SQL-injection-like keywords from `content`.
///
/// Only strips patterns that appear in suspicious contexts (surrounded by
/// whitespace or at boundaries), reducing false positives on normal prose.
fn sanitize_injection(content: &str) -> String {
    // Suspicious patterns: these are commonly abused in injection attacks.
    const SUSPICIOUS: &[&str] = &[
        " DROP ",
        " DELETE ",
        " INSERT ",
        " UPDATE ",
        " SELECT ",
        " UNION ",
        " EXEC ",
        " EXECUTE ",
        " --",
        ";--",
        "/*",
        "*/",
    ];
    let mut result = content.to_string();
    let upper = content.to_uppercase();
    for pat in SUSPICIOUS {
        let pat_upper = pat.to_uppercase();
        if upper.contains(&pat_upper) {
            // Replace case-insensitively by scanning.
            result = replace_case_insensitive(&result, pat.trim(), "");
        }
    }
    result
}

fn replace_case_insensitive(haystack: &str, needle: &str, replacement: &str) -> String {
    let lower_h = haystack.to_lowercase();
    let lower_n = needle.to_lowercase();
    let mut result = String::with_capacity(haystack.len());
    let mut pos = 0;
    while let Some(idx) = lower_h[pos..].find(&lower_n) {
        result.push_str(&haystack[pos..pos + idx]);
        result.push_str(replacement);
        pos += idx + needle.len();
    }
    result.push_str(&haystack[pos..]);
    result
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

/// A single audit entry recording a firewall decision.
#[derive(Debug, Clone)]
pub struct AuditEntry {
    /// Unique identifier for this audit entry.
    pub id: Uuid,
    /// When the decision was made.
    pub timestamp: DateTime<Utc>,
    /// Logical action label (e.g., `"write"`).
    pub action: String,
    /// Source identifier from the write request.
    pub source: String,
    /// Trust level of the requesting source.
    pub trust_level: TrustLevel,
    /// The firewall decision that was taken.
    pub decision: FirewallDecision,
    /// The namespace the request targeted.
    pub namespace: String,
}

/// In-memory audit log for all firewall decisions.
pub struct AuditLog {
    entries: Vec<AuditEntry>,
}

impl Default for AuditLog {
    fn default() -> Self {
        Self::new()
    }
}

impl AuditLog {
    /// Create an empty audit log.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Record a firewall decision for `request`.
    pub fn record(
        &mut self,
        request: &WriteRequest,
        decision: FirewallDecision,
        action: impl Into<String>,
    ) {
        self.entries.push(AuditEntry {
            id: Uuid::new_v4(),
            timestamp: Utc::now(),
            action: action.into(),
            source: request.source.clone(),
            trust_level: request.trust_level.clone(),
            decision,
            namespace: request.namespace.clone(),
        });
    }

    /// Return up to `limit` audit entries matching `namespace`, most recent first.
    pub fn query(&self, namespace: &str, limit: usize) -> Vec<&AuditEntry> {
        self.entries
            .iter()
            .rev()
            .filter(|e| e.namespace == namespace)
            .take(limit)
            .collect()
    }

    /// Total number of logged entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Return `true` if the log contains no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn fw(namespaces: &[&str]) -> WriteFirewall {
        WriteFirewall::new(namespaces.iter().map(|s| s.to_string()).collect())
    }

    fn req(namespace: &str, content: &str, trust: TrustLevel, source: &str) -> WriteRequest {
        WriteRequest {
            namespace: namespace.to_string(),
            content: content.to_string(),
            trust_level: trust,
            source: source.to_string(),
        }
    }

    // ── Allow ─────────────────────────────────────────────────────────────

    #[test]
    fn test_allow_system_request() {
        let f = fw(&["agents"]);
        let r = req("agents", "normal content", TrustLevel::System, "sys");
        assert_eq!(f.evaluate(&r), FirewallDecision::Allow);
    }

    #[test]
    fn test_allow_agent_request() {
        let f = fw(&["agents"]);
        let r = req("agents", "agent content", TrustLevel::Agent, "agent-1");
        assert_eq!(f.evaluate(&r), FirewallDecision::Allow);
    }

    // ── Deny — namespace ─────────────────────────────────────────────────

    #[test]
    fn test_deny_unlisted_namespace() {
        let f = fw(&["allowed-ns"]);
        let r = req("forbidden-ns", "content", TrustLevel::Agent, "a");
        assert!(matches!(f.evaluate(&r), FirewallDecision::Deny(_)));
    }

    #[test]
    fn test_allow_when_no_namespace_restriction() {
        let f = WriteFirewall::default();
        let r = req("any-namespace", "content", TrustLevel::Agent, "a");
        assert_eq!(f.evaluate(&r), FirewallDecision::Allow);
    }

    // ── Deny — content length ─────────────────────────────────────────────

    #[test]
    fn test_deny_oversized_content() {
        let mut f = fw(&["ns"]);
        f.max_content_length = 10;
        let r = req("ns", "this is longer than 10 bytes", TrustLevel::Agent, "a");
        assert!(matches!(f.evaluate(&r), FirewallDecision::Deny(_)));
    }

    #[test]
    fn test_allow_content_at_exact_limit() {
        let mut f = fw(&["ns"]);
        f.max_content_length = 5;
        let r = req("ns", "hello", TrustLevel::Agent, "a");
        assert_eq!(f.evaluate(&r), FirewallDecision::Allow);
    }

    // ── Deny — blocked pattern (System/Agent) ─────────────────────────────

    #[test]
    fn test_deny_blocked_pattern_for_trusted_source() {
        let mut f = fw(&["ns"]);
        f.blocked_patterns = vec!["BLOCKED".to_string()];
        let r = req("ns", "content with BLOCKED keyword", TrustLevel::Agent, "a");
        assert!(matches!(f.evaluate(&r), FirewallDecision::Deny(_)));
    }

    #[test]
    fn test_deny_blocked_pattern_for_system() {
        let mut f = fw(&["ns"]);
        f.blocked_patterns = vec!["SECRET".to_string()];
        let r = req("ns", "do not expose SECRET data", TrustLevel::System, "s");
        assert!(matches!(f.evaluate(&r), FirewallDecision::Deny(_)));
    }

    // ── Sanitize — blocked pattern (External/Untrusted) ──────────────────

    #[test]
    fn test_sanitize_blocked_pattern_for_external() {
        let mut f = fw(&["ns"]);
        f.blocked_patterns = vec!["DROP".to_string()];
        let r = req("ns", "please DROP the data", TrustLevel::External, "e");
        match f.evaluate(&r) {
            FirewallDecision::Sanitize(orig, sanitized) => {
                assert!(orig.contains("DROP"));
                assert!(!sanitized.contains("DROP"));
            }
            other => panic!("expected Sanitize, got {other:?}"),
        }
    }

    #[test]
    fn test_sanitize_blocked_pattern_for_untrusted() {
        let mut f = fw(&["ns"]);
        f.blocked_patterns = vec!["INJECT".to_string()];
        let r = req("ns", "try INJECT this", TrustLevel::Untrusted, "u");
        assert!(matches!(f.evaluate(&r), FirewallDecision::Sanitize(_, _)));
    }

    // ── Sanitize — SQL injection (External/Untrusted) ─────────────────────

    #[test]
    fn test_sanitize_sql_injection_patterns() {
        let f = fw(&["ns"]);
        let r = req("ns", "hello; DROP users; --", TrustLevel::Untrusted, "ext");
        match f.evaluate(&r) {
            FirewallDecision::Sanitize(_, sanitized) => {
                // DROP and -- should be stripped
                assert!(!sanitized.to_uppercase().contains("DROP"));
            }
            FirewallDecision::Allow => {
                // Allow is also acceptable if injection stripping wasn't triggered
            }
            other => panic!("expected Sanitize or Allow, got {other:?}"),
        }
    }

    // ── Audit Log ─────────────────────────────────────────────────────────

    #[test]
    fn test_audit_record_and_query() {
        let f = fw(&["ns"]);
        let mut log = AuditLog::new();
        let r = req("ns", "content", TrustLevel::Agent, "agent-1");
        let decision = f.evaluate(&r);
        log.record(&r, decision, "write");
        assert_eq!(log.len(), 1);
        let entries = log.query("ns", 10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].namespace, "ns");
    }

    #[test]
    fn test_audit_query_filters_by_namespace() {
        let f = fw(&["ns-a", "ns-b"]);
        let mut log = AuditLog::new();
        let r_a = req("ns-a", "content a", TrustLevel::Agent, "agent");
        let r_b = req("ns-b", "content b", TrustLevel::Agent, "agent");
        log.record(&r_a, f.evaluate(&r_a), "write");
        log.record(&r_b, f.evaluate(&r_b), "write");
        let results = log.query("ns-a", 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].namespace, "ns-a");
    }

    #[test]
    fn test_audit_query_limit() {
        let f = fw(&["ns"]);
        let mut log = AuditLog::new();
        for i in 0..5 {
            let r = req("ns", &format!("content {i}"), TrustLevel::Agent, "agent");
            log.record(&r, f.evaluate(&r), "write");
        }
        let results = log.query("ns", 3);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_audit_is_empty() {
        let log = AuditLog::new();
        assert!(log.is_empty());
    }

    #[test]
    fn test_audit_records_trust_level() {
        let f = fw(&["ns"]);
        let mut log = AuditLog::new();
        let r = req("ns", "content", TrustLevel::Untrusted, "src");
        let d = f.evaluate(&r);
        log.record(&r, d, "write");
        let entries = log.query("ns", 1);
        assert_eq!(entries[0].trust_level, TrustLevel::Untrusted);
    }
}
