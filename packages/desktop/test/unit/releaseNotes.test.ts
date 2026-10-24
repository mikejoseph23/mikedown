/** U2: the "What's new" renderer and its sanitizer (no scripts, no handlers, no remote images). */
import { describe, expect, it } from 'vitest';
import { isSafeLink, renderReleaseNotes, sanitizeNotesHtml } from '../../src/ui/releaseNotes';

describe('sanitizeNotesHtml', () => {
  it('drops <script> and its content', () => {
    const out = sanitizeNotesHtml('<p>Hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>Hi</p>');
  });

  it('drops event handlers and style', () => {
    const out = sanitizeNotesHtml('<p onclick="x()" style="color:red" onmouseover="y()">Hi</p>');
    expect(out).toBe('<p>Hi</p>');
  });

  it('removes remote images, keeping alt text', () => {
    expect(sanitizeNotesHtml('<p><img src="https://evil.example/t.png" alt="Chart"></p>')).toBe('<p>Chart</p>');
    expect(sanitizeNotesHtml('<p><img src="//evil.example/t.png"></p>')).toBe('<p></p>');
    expect(sanitizeNotesHtml('<p><img src="data:image/svg+xml;base64,PHN2Zz4="></p>')).toBe('<p></p>');
  });

  it('keeps inline raster images', () => {
    expect(sanitizeNotesHtml('<img src="data:image/png;base64,iVBORw0K" alt="x">')).toContain('src="data:image/png;base64,iVBORw0K"');
  });

  it('strips javascript: and other non-web links, keeps http(s) and mailto', () => {
    expect(sanitizeNotesHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeNotesHtml('<a href=" JAVASCRIPT:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeNotesHtml('<a href="file:///etc/passwd">x</a>')).toBe('<a>x</a>');
    expect(sanitizeNotesHtml('<a href="https://www.iadev.net/" target="_top">x</a>')).toBe('<a href="https://www.iadev.net/" rel="noopener noreferrer">x</a>');
    expect(sanitizeNotesHtml('<a href="mailto:a@b.c">x</a>')).toContain('href="mailto:a@b.c"');
  });

  it('removes iframes, forms, svg and comments; unwraps unknown tags', () => {
    const out = sanitizeNotesHtml('<iframe src="https://x"></iframe><form><input></form><svg><script>1</script></svg><!-- c --><section><p>Kept</p></section>');
    expect(out).toBe('<p>Kept</p>');
  });

  it('cleans nested content inside unwrapped tags', () => {
    expect(sanitizeNotesHtml('<div><span onclick="x">a</span><script>b</script></div>')).toBe('<span>a</span>');
  });
});

describe('renderReleaseNotes', () => {
  it('renders markdown lists, emphasis, code and links', () => {
    const html = renderReleaseNotes('## Fixes\n\n- **Faster** open\n- `code`\n- See https://www.iadev.net/mikedown/');
    expect(html).toContain('<h2>Fixes</h2>');
    expect(html).toContain('<strong>Faster</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://www.iadev.net/mikedown/"');
  });

  it('shows raw HTML in the notes as text, never as markup', () => {
    const html = renderReleaseNotes('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops a markdown image pointing at a remote server', () => {
    expect(renderReleaseNotes('![tracker](https://evil.example/pixel.gif)')).toBe('<p>tracker</p>');
  });

  it('neutralizes a javascript: markdown link', () => {
    // markdown-it refuses the link, so it stays plain text: no anchor, no href.
    const html = renderReleaseNotes('[x](javascript:alert(1))');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
  });

  it('is empty for missing or blank notes', () => {
    expect(renderReleaseNotes(null)).toBe('');
    expect(renderReleaseNotes('   \n')).toBe('');
  });
});

describe('isSafeLink', () => {
  it('allows http(s) and mailto only', () => {
    expect(isSafeLink('https://a')).toBe(true);
    expect(isSafeLink('http://a')).toBe(true);
    expect(isSafeLink('mailto:a@b')).toBe(true);
    expect(isSafeLink('javascript:1')).toBe(false);
    expect(isSafeLink('/relative')).toBe(false);
    expect(isSafeLink(null)).toBe(false);
  });
});
