// Privacy copy (ai/privacy.ts) and the privacy card (ai-settings-dom.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_CLOUD_PRIVACY,
  AI_ENGINE_PRESETS,
  AI_FEATURES,
  AI_SENDS_FALLBACK,
  AI_SENDS_TEXT,
  AI_NO_CONSENTS_TEXT,
  aiConsentStepNote,
  aiConsentSummary,
  aiConsentText,
  aiProviderPolicy,
  aiProviderPolicyForHost,
  hostOfUrl,
  whatIsSent,
} from '@mikedown/core/ai';
import { AI_EXPERIMENTAL_DISCLAIMER, privacyCard, privacyLine } from '../src/ai-settings-dom';
import { aiIndicatorState } from '../src/ai-settings-model';
import { parseAiSettings } from '../src/ai';

const fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'test', 'ai-fixtures', 'consent', 'consent-text.json'), 'utf8'));

describe('whatIsSent', () => {
  it('says what each available feature sends', () => {
    expect(whatIsSent('rewrite')).toBe('the selected text and the paragraph before and after it');
    expect(whatIsSent('summary')).toBe('the whole document, up to what fits the model');
    expect(whatIsSent('title')).toBe('the whole document, up to what fits the model');
    expect(whatIsSent('frontmatter')).toBe('the document, its frontmatter and the tag names used in this workspace');
  });

  it('lets the request override the feature (whole-document Translate runs as rewrite)', () => {
    expect(whatIsSent('rewrite', 'document')).toBe(AI_SENDS_TEXT.document);
  });

  it('falls back to a generic phrase for an unknown or missing feature', () => {
    expect(whatIsSent()).toBe(AI_SENDS_FALLBACK);
    expect(whatIsSent('notAFeature')).toBe(AI_SENDS_FALLBACK);
  });

  it('every available feature declares what it sends', () => {
    for (const f of AI_FEATURES.filter((f) => f.status === 'available')) {
      expect(f.sends, f.id).toBeDefined();
    }
  });
});

describe('provider policies', () => {
  const cloud = AI_ENGINE_PRESETS.filter((p) => p.family === 'cloud');

  it('every cloud preset links an https policy page; local presets have none', () => {
    for (const p of cloud) {
      expect(p.policy, p.id).toBeDefined();
      expect(p.policy!.url, p.id).toMatch(/^https:\/\//);
      expect(p.policy!.label.length, p.id).toBeGreaterThan(0);
    }
    for (const p of AI_ENGINE_PRESETS.filter((p) => p.family === 'local')) {expect(p.policy, p.id).toBeUndefined();}
  });

  it('matches an engine to its policy by host', () => {
    expect(aiProviderPolicy({ baseUrl: 'https://api.anthropic.com' })?.label).toBe('Anthropic privacy and data use');
    expect(aiProviderPolicyForHost('API.OPENAI.COM')?.url).toContain('openai.com');
    expect(aiProviderPolicy({ baseUrl: 'http://127.0.0.1:1234/v1' })).toBeUndefined();
    expect(aiProviderPolicy({ baseUrl: 'https://llm.example.com/v1' })).toBeUndefined();
  });

  it('makes no claims about training or retention in code', () => {
    const copy = [
      ...Object.values(AI_CLOUD_PRIVACY),
      ...cloud.flatMap((p) => [p.policy?.label ?? '', p.policy?.note ?? '']),
      AI_EXPERIMENTAL_DISCLAIMER,
    ].join('\n');
    expect(copy).not.toMatch(/(does not|doesn't|never|won't|will not) (train|store|retain|log)/i);
    expect(copy).not.toMatch(/zero.data.retention|not used for training/i);
  });
});

describe('aiConsentText (shared fixture)', () => {
  it('the fixture tables match core', () => {
    expect(fixture.privacy).toEqual(AI_CLOUD_PRIVACY);
    expect(fixture.sendsText).toEqual(AI_SENDS_TEXT);
    expect(fixture.sendsFallback).toBe(AI_SENDS_FALLBACK);
    expect(fixture.features).toEqual(Object.fromEntries(AI_FEATURES.filter((f) => f.sends).map((f) => [f.id, f.sends])));
    expect(fixture.policies).toEqual(
      AI_ENGINE_PRESETS.filter((p) => p.family === 'cloud' && p.policy).map((p) => ({ host: hostOfUrl(p.baseUrl), ...p.policy })),
    );
  });

  for (const c of fixture.cases as Array<{ name: string; input: any; expected: unknown }>) {
    it(c.name, () => {
      expect(aiConsentText({ ...c.input, policy: aiProviderPolicyForHost(c.input.host) })).toEqual(c.expected);
    });
  }

  it('names what is sent, where (once), the terms and the local alternative; the policy is a button, not a URL', () => {
    const t = aiConsentText({ engineName: 'Anthropic', host: 'api.anthropic.com', feature: 'summary', scopeWord: 'workspace', policy: aiProviderPolicyForHost('api.anthropic.com') });
    expect(t.title).toBe('Send text to Anthropic?');
    expect(t.body).toContain('the whole document, up to what fits the model');
    expect(t.body.split('api.anthropic.com')).toHaveLength(2);
    expect(t.body).toContain(AI_CLOUD_PRIVACY.terms);
    expect(t.body).toContain('You can use a local engine instead.');
    expect(t.body).not.toContain('https://');
    expect(t.readPolicy).toBe('Read the provider\'s policy');
    expect([t.deny, t.allowOnce, t.allow]).toEqual(['Don\'t allow', 'Allow once', 'Allow for this workspace']);
  });

  it('spells the policy URL out instead of a button when asked (Desktop)', () => {
    const t = aiConsentText({ engineName: 'Anthropic', host: 'api.anthropic.com', scopeWord: 'folder', policy: aiProviderPolicyForHost('api.anthropic.com'), policyLine: true });
    expect(t.body).toContain('https://privacy.claude.com/');
    expect(t.readPolicy).toBeUndefined();
  });
});

describe('privacyCard', () => {
  const anthropic = AI_ENGINE_PRESETS.find((p) => p.id === 'anthropic')!;

  it('shows the four lines and the preset policy link, without a warning icon', () => {
    const card = privacyCard(anthropic);
    const lines = Array.from(card.querySelectorAll('.ai-privacy-lines li')).map((li) => li.textContent);
    expect(lines).toEqual([AI_CLOUD_PRIVACY.leaves, AI_CLOUD_PRIVACY.terms, AI_CLOUD_PRIVACY.local, AI_CLOUD_PRIVACY.keys]);
    const link = card.querySelector<HTMLAnchorElement>('a.ai-privacy-link')!;
    expect(link.textContent).toBe('Anthropic privacy and data use');
    expect(link.href).toBe(anthropic.policy!.url);
    expect(link.rel).toContain('noopener');
    expect(card.querySelector('.ai-note--warning')).toBeNull();
    expect(card.querySelector('.ai-privacy-glyph svg')).not.toBeNull();
  });

  it('opens the policy through the host when it can', () => {
    const openLink = vi.fn();
    const card = privacyCard(anthropic, { openLink });
    const link = card.querySelector<HTMLAnchorElement>('a.ai-privacy-link')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(openLink).toHaveBeenCalledWith(anthropic.policy!.url);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('lists each distinct policy once, with the OpenRouter note, and none for a local engine', () => {
    const openrouter = AI_ENGINE_PRESETS.find((p) => p.id === 'openrouter')!;
    const card = privacyCard([anthropic, openrouter, anthropic, {}]);
    expect(card.querySelectorAll('a.ai-privacy-link')).toHaveLength(2);
    expect(card.textContent).toContain('passes each request on');
    expect(privacyCard().querySelectorAll('a.ai-privacy-link')).toHaveLength(0);
  });

  it('collapses into a "What is sent" disclosure that remembers its state', () => {
    const onToggle = vi.fn();
    const card = privacyCard(anthropic, { collapsed: true, open: true, onToggle }) as HTMLDetailsElement;
    expect(card.tagName).toBe('DETAILS');
    expect(card.open).toBe(true);
    expect(card.querySelector('summary')!.textContent).toBe('What is sent');
  });

  it('adds the extra line', () => {
    expect(privacyCard(null, { extra: 'Once allowed, …' }).querySelector('.ai-privacy-extra')!.textContent).toBe('Once allowed, …');
  });

  it('privacyLine offers Learn more', () => {
    const onLearnMore = vi.fn();
    const line = privacyLine(onLearnMore);
    expect(line.textContent).toContain(AI_CLOUD_PRIVACY.local);
    line.querySelector('button')!.click();
    expect(onLearnMore).toHaveBeenCalled();
  });
});

describe('disclaimer and indicator', () => {
  it('the disclaimer keeps the experimental sentences and uses the shared cloud and local lines', () => {
    expect(AI_EXPERIMENTAL_DISCLAIMER).toContain('AI features are experimental');
    expect(AI_EXPERIMENTAL_DISCLAIMER).toContain('With a cloud engine, text you ask about is sent over the internet');
    expect(AI_EXPERIMENTAL_DISCLAIMER).toContain(AI_CLOUD_PRIVACY.local);
  });

  it('the chip tooltip says what the last cloud request sent and where', () => {
    const settings = parseAiSettings({
      enabled: true,
      allowCloud: true,
      engines: [{ id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'm' }] }],
    });
    const served = { engineId: 'claude', engineName: 'Anthropic', modelId: 'm', isLocal: false, feature: 'summary', sends: 'document' as const };
    const s = aiIndicatorState({ settings, statuses: [], tier: 2, served, viaFallback: false })!;
    expect(s.title).toContain('It sent text to api.anthropic.com: the whole document, up to what fits the model.');
    const local = aiIndicatorState({ settings, statuses: [], tier: 2, served: { ...served, isLocal: true }, viaFallback: false })!;
    expect(local.title).not.toContain('It sent');
  });
});

describe('consent list copy', () => {
  it('summarises an answer and says whether the host asks', () => {
    expect(aiConsentSummary({ answer: 'allow', scope: 'workspace' }, 'Anthropic')).toBe('Anthropic · this workspace · Allowed');
    expect(aiConsentSummary({ answer: 'never', scope: 'folder' }, 'OpenAI')).toBe('OpenAI · this folder · Not allowed');
    expect(aiConsentSummary({ answer: 'deny', scope: 'workspace' }, 'OpenAI')).toBe('OpenAI · this workspace · Not allowed until restart');
    expect(AI_NO_CONSENTS_TEXT).toBe('No cloud engine has been allowed here.');
    expect(aiConsentStepNote(true)).toBe('MikeDown asks before a cloud engine\'s first request in each workspace or folder.');
    expect(aiConsentStepNote(false)).toContain('without asking');
  });

  it('the session word says how long Allow lasts instead of pointing at the list', () => {
    const t = aiConsentText({ engineName: 'Anthropic', host: 'api.anthropic.com', scopeWord: 'session' });
    expect(t.body.split('\n\n').at(-1)).toBe('You can use a local engine instead. Allow for this session lasts until you quit MikeDown.');
  });
});

// ── T2: coverage the M3 and M4 tests above left open ────────────────────────

describe('whatIsSent covers every feature', () => {
  it('has a non-generic sentence for each feature that declares what it sends', () => {
    for (const f of AI_FEATURES) {
      if (f.sends) {
        expect(whatIsSent(f.id), f.id).toBe(AI_SENDS_TEXT[f.sends]);
        expect(whatIsSent(f.id), f.id).not.toBe(AI_SENDS_FALLBACK);
      } else {
        expect(whatIsSent(f.id), f.id).toBe(AI_SENDS_FALLBACK);
      }
    }
  });

  it('every available feature gets a real sentence, and every scope has text', () => {
    for (const f of AI_FEATURES.filter((f) => f.status === 'available')) {
      expect(whatIsSent(f.id), f.id).not.toBe(AI_SENDS_FALLBACK);
    }
    for (const scope of ['selection', 'document', 'documentAndTags'] as const) {
      expect(AI_SENDS_TEXT[scope].length, scope).toBeGreaterThan(10);
    }
  });
});

describe('aiConsentText for rewrite, summary and frontmatter on both scope words', () => {
  const cases = [
    { feature: 'rewrite', engineName: 'Anthropic', host: 'api.anthropic.com' },
    { feature: 'summary', engineName: 'OpenAI', host: 'api.openai.com' },
    { feature: 'frontmatter', engineName: 'OpenRouter', host: 'openrouter.ai' },
  ];

  for (const c of cases) {
    for (const scopeWord of ['workspace', 'folder'] as const) {
      it(`${c.feature} / ${scopeWord}`, () => {
        const policy = aiProviderPolicyForHost(c.host)!;
        const t = aiConsentText({ ...c, scopeWord, policy, policyLine: scopeWord === 'folder' });
        expect(t.title).toBe(`Send text to ${c.engineName}?`);
        expect(t.allow).toBe(`Allow for this ${scopeWord}`);
        expect(t.allowOnce).toBe('Allow once');
        expect(t.deny).toBe('Don\'t allow');
        const paragraphs = t.body.split('\n\n');
        expect(paragraphs[0]).toContain(`this request sends ${whatIsSent(c.feature)}.`);
        expect(paragraphs[0]).toContain(`${c.engineName} is a cloud engine at ${c.host}.`);
        if (scopeWord === 'folder') {expect(paragraphs.at(-2)).toBe(`${policy.label}: ${policy.url}`);}
        else {expect(t.body).not.toContain(policy.url);}
        expect(paragraphs.at(-1)).toBe(`You can use a local engine instead. Allow for this ${scopeWord} is remembered; you can change it in AI settings \u2192 Cloud consents.`);
      });
    }
  }

  it('a fixture case on the folder word reads the same on the workspace word apart from the word itself', () => {
    for (const c of fixture.cases as Array<{ input: any; expected: any }>) {
      if (c.input.scopeWord !== 'folder') {continue;}
      const other = aiConsentText({ ...c.input, scopeWord: 'workspace', policy: aiProviderPolicyForHost(c.input.host) });
      expect(other.body).toBe(c.expected.body.replace('Allow for this folder', 'Allow for this workspace'));
      expect(other.allow).toBe('Allow for this workspace');
    }
  });
});

describe('stale claims guard', () => {
  const root = join(__dirname, '..', '..', '..');
  const sources = [
    join(root, 'packages', 'core', 'src', 'ai', 'privacy.ts'),
    join(root, 'packages', 'core', 'src', 'ai', 'presets.ts'),
    join(root, 'packages', 'desktop', 'src-tauri', 'src', 'commands', 'ai', 'consent.rs'),
    join(root, 'test', 'ai-fixtures', 'consent', 'consent-text.json'),
  ];
  const stale = /does not train|never trains|not used for training/i;

  it('no source string says a provider does not train on, or never trains on, your text', () => {
    for (const file of sources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(stale);
    }
  });

  it('the rendered consent text never makes the claim either', () => {
    for (const preset of AI_ENGINE_PRESETS.filter((p) => p.family === 'cloud')) {
      const host = hostOfUrl(preset.baseUrl)!;
      const t = aiConsentText({ engineName: preset.id, host, feature: 'summary', scopeWord: 'workspace', policy: aiProviderPolicyForHost(host), policyLine: true });
      expect(`${t.title}\n${t.body}\n${t.allow}\n${t.allowOnce}\n${t.deny}`, preset.id).not.toMatch(stale);
    }
  });

  it('every cloud preset policy URL parses as https', () => {
    for (const p of AI_ENGINE_PRESETS.filter((p) => p.family === 'cloud')) {
      expect(new URL(p.policy!.url).protocol, p.id).toBe('https:');
    }
  });
});
