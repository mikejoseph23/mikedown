/*
 * Injected before the app boots (page.addInitScript). Stands in for the
 * object Tauri's webview injects, `window.__TAURI_INTERNALS__`, so
 * `@tauri-apps/api` works under a plain `vite dev` page:
 *
 * - `invoke` forwards every command to the Node side
 *   (`window.__mikedownE2eInvoke`, a Playwright binding in fixtures.ts) which
 *   answers the app's fs commands against a real temp folder and records the
 *   call. Event-plugin commands (listen/unlisten/emit) are handled here.
 * - `transformCallback` / `convertFileSrc` / `metadata` mirror Tauri 2.
 *
 * Plain script, no imports: it runs before any module.
 */
(() => {
  const callbacks = new Map();
  let nextId = 1;
  const listeners = new Map();

  function transformCallback(cb, once = false) {
    const id = nextId++;
    callbacks.set(id, (data) => {
      if (once) {callbacks.delete(id);}
      return cb && cb(data);
    });
    return id;
  }

  function toPlain(payload) {
    if (payload instanceof Uint8Array) {return { __bytes: Array.from(payload) };}
    if (payload instanceof ArrayBuffer) {return { __bytes: Array.from(new Uint8Array(payload)) };}
    return payload;
  }

  async function invoke(cmd, args = {}, options) {
    switch (cmd) {
      case 'plugin:event|listen': {
        const list = listeners.get(args.event) ?? [];
        list.push(args.handler);
        listeners.set(args.event, list);
        return args.handler;
      }
      case 'plugin:event|unlisten':
        return null;
      case 'plugin:event|emit': {
        for (const id of listeners.get(args.event) ?? []) {callbacks.get(id)?.({ event: args.event, id, payload: args.payload });}
        return null;
      }
      default:
        break;
    }
    const res = await window.__mikedownE2eInvoke(cmd, toPlain(args), options?.headers ?? {});
    if (res && typeof res === 'object' && res.__error) {throw res.__error;}
    if (res && typeof res === 'object' && Array.isArray(res.__bytes)) {return new Uint8Array(res.__bytes).buffer;}
    return res;
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback: (id) => callbacks.delete(id),
    runCallback: (id, data) => callbacks.get(id)?.(data),
    callbacks,
    convertFileSrc: (filePath, protocol = 'asset') => `${protocol}://localhost/${encodeURIComponent(filePath)}`,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    plugins: {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  /** Test hook: fire a Tauri event into the page (e.g. mikedown:open-files). */
  window.__mikedownE2eEmit = (event, payload) => invoke('plugin:event|emit', { event, payload });
})();
