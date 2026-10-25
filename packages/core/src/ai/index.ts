/**
 * @mikedown/core/ai — the pure AI provider layer: settings schema, task
 * taxonomy, feature registry, capability heuristics, locality, router, SSE
 * parsing and request building. No network, no DOM, no provider SDK; hosts
 * (the VS Code extension, MikeDown Desktop, npm consumers) do the I/O.
 */

export * from './types';
export * from './tasks';
export * from './features';
export * from './locality';
export * from './capabilityHeuristics';
export * from './discovery';
export * from './schema';
export * from './router';
export * from './sse';
export * from './requests';
export * from './wire';
export * from './errors';
export * from './presets';
