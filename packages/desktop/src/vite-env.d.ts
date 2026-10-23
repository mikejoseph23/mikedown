/// <reference types="vite/client" />

/** 'source' when vite.config.ts aliased @mikedown/core to ../core/src, else 'dist'. */
declare const __MIKEDOWN_CORE_FROM__: 'source' | 'dist';

interface ImportMetaEnv {
  /** '1' turns on src/smoke/harness.ts. */
  readonly VITE_MIKEDOWN_SMOKE?: string;
  /** '1' reports folder-open time and watcher latency through `smoke_report` (M3 measurements). */
  readonly VITE_MIKEDOWN_TIMING?: string;
}
