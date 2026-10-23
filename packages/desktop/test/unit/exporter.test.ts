import { beforeEach, describe, expect, it } from 'vitest';
import { createPathOps } from '../../src/host/pathOps';
import { printHtml, type PrintApi, type PrintResult } from '../../src/export/printWindow';

import { createExporter, localImageCount } from '../../src/export/exporter';

const path = createPathOps('posix');
const HTML = '<h1>Plan</h1><p><img src="asset://localhost/a" data-mikedown-src="img/a.png"></p>';

function setup(opts: { confirm?: { ok: boolean; checked: boolean }; save?: string | null; html?: string | null } = {}) {
  const written: Record<string, string> = {};
  const bytes: Record<string, Uint8Array> = {};
  const dirs: string[] = [];
  const toasts: string[] = [];
  const errors: string[] = [];
  const exporter = createExporter({
    path,
    fs: {
      readBytes: async (p) => {
        if (p === '/notes/img/a.png') {return new Uint8Array([1, 2, 3]);}
        throw new Error('not found');
      },
      writeText: async (p, text) => { written[p] = text; return { mtimeMs: 0, size: text.length }; },
      writeBytes: async (p, b) => { bytes[p] = b; return { mtimeMs: 0, size: b.length }; },
      mkdir: async (p) => { dirs.push(p); },
    },
    dialogs: {
      saveFile: async () => ('save' in opts ? opts.save ?? null : '/out/Plan.html'),
      confirm: async () => opts.confirm ?? { ok: true, checked: false },
      toast: (m) => { toasts.push(m); },
      error: async (m) => { errors.push(m); },
    },
    stylesheet: async () => '.ProseMirror{color:#111}',
    doc: () => ({ path: '/notes/plan.md' }),
    html: () => ('html' in opts ? opts.html ?? null : HTML),
  });
  return { exporter, written, bytes, dirs, toasts, errors };
}

describe('Exporter.exportHtml', () => {
  it('writes a standalone page with the image embedded by default', async () => {
    const t = setup();
    await t.exporter.exportHtml();
    const out = t.written['/out/Plan.html'];
    expect(out).toContain('<title>Plan</title>');
    expect(out).toContain('.ProseMirror{color:#111}');
    expect(out).toContain('src="data:image/png;base64,AQID"');
    expect(t.dirs).toEqual([]);
    expect(t.toasts[0]).toMatch(/Exported to Plan\.html/);
  });

  it('sidecar choice copies the image beside the file', async () => {
    const t = setup({ confirm: { ok: true, checked: true } });
    await t.exporter.exportHtml();
    expect(t.dirs).toEqual(['/out/Plan_files']);
    expect([...t.bytes['/out/Plan_files/a.png']]).toEqual([1, 2, 3]);
    expect(t.written['/out/Plan.html']).toContain('src="Plan_files/a.png"');
  });

  it('writes nothing when the save dialog or the image question is cancelled', async () => {
    const a = setup({ save: null });
    await a.exporter.exportHtml();
    expect(a.written).toEqual({});
    const b = setup({ confirm: { ok: false, checked: false } });
    await b.exporter.exportHtml();
    expect(b.written).toEqual({});
  });

  it('skips the image question for documents without local images', async () => {
    const t = setup({ html: '<h1>Plain</h1>' });
    await t.exporter.exportHtml();
    expect(t.written['/out/Plan.html']).toContain('<title>Plain</title>');
  });

  it('reports unreadable images in a toast', async () => {
    const t = setup({ html: '<img src="x" data-mikedown-src="gone.png">' });
    await t.exporter.exportHtml();
    expect(t.toasts.join(' ')).toMatch(/1 image could not be read/);
  });
});

describe('localImageCount', () => {
  it('counts only local files', () => {
    expect(localImageCount('<img src="a.png"><img src="https://x/y.png"><img src="data:image/png;base64,AA"><img src="x" data-mikedown-src="b.png">')).toBe(2);
  });
});

describe('printHtml (hidden first, preview fallback)', () => {
  let opened: Array<{ preview: boolean; label: string }>;
  let closed: string[];
  let emit: (r: PrintResult) => void;
  const api = (reply: 'printing' | 'failed' | null): PrintApi => ({
    open: async (_html, _title, preview) => {
      const label = `print-${opened.length + 1}`;
      opened.push({ preview, label });
      if (!preview && reply) {queueMicrotask(() => emit({ label, state: reply, error: reply === 'failed' ? 'boom' : null }));}
      return label;
    },
    close: async (label) => { closed.push(label); },
    onResult: async (handler) => { emit = handler; return () => undefined; },
  });
  beforeEach(() => { opened = []; closed = []; });

  it('stays hidden when printing starts', async () => {
    expect(await printHtml('<p/>', 'T', api('printing'), 50)).toBe('printing');
    expect(opened).toEqual([{ preview: false, label: 'print-1' }]);
    expect(closed).toEqual([]);
  });

  it('falls back to a visible preview when the hidden window fails', async () => {
    expect(await printHtml('<p/>', 'T', api('failed'), 50)).toBe('preview');
    expect(opened.map((o) => o.preview)).toEqual([false, true]);
    expect(closed).toEqual(['print-1']);
  });

  it('falls back when the hidden window never reports', async () => {
    expect(await printHtml('<p/>', 'T', api(null), 20)).toBe('preview');
    expect(opened.map((o) => o.preview)).toEqual([false, true]);
  });
});
