import type { AiEngineConfig } from '@mikedown/core/ai';

/**
 * API keys for AI engines. Stored in VS Code's SecretStorage under
 * `mikedown.ai.apiKey.<engineId>`, never in settings and never sent to the
 * webview (it only learns `hasKey`). When nothing is stored, the engine's
 * `apiKeyEnv` names an environment variable of the extension host process
 * to read instead (covers `OMLX_API_KEY`).
 */

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
  constructor(
    private readonly store: SecretStore,
    private readonly env: Readonly<Record<string, string | undefined>> = process.env,
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

  /** The key to send: the stored one, then `apiKeyEnv`, then none. */
  async resolve(engine: Pick<AiEngineConfig, 'id' | 'apiKeyEnv'>): Promise<string | null> {
    return (await this.getStored(engine.id)) ?? this.envKey(engine);
  }

  async hasKey(engine: Pick<AiEngineConfig, 'id' | 'apiKeyEnv'>): Promise<boolean> {
    return (await this.resolve(engine)) !== null;
  }

  /** Delete the keys of engines that disappeared from settings. Returns the ids it deleted. */
  async pruneRemoved(before: readonly Pick<AiEngineConfig, 'id'>[], after: readonly Pick<AiEngineConfig, 'id'>[]): Promise<string[]> {
    const gone = removedEngineIds(before, after);
    await Promise.all(gone.map((id) => this.delete(id)));
    return gone;
  }
}
