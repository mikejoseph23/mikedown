/**
 * VsCodeHost posts, for every MikeDownHost method, exactly the message shape
 * the extension host (markdownEditorProvider.ts) has always received. These
 * are the wire format: a change here is a protocol change.
 */
import { describe, expect, it } from 'vitest';
import { VsCodeHost } from '../../src/webview/vsCodeHost';

function setup() {
  const posted: any[] = [];
  const host = new VsCodeHost({ postMessage: (m) => posted.push(m), getState: () => undefined, setState: () => undefined });
  /** The last posted message, with a generated requestId replaced by a stable token. */
  const last = () => {
    const m = { ...posted[posted.length - 1] };
    if (typeof m.requestId === 'string') {
      expect(m.requestId).toMatch(/^img(paste|pick|resize)-\d+-[a-z0-9]+$/);
      m.requestId = '<requestId>';
    }
    return m;
  };
  return { host, posted, last };
}

describe('VsCodeHost outbound messages', () => {
  it('onChange posts edit with content and pristine', () => {
    const { host, last } = setup();
    host.onChange('# Hi\n', { pristine: false });
    expect(last()).toMatchInlineSnapshot(`
      {
        "content": "# Hi
      ",
        "pristine": false,
        "type": "edit",
      }
    `);
    host.onChange('x', { pristine: true });
    expect(last()).toEqual({ type: 'edit', content: 'x', pristine: true });
  });

  it('onStats posts stats with the document and selection pieces', () => {
    const { host, last } = setup();
    host.onStats({ document: 'hello world' });
    expect(last()).toEqual({ type: 'stats', document: 'hello world' });
    host.onStats({ selection: { words: 2, chars: 11 } });
    expect(last()).toEqual({ type: 'stats', selection: { words: 2, chars: 11 } });
    host.onStats({ selection: null });
    expect(last()).toEqual({ type: 'stats', selection: null });
  });

  it('openLink posts openLink, adding behavior and reveal fields only when given', () => {
    const { host, last } = setup();
    host.openLink('./a.md');
    expect(last()).toStrictEqual({ type: 'openLink', href: './a.md' });
    host.openLink('./a.md#x', 'openNewTab');
    expect(last()).toStrictEqual({ type: 'openLink', href: './a.md#x', behavior: 'openNewTab' });
    host.openLink('#sec', 'navigateCurrentTab', { href: '#sec', occurrence: 2 });
    expect(last()).toStrictEqual({
      type: 'openLink', href: '#sec', behavior: 'navigateCurrentTab', revealHref: '#sec', revealOccurrence: 2,
    });
  });

  it('saveSettings posts the patch, with silent and source flags only when set', () => {
    const { host, last } = setup();
    host.saveSettings({ fontSize: 18 });
    expect(last()).toStrictEqual({ type: 'saveSettings', settings: { fontSize: 18 } });
    host.saveSettings({ slashCommandsEnabled: false } as any, { source: 'slashMenu', silent: true });
    expect(last()).toStrictEqual({
      type: 'saveSettings', settings: { slashCommandsEnabled: false }, silent: true, source: 'slashMenu',
    });
  });

  it('toggleTheme and openKeybindings post bare messages', () => {
    const { host, last } = setup();
    host.toggleTheme();
    expect(last()).toStrictEqual({ type: 'toggleTheme' });
    host.openKeybindings();
    expect(last()).toStrictEqual({ type: 'openKeybindings' });
  });

  it('uploadImage posts savePastedImage with base64 bytes and a requestId', () => {
    const { host, last } = setup();
    void host.uploadImage({ mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]), name: 'ignored.png' });
    expect(last()).toStrictEqual({
      type: 'savePastedImage', requestId: '<requestId>', mime: 'image/png', dataBase64: 'iVBORw==',
    });
  });

  it('uploadImage encodes payloads larger than one chunk', () => {
    const { host, posted } = setup();
    const bytes = new Uint8Array(0x8000 * 2 + 5).map((_, i) => i % 251);
    void host.uploadImage({ mime: 'image/png', bytes });
    const decoded = Uint8Array.from(atob(posted[0].dataBase64), c => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });

  it('pickImage posts pickImage with a requestId', () => {
    const { host, last } = setup();
    void host.pickImage();
    expect(last()).toStrictEqual({ type: 'pickImage', requestId: '<requestId>' });
  });

  it('resizeImage posts resizeImage with the source, base64 bytes and percent', () => {
    const { host, last } = setup();
    void host.resizeImage({ currentSrc: 'vscode-webview://x/a.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), percent: 50 });
    expect(last()).toStrictEqual({
      type: 'resizeImage', requestId: '<requestId>', currentSrc: 'vscode-webview://x/a.png',
      mime: 'image/png', dataBase64: 'AQID', percent: 50,
    });
  });

  it('knowledge-base requests post their request messages', () => {
    const { host, last } = setup();
    void host.getLinkSuggestions();
    expect(last()).toStrictEqual({ type: 'getLinkSuggestions' });
    void host.getFileHeadings('./other.md');
    expect(last()).toStrictEqual({ type: 'getFileHeadings', filePath: './other.md' });
    void host.resolveWikilinks(['a', 'b']);
    expect(last()).toStrictEqual({ type: 'resolveWikilinks', targets: ['a', 'b'] });
    void host.createWikilink('new note');
    expect(last()).toStrictEqual({ type: 'createWikilink', target: 'new note' });
    void host.checkLinks([{ href: './a.md', type: 'file' }, { href: '#x', type: 'anchor' }]);
    expect(last()).toStrictEqual({
      type: 'checkLinks', links: [{ href: './a.md', type: 'file' }, { href: '#x', type: 'anchor' }],
    });
    void host.getTags();
    expect(last()).toStrictEqual({ type: 'getTags' });
    void host.getDiffBaseline();
    expect(last()).toStrictEqual({ type: 'requestDiff' });
  });

  it('tag and heading notifications post their messages', () => {
    const { host, last } = setup();
    host.openTag('project');
    expect(last()).toStrictEqual({ type: 'openTag', tag: 'project' });
    host.onHeadingRenamed('old-slug', 'new-slug');
    expect(last()).toStrictEqual({ type: 'headingRenamed', oldSlug: 'old-slug', newSlug: 'new-slug' });
    host.onHeadingRenameAmbiguous('intro');
    expect(last()).toStrictEqual({ type: 'headingRenameAmbiguous', baseName: 'intro' });
  });

  it('output methods post the rendered html', () => {
    const { host, last } = setup();
    host.exportHtml('<p>a</p>');
    expect(last()).toStrictEqual({ type: 'exportHtml', html: '<p>a</p>' });
    host.printDocument('<p>b</p>');
    expect(last()).toStrictEqual({ type: 'printDocument', html: '<p>b</p>' });
    host.viewInBrowser('<p>c</p>');
    expect(last()).toStrictEqual({ type: 'viewInBrowser', html: '<p>c</p>' });
  });

  it('sidebarPrefs post the sidebar messages', () => {
    const { host, last } = setup();
    host.sidebarPrefs.requestState();
    expect(last()).toStrictEqual({ type: 'sidebarRequestState' });
    host.sidebarPrefs.setPref('always');
    expect(last()).toStrictEqual({ type: 'sidebarSetPref', pref: 'always' });
    host.sidebarPrefs.applyDefaults();
    expect(last()).toStrictEqual({ type: 'sidebarApplyDefaults' });
    host.sidebarPrefs.sectionCollapsed('outline', true);
    expect(last()).toStrictEqual({ type: 'sidebarSectionCollapsed', section: 'outline', collapsed: true });
  });

  it('implements every method the shell advertises (no method is missing a test)', () => {
    const { host } = setup();
    const advertised = [
      'onChange', 'onStats', 'openLink', 'saveSettings', 'toggleTheme', 'openKeybindings', 'uploadImage',
      'pickImage', 'resizeImage', 'getLinkSuggestions', 'getFileHeadings', 'resolveWikilinks', 'createWikilink',
      'checkLinks', 'getTags', 'openTag', 'getDiffBaseline', 'onHeadingRenamed', 'onHeadingRenameAmbiguous',
      'exportHtml', 'printDocument', 'viewInBrowser',
    ];
    for (const name of advertised) expect(typeof (host as any)[name], name).toBe('function');
    expect(Object.keys(host.sidebarPrefs).sort()).toEqual(['applyDefaults', 'requestState', 'sectionCollapsed', 'setPref']);
  });
});

describe('VsCodeHost reply routing', () => {
  it('resolves uploadImage from pastedImageResult by requestId', async () => {
    const { host, posted } = setup();
    const p = host.uploadImage({ mime: 'image/png', bytes: new Uint8Array([1]) });
    const { requestId } = posted[0];
    expect(host.handleReply({ type: 'pastedImageResult', requestId, success: true, webviewUri: 'vscode-webview://x/a.png', alt: 'a' })).toBe(true);
    await expect(p).resolves.toEqual({ src: 'vscode-webview://x/a.png', alt: 'a' });
  });

  it('rejects uploadImage when the reply has no success flag', async () => {
    const { host, posted } = setup();
    const p = host.uploadImage({ mime: 'image/png', bytes: new Uint8Array([1]) });
    host.handleReply({ type: 'pastedImageResult', requestId: posted[0].requestId, error: 'document not saved' });
    await expect(p).rejects.toThrow('document not saved');
  });

  it('resolves pickImage to null when the user cancels', async () => {
    const { host, posted } = setup();
    const p = host.pickImage();
    host.handleReply({ type: 'pickedImageResult', requestId: posted[0].requestId, cancelled: true });
    await expect(p).resolves.toBeNull();
  });

  it('resolves resizeImage and getTags and getDiffBaseline from their replies', async () => {
    const { host, posted } = setup();
    const resize = host.resizeImage({ currentSrc: 's', mime: 'image/png', bytes: new Uint8Array([1]), percent: 50 });
    host.handleReply({ type: 'resizeImageResult', requestId: posted[0].requestId, success: true, webviewUri: 'u', overwritten: true });
    await expect(resize).resolves.toEqual({ src: 'u', overwritten: true });

    const tags = host.getTags();
    expect(host.handleReply({ type: 'tags', tags: [{ tag: 'a', count: 2 }] })).toBe(true);
    await expect(tags).resolves.toEqual([{ tag: 'a', count: 2 }]);
    // An unsolicited tag push is not consumed: the caller applies it.
    expect(host.handleReply({ type: 'tags', tags: [] })).toBe(false);

    const diff = host.getDiffBaseline();
    host.handleReply({ type: 'diffData', headContent: 'old', hasChanges: true });
    await expect(diff).resolves.toEqual({ headContent: 'old', hasChanges: true });
  });

  it('leaves non-reply messages to the caller', () => {
    const { host } = setup();
    expect(host.handleReply({ type: 'update', content: 'x' })).toBe(false);
    expect(host.handleReply({ type: 'settings' })).toBe(false);
    expect(host.handleReply(undefined)).toBe(false);
  });
});
