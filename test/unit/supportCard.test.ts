import { describe, it, expect, vi, afterEach } from 'vitest';
import { bootWebview, type Harness } from '../harness/webviewHarness';
import { CARD_COPY, ENTRY_COPY } from '../../src/supportCopy';

/**
 * "A note from Mike" support card + persistent entry points (review-appeal-
 * planning.md M5/M6), driven through the real webview bundle in jsdom. The
 * host's real copy fixtures (`src/supportCopy.ts`) are used verbatim so these
 * tests can't drift from what the extension host actually sends.
 *
 * Adjustments vs. the plan text (see the M7 worker prompt): the Settings
 * modal and the sidebar dismiss button both use the `supportShowSidebarLink`
 * key in `saveSettings` (matching the modal's existing flat-key style), and
 * the sidebar link / About button post `{ type: 'supportAction', action:
 * 'open' }` — the host replies with a manual `showSupportCard`.
 */

let harness: Harness | null = null;

const settle = () => new Promise(r => setTimeout(r, 30));

async function boot(): Promise<Harness> {
  harness = await bootWebview();
  harness.send({ type: 'update', content: '# Doc\n\nSome body text.\n' });
  await settle();
  harness.clear();
  return harness;
}

function findButtonByText(root: ParentNode, text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent === text);
  if (!btn) throw new Error(`no button with text "${text}"`);
  return btn as HTMLButtonElement;
}

afterEach(() => {
  vi.useRealTimers();
  harness?.dispose();
  harness = null;
});

describe('support card rendering', () => {
  it('renders the title, body, and five action buttons, and acks supportCardShown', async () => {
    const h = await boot();
    h.send({ type: 'showSupportCard', reason: 'auto', copy: CARD_COPY });
    await settle();

    const card = document.querySelector('[data-testid="support-card"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card!.querySelector('h2')?.textContent).toBe(CARD_COPY.title);
    expect(card!.querySelector('.support-card-body')?.textContent).toContain('Hi there! Thanks for downloading my markdown editor.');

    const actionButtons = Array.from(card!.querySelectorAll<HTMLButtonElement>('button[data-action]'))
      .filter(b => b.dataset.action !== 'close');
    expect(actionButtons.map(b => b.dataset.action)).toEqual(['review', 'share', 'feedback', 'later', 'never']);
    expect(actionButtons.map(b => b.textContent)).toEqual([
      CARD_COPY.buttons.review,
      CARD_COPY.buttons.share,
      CARD_COPY.buttons.feedback,
      CARD_COPY.buttons.later,
      CARD_COPY.buttons.never,
    ]);

    expect(h.last('supportCardShown')).toEqual({ type: 'supportCardShown' });
  });
});

describe('support card button actions', () => {
  const cases: Array<['review' | 'share' | 'feedback' | 'later' | 'never', string]> = [
    ['review', CARD_COPY.buttons.review],
    ['share', CARD_COPY.buttons.share],
    ['feedback', CARD_COPY.buttons.feedback],
    ['later', CARD_COPY.buttons.later],
    ['never', CARD_COPY.buttons.never],
  ];

  it.each(cases)('%s button posts supportAction %s', async (action, label) => {
    const h = await boot();
    h.send({ type: 'showSupportCard', reason: 'manual', copy: CARD_COPY });
    await settle();

    const btn = document.querySelector(`[data-testid="support-card"] button[data-action="${action}"]`) as HTMLButtonElement;
    expect(btn.textContent).toBe(label);
    btn.click();

    expect(h.last('supportAction')).toEqual({ type: 'supportAction', action });
  });

  it("the corner × posts supportAction 'close'", async () => {
    const h = await boot();
    h.send({ type: 'showSupportCard', reason: 'manual', copy: CARD_COPY });
    await settle();

    const closeBtn = document.querySelector('[data-testid="support-card"] button[data-action="close"]') as HTMLButtonElement;
    closeBtn.click();

    expect(h.last('supportAction')).toEqual({ type: 'supportAction', action: 'close' });
  });
});

describe('supportCopied confirmation', () => {
  it('swaps the share label to the Copied text, then reverts it', async () => {
    const h = await boot();
    h.send({ type: 'showSupportCard', reason: 'manual', copy: CARD_COPY });
    await settle();

    const shareBtn = document.querySelector('[data-testid="support-card"] button[data-action="share"]') as HTMLButtonElement;
    shareBtn.click();
    expect(h.last('supportAction')).toEqual({ type: 'supportAction', action: 'share' });

    vi.useFakeTimers();
    h.send({ type: 'supportCopied' });
    expect(shareBtn.textContent).toContain(CARD_COPY.copiedConfirmation);

    vi.advanceTimersByTime(2000);
    expect(shareBtn.textContent).toBe(CARD_COPY.buttons.share);
  });
});

describe('auto card and focus', () => {
  it("reason 'auto' does not steal focus, typing still edits the document, and the card is not inside .ProseMirror", async () => {
    const h = await boot();
    const before = document.activeElement;

    h.send({ type: 'showSupportCard', reason: 'auto', copy: CARD_COPY });
    await settle();

    expect(document.activeElement).toBe(before);

    const card = document.querySelector('[data-testid="support-card"]') as HTMLElement;
    const pm = document.querySelector('.ProseMirror') as HTMLElement;
    expect(pm.contains(card)).toBe(false);
    expect(document.body.contains(card)).toBe(true);

    h.typeInWysiwyg('hello');
    await settle();
    expect(h.lastEditMarkdown()).toContain('hello');
  });
});

describe('showSupportCard while Settings is open', () => {
  it("reason 'auto' posts busy and renders nothing", async () => {
    const h = await boot();
    const settingsBtn = document.querySelector('[data-action="settings"]') as HTMLButtonElement;
    settingsBtn.click();
    await settle();
    expect(document.getElementById('mikedown-settings-overlay')).not.toBeNull();

    h.send({ type: 'showSupportCard', reason: 'auto', copy: CARD_COPY });
    await settle();

    expect(h.last('busy')).toEqual({ type: 'busy' });
    expect(document.querySelector('[data-testid="support-card"]')).toBeNull();
  });
});

describe('sidebar footer entry point', () => {
  it('appears inline in the metrics row and opens the card', async () => {
    const h = await boot();
    h.send({ type: 'settings', supportEntryCopy: ENTRY_COPY, supportShowSidebarLink: true });
    await settle();

    const link = document.querySelector('[data-testid="sidebar-support-link"]') as HTMLButtonElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe(ENTRY_COPY.sidebarLink);

    const row = link.closest('.sidebar-footer-row');
    expect(row?.classList.contains('sidebar-footer-row--with-support')).toBe(true);
    expect(row?.querySelector('.sidebar-footer-metrics')).not.toBeNull();

    link.click();
    expect(h.last('supportAction')).toEqual({ type: 'supportAction', action: 'open' });

    h.send({ type: 'showSupportCard', reason: 'manual', copy: CARD_COPY });
    await settle();
    expect(document.querySelector('[data-testid="support-card"]')).not.toBeNull();
  });

  it('dismiss persists the setting, shows a confirmation that disappears, and stays gone across re-renders and broadcasts', async () => {
    const h = await boot();
    h.send({ type: 'settings', supportEntryCopy: ENTRY_COPY, supportShowSidebarLink: true });
    await settle();

    vi.useFakeTimers();
    const dismiss = document.querySelector('[data-testid="sidebar-support-dismiss"]') as HTMLButtonElement;
    dismiss.click();

    expect(h.last('saveSettings')).toEqual({ type: 'saveSettings', settings: { supportShowSidebarLink: false } });
    expect(document.querySelector('[data-testid="sidebar-support-link"]')).toBeNull();

    const status = document.querySelector('[data-testid="sidebar-support-status"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toBe(ENTRY_COPY.dismissConfirmation);

    vi.advanceTimersByTime(4000);
    expect(status?.textContent).toBe('');
    vi.useRealTimers();

    // Stays gone after a footer re-render (an editor edit re-renders the footer).
    h.typeInWysiwyg('x');
    await settle();
    expect(document.querySelector('[data-testid="sidebar-support-link"]')).toBeNull();

    // Stays gone after a settings broadcast that carries the persisted false back.
    h.send({ type: 'settings', supportShowSidebarLink: false });
    await settle();
    expect(document.querySelector('[data-testid="sidebar-support-link"]')).toBeNull();
  });

  it('live toggle: a settings broadcast hides and shows the link with no reload', async () => {
    const h = await boot();
    h.send({ type: 'settings', supportEntryCopy: ENTRY_COPY, supportShowSidebarLink: true });
    await settle();
    expect(document.querySelector('[data-testid="sidebar-support-link"]')).not.toBeNull();

    h.send({ type: 'settings', supportShowSidebarLink: false });
    await settle();
    expect(document.querySelector('[data-testid="sidebar-support-link"]')).toBeNull();

    h.send({ type: 'settings', supportShowSidebarLink: true });
    await settle();
    expect(document.querySelector('[data-testid="sidebar-support-link"]')).not.toBeNull();
  });
});

describe('Settings modal — Appearance checkbox and About tab', () => {
  it('the Appearance checkbox reflects and round-trips supportShowSidebarLink', async () => {
    const h = await boot();
    h.send({ type: 'settings', supportEntryCopy: ENTRY_COPY, supportShowSidebarLink: true });
    await settle();

    const settingsBtn = document.querySelector('[data-action="settings"]') as HTMLButtonElement;
    settingsBtn.click();
    await settle();

    let overlay = document.getElementById('mikedown-settings-overlay') as HTMLElement;
    let checkbox = overlay.querySelector('[data-testid="setting-support-sidebar-link"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    checkbox.click();
    expect(checkbox.checked).toBe(false);
    findButtonByText(overlay, 'Save to Settings').click();
    expect(h.last('saveSettings')?.settings.supportShowSidebarLink).toBe(false);

    // Reopening reflects the saved value.
    settingsBtn.click();
    await settle();
    overlay = document.getElementById('mikedown-settings-overlay') as HTMLElement;
    checkbox = overlay.querySelector('[data-testid="setting-support-sidebar-link"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.click();
    expect(checkbox.checked).toBe(true);
    findButtonByText(overlay, 'Save to Settings').click();
    expect(h.last('saveSettings')?.settings.supportShowSidebarLink).toBe(true);
  });

  it('the About tab button closes Settings and opens the card, even when the sidebar link is hidden', async () => {
    const h = await boot();
    h.send({ type: 'settings', supportEntryCopy: ENTRY_COPY, supportShowSidebarLink: false });
    await settle();

    const settingsBtn = document.querySelector('[data-action="settings"]') as HTMLButtonElement;
    settingsBtn.click();
    await settle();
    const overlay = document.getElementById('mikedown-settings-overlay') as HTMLElement;

    const aboutTab = overlay.querySelector('[data-tab-id="about"]') as HTMLButtonElement;
    aboutTab.click();

    const aboutBtn = overlay.querySelector('[data-testid="about-support-button"]') as HTMLButtonElement;
    expect(aboutBtn.textContent).toBe(ENTRY_COPY.aboutButton);
    aboutBtn.click();

    expect(document.getElementById('mikedown-settings-overlay')).toBeNull();
    expect(h.last('supportAction')).toEqual({ type: 'supportAction', action: 'open' });
  });
});
