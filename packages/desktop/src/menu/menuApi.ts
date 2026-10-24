/**
 * Typed wrapper over the native-menu commands in `src-tauri/src/menu.rs`.
 * Menu clicks come back through `windowsApi.onMenu` (`mikedown:menu`).
 */
import { invoke } from '@tauri-apps/api/core';
import type { MenuNode } from './menuSpec';

export interface MenuApi {
  /** Replace the menu bar with this spec (Rust skips an unchanged one). */
  set(spec: MenuNode[]): Promise<boolean>;
  /** Enable or disable items by id. */
  update(enabled: Record<string, boolean>): Promise<void>;
  /** Refill File > Open Recent. */
  setRecents(items: MenuNode[]): Promise<void>;
}

export const menuApi: MenuApi = {
  set: (spec) => invoke<boolean>('menu_set', { spec }),
  update: (enabled) => invoke<void>('menu_update', { enabled }),
  setRecents: (items) => invoke<void>('menu_set_recents', { items }),
};
