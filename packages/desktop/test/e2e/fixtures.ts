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
import crypto from 'node:crypto';
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
  /** Stand-in for <app-data>: backups/ and sessions/ live here (M4). */
  appData: string;
  calls: IpcRecord[];
  /** Files `frontend_ready` hands the page (the double-click / argv path). */
  launchFiles: string[];
  /** Answer for the next `quit_reply` / `request_quit_cmd` round (recorded). */
  quitReplies: boolean[];
  windowStates: Array<{ folder: string | null; files: string[] }>;
  write(name: string, content: string | Buffer): string;
  read(name: string): Buffer;
  /** The backup index as Rust would keep it. */
  backupIndex(): Record<string, { path: string | null; untitledId: string | null; folder: string | null; savedAt: number }>;
  session(label?: string): unknown | null;
  /** Per-spec command handlers, checked before the built-in ones (M7: search_folder). */
  custom: Record<string, (args: any) => unknown>;
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

// ── M4: backups and sessions, mirroring src-tauri/src/commands/appdata.rs ──

function sha256(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function indexPath(ipc: Ipc): string {
  return path.join(ipc.appData, 'backups', 'index.json');
}

function readIndex(ipc: Ipc): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(indexPath(ipc), 'utf8')); } catch { return {}; }
}

function writeIndex(ipc: Ipc, index: Record<string, any>): void {
  fs.mkdirSync(path.dirname(indexPath(ipc)), { recursive: true });
  fs.writeFileSync(indexPath(ipc), JSON.stringify(index, null, 2));
}

function sessionPath(ipc: Ipc, label: string): string {
  return path.join(ipc.appData, 'sessions', `${label.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

/** M5: <app-data>/settings.json, or <folder>/.mikedown/settings.json (settings.rs). */
function settingsPath(ipc: Ipc, scope: string, folder: string | null): string {
  return scope === 'folder' ? path.join(folder as string, '.mikedown', 'settings.json') : path.join(ipc.appData, 'settings.json');
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
    case 'backup_write': {
      const hash = sha256(args.key);
      const dir = path.join(ipc.appData, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${hash}.md`), args.text);
      const index = readIndex(ipc);
      index[hash] = { ...args.meta, savedAt: Date.now() };
      writeIndex(ipc, index);
      return hash;
    }
    case 'backup_remove': {
      const hash = sha256(args.key);
      fs.rmSync(path.join(ipc.appData, 'backups', `${hash}.md`), { force: true });
      const index = readIndex(ipc);
      delete index[hash];
      writeIndex(ipc, index);
      return null;
    }
    case 'backup_list': {
      const index = readIndex(ipc);
      const out: unknown[] = [];
      for (const [hash, entry] of Object.entries(index)) {
        const file = path.join(ipc.appData, 'backups', `${hash}.md`);
        if (!fs.existsSync(file)) {continue;}
        out.push({ key: hash, ...entry, text: fs.readFileSync(file, 'utf8') });
      }
      return out;
    }
    case 'session_write':
      fs.mkdirSync(path.dirname(sessionPath(ipc, args.label)), { recursive: true });
      fs.writeFileSync(sessionPath(ipc, args.label), JSON.stringify(args.data, null, 2));
      return null;
    case 'session_read':
      return ipc.session(args.label);
    case 'session_remove':
      fs.rmSync(sessionPath(ipc, args.label), { force: true });
      return null;
    case 'session_list': {
      const dir = path.join(ipc.appData, 'sessions');
      if (!fs.existsSync(dir)) {return [];}
      return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => ({ label: n.slice(0, -5), data: ipc.session(n.slice(0, -5)) }));
    }
    case 'settings_read': {
      const p = settingsPath(ipc, args.scope, args.folder);
      return { path: p, text: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null };
    }
    case 'settings_write': {
      const p = settingsPath(ipc, args.scope, args.folder);
      const parsed = JSON.parse(args.text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {throw new Error('settings must be a JSON object');}
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, args.text);
      return { path: p, text: args.text };
    }
    case 'report_window_state':
      ipc.windowStates.push({ folder: args.folder ?? null, files: args.files ?? [] });
      return null;
    case 'window_count':
      return 1;
    case 'new_window':
      return args.label ?? 'w-1';
    case 'quit_reply':
      ipc.quitReplies.push(!!args.proceed);
      return null;
    default:
      // Window/title/represented-file, allow_asset, shell, dialogs: no-ops.
      return null;
  }
}

export const test = base.extend<{ ipc: Ipc }>({
  ipc: async ({ page }, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-e2e-'));
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-e2e-appdata-'));
    const ipc: Ipc = {
      dir,
      appData,
      calls: [],
      launchFiles: [],
      quitReplies: [],
      windowStates: [],
      write(name, content) {
        const p = path.join(dir, name);
        fs.writeFileSync(p, content);
        return p;
      },
      read: (name) => fs.readFileSync(path.join(dir, name)),
      custom: {},
      backupIndex: () => readIndex(ipc),
      session(label = 'main') {
        try { return JSON.parse(fs.readFileSync(sessionPath(ipc, label), 'utf8')); } catch { return null; }
      },
    };
    await page.exposeFunction('__mikedownE2eInvoke', (cmd: string, args: unknown, headers: Record<string, string>) => {
      ipc.calls.push({ cmd, args, headers });
      try {
        return ipc.custom[cmd] ? ipc.custom[cmd](args) : handle(ipc, cmd, args, headers);
      } catch (err) {
        return { __error: String((err as Error).message ?? err) };
      }
    });
    await page.addInitScript({ path: path.join(here, 'tauri-mock.js') });
    await use(ipc);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(appData, { recursive: true, force: true });
  },
});

export { expect };
