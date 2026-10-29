//! Server-sent events and the two completion stream shapes, ported from
//! `packages/core/src/ai/sse.ts` and checked against the same fixtures
//! (`test/ai-fixtures/sse/`).
//!
//! `SseParser` reassembles events from arbitrary text chunks (WHATWG
//! event-stream rules: CRLF, CR or LF, `:` comments, multi-line `data`).
//! Network bytes are decoded first by `Utf8Chunker`, which holds back a
//! multi-byte character split across two chunks. Two readers sit on top:
//!
//! - OpenAI Chat Completions (OpenAI, oMLX, LM Studio, Ollama `/v1`, vLLM):
//!   `data: {choices:[{delta:{content}}]}` ending in `data: [DONE]`.
//!   `reasoning_content` deltas are thinking, not text.
//! - Anthropic Messages: `message_start`, `content_block_delta` with
//!   `text_delta`, `message_delta` (stop reason, usage), `message_stop`, and
//!   an `error` event.
//!
//! A stream that ends without its terminator is truncated: the outcome's
//! finish reason is `Error`.

use serde_json::Value;

use super::errors::{AiError, ErrorCode};
use super::model::{EngineKind, FinishReason, Usage};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

#[derive(Default)]
pub struct SseParser {
    buffer: String,
    started: bool,
    data_lines: Vec<String>,
    event_name: Option<String>,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed decoded text; returns the events it completed.
    pub fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        let mut text = chunk;
        if !self.started && !text.is_empty() {
            self.started = true;
            text = text.strip_prefix('\u{feff}').unwrap_or(text);
        }
        self.buffer.push_str(text);
        let mut events = Vec::new();
        loop {
            let Some(idx) = self.buffer.find(['\r', '\n']) else { break };
            let bytes = self.buffer.as_bytes();
            let eol = if bytes[idx] == b'\r' {
                // A lone CR at the very end may be half of a CRLF split across chunks.
                if idx == bytes.len() - 1 {
                    break;
                }
                if bytes[idx + 1] == b'\n' { 2 } else { 1 }
            } else {
                1
            };
            let line: String = self.buffer[..idx].to_string();
            self.buffer.drain(..idx + eol);
            if let Some(event) = self.line(&line) {
                events.push(event);
            }
        }
        events
    }

    /// The stream closed: flush a final event that had no trailing blank line.
    pub fn end(&mut self) -> Vec<SseEvent> {
        let mut events = Vec::new();
        if !self.buffer.is_empty() {
            let rest = std::mem::take(&mut self.buffer);
            let rest = rest.strip_suffix('\r').unwrap_or(&rest).to_string();
            if let Some(event) = self.line(&rest) {
                events.push(event);
            }
        }
        if let Some(last) = self.line("") {
            events.push(last);
        }
        events
    }

    fn line(&mut self, line: &str) -> Option<SseEvent> {
        if line.is_empty() {
            if self.data_lines.is_empty() {
                self.event_name = None;
                return None;
            }
            let event = SseEvent { event: self.event_name.take(), data: self.data_lines.join("\n") };
            self.data_lines.clear();
            return Some(event);
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = match line.find(':') {
            Some(i) => (&line[..i], line[i + 1..].strip_prefix(' ').unwrap_or(&line[i + 1..])),
            None => (line, ""),
        };
        match field {
            "data" => self.data_lines.push(value.to_string()),
            "event" => self.event_name = Some(value.to_string()),
            _ => {}
        }
        None
    }
}

/// Decodes a byte stream into text without splitting a multi-byte character
/// that straddles two network chunks. Invalid bytes become U+FFFD.
#[derive(Default)]
pub struct Utf8Chunker {
    pending: Vec<u8>,
}

impl Utf8Chunker {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        let mut start = 0;
        loop {
            match std::str::from_utf8(&self.pending[start..]) {
                Ok(valid) => {
                    out.push_str(valid);
                    start = self.pending.len();
                    break;
                }
                Err(e) => {
                    let valid_end = start + e.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[start..valid_end]).unwrap_or(""));
                    match e.error_len() {
                        // An incomplete sequence at the end: keep it for the next chunk.
                        None => {
                            start = valid_end;
                            break;
                        }
                        Some(n) => {
                            out.push('\u{fffd}');
                            start = valid_end + n;
                        }
                    }
                }
            }
        }
        self.pending.drain(..start);
        out
    }

    /// The stream closed; a dangling partial character decodes as U+FFFD.
    pub fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            String::new()
        } else {
            self.pending.clear();
            "\u{fffd}".to_string()
        }
    }
}

/// Where a completion stream ended up.
#[derive(Clone, Debug, PartialEq)]
pub struct StreamOutcome {
    pub text: String,
    pub finish_reason: FinishReason,
    pub usage: Option<Usage>,
    /// The provider's own stop reason (`end_turn`, `length`, ...).
    pub stop_reason: Option<String>,
    /// A stream-level error event, mapped to a code.
    pub error: Option<AiError>,
}

fn error_code_from_type(t: Option<&str>) -> ErrorCode {
    match t {
        Some("authentication_error" | "permission_error" | "invalid_api_key") => ErrorCode::Auth,
        Some("not_found_error" | "model_not_found") => ErrorCode::ModelNotFound,
        Some("rate_limit_error" | "overloaded_error" | "rate_limit_exceeded") => ErrorCode::RateLimited,
        Some("context_length_exceeded" | "request_too_large") => ErrorCode::ContextOverflow,
        _ => ErrorCode::Unknown,
    }
}

fn stream_error(raw: &Value) -> AiError {
    let message = raw
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| raw.as_str())
        .unwrap_or("The stream reported an error.")
        .to_string();
    let kind = raw.get("type").or_else(|| raw.get("code")).and_then(Value::as_str);
    AiError::new(error_code_from_type(kind), message)
}

fn map_openai_finish(reason: &str) -> FinishReason {
    match reason {
        "length" => FinishReason::Length,
        "stop" | "tool_calls" | "function_call" | "eos" => FinishReason::Stop,
        _ => FinishReason::Error,
    }
}

fn map_anthropic_stop(reason: &str) -> FinishReason {
    match reason {
        "max_tokens" | "model_context_window_exceeded" => FinishReason::Length,
        "end_turn" | "stop_sequence" | "tool_use" | "pause_turn" => FinishReason::Stop,
        _ => FinishReason::Error,
    }
}

fn as_u64(v: Option<&Value>) -> Option<u64> {
    v.and_then(Value::as_u64)
}

fn parse_object(data: &str) -> Option<Value> {
    serde_json::from_str::<Value>(data).ok().filter(Value::is_object)
}

/// One completion stream: push decoded text, get deltas back, then `finish`.
pub struct StreamReader {
    kind: EngineKind,
    parser: SseParser,
    text: String,
    done: bool,
    stop_reason: Option<String>,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    error: Option<AiError>,
    /// Reasoning (`reasoning_content`, `reasoning`, Anthropic `thinking_delta`), in UTF-16 units.
    reasoning_chars: u64,
}

impl StreamReader {
    pub fn new(kind: EngineKind) -> Self {
        Self {
            kind,
            parser: SseParser::new(),
            text: String::new(),
            done: false,
            stop_reason: None,
            prompt_tokens: None,
            completion_tokens: None,
            error: None,
            reasoning_chars: 0,
        }
    }

    /// Port of `outputChars()`: answer plus reasoning so far, in UTF-16 units
    /// (JavaScript string length), so both hosts estimate the same tokens.
    pub fn output_chars(&self) -> u64 {
        self.text.encode_utf16().count() as u64 + self.reasoning_chars
    }

    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        let events = self.parser.push(chunk);
        self.handle(events)
    }

    pub fn finish(&mut self) -> StreamOutcome {
        let events = self.parser.end();
        self.handle(events);
        let anthropic = self.kind == EngineKind::Anthropic;
        let finish_reason = if self.error.is_some() || !self.done {
            FinishReason::Error
        } else {
            match self.stop_reason.as_deref() {
                Some(r) if anthropic => map_anthropic_stop(r),
                Some(r) => map_openai_finish(r),
                None => FinishReason::Stop,
            }
        };
        let usage = (self.prompt_tokens.is_some() || self.completion_tokens.is_some())
            .then_some(Usage { prompt_tokens: self.prompt_tokens, completion_tokens: self.completion_tokens });
        StreamOutcome {
            text: self.text.clone(),
            finish_reason,
            usage,
            stop_reason: self.stop_reason.clone(),
            error: self.error.clone(),
        }
    }

    fn handle(&mut self, events: Vec<SseEvent>) -> Vec<String> {
        if self.kind == EngineKind::Anthropic {
            self.handle_anthropic(events)
        } else {
            self.handle_openai(events)
        }
    }

    fn handle_openai(&mut self, events: Vec<SseEvent>) -> Vec<String> {
        let mut deltas = Vec::new();
        for ev in events {
            let data = ev.data.trim();
            if data == "[DONE]" {
                self.done = true;
                continue;
            }
            let Some(json) = parse_object(data) else { continue };
            if let Some(err) = json.get("error") {
                self.error = Some(stream_error(err));
                continue;
            }
            if let Some(u) = json.get("usage").filter(|u| u.is_object()) {
                self.prompt_tokens = as_u64(u.get("prompt_tokens"));
                self.completion_tokens = as_u64(u.get("completion_tokens"));
            }
            for choice in json.get("choices").and_then(Value::as_array).into_iter().flatten() {
                if let Some(content) = choice.pointer("/delta/content").and_then(Value::as_str) {
                    if !content.is_empty() {
                        self.text.push_str(content);
                        deltas.push(content.to_string());
                    }
                }
                let reasoning = choice.pointer("/delta/reasoning_content").or_else(|| choice.pointer("/delta/reasoning"));
                if let Some(r) = reasoning.and_then(Value::as_str) {
                    self.reasoning_chars += r.encode_utf16().count() as u64;
                }
                if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                    if !reason.is_empty() {
                        self.stop_reason = Some(reason.to_string());
                    }
                }
            }
        }
        deltas
    }

    fn handle_anthropic(&mut self, events: Vec<SseEvent>) -> Vec<String> {
        let mut deltas = Vec::new();
        for ev in events {
            let Some(json) = parse_object(&ev.data) else { continue };
            let kind = json.get("type").and_then(Value::as_str).or(ev.event.as_deref());
            match kind {
                Some("message_start") => {
                    let usage = json.pointer("/message/usage");
                    self.prompt_tokens = as_u64(usage.and_then(|u| u.get("input_tokens"))).or(self.prompt_tokens);
                    self.completion_tokens = as_u64(usage.and_then(|u| u.get("output_tokens"))).or(self.completion_tokens);
                }
                Some("content_block_delta") => {
                    let delta = json.get("delta");
                    match delta.and_then(|d| d.get("type")).and_then(Value::as_str) {
                        Some("text_delta") => {
                            if let Some(text) = delta.and_then(|d| d.get("text")).and_then(Value::as_str) {
                                if !text.is_empty() {
                                    self.text.push_str(text);
                                    deltas.push(text.to_string());
                                }
                            }
                        }
                        Some("thinking_delta") => {
                            if let Some(thinking) = delta.and_then(|d| d.get("thinking")).and_then(Value::as_str) {
                                self.reasoning_chars += thinking.encode_utf16().count() as u64;
                            }
                        }
                        _ => {}
                    }
                }
                Some("message_delta") => {
                    if let Some(reason) = json.pointer("/delta/stop_reason").and_then(Value::as_str) {
                        self.stop_reason = Some(reason.to_string());
                    }
                    let usage = json.get("usage");
                    self.prompt_tokens = as_u64(usage.and_then(|u| u.get("input_tokens"))).or(self.prompt_tokens);
                    self.completion_tokens = as_u64(usage.and_then(|u| u.get("output_tokens"))).or(self.completion_tokens);
                }
                Some("message_stop") => self.done = true,
                Some("error") => {
                    self.error = Some(stream_error(json.get("error").unwrap_or(&Value::Null)));
                }
                _ => {}
            }
        }
        deltas
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../test/ai-fixtures")
    }

    #[test]
    fn events_survive_arbitrary_chunking_and_all_line_endings() {
        let mut p = SseParser::new();
        let mut out = Vec::new();
        for chunk in ["\u{feff}: ping\r", "\ndata: one\r", "\n\r", "\nevent: x\ndata: a\ndata: ", "b\n\n", "data: tail"] {
            out.extend(p.push(chunk));
        }
        out.extend(p.end());
        assert_eq!(
            out,
            vec![
                SseEvent { event: None, data: "one".into() },
                SseEvent { event: Some("x".into()), data: "a\nb".into() },
                SseEvent { event: None, data: "tail".into() },
            ]
        );
    }

    #[test]
    fn a_character_split_across_chunks_is_not_mangled() {
        let bytes = "héllo €".as_bytes();
        let mut c = Utf8Chunker::default();
        let mut out = String::new();
        // One byte at a time: every multi-byte character is split.
        for b in bytes {
            out.push_str(&c.push(&[*b]));
        }
        out.push_str(&c.finish());
        assert_eq!(out, "héllo €");
        // Invalid bytes become the replacement character without eating the rest.
        let mut c = Utf8Chunker::default();
        assert_eq!(c.push(&[b'a', 0xff, b'b']), "a\u{fffd}b");
    }

    #[test]
    fn every_sse_fixture_reads_the_same_as_the_typescript_reader() {
        let dir = fixtures().join("sse");
        let mut seen = 0;
        for entry in std::fs::read_dir(&dir).expect("sse fixtures") {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let fixture: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let kind = match fixture["kind"].as_str().unwrap() {
                "anthropic" => EngineKind::Anthropic,
                _ => EngineKind::OpenAiCompatible,
            };
            let mut reader = StreamReader::new(kind);
            let mut deltas: Vec<String> = Vec::new();
            for chunk in fixture["chunks"].as_array().unwrap() {
                deltas.extend(reader.push(chunk.as_str().unwrap()));
            }
            let outcome = reader.finish();
            let expected = &fixture["expected"];
            let want_deltas: Vec<String> =
                expected["deltas"].as_array().unwrap().iter().map(|d| d.as_str().unwrap().to_string()).collect();
            assert_eq!(deltas, want_deltas, "{name}: deltas");
            assert_eq!(outcome.text, expected["text"].as_str().unwrap(), "{name}: text");
            let finish = match outcome.finish_reason {
                FinishReason::Stop => "stop",
                FinishReason::Length => "length",
                FinishReason::Error => "error",
                FinishReason::Cancelled => "cancelled",
            };
            assert_eq!(finish, expected["finishReason"].as_str().unwrap(), "{name}: finishReason");
            assert_eq!(outcome.stop_reason.as_deref(), expected["stopReason"].as_str(), "{name}: stopReason");
            if let Some(chars) = fixture.get("outputChars") {
                assert_eq!(reader.output_chars(), chars.as_u64().unwrap(), "{name}: outputChars");
            }
            match expected.get("usage") {
                Some(u) => {
                    let got = outcome.usage.unwrap_or_else(|| panic!("{name}: usage missing"));
                    assert_eq!(got.prompt_tokens, u["promptTokens"].as_u64(), "{name}: promptTokens");
                    assert_eq!(got.completion_tokens, u["completionTokens"].as_u64(), "{name}: completionTokens");
                }
                None => assert!(outcome.usage.is_none(), "{name}: unexpected usage"),
            }
            match expected.get("error") {
                Some(e) => {
                    let got = outcome.error.unwrap_or_else(|| panic!("{name}: error missing"));
                    assert_eq!(got.code.as_str(), e["code"].as_str().unwrap(), "{name}: error code");
                    assert_eq!(got.message, e["message"].as_str().unwrap(), "{name}: error message");
                }
                None => assert!(outcome.error.is_none(), "{name}: unexpected error"),
            }
            seen += 1;
        }
        assert_eq!(seen, 7, "all seven sse fixtures are covered");
    }
}
