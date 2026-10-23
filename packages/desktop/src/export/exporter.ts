/**
 * File > Export > HTML… and Print / PDF… (M9). Takes the active editor's
 * rendered HTML, makes it a standalone document (`standaloneHtml.ts`) and
 * either saves it (HTML) or hands it to a print window (PDF / Print: the OS
 * dialog offers Save as PDF on both platforms).
 *
 * Image choice: the native save dialog has no custom options, so a document
 * with local images first gets a small confirm with a "copy images to a
 * folder instead of embedding them" checkbox (default: embed).
 */
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import type { FsApi } from '../documents/fsApi';
import { stripQuery } from '../host/imagePipeline';
import { imageMimeFor } from '../tree/dropRouting';
import type { Dialogs } from '../ui/dialogs';
import { printHtml } from './printWindow';
import {
  buildStandaloneHtml,
  extractTitle,
  prepareImages,
  rawImageSrc,
  suggestedExportName,
  type ImageHooks,
  type ImageMode,
  type PreparedBody,
} from './standaloneHtml';

export interface ExporterDeps {
  path: PathOps;
  fs: Pick<FsApi, 'readBytes' | 'writeText' | 'writeBytes' | 'mkdir'>;
  dialogs: Pick<Dialogs, 'saveFile' | 'confirm' | 'toast' | 'error'>;
  /** The document the export is about (its path anchors relative images). */
  doc(): { path: string | null } | null;
  /** The active editor's rendered HTML, or null when no editor is showing. */
  html(): string | null;
  /** Core's self-contained stylesheet (`exportCss.ts`). */
  stylesheet(): Promise<string>;
}

export interface Exporter {
  exportHtml(html?: string): Promise<void>;
  /** PDF… and Print… are the same flow: the OS print dialog. */
  print(html?: string): Promise<void>;
}

const HTML_FILTERS = [{ name: 'HTML', extensions: ['html', 'htm'] }];

/** Count of `<img>` tags that point at a local file (neither data: nor remote). */
export function localImageCount(html: string): number {
  let n = 0;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const raw = rawImageSrc(tag);
    if (raw && !/^(?:data:|(?:https?:)?\/\/)/i.test(raw)) {n++;}
  }
  return n;
}

export function createExporter(deps: ExporterDeps): Exporter {
  const { path, fs, dialogs } = deps;

  function imageHooks(docPath: string | null): ImageHooks {
    return {
      async load(raw) {
        const clean = stripQuery(raw);
        let decoded = clean;
        try {decoded = decodeURIComponent(clean);} catch { /* keep as written */ }
        for (const candidate of decoded === clean ? [clean] : [decoded, clean]) {
          const abs = path.isAbsolute(candidate)
            ? path.normalize(candidate)
            : docPath ? path.resolve(path.dirname(docPath), candidate) : null;
          if (!abs) {continue;}
          try {
            const bytes = await fs.readBytes(abs);
            return { mime: imageMimeFor(abs) || 'application/octet-stream', bytes };
          } catch { /* try the next spelling */ }
        }
        return null;
      },
    };
  }

  function warn(prepared: PreparedBody, verb: string): void {
    const parts: string[] = [];
    if (prepared.missingImages) {parts.push(`${prepared.missingImages} image${prepared.missingImages === 1 ? '' : 's'} could not be read`);}
    if (prepared.remoteImages) {parts.push(`${prepared.remoteImages} remote image${prepared.remoteImages === 1 ? ' stays' : 's stay'} online`);}
    if (parts.length) {dialogs.toast(`${verb}: ${parts.join('; ')}.`, { ms: 7000 });}
  }

  async function exportHtml(htmlArg?: string): Promise<void> {
    const html = htmlArg ?? deps.html();
    if (html === null) {
      dialogs.toast('Open a document to export.');
      return;
    }
    const docPath = deps.doc()?.path ?? null;
    let mode: ImageMode = 'inline';
    if (localImageCount(html) > 0) {
      const answer = await dialogs.confirm('Export as HTML', {
        okLabel: 'Choose File…',
        checkboxLabel: 'Copy images to a folder next to the file instead of embedding them',
        detail: 'Images are embedded in the page by default, so the file can be moved or emailed on its own.',
      });
      if (!answer.ok) {return;}
      mode = answer.checked ? 'sidecar' : 'inline';
    }
    const name = suggestedExportName(docPath, 'html');
    const target = await dialogs.saveFile({
      defaultPath: docPath ? path.join(path.dirname(docPath), name) : name,
      filters: HTML_FILTERS,
      title: 'Export as HTML',
    });
    if (!target) {return;}
    try {
      const stem = path.basename(target).replace(/\.[^.]+$/, '') || 'export';
      const folder = `${stem}_files`;
      const prepared = await prepareImages(html, imageHooks(docPath), mode, folder);
      if (prepared.sidecar.length) {
        const dir = path.dirname(target);
        await fs.mkdir(path.join(dir, folder));
        for (const file of prepared.sidecar) {
          await fs.writeBytes(path.join(dir, ...file.relPath.split('/')), file.bytes);
        }
      }
      const out = buildStandaloneHtml({
        bodyHtml: prepared.html,
        fileName: docPath,
        css: await deps.stylesheet(),
      });
      await fs.writeText(target, out, { eol: 'lf', bom: false });
      dialogs.toast(`Exported to ${path.basename(target)}`);
      warn(prepared, 'Export');
    } catch (err) {
      await dialogs.error(`Could not export to ${target}.\n\n${String(err)}`);
    }
  }

  async function print(htmlArg?: string): Promise<void> {
    const html = htmlArg ?? deps.html();
    if (html === null) {
      dialogs.toast('Open a document to print.');
      return;
    }
    const docPath = deps.doc()?.path ?? null;
    try {
      const prepared = await prepareImages(html, imageHooks(docPath), 'inline', '');
      const out = buildStandaloneHtml({ bodyHtml: prepared.html, fileName: docPath, css: await deps.stylesheet() });
      const outcome = await printHtml(out, extractTitle(html, docPath));
      if (outcome === 'preview') {
        dialogs.toast('Opened a print preview: use its Print button to print or save as PDF.', { ms: 6000 });
      }
      warn(prepared, 'Print');
    } catch (err) {
      await dialogs.error(`Could not print.\n\n${String(err)}`);
    }
  }

  return { exportHtml, print };
}
