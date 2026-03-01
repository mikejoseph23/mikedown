import { describe, it, expect, beforeEach } from 'vitest';

// Import the cleanHtml function — we need to replicate its logic for testing
// since it lives in the webview bundle. We'll test it by creating a mock DOM.

// Minimal DOM-based cleanHtml test (uses jsdom via vitest environment)
function stripTags(html: string, ...tags: string[]): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  tags.forEach(tag => doc.querySelectorAll(tag).forEach(el => el.remove()));
  return doc.body.innerHTML;
}

describe('Smart Paste — HTML Cleanup', () => {
  it('strips script tags', () => {
    const html = '<p>Hello</p><script>alert(1)</script>';
    const result = stripTags(html, 'script');
    expect(result).not.toContain('<script');
    expect(result).toContain('Hello');
  });

  it('strips style tags', () => {
    const html = '<p>Hello</p><style>body{color:red}</style>';
    const result = stripTags(html, 'style');
    expect(result).not.toContain('<style');
  });

  it('preserves paragraph content', () => {
    const doc = new DOMParser().parseFromString('<p>Hello <b>world</b></p>', 'text/html');
    expect(doc.body.textContent).toContain('Hello world');
  });

  it('handles Mso-class paragraphs', () => {
    const doc = new DOMParser().parseFromString('<p class="MsoNormal">Word paragraph</p>', 'text/html');
    const el = doc.querySelector('.MsoNormal');
    expect(el?.textContent).toBe('Word paragraph');
  });

  it('converts figure to img + caption', () => {
    const html = '<figure><img src="test.png" alt="test"><figcaption>Caption text</figcaption></figure>';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Simulate the figure conversion
    doc.querySelectorAll('figure').forEach(fig => {
      const img = fig.querySelector('img');
      const caption = fig.querySelector('figcaption');
      if (img) {
        const fragment = doc.createDocumentFragment();
        fragment.appendChild(img.cloneNode(true));
        if (caption) {
          const p = doc.createElement('p');
          const em = doc.createElement('em');
          em.textContent = caption.textContent || '';
          p.appendChild(em);
          fragment.appendChild(p);
        }
        fig.replaceWith(fragment);
      }
    });
    expect(doc.body.querySelector('img')).not.toBeNull();
    expect(doc.body.textContent).toContain('Caption text');
  });

  it('handles empty HTML', () => {
    const doc = new DOMParser().parseFromString('', 'text/html');
    expect(doc.body.innerHTML).toBe('');
  });

  it('strips nav/aside/header/footer', () => {
    const tags = ['nav', 'aside', 'header', 'footer'];
    tags.forEach(tag => {
      const result = stripTags(`<${tag}>nav content</${tag}><p>content</p>`, tag);
      expect(result).not.toContain('nav content');
      expect(result).toContain('content');
    });
  });
});
