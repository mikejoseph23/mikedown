/**
 * Local or cloud, from an engine's base URL. Loopback, link-local, IPv6
 * unique-local, `localhost`, `.local`, `.lan`, `.home.arpa` and `.internal`
 * are always local; `localNetworks` adds CIDR ranges (RFC 1918 by default, a
 * WireGuard range such as `10.0.98.0/24`) and `.suffix` host names. Anything
 * else, including a URL that does not parse, is cloud.
 */

import type { AiEngineConfig, AiLocality } from './types';

/** Default `mikedown.ai.localNetworks`: RFC 1918. */
export const DEFAULT_LOCAL_NETWORKS: readonly string[] = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

const ALWAYS_LOCAL_IPV4 = ['127.0.0.0/8', '169.254.0.0/16', '0.0.0.0/32'];
const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.home.arpa', '.internal'];

/** Lower-cased host of a URL (no port, no brackets), or null. Accepts a bare `host:port`. */
export function hostOfUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {return null;}
  const withoutScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') : trimmed;
  const authority = withoutScheme.split(/[/?#]/, 1)[0];
  const hostPort = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  if (!hostPort) {return null;}
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    return end > 1 ? hostPort.slice(1, end).toLowerCase() : null;
  }
  // More than one colon and no brackets: a bare IPv6 address.
  if ((hostPort.match(/:/g) ?? []).length > 1) {return hostPort.toLowerCase();}
  const host = hostPort.split(':', 1)[0].toLowerCase().replace(/\.$/, '');
  return host || null;
}

function parseIpv4(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) {return null;}
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) {return null;}
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inIpv4Cidr(ip: number, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const baseIp = parseIpv4(base.trim());
  const bits = bitsText === undefined ? 32 : Number(bitsText);
  if (baseIp === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {return false;}
  if (bits === 0) {return true;}
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((baseIp & mask) >>> 0);
}

function isLocalIpv6(host: string): boolean {
  if (!host.includes(':')) {return false;}
  if (host === '::1' || host === '::') {return true;}
  // IPv4-mapped (::ffff:192.168.1.2) is judged by its IPv4 part elsewhere.
  const first = host.split(':')[0];
  if (!first) {return false;}
  const word = parseInt(first, 16);
  if (Number.isNaN(word)) {return false;}
  // fe80::/10 link-local, fc00::/7 unique-local.
  return (word & 0xffc0) === 0xfe80 || (word & 0xfe00) === 0xfc00;
}

/**
 * `local` or `cloud` for a base URL. `localNetworks` entries are IPv4 CIDR
 * ranges (`10.0.98.0/24`, a bare address counts as /32) or host-name
 * suffixes (`.ts.net`, `studio.example.com`).
 */
export function detectLocality(baseUrl: string, localNetworks: readonly string[] = DEFAULT_LOCAL_NETWORKS): AiLocality {
  const host = hostOfUrl(baseUrl);
  if (!host) {return 'cloud';}
  if (host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {return 'local';}

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  const ip = parseIpv4(mapped ? mapped[1] : host);
  if (ip !== null) {
    if (ALWAYS_LOCAL_IPV4.some((c) => inIpv4Cidr(ip, c))) {return 'local';}
    return localNetworks.some((entry) => /^\d/.test(entry.trim()) && inIpv4Cidr(ip, entry.trim())) ? 'local' : 'cloud';
  }
  if (isLocalIpv6(host)) {return 'local';}

  for (const raw of localNetworks) {
    const entry = raw.trim().toLowerCase();
    if (!entry || /^\d/.test(entry)) {continue;}
    if (entry.startsWith('.') ? host.endsWith(entry) : host === entry || host.endsWith(`.${entry}`)) {return 'local';}
  }
  return 'cloud';
}

/**
 * The engine's effective locality: its pin, or `detectLocality` for `auto`.
 * A `vscode-lm` engine is always cloud, whatever its pin: it has no address,
 * and the text goes to GitHub's Copilot service.
 */
export function engineLocality(engine: Pick<AiEngineConfig, 'baseUrl' | 'locality'> & { kind?: string }, localNetworks?: readonly string[]): AiLocality {
  if (engine.kind === 'vscode-lm') {return 'cloud';}
  if (engine.locality === 'local' || engine.locality === 'cloud') {return engine.locality;}
  return detectLocality(engine.baseUrl, localNetworks);
}

/**
 * True when a pinned locality disagrees with the URL (cloud pinned on a
 * private address, or local pinned on a public one). The indicator shows a
 * warning glyph for it.
 */
export function localityMismatch(engine: Pick<AiEngineConfig, 'baseUrl' | 'locality'> & { kind?: string }, localNetworks?: readonly string[]): boolean {
  if (engine.locality === 'auto' || engine.kind === 'vscode-lm') {return false;}
  return engine.locality !== detectLocality(engine.baseUrl, localNetworks);
}
