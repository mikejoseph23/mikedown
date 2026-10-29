//! The cloud consent dialog's words: a port of core's `privacy.ts`
//! (`aiConsentText`, `whatIsSent`, the provider policy links), so the native
//! dialog says exactly what the VS Code modal says. Checked against the shared
//! fixture `test/ai-fixtures/consent/consent-text.json`; when the copy changes
//! in core, regenerate the fixture and update the tables here.
//!
//! No claims about any provider's training or retention: the text points at
//! the provider's own policy. A native dialog can neither link nor spare one
//! of its three buttons for the policy, so the policy URL is spelled out in
//! the body (core's `policyLine`; VS Code shows a policy button instead).

/// `AI_CLOUD_PRIVACY.terms`.
pub const PRIVACY_TERMS: &str = "API traffic is covered by the provider's API terms, which differ from its consumer apps. \
Whether it is retained or used for training is set by those terms and may change; read them before you decide.";

/// `AI_SENDS_FALLBACK`: a request whose feature is unknown.
pub const SENDS_FALLBACK: &str = "the text you ask the AI about";

/// `AI_SENDS_TEXT`, by scope id.
pub fn sends_text(scope: &str) -> Option<&'static str> {
    match scope {
        "selection" => Some("the selected text and the paragraph before and after it"),
        "document" => Some("the whole document, up to what fits the model"),
        "documentAndTags" => Some("the document, its frontmatter and the tag names used in this workspace"),
        _ => None,
    }
}

/// `AI_FEATURES[].sends`: what each feature's requests send.
pub fn feature_sends(feature: &str) -> Option<&'static str> {
    match feature {
        "rewrite" => Some("selection"),
        "chat" | "summary" | "title" => Some("document"),
        "frontmatter" => Some("documentAndTags"),
        _ => None,
    }
}

/// `whatIsSent(feature, sends)`: `sends` wins, then the feature's own scope.
pub fn what_is_sent(feature: Option<&str>, sends: Option<&str>) -> &'static str {
    sends
        .and_then(sends_text)
        .or_else(|| feature.and_then(feature_sends).and_then(sends_text))
        .unwrap_or(SENDS_FALLBACK)
}

/// A cloud preset's policy link (`AiEnginePreset.policy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderPolicy {
    pub host: &'static str,
    pub label: &'static str,
    pub url: &'static str,
    pub note: Option<&'static str>,
}

/// The cloud presets' policies, by the preset's API host (URLs checked 2026-10-29).
pub const PROVIDER_POLICIES: &[ProviderPolicy] = &[
    ProviderPolicy {
        host: "api.anthropic.com",
        label: "Anthropic privacy and data use",
        url: "https://privacy.claude.com/en/collections/10663361-commercial-customers",
        note: None,
    },
    ProviderPolicy {
        host: "api.openai.com",
        label: "OpenAI API data controls",
        url: "https://developers.openai.com/api/docs/guides/your-data",
        note: None,
    },
    ProviderPolicy {
        host: "openrouter.ai",
        label: "OpenRouter privacy policy",
        url: "https://openrouter.ai/privacy",
        note: Some("OpenRouter passes each request on to the provider that serves the model, whose own terms apply as well."),
    },
    ProviderPolicy {
        host: "generativelanguage.googleapis.com",
        label: "Gemini API terms and data use",
        url: "https://ai.google.dev/gemini-api/terms",
        note: None,
    },
    ProviderPolicy {
        host: "api.groq.com",
        label: "Groq: your data in GroqCloud",
        url: "https://console.groq.com/docs/your-data",
        note: None,
    },
    ProviderPolicy {
        host: "api.mistral.ai",
        label: "Mistral AI privacy policy",
        url: "https://legal.mistral.ai/terms/privacy-policy/",
        note: None,
    },
    ProviderPolicy {
        host: "api.deepseek.com",
        label: "DeepSeek privacy policy",
        url: "https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html",
        note: None,
    },
];

/// `aiProviderPolicyForHost`.
pub fn policy_for_host(host: &str) -> Option<&'static ProviderPolicy> {
    let host = host.trim().to_ascii_lowercase();
    PROVIDER_POLICIES.iter().find(|p| p.host == host)
}

/// `AiConsentText` (no `readPolicy`: the policy is in the body).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsentText {
    pub title: String,
    pub body: String,
    pub allow: String,
    pub allow_once: String,
    pub deny: String,
}

/// `aiConsentText` with `policyLine: true`, the policy looked up from `host`.
/// `scope_word` is "folder" or "session" on Desktop.
pub fn consent_text(engine_name: &str, host: &str, feature: Option<&str>, sends: Option<&str>, scope_word: &str) -> ConsentText {
    let policy = policy_for_host(host);
    let mut paragraphs = vec![
        format!(
            "{engine_name} is a cloud engine at {host}. If you allow it, this request sends {}. \
It goes over the internet and is processed on the provider's servers.",
            what_is_sent(feature, sends)
        ),
        match policy.and_then(|p| p.note) {
            Some(note) => format!("{PRIVACY_TERMS} {note}"),
            None => PRIVACY_TERMS.to_string(),
        },
    ];
    if let Some(p) = policy {
        paragraphs.push(format!("{}: {}", p.label, p.url));
    }
    let allow = format!("Allow for this {scope_word}");
    paragraphs.push(if scope_word == "session" {
        format!("You can use a local engine instead. {allow} lasts until you quit MikeDown.")
    } else {
        format!("You can use a local engine instead. {allow} is remembered; you can change it in AI settings \u{2192} Cloud consents.")
    });
    ConsentText {
        title: format!("Send text to {engine_name}?"),
        body: paragraphs.join("\n\n"),
        allow,
        allow_once: "Allow once".to_string(),
        deny: "Don't allow".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::path::PathBuf;

    fn fixture() -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../test/ai-fixtures/consent/consent-text.json");
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn tables_match_the_shared_fixture() {
        let f = fixture();
        assert_eq!(f["privacy"]["terms"].as_str().unwrap(), PRIVACY_TERMS);
        assert_eq!(f["sendsFallback"].as_str().unwrap(), SENDS_FALLBACK);
        for (scope, text) in f["sendsText"].as_object().unwrap() {
            assert_eq!(sends_text(scope), text.as_str(), "sends text for {scope}");
        }
        for (feature, scope) in f["features"].as_object().unwrap() {
            assert_eq!(feature_sends(feature), scope.as_str(), "sends scope for {feature}");
        }
        let policies = f["policies"].as_array().unwrap();
        assert_eq!(policies.len(), PROVIDER_POLICIES.len());
        for p in policies {
            let host = p["host"].as_str().unwrap();
            let ours = policy_for_host(host).unwrap_or_else(|| panic!("no policy for {host}"));
            assert_eq!(ours.label, p["label"].as_str().unwrap());
            assert_eq!(ours.url, p["url"].as_str().unwrap());
            assert_eq!(ours.note, p["note"].as_str());
        }
    }

    /// Desktop renders the cases with `policyLine: true`; the others are VS Code's.
    #[test]
    fn consent_text_renders_every_desktop_fixture_case() {
        let f = fixture();
        let cases: Vec<&Value> = f["cases"].as_array().unwrap().iter().filter(|c| c["input"]["policyLine"].as_bool() == Some(true)).collect();
        assert!(cases.len() >= 3);
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let input = &case["input"];
            let expected = &case["expected"];
            let got = consent_text(
                input["engineName"].as_str().unwrap(),
                input["host"].as_str().unwrap(),
                input["feature"].as_str(),
                input["sends"].as_str(),
                input["scopeWord"].as_str().unwrap(),
            );
            assert_eq!(got.title, expected["title"].as_str().unwrap(), "{name}: title");
            assert_eq!(got.body, expected["body"].as_str().unwrap(), "{name}: body");
            assert_eq!(got.allow, expected["allow"].as_str().unwrap(), "{name}: allow");
            assert_eq!(got.allow_once, expected["allowOnce"].as_str().unwrap(), "{name}: allowOnce");
            assert_eq!(got.deny, expected["deny"].as_str().unwrap(), "{name}: deny");
            assert!(expected.get("readPolicy").is_none(), "{name}: the policy is in the body, not a button");
        }
    }

    /// The fixture is rendered byte for byte, so the body must be the paragraphs
    /// joined with a blank line, exactly as core's `aiConsentText` joins them.
    #[test]
    fn the_body_is_the_paragraphs_joined_by_one_blank_line() {
        let t = consent_text("Anthropic", "api.anthropic.com", Some("rewrite"), None, "folder");
        let paragraphs: Vec<&str> = t.body.split("\n\n").collect();
        assert_eq!(paragraphs.len(), 4);
        assert!(paragraphs[0].starts_with("Anthropic is a cloud engine at api.anthropic.com. If you allow it, this request sends "));
        assert_eq!(paragraphs[0].matches("api.anthropic.com").count(), 1, "the host is named once");
        assert_eq!(paragraphs[1], PRIVACY_TERMS);
        assert!(paragraphs[2].starts_with("Anthropic privacy and data use: https://"));
        assert_eq!(paragraphs[3], "You can use a local engine instead. Allow for this folder is remembered; you can change it in AI settings \u{2192} Cloud consents.");
        assert!(!t.body.contains("\n\n\n"));
    }

    #[test]
    fn rewrite_summary_and_frontmatter_render_on_both_scope_words() {
        for (feature, engine, host) in [
            ("rewrite", "Anthropic", "api.anthropic.com"),
            ("summary", "OpenAI", "api.openai.com"),
            ("frontmatter", "OpenRouter", "openrouter.ai"),
        ] {
            for word in ["folder", "session"] {
                let t = consent_text(engine, host, Some(feature), None, word);
                assert_eq!(t.title, format!("Send text to {engine}?"));
                assert_eq!(t.allow, format!("Allow for this {word}"));
                assert_eq!(t.allow_once, "Allow once");
                assert_eq!(t.deny, "Don't allow");
                assert!(t.body.contains(&format!("this request sends {}.", what_is_sent(Some(feature), None))), "{feature}");
                assert!(t.body.contains(&format!("You can use a local engine instead. Allow for this {word} ")), "{feature}/{word}");
                let p = policy_for_host(host).unwrap();
                assert!(t.body.contains(&format!("{}: {}", p.label, p.url)), "{feature}: policy line");
            }
        }
    }

    #[test]
    fn a_feature_that_sends_nothing_known_falls_back_to_the_generic_phrase() {
        let t = consent_text("My proxy", "llm.example.com", Some("somethingNew"), None, "folder");
        assert!(t.body.contains(&format!("this request sends {SENDS_FALLBACK}.")));
        assert!(!t.body.contains("https://"), "a host no preset knows has no policy line");
    }

    #[test]
    fn every_policy_link_is_https_and_no_copy_claims_what_a_provider_does_with_the_text() {
        for p in PROVIDER_POLICIES {
            assert!(p.url.starts_with("https://"), "{}", p.host);
        }
        let source = include_str!("consent.rs");
        // Built from pieces so this test does not trip itself.
        for claim in [["does not", " train"].concat(), ["never", " trains"].concat(), ["not used for", " training"].concat()] {
            let tests_start = source.find("#[cfg(test)]").unwrap();
            assert!(!source[..tests_start].to_lowercase().contains(&claim), "stale claim: {claim}");
        }
    }
}
