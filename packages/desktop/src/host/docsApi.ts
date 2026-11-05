/**
 * Typed wrapper over the documentation-base commands
 * (`src-tauri/src/commands/docs.rs`) and their change event. The host
 * (`docsHost.ts`) takes this interface, so tests swap in a fake.
 *
 * Every call names a base id and nothing else: Rust looks the folders up in
 * the global settings itself, so the webview can never point a read at a path.
 */
import type { AiDocBaseStatus, AiDocsIndex, AiDocsSection, AiDocsSectionRef } from '@mikedown/core/ai';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface DocsApi {
  /**
   * Every configured base with its health, the bases read afresh from the
   * settings. Plain: an enabled base is walked only when it has no usable
   * index. `refresh: true` walks every enabled base.
   */
  listBases(opts?: { refresh?: boolean }): Promise<AiDocBaseStatus[]>;
  index(baseId: string): Promise<AiDocsIndex>;
  readSections(baseId: string, ids: string[]): Promise<AiDocsSection[]>;
  keywordSearch(baseId: string, query: string): Promise<AiDocsSectionRef[]>;
  /** Add the saved bases' roots to the fs scope (S11); drops cached indexes. */
  syncRoots(): Promise<number>;
  /** Start this window's recursive watchers on the base's roots. */
  watch(baseId: string): Promise<number>;
  unwatch(baseId: string): Promise<void>;
  /** `docs-changed { baseId }`: a watched root changed on disk. */
  onChanged(handler: (baseId: string) => void): Promise<UnlistenFn>;
}

export const docsApi: DocsApi = {
  listBases: (opts) => invoke<AiDocBaseStatus[]>('docs_list_bases', { refresh: opts?.refresh === true }),
  index: (baseId) => invoke<AiDocsIndex>('docs_index', { baseId }),
  readSections: (baseId, ids) => invoke<AiDocsSection[]>('docs_read_sections', { baseId, ids }),
  keywordSearch: (baseId, query) => invoke<AiDocsSectionRef[]>('docs_keyword_search', { baseId, query }),
  syncRoots: () => invoke<number>('docs_sync_roots'),
  watch: (baseId) => invoke<number>('docs_watch', { baseId }),
  unwatch: (baseId) => invoke<void>('docs_unwatch', { baseId }),
  onChanged: (handler) => listen<{ baseId: string }>('docs-changed', (e) => handler(e.payload.baseId)),
};
