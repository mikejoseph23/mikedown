//! `AiError`: what every AI command rejects with. Serializes as
//! `{ code, message }`, the `AiError` shape in `@mikedown/core/ai`, so it
//! crosses `invoke` and the `ai-error:<id>` events unchanged. The HTTP
//! mapping mirrors `aiErrorCodeFromHttp` in core.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    Unreachable,
    Auth,
    ModelNotFound,
    ModelLoadFailed,
    ContextOverflow,
    RateLimited,
    CloudBlocked,
    ConsentDenied,
    Cancelled,
    Unknown,
}

impl ErrorCode {
    /// The camelCase name, for tests and logs.
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::Unreachable => "unreachable",
            ErrorCode::Auth => "auth",
            ErrorCode::ModelNotFound => "modelNotFound",
            ErrorCode::ModelLoadFailed => "modelLoadFailed",
            ErrorCode::ContextOverflow => "contextOverflow",
            ErrorCode::RateLimited => "rateLimited",
            ErrorCode::CloudBlocked => "cloudBlocked",
            ErrorCode::ConsentDenied => "consentDenied",
            ErrorCode::Cancelled => "cancelled",
            ErrorCode::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AiError {
    pub code: ErrorCode,
    pub message: String,
}

impl AiError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorCode::Cancelled, "The request was cancelled.")
    }

    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unknown, message)
    }
}

impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

/// A local server that could not load the model (LM Studio, llama.cpp,
/// Ollama). Mirrors `MODEL_LOAD_FAILED_PHRASES` in core.
pub const MODEL_LOAD_FAILED_PHRASES: [&str; 8] = [
    "failed to load model",
    "error loading model",
    "unable to load model",
    "could not load model",
    "couldn't load model",
    "model failed to load",
    "llama runner process has terminated",
    "requires more system memory",
];

/// 401/403 auth, 404 modelNotFound, a body that says the model failed to
/// load modelLoadFailed, 413 or a 400 that mentions the context
/// contextOverflow, 429 and 529 rateLimited, 502/503/504 unreachable,
/// everything else unknown.
pub fn code_from_http(status: u16, body: &str) -> ErrorCode {
    let lower = body.to_lowercase();
    match status {
        401 | 403 => ErrorCode::Auth,
        404 => ErrorCode::ModelNotFound,
        _ if MODEL_LOAD_FAILED_PHRASES.iter().any(|p| lower.contains(p)) => ErrorCode::ModelLoadFailed,
        413 => ErrorCode::ContextOverflow,
        429 | 529 => ErrorCode::RateLimited,
        400 if ["context", "too long", "token limit"].iter().any(|k| lower.contains(k))
            || (lower.contains("maximum") && lower.contains("tokens")) =>
        {
            ErrorCode::ContextOverflow
        }
        400 if lower.contains("no such model")
            || (lower.contains("model")
                && ["not found", "does not exist", "unknown"].iter().any(|k| lower.contains(k))) =>
        {
            ErrorCode::ModelNotFound
        }
        502..=504 => ErrorCode::Unreachable,
        _ => ErrorCode::Unknown,
    }
}

/// The human message inside an error body (`{ error: { message } }`,
/// `{ error: "..." }`, `{ message }`), else the trimmed text.
pub fn message_from_body(status: u16, body: &str) -> String {
    let fallback = || {
        let text = body.trim();
        if text.is_empty() {
            format!("HTTP {status}")
        } else {
            let short: String = text.chars().take(300).collect();
            format!("HTTP {status}: {short}")
        }
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
        return fallback();
    };
    let message = json
        .pointer("/error/message")
        .or_else(|| json.get("error"))
        .or_else(|| json.get("message"))
        .and_then(|v| v.as_str());
    match message {
        Some(m) if !m.trim().is_empty() => format!("HTTP {status}: {m}"),
        _ => fallback(),
    }
}

/// A failed `send()` or body read.
pub fn from_reqwest(err: &reqwest::Error) -> AiError {
    if err.is_connect() || err.is_timeout() || err.is_request() {
        AiError::new(ErrorCode::Unreachable, format!("Could not reach the engine: {}", strip_url(err)))
    } else {
        AiError::unknown(strip_url(err))
    }
}

/// reqwest errors embed the URL; keep the message short and free of query strings.
fn strip_url(err: &reqwest::Error) -> String {
    err.to_string().split(" for url ").next().unwrap_or("request failed").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_statuses_map_like_core() {
        assert_eq!(code_from_http(401, ""), ErrorCode::Auth);
        assert_eq!(code_from_http(403, ""), ErrorCode::Auth);
        assert_eq!(code_from_http(404, ""), ErrorCode::ModelNotFound);
        assert_eq!(code_from_http(413, ""), ErrorCode::ContextOverflow);
        assert_eq!(code_from_http(429, ""), ErrorCode::RateLimited);
        assert_eq!(code_from_http(529, ""), ErrorCode::RateLimited);
        assert_eq!(code_from_http(503, ""), ErrorCode::Unreachable);
        assert_eq!(code_from_http(500, ""), ErrorCode::Unknown);
        assert_eq!(code_from_http(400, "This model's maximum context length is 8192 tokens"), ErrorCode::ContextOverflow);
        assert_eq!(code_from_http(400, "The model `x` does not exist"), ErrorCode::ModelNotFound);
        assert_eq!(code_from_http(400, "bad json"), ErrorCode::Unknown);
    }

    #[test]
    fn a_model_that_did_not_load_maps_like_core() {
        let lm = r#"{"error":"Failed to load model \"qwen3.8-flash-next-oq5e-mtp\". Error: Failed to load model."}"#;
        assert_eq!(code_from_http(400, lm), ErrorCode::ModelLoadFailed);
        // A load failure that mentions the context is still a load failure.
        assert_eq!(code_from_http(400, "Failed to load model: context length too large for memory"), ErrorCode::ModelLoadFailed);
        assert_eq!(code_from_http(500, r#"{"error":"llama runner process has terminated: exit status 2"}"#), ErrorCode::ModelLoadFailed);
        assert_eq!(code_from_http(500, "model requires more system memory (40 GiB) than is available (16 GiB)"), ErrorCode::ModelLoadFailed);
        assert_eq!(code_from_http(503, "Loading model"), ErrorCode::Unreachable);
        assert_eq!(code_from_http(401, "failed to load model"), ErrorCode::Auth);
        assert_eq!(ErrorCode::ModelLoadFailed.as_str(), "modelLoadFailed");
    }

    #[test]
    fn body_messages_are_pulled_out_of_error_objects() {
        assert_eq!(message_from_body(401, r#"{"error":{"message":"bad key"}}"#), "HTTP 401: bad key");
        assert_eq!(message_from_body(500, r#"{"error":"boom"}"#), "HTTP 500: boom");
        assert_eq!(message_from_body(502, ""), "HTTP 502");
        assert_eq!(message_from_body(500, "plain text"), "HTTP 500: plain text");
    }

    #[test]
    fn errors_serialize_as_code_and_message() {
        let json = serde_json::to_value(AiError::new(ErrorCode::ModelNotFound, "x")).unwrap();
        assert_eq!(json, serde_json::json!({ "code": "modelNotFound", "message": "x" }));
    }
}
