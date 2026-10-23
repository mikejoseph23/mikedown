/**
 * Playwright fixture: a temp folder on real disk plus the Node half of the
 * Tauri mock (tauri-mock.js). The page's `invoke` calls land in `handle()`,
 * which mirrors `src-tauri/src/commands/fs.rs` closely enough for the app's
 * open / save path (BOM + CRLF detection, LF text, EOL + BOM re-applied on
 * write) and records every call in `ipc.calls`.
 */
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export interface IpcRecord {
  cmd: string;
  args: unknown;
  headers: Record<string, string>;
}

export interface Ipc {
  dir: string;
  calls: IpcRecord[];
  /** Files `frontend_ready` hands the page (the double-click / argv path). */
  launchFiles: string[];
  write(name: string, content: string | Buffer): string;
  read(name: string): Buffer;
}

function decode(bytes: Buffer): { text: string; encoding: string; eol: 'lf' | 'crlf' } {
  const hasBom = bytes.subarray(0, 3).equals(BOM);
  const body = hasBom ? bytes.subarray(3) : bytes;
  let raw: string;
  let valid = true;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    valid = false;
    raw = new TextDecoder('utf-8').decode(body);
  }
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/\n/g) ?? []).length;
  const eol = crlf > 0 && crlf >= lf - crlf ? 'crlf' : 'lf';
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return { text, encoding: !valid ? 'unknown' : hasBom ? 'utf8-bom' : 'utf8', eol };
}

function encode(text: string, eol: 'lf' | 'crlf', bom: boolean): Buffer {
  const lf = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const body = Buffer.from(eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf, 'utf8');
  return bom ? Buffer.concat([BOM, body]) : body;
}

function statOf(p: string) {
  const st = fs.statSync(p);
  return { mtimeMs: st.mtimeMs, size: st.size };
}

function handle(ipc: Ipc, cmd: string, args: any, headers: Record<string, string>): unknown {
  switch (cmd) {
    case 'frontend_ready':
      return ipc.launchFiles;
    case 'read_text': {
      const bytes = fs.readFileSync(args.path);
      const d = decode(bytes);
      return { ...d, ...statOf(args.path), readOnly: false };
    }
    case 'write_text': {
      fs.writeFileSync(args.path, encode(args.text, args.options.eol, args.options.bom));
      return statOf(args.path);
    }
    case 'stat': {
      if (!fs.existsSync(args.path)) {return { exists: false, isFile: false, isDir: false, mtimeMs: 0, size: 0, readOnly: false };}
      const st = fs.statSync(args.path);
      return { exists: true, isFile: st.isFile(), isDir: st.isDirectory(), mtimeMs: st.mtimeMs, size: st.size, readOnly: false };
    }
    case 'exists':
      return fs.existsSync(args.path);
    case 'list_dir': {
      // Mirrors fs.rs: folders first, natural order; with options, hidden
      // entries (dotfolders, node_modules, OS clutter) unless showHidden.
      if (!fs.existsSync(args.path)) {return [];}
      let entries = fs.readdirSync(args.path, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
      if (args.options && !args.options.showHidden) {
        entries = entries.filter((e) => (e.isDir ? !e.name.startsWith('.') && e.name !== 'node_modules' : !['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(e.name)));
      }
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      return entries.sort((a, b) => (a.isDir === b.isDir ? collator.compare(a.name, b.name) : a.isDir ? -1 : 1));
    }
    case 'list_markdown': {
      const out: string[] = [];
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === '.mikedown' || (!args.showHidden && (e.name.startsWith('.') || e.name === 'node_modules'))) {continue;}
            walk(p);
          } else if (/\.(md|markdown)$/i.test(e.name)) {out.push(p);}
        }
      };
      walk(args.root);
      return out;
    }
    case 'create_file':
      fs.writeFileSync(args.path, '', { flag: 'wx' });
      return null;
    case 'create_dir':
      fs.mkdirSync(args.path);
      return null;
    case 'rename':
    case 'move_path':
      if (fs.existsSync(args.to) && args.from.toLowerCase() !== args.to.toLowerCase()) {throw new Error(`“${path.basename(args.to)}” already exists.`);}
      fs.mkdirSync(path.dirname(args.to), { recursive: true });
      fs.renameSync(args.from, args.to);
      return null;
    case 'copy_path':
      fs.cpSync(args.from, args.to, { recursive: true, errorOnExist: true, force: false });
      return null;
    case 'trash':
      fs.rmSync(args.path, { recursive: true, force: true });
      return null;
    case 'watch':
      return 'native';
    case 'modifier_state':
      return { alt: false };
    case 'mkdir':
      fs.mkdirSync(args.path, { recursive: true });
      return null;
    case 'read_bytes':
      return { __bytes: Array.from(fs.readFileSync(args.path)) };
    case 'write_bytes': {
      const target = decodeURIComponent(headers['x-path']);
      fs.writeFileSync(target, Buffer.from(args.__bytes));
      return statOf(target);
    }
    default:
      // Window/title/represented-file, allow_asset, shell, dialogs: no-ops.
      return null;
  }
}

export const test = base.extend<{ ipc: Ipc }>({
  ipc: async ({ page }, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-e2e-'));
    const ipc: Ipc = {
      dir,
      calls: [],
      launchFiles: [],
      write(name, content) {
        const p = path.join(dir, name);
        fs.writeFileSync(p, content);
        return p;
      },
      read: (name) => fs.readFileSync(path.join(dir, name)),
    };
    await page.exposeFunction('__mikedownE2eInvoke', (cmd: string, args: unknown, headers: Record<string, string>) => {
      ipc.calls.push({ cmd, args, headers });
      try {
        return handle(ipc, cmd, args, headers);
      } catch (err) {
        return { __error: String((err as Error).message ?? err) };
      }
    });
    await page.addInitScript({ path: path.join(here, 'tauri-mock.js') });
    await use(ipc);
    fs.rmSync(dir, { recursive: true, force: true });
  },
});

export { expect };
