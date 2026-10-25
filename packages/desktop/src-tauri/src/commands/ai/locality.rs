//! Local or cloud, from an engine's base URL. Ported from
//! `packages/core/src/ai/locality.ts`. This is the host's own check behind the
//! cloud gate: the webview's router decides what to ask for, but the Rust side
//! refuses a cloud engine by itself.
//!
//! Loopback, link-local, IPv6 unique-local, `localhost`, `.local`, `.lan`,
//! `.home.arpa` and `.internal` are always local; `ai.localNetworks` adds IPv4
//! CIDR ranges (RFC 1918 by default) and `.suffix` host names. Anything else,
//! including a URL that does not parse, is cloud.

pub const DEFAULT_LOCAL_NETWORKS: [&str; 3] = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

const ALWAYS_LOCAL_IPV4: [&str; 3] = ["127.0.0.0/8", "169.254.0.0/16", "0.0.0.0/32"];
const LOCAL_SUFFIXES: [&str; 5] = [".localhost", ".local", ".lan", ".home.arpa", ".internal"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locality {
    Local,
    Cloud,
}

/// Lower-cased host of a URL (no port, no brackets), or None. Accepts a bare `host:port`.
pub fn host_of_url(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_scheme = match trimmed.find("://") {
        Some(i) if trimmed[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) => &trimmed[i + 3..],
        _ => trimmed,
    };
    let authority = without_scheme.split(['/', '?', '#']).next().unwrap_or("");
    let host_port = authority.rsplit('@').next().unwrap_or("");
    if host_port.is_empty() {
        return None;
    }
    if let Some(rest) = host_port.strip_prefix('[') {
        let end = rest.find(']')?;
        return (end > 0).then(|| rest[..end].to_lowercase());
    }
    // More than one colon and no brackets: a bare IPv6 address.
    if host_port.matches(':').count() > 1 {
        return Some(host_port.to_lowercase());
    }
    let host = host_port.split(':').next().unwrap_or("").to_lowercase();
    let host = host.trim_end_matches('.').to_string();
    (!host.is_empty()).then_some(host)
}

fn parse_ipv4(host: &str) -> Option<u32> {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut ip: u32 = 0;
    for p in parts {
        if p.is_empty() || p.len() > 3 || !p.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let n: u32 = p.parse().ok()?;
        if n > 255 {
            return None;
        }
        ip = (ip << 8) | n;
    }
    Some(ip)
}

fn in_ipv4_cidr(ip: u32, cidr: &str) -> bool {
    let (base, bits_text) = match cidr.split_once('/') {
        Some((b, bits)) => (b, Some(bits)),
        None => (cidr, None),
    };
    let Some(base_ip) = parse_ipv4(base.trim()) else { return false };
    let bits: u32 = match bits_text {
        None => 32,
        Some(t) => match t.trim().parse() {
            Ok(b) if b <= 32 => b,
            _ => return false,
        },
    };
    if bits == 0 {
        return true;
    }
    let mask = u32::MAX << (32 - bits);
    (ip & mask) == (base_ip & mask)
}

fn is_local_ipv6(host: &str) -> bool {
    if !host.contains(':') {
        return false;
    }
    if host == "::1" || host == "::" {
        return true;
    }
    let first = host.split(':').next().unwrap_or("");
    if first.is_empty() {
        return false;
    }
    let Ok(word) = u32::from_str_radix(first, 16) else { return false };
    // fe80::/10 link-local, fc00::/7 unique-local.
    (word & 0xffc0) == 0xfe80 || (word & 0xfe00) == 0xfc00
}

pub fn detect_locality(base_url: &str, local_networks: &[String]) -> Locality {
    let Some(host) = host_of_url(base_url) else { return Locality::Cloud };
    if host == "localhost" || LOCAL_SUFFIXES.iter().any(|s| host.ends_with(s)) {
        return Locality::Local;
    }
    let candidate = host.strip_prefix("::ffff:").filter(|rest| parse_ipv4(rest).is_some()).unwrap_or(&host);
    if let Some(ip) = parse_ipv4(candidate) {
        if ALWAYS_LOCAL_IPV4.iter().any(|c| in_ipv4_cidr(ip, c)) {
            return Locality::Local;
        }
        let local = local_networks
            .iter()
            .any(|e| e.trim().starts_with(|c: char| c.is_ascii_digit()) && in_ipv4_cidr(ip, e.trim()));
        return if local { Locality::Local } else { Locality::Cloud };
    }
    if is_local_ipv6(&host) {
        return Locality::Local;
    }
    for raw in local_networks {
        let entry = raw.trim().to_lowercase();
        if entry.is_empty() || entry.starts_with(|c: char| c.is_ascii_digit()) {
            continue;
        }
        let hit = if entry.starts_with('.') { host.ends_with(&entry) } else { host == entry || host.ends_with(&format!(".{entry}")) };
        if hit {
            return Locality::Local;
        }
    }
    Locality::Cloud
}

/// The engine's effective locality: its pin, or `detect_locality` for `auto`.
pub fn engine_locality(locality: &str, base_url: &str, local_networks: &[String]) -> Locality {
    match locality {
        "local" => Locality::Local,
        "cloud" => Locality::Cloud,
        _ => detect_locality(base_url, local_networks),
    }
}

pub fn default_local_networks() -> Vec<String> {
    DEFAULT_LOCAL_NETWORKS.iter().map(|s| s.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nets() -> Vec<String> {
        default_local_networks()
    }

    #[test]
    fn hosts_are_pulled_out_of_urls() {
        assert_eq!(host_of_url("http://127.0.0.1:8000/v1").as_deref(), Some("127.0.0.1"));
        assert_eq!(host_of_url("https://user:pw@API.Example.com./x").as_deref(), Some("api.example.com"));
        assert_eq!(host_of_url("http://[fe80::1]:80/").as_deref(), Some("fe80::1"));
        assert_eq!(host_of_url("studio.lan:1234").as_deref(), Some("studio.lan"));
        assert_eq!(host_of_url("  "), None);
    }

    #[test]
    fn loopback_private_and_lan_names_are_local() {
        for url in [
            "http://127.0.0.1:8000/v1",
            "http://localhost:1234/v1",
            "http://192.168.1.20:11434",
            "http://10.0.98.5/v1",
            "http://172.20.0.4/v1",
            "http://169.254.1.1",
            "http://studio.local:8000",
            "http://mac.home.arpa",
            "http://[::1]:8000",
            "http://[fd12::1]:8000",
            "http://[::ffff:192.168.1.2]/",
        ] {
            assert_eq!(detect_locality(url, &nets()), Locality::Local, "{url}");
        }
    }

    #[test]
    fn public_hosts_and_garbage_are_cloud() {
        for url in ["https://api.anthropic.com", "https://api.openai.com/v1", "http://8.8.8.8", "http://172.32.0.1", "", "http://"] {
            assert_eq!(detect_locality(url, &nets()), Locality::Cloud, "{url}");
        }
    }

    #[test]
    fn local_networks_extend_the_list_with_cidrs_and_suffixes() {
        let extra = vec!["100.64.0.0/10".to_string(), ".ts.net".to_string(), "studio.example.com".to_string()];
        assert_eq!(detect_locality("http://100.100.1.1", &extra), Locality::Local);
        assert_eq!(detect_locality("http://mac.tail1234.ts.net", &extra), Locality::Local);
        assert_eq!(detect_locality("http://studio.example.com", &extra), Locality::Local);
        assert_eq!(detect_locality("http://other.example.com", &extra), Locality::Cloud);
        // Replacing the list drops RFC 1918.
        assert_eq!(detect_locality("http://192.168.1.2", &extra), Locality::Cloud);
    }

    #[test]
    fn a_pin_beats_the_url() {
        assert_eq!(engine_locality("cloud", "http://127.0.0.1:8000", &nets()), Locality::Cloud);
        assert_eq!(engine_locality("local", "https://api.openai.com", &nets()), Locality::Local);
        assert_eq!(engine_locality("auto", "https://api.openai.com", &nets()), Locality::Cloud);
    }
}
