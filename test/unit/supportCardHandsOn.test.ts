import { describe, it, expect, vi, afterEach } from 'vitest';
import { bootWebview, type Harness } from '../harness/webviewHarness';
import { CARD_COPY, ENTRY_COPY } from '../../src/supportCopy';

/**
 * Fills gaps left by supportCard.test.ts while auditing the review-appeal
 * hands-on checklist (worker-summary-m9-hands-on.md) for automation:
 *
 *  - step 2: focus lands on "Leave a review" for a manual open.
 *  - step 3: the card stays open after "Tell a colleague" (every other
 *    action closes it).
 *  - step 4: the card closes for every non-share action.
 *  - step 5: the sidebar link survives the footer's own 60s re-render tick.
 *  - step 8: the About tab's lead-in copy is actually rendered.
 */

let harness: Harness | null = null;
const settle = () => new Promise((r) => setTimeout(r, 30));

async function boot(): Promise<Harness> {
  harness = await bootWebview();
  harness.send({ type: 'update', content: '# Doc\n\nSome body text.\n' });
  await settle();
  harness.clear();
  return harness;
}

afterEach(() => {
  vi.useRealTimers();
  harness?.dispose();
  harness = null;
});

describe('support card — manual open focus (checklist step 2)', () => {
  it('focuses "Leave a review" when reason is manual', async () => {
    const h = await boot();
    h.send({ type: 'showSupportCard', reason: 'manual', copy: CARD_COPY });
    await settle();

    const reviewBtn = document.querySelector('[data-testid="support-card"] button[data-action="review"]');
    expect(document.activeElement).toBe(reviewBtn);
  });
});

describe('support card — open/close per action (checklist steps 3 and 4)', () => {
  it('stays open after "Tell a colleague" (share)', async () => {
    const h = await boot();
    h.send({ type: 'showSupportCard', reason: 'manual', copy: CARD_COPY });
    await settle();

    const shareBtn = document.querySelector('[data-testid="support-card"] button[data-action="share"]') as HTMLButtonElement;
    shareBtn.click();

    expect(document.querySelector('[data-testid="support-card"]')).not.toBeNull();
  });

  it.each(['review', 'feedback', 'later', 'never'] as const)('closes after %s', async (action) => {
    const h = await boot();
    h.send({ type: 'showSupportCard', reason: 'manual', copy: CARD_COPY });
    await settle();

    const btn = document.querySelector(`[data-testid="support-card"] button[data-action="${action}"]`) as HTMLButtonElement;
    btn.click();

    // The card removes itself after a short exit-animation delay (EXIT_MS in
    // supportCard.ts) rather than synchronously on click.
    await new Promise((r) => setTimeout(r, 200));
    expect(document.querySelector('[data-testid="support-card"]')).toBeNull();
  });
});

describe('sidebar footer link — survives its own 60s re-render (checklist step 5)', () => {
  it('is still present after the footer\'s periodic tick fires', async () => {
    const h = await boot();
    h.send({ type: 'settings', supportEntryCopy: ENTRY_COPY, supportShowSidebarLink: true });
    await settle();
    expect(document.querySelector('[data-testid="sidebar-support-link"]')).not.toBeNull();

    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(60_000);
    } finally {
      vi.useRealTimers();
    }

    expect(document.querySelector('[data-testid="sidebar-support-link"]')).not.toBeNull();
    expect((document.querySelector('[data-testid="sidebar-support-link"]') as HTMLElement).textContent).toBe(
      ENTRY_COPY.sidebarLink
    );
  });
});

describe('Settings modal — About tab lead-in copy (checklist step 8)', () => {
  it('renders the approved lead-in line above the Support button', async () => {
    const h = await boot();
    h.send({ type: 'settings', supportEntryCopy: ENTRY_COPY, supportShowSidebarLink: true });
    await settle();

    const settingsBtn = document.querySelector('[data-action="settings"]') as HTMLButtonElement;
    settingsBtn.click();
    await settle();
    const overlay = document.getElementById('mikedown-settings-overlay') as HTMLElement;
    const aboutTab = overlay.querySelector('[data-tab-id="about"]') as HTMLButtonElement;
    aboutTab.click();

    expect(overlay.textContent).toContain(ENTRY_COPY.aboutLeadIn);
    expect(overlay.textContent).toContain(ENTRY_COPY.aboutHeading);
  });
});
