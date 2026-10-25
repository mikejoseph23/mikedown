// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_NETWORKS, detectLocality, engineLocality, hostOfUrl, localityMismatch } from '@mikedown/core/ai';

const local = (url: string, nets?: string[]) => expect(detectLocality(url, nets), url).toBe('local');
const cloud = (url: string, nets?: string[]) => expect(detectLocality(url, nets), url).toBe('cloud');

describe('hostOfUrl', () => {
  it('strips scheme, port, path, credentials and brackets, and lower-cases', () => {
    expect(hostOfUrl('HTTP://Studio.Local:8000/v1')).toBe('studio.local');
    expect(hostOfUrl('https://user:pw@api.example.com/x?y=1#z')).toBe('api.example.com');
    expect(hostOfUrl('http://[::1]:11434/v1')).toBe('::1');
    expect(hostOfUrl('http://[fe80::1]/')).toBe('fe80::1');
    expect(hostOfUrl('127.0.0.1:8000')).toBe('127.0.0.1');
    expect(hostOfUrl('http://example.com./v1')).toBe('example.com');
  });

  it('returns null for nothing usable', () => {
    expect(hostOfUrl('')).toBeNull();
    expect(hostOfUrl('   ')).toBeNull();
    expect(hostOfUrl('http://')).toBeNull();
    expect(hostOfUrl('http://[]/')).toBeNull();
  });
});

describe('loopback and link-local', () => {
  it('127.0.0.0/8, localhost, ::1, 0.0.0.0', () => {
    local('http://127.0.0.1:8000/v1');
    local('http://127.255.255.254/v1');
    local('http://localhost:1234/v1');
    local('http://LOCALHOST:1234/v1');
    local('http://app.localhost/v1');
    local('http://[::1]:11434');
    local('http://0.0.0.0:8000/v1');
  });

  it('169.254/16 and IPv6 link-local and unique-local', () => {
    local('http://169.254.10.20/v1');
    local('http://[fe80::1]:8000/v1');
    local('http://[fd12:3456::1]:8000/v1');
    local('http://[fc00::1]:8000/v1');
  });

  it('IPv4-mapped IPv6 is judged by its IPv4 part', () => {
    local('http://[::ffff:192.168.1.2]:8000');
    cloud('http://[::ffff:8.8.8.8]:8000');
  });

  it('loopback stays local even when localNetworks is emptied', () => {
    local('http://127.0.0.1:8000/v1', []);
    local('http://localhost:1234/v1', []);
  });
});

describe('RFC 1918 (the default localNetworks)', () => {
  it('10/8, 172.16/12 and 192.168/16 are local, with their exact edges', () => {
    local('http://10.0.0.1/v1');
    local('http://10.255.255.255/v1');
    local('http://172.16.0.1/v1');
    local('http://172.31.255.255/v1');
    local('http://192.168.0.1/v1');
    local('http://192.168.255.255/v1');
    cloud('http://172.15.255.255/v1');
    cloud('http://172.32.0.1/v1');
    cloud('http://192.167.1.1/v1');
    cloud('http://192.169.1.1/v1');
    cloud('http://11.0.0.1/v1');
  });

  it('DEFAULT_LOCAL_NETWORKS is exactly those three ranges', () => {
    expect([...DEFAULT_LOCAL_NETWORKS]).toEqual(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
  });

  it('an empty localNetworks makes private addresses cloud', () => {
    cloud('http://192.168.1.5:8000/v1', []);
  });
});

describe('.local and the other always-local suffixes', () => {
  it('.local, .lan, .home.arpa, .internal', () => {
    local('http://studio.local:1234/v1');
    local('http://nas.lan/v1');
    local('http://box.home.arpa/v1');
    local('http://gpu.internal/v1');
  });

  it('does not match look-alikes', () => {
    cloud('http://notlocal/v1');
    cloud('http://studio.local.example.com/v1');
    cloud('http://localhost.evil.com/v1');
    cloud('http://mylocal.com/v1');
  });
});

describe('localNetworks additions', () => {
  it('a WireGuard range makes its addresses local; the default ranges no longer apply when replaced', () => {
    const wg = ['10.0.98.0/24'];
    local('http://10.0.98.4:8000/v1', wg);
    local('http://10.0.98.255:8000/v1', wg);
    cloud('http://10.0.99.4:8000/v1', wg);
    cloud('http://192.168.1.2:8000/v1', wg);
  });

  it('defaults plus a WireGuard range', () => {
    const nets = [...DEFAULT_LOCAL_NETWORKS, '100.64.0.0/10'];
    local('http://100.100.1.1/v1', nets);
    local('http://192.168.1.2/v1', nets);
    cloud('http://100.128.0.1/v1', nets);
  });

  it('a bare address counts as /32; /0 matches everything; bad CIDRs are ignored', () => {
    local('http://203.0.113.7/v1', ['203.0.113.7']);
    cloud('http://203.0.113.8/v1', ['203.0.113.7']);
    local('http://8.8.8.8/v1', ['0.0.0.0/0']);
    cloud('http://8.8.8.8/v1', ['8.8.8.0/33', '8.8.8.0/x', '999.1.1.1/8']);
  });

  it('host-name suffixes and exact hosts', () => {
    local('http://mac.tail1234.ts.net:8000/v1', ['.ts.net']);
    local('http://studio.example.com/v1', ['studio.example.com']);
    local('http://gpu.studio.example.com/v1', ['studio.example.com']);
    cloud('http://other.example.com/v1', ['studio.example.com']);
    cloud('http://mac.tail1234.ts.net/v1', []);
  });
});

describe('public hosts and unparsable input', () => {
  it('well-known cloud APIs and public addresses are cloud', () => {
    cloud('https://api.anthropic.com');
    cloud('https://api.openai.com/v1');
    cloud('https://openrouter.ai/api/v1');
    cloud('http://8.8.8.8:8000/v1');
    cloud('http://1.1.1.1/v1');
  });

  it('empty or hostless URLs are cloud (the safe answer)', () => {
    cloud('');
    cloud('http://');
  });

  it('an out-of-range octet is a host name, not an address, so it is cloud', () => {
    cloud('http://300.1.1.1/v1');
  });
});

describe('pinned override', () => {
  it('a pinned locality wins over the URL', () => {
    expect(engineLocality({ baseUrl: 'http://127.0.0.1:8000/v1', locality: 'cloud' })).toBe('cloud');
    expect(engineLocality({ baseUrl: 'https://api.anthropic.com', locality: 'local' })).toBe('local');
  });

  it('auto derives from the URL and honours localNetworks', () => {
    expect(engineLocality({ baseUrl: 'http://127.0.0.1:8000/v1', locality: 'auto' })).toBe('local');
    expect(engineLocality({ baseUrl: 'https://api.anthropic.com', locality: 'auto' })).toBe('cloud');
    expect(engineLocality({ baseUrl: 'http://10.0.98.4/v1', locality: 'auto' }, ['10.0.98.0/24'])).toBe('local');
    expect(engineLocality({ baseUrl: 'http://10.0.98.4/v1', locality: 'auto' }, [])).toBe('cloud');
  });

  it('localityMismatch flags a pin that disagrees with the URL, never an auto engine', () => {
    expect(localityMismatch({ baseUrl: 'http://127.0.0.1:8000/v1', locality: 'cloud' })).toBe(true);
    expect(localityMismatch({ baseUrl: 'https://api.anthropic.com', locality: 'local' })).toBe(true);
    expect(localityMismatch({ baseUrl: 'http://127.0.0.1:8000/v1', locality: 'local' })).toBe(false);
    expect(localityMismatch({ baseUrl: 'https://api.anthropic.com', locality: 'cloud' })).toBe(false);
    expect(localityMismatch({ baseUrl: 'https://api.anthropic.com', locality: 'auto' })).toBe(false);
  });
});
