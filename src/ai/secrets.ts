import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AiEngineConfig } from '@mikedown/core/ai';

/**
 * API keys for AI engines. Stored in VS Code's SecretStorage under
 * `mikedown.ai.apiKey.<engineId>`, never in settings and never sent to the
 * webview (it only learns `hasKey`). When nothing is stored, the engine's
 * `apiKeyEnv` names an environment variable of the extension host process
 * to read instead (covers `OMLX_API_KEY`), and after that its `apiKeyFile`: a
 * small JSON file in the user's home folder (oMLX's `~/.omlx/settings.json`),
 * which also works when VS Code was launched from the Dock and has no shell
 * environment. Engines are user scope only, so a repo cannot point this at a file.
 */

/** A key file bigger than this is not read. */
export const KEY_FILE_MAX_BYTES = 64 * 1024;

type KeySource = Pick<AiEngineConfig, 'id' | 'apiKeyEnv' | 'apiKeyFile'>;

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export const SECRET_KEY_PREFIX = 'mikedown.ai.apiKey.';

/** The slice of `vscode.SecretStorage` used here, so tests can pass a Map-backed fake. */
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export function secretKey(engineId: string): string {
  return `${SECRET_KEY_PREFIX}${engineId}`;
}

/** Engine ids present in `before` and gone from `after`: their keys should be deleted. */
export function removedEngineIds(before: readonly Pick<AiEngineConfig, 'id'>[], after: readonly Pick<AiEngineConfig, 'id'>[]): string[] {
  const kept = new Set(after.map((e) => e.id));
  return [...new Set(before.map((e) => e.id))].filter((id) => !kept.has(id));
}

export class AiSecrets {
  private readonly lastFailure = new Map<string, string>();

  constructor(
    private readonly store: SecretStore,
    private readonly env: Readonly<Record<string, string | undefined>> = process.env,
    private readonly home: () => string = os.homedir,
    private readonly log: (line: string) => void = () => {},
  ) {}

  async getStored(engineId: string): Promise<string | null> {
    const value = await this.store.get(secretKey(engineId));
    return value ? value : null;
  }

  /** Store a key, or delete it with null or an empty string. */
  async set(engineId: string, apiKey: string | null): Promise<void> {
    const trimmed = apiKey?.trim() ?? '';
    if (trimmed) {
      await this.store.store(secretKey(engineId), trimmed);
    } else {
      await this.store.delete(secretKey(engineId));
    }
  }

  async delete(engineId: string): Promise<void> {
    await this.store.delete(secretKey(engineId));
  }

  /** The value of the engine's `apiKeyEnv` variable, or null when unset or empty. */
  envKey(engine: Pick<AiEngineConfig, 'apiKeyEnv'>): string | null {
    const name = engine.apiKeyEnv?.trim();
    if (!name) {return null;}
    const value = this.env[name]?.trim();
    return value ? value : null;
  }

  /**
   * The string at `jsonPath` in the engine's `apiKeyFile`, or null. Only a regular
   * file under the home folder (after resolving `~` and symlinks) is read, at most
   * 64 KB. Any failure is "no key from this source" and logs one line that never
   * holds the key or the file's contents.
   */
  fileKey(engine: Pick<AiEngineConfig, 'id' | 'apiKeyFile'>): string | null {
    const spec = engine.apiKeyFile;
    const rawPath = spec?.path.trim();
    const jsonPath = spec?.jsonPath.trim();
    if (!rawPath || !jsonPath) {return null;}
    const fail = (why: string): null => {
      // Status polls call this often: say each distinct failure once per engine, and say again after a recovery.
      const line = `${engine.id}: key file ${rawPath} not used (${why})`;
      if (this.lastFailure.get(engine.id) !== line) {
        this.lastFailure.set(engine.id, line);
        this.log(line);
      }
      return null;
    };
    try {
      const home = fs.realpathSync(this.home());
      const expanded = rawPath === '~' ? home : rawPath.startsWith('~/') ? path.join(home, rawPath.slice(2)) : rawPath;
      if (!path.isAbsolute(expanded)) {return fail('not an absolute path');}
      const resolved = fs.realpathSync(expanded);
      if (!isInside(home, resolved)) {return fail('outside the home folder');}
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {return fail('not a regular file');}
      if (stat.size > KEY_FILE_MAX_BYTES) {return fail('file too large');}
      let value: unknown = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      for (const part of jsonPath.split('.')) {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, part)) {return fail('no string at the JSON path');}
        value = (value as Record<string, unknown>)[part];
      }
      if (typeof value !== 'string' || !value.trim()) {return fail('no string at the JSON path');}
      this.lastFailure.delete(engine.id);
      return value.trim();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return fail(code ?? (err instanceof SyntaxError ? 'not valid JSON' : 'unreadable'));
    }
  }

  /** The key to send and where it came from: the stored one, then `apiKeyEnv`, then `apiKeyFile`, then none. */
  async resolveWithSource(engine: KeySource): Promise<{ key: string; source: 'stored' | 'env' | 'file' } | null> {
    const stored = await this.getStored(engine.id);
    if (stored) {return { key: stored, source: 'stored' };}
    const env = this.envKey(engine);
    if (env) {return { key: env, source: 'env' };}
    const file = this.fileKey(engine);
    return file ? { key: file, source: 'file' } : null;
  }

  /** The key to send: the stored one, then `apiKeyEnv`, then `apiKeyFile`, then none. */
  async resolve(engine: KeySource): Promise<string | null> {
    return (await this.resolveWithSource(engine))?.key ?? null;
  }

  async hasKey(engine: KeySource): Promise<boolean> {
    return (await this.resolve(engine)) !== null;
  }

  /** Delete the keys of engines that disappeared from settings. Returns the ids it deleted. */
  async pruneRemoved(before: readonly Pick<AiEngineConfig, 'id'>[], after: readonly Pick<AiEngineConfig, 'id'>[]): Promise<string[]> {
    const gone = removedEngineIds(before, after);
    await Promise.all(gone.map((id) => this.delete(id)));
    return gone;
  }
}
