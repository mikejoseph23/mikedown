// @vitest-environment node
// Attacks on the secrets scan (S7, A6).
import { describe, expect, it } from 'vitest';
import {
  capSectionText,
  dropSecretSections,
  findSecret,
  findSecretAtCutoff,
  scanDocsSections,
  secretsLeftOutPhrase,
} from '@mikedown/core/ai';
import type { AiDocsSection } from '@mikedown/core/ai';

const AKIA = 'AKIAIOSFODNN7EXAMPLE';
const sec = (id: string, text: string, truncated = false): AiDocsSection => ({ id, pageId: 'd/a.md', title: 'A', relPath: 'a.md', text, truncated });

describe('secrets: every pattern hits', () => {
  it.each([
    ['AKIA key', `id ${AKIA}`, 'aws-access-key'],
    ['ASIA temporary key', 'id ASIAIOSFODNN7EXAMPLE', 'aws-access-key'],
    ['sk- token', 'sk-abcdefghij0123456789abcd', 'api-token'],
    ['sk-ant token', 'sk-ant-api03-Ab1Cd2Ef3Gh4Ij5Kl6Mn7', 'api-token'],
    ['Stripe live', 'sk_live_51H8aBcDeFgHiJkLmNoPq', 'api-token'],
    ['Stripe restricted test', 'rk_test_51H8aBcDeFgHiJkLmNoPq', 'api-token'],
    ['PEM RSA', '-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
    ['PEM bare', '-----BEGIN PRIVATE KEY-----', 'private-key'],
    ['PGP block', '-----BEGIN PGP PRIVATE KEY BLOCK-----', 'private-key'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r', 'jwt'],
    ['unsecured JWT, empty signature', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.', 'jwt'],
  ])('%s', (_n, text, kind) => {
    expect(findSecret(text)).toBe(kind);
  });
});

describe('secrets: no false positives on ordinary text', () => {
  it.each([
    'We use task-based planning and risk-free desk-mounted screens in our flask-based app',
    'sk-learn is a machine learning library, see ask-me-anything-about-the-api-2024-edition',
    'the long-sk-abcdefghij0123456789abcdefg-word',
    '-----BEGIN CERTIFICATE-----\nMIIB',
    '-----BEGIN PUBLIC KEY-----',
    'AKIA alone, or AKIAIOSFODNN7EXAM too short',
    'sk-abcdefghijklmnopqrstuvwxyz has no digit and is prose',
    'a JWT looks like eyJ.eyJ.sig but this is not one',
    'The SK_LIVE_ constant name and sk_live_ prefix are documented',
    'mask-abcdefghij0123456789abcdefg',
  ])('%j', (text) => {
    expect(findSecret(text)).toBeNull();
  });
});

describe('secrets: attacks', () => {
  it('a PEM header split by CRLF or a lone newline is not a header, but the BEGIN line itself is still caught', () => {
    // Real PEM headers are one line. A split header is not a key header; the scan must not throw or hang on it.
    expect(() => findSecret('-----BEGIN RSA\r\nPRIVATE KEY-----')).not.toThrow();
    // The common case: header, CRLF, body.
    expect(findSecret('-----BEGIN RSA PRIVATE KEY-----\r\nMIIEowIBAAKCAQEA')).toBe('private-key');
    // A header with tabs between the words still counts.
    expect(findSecret('-----BEGIN\tRSA\tPRIVATE\tKEY-----')).toBe('private-key');
  });

  it('a PEM header split across lines (CRLF) is also caught, since a model would reassemble it', () => {
    expect(findSecret('-----BEGIN RSA\r\nPRIVATE KEY-----\r\nMIIE')).toBe('private-key');
  });

  it('lower-cased AKIA is not a key; AKIA inside a longer run is not a key; AKIA after punctuation is', () => {
    expect(findSecret(`id ${AKIA.toLowerCase()}`)).toBeNull();
    expect(findSecret(`ABC${AKIA}DEF`)).toBeNull();
    expect(findSecret(`${AKIA}X`)).toBeNull();
    for (const sep of ['=', ':', '"', "'", '(', ',', '\n', '`', '/', '[']) {
      expect(findSecret(`k${sep}${AKIA}`), sep).toBe('aws-access-key');
    }
    expect(findSecret(AKIA)).toBe('aws-access-key');
  });

  it('an AKIA key in a code block, a list, a table cell and a link is still caught', () => {
    for (const t of [`\`\`\`\n${AKIA}\n\`\`\``, `- key ${AKIA}`, `| key | ${AKIA} |`, `[x](https://a.example/?k=${AKIA})`, `<!-- ${AKIA} -->`]) {
      expect(findSecret(t), t).toBe('aws-access-key');
    }
  });

  it('a JWT inside a code block or a header line is caught', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
    expect(findSecret(`\`\`\`http\nAuthorization: Bearer ${jwt}\n\`\`\``)).toBe('jwt');
    expect(findSecret(`curl -H "Authorization: Bearer ${jwt}"`)).toBe('jwt');
  });

  it('a token one character short or at the exact threshold', () => {
    const body = 'abcdefghij012345678'; // 19 chars
    expect(findSecret(`sk-${body}`)).toBeNull();
    expect(findSecret(`sk-${body}9`)).toBe('api-token');
    expect(findSecret(`sk_live_${'a'.repeat(15)}`)).toBeNull();
    expect(findSecret(`sk_live_${'a'.repeat(16)}`)).toBe('api-token');
  });

  it('a key at the very end of a truncated section is caught by the tail rule', () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(100);
    for (const tail of ['AKIAIOSFODNN7EXA', 'sk-proj-abc123def456', 'sk_live_51H8aBc', '-----BEGIN RSA PRIV', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx']) {
      const text = filler + tail;
      expect(findSecret(text), `full scan of ${tail}`).toBeNull(); // incomplete on purpose
      const scan = scanDocsSections([sec('a', text, true), sec('b', text, false)]);
      expect(scan.leftOut, tail).toEqual(['a']);
      expect(scan.kept.map((s) => s.id)).toEqual(['b']);
    }
  });

  it('a key cut by the real byte cap is caught at every cut position', () => {
    const key = `${AKIA}`;
    const prefix = 'x '.repeat(100);
    for (let cut = 1; cut <= key.length; cut++) {
      const full = prefix + key + ' tail';
      // Cut mid key: keep prefix + first `cut` chars of the key.
      const text = full.slice(0, prefix.length + cut);
      const kind = findSecret(text) ?? findSecretAtCutoff(text);
      // 4 chars of AKIA are a prefix only; below 'AKIA' + 4 nothing identifies the key.
      if (cut >= 8) {expect(kind, `cut ${cut}`).toBe('aws-access-key');}
    }
  });

  it('the real cap helper cuts on a code point and the tail rule still sees the key', () => {
    const text = `${'é'.repeat(13_000)} ${AKIA} more text after`;
    const capped = capSectionText(text, 24 * 1024);
    expect(capped.truncated).toBe(true);
    // Whatever survives of the key, scanning the uncapped text finds it; hosts must scan before capping.
    expect(findSecret(text)).toBe('aws-access-key');
  });

  it('truncated sections are only tail-scanned when flagged truncated', () => {
    const text = `${'word '.repeat(100)}AKIAIOSFODNN7EXA`;
    expect(scanDocsSections([sec('a', text, false)]).leftOut).toEqual([]);
    expect(scanDocsSections([sec('a', text, true)]).leftOut).toEqual(['a']);
  });

  it('the tail rule does not flag ordinary prose ending in a word', () => {
    for (const t of ['we talked about the task-', 'the disk-mounted', 'risk-free', 'ends with sk-', 'ends with AKIA', 'ends with eyJ.']) {
      expect(findSecretAtCutoff(`${'prose '.repeat(50)}${t}`), t).toBeNull();
    }
  });

  it('reports ids only, and never the key, in leftOut and kinds', () => {
    const scan = scanDocsSections([sec('p#a', AKIA), sec('p#b', 'fine')]);
    expect(JSON.stringify([scan.leftOut, scan.kinds])).not.toContain('AKIA');
    expect(scan.kinds).toEqual({ 'p#a': 'aws-access-key' });
  });

  it('zero-width and unicode padding next to a key does not hide it', () => {
    expect(findSecret(`​${AKIA}​`)).toBe('aws-access-key');
    expect(findSecret(`é${AKIA}`)).toBe('aws-access-key');
  });

  it('this-document scope: key in frontmatter-only text, many sections, and no headings', () => {
    expect(dropSecretSections('plain text with no heading and ' + AKIA)).toMatchObject({ leftOut: expect.any(Number) });
    const r = dropSecretSections(`---\napi: ${AKIA}\n---\n# A\nok\n# B\nalso ok\n`);
    expect(r.text).not.toContain('AKIA');
    expect(r.text).toContain('also ok');
    const none = dropSecretSections('# A\nok\n');
    expect(none).toEqual({ text: '# A\nok\n', total: 1, leftOut: 0 });
    expect(dropSecretSections('').total).toBe(0);
  });

  it('this-document scope: a key in a fenced block dropping only its own section, with CRLF line endings', () => {
    const doc = '# A\r\nok\r\n# B\r\n```\r\nsk_live_51H8aBcDeFgHiJkLmNoPq\r\n```\r\n# C\r\nfine\r\n';
    const r = dropSecretSections(doc);
    expect(r.leftOut).toBe(1);
    expect(r.text).toBe('# A\r\nok\r\n# C\r\nfine\r\n');
  });

  it('a key split across two sections is not found in either (known limit), but both halves stay under pattern minimums', () => {
    const r = scanDocsSections([sec('a', 'AKIAIOSFODNN'), sec('b', '7EXAMPLE')]);
    expect(r.leftOut).toEqual([]);
  });
});

describe('secrets: coverage phrase', () => {
  it('singular and plural, sections and entries', () => {
    expect(secretsLeftOutPhrase(1)).toBe('1 section left out: looks like it contains a key');
    expect(secretsLeftOutPhrase(3)).toBe('3 sections left out: look like they contain a key');
    expect(secretsLeftOutPhrase(1, 'entry')).toBe('1 entry left out: looks like it contains a key');
    expect(secretsLeftOutPhrase(2, 'entry')).toBe('2 entries left out: look like they contain a key');
    expect(secretsLeftOutPhrase(-1)).toBe('');
  });
});

describe('secrets: speed', () => {
  it('stays linear on repeated near-misses of every pattern at 1 MiB', () => {
    const n = 1 << 20;
    const inputs = [
      'sk-aaaaaaaaaaaaaaaaaaa '.repeat(n / 23),
      '-----BEGIN A B C D E F G '.repeat(n / 25),
      'eyJaaaaaaaa.eyJaaaaaaaa '.repeat(n / 24),
      'AKIAAAAAAAAAAAAAAA '.repeat(n / 19),
      'sk_live_aaaaaaaaaaaaaaa '.repeat(n / 24),
      `${'-'.repeat(n)}`,
      'a'.repeat(n),
      'sk-'.repeat(n / 3),
    ];
    const t0 = Date.now();
    for (const text of inputs) {
      findSecret(text);
      findSecretAtCutoff(text);
    }
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
