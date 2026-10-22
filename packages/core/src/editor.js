/**
 * MikeDown Editor — Webview Script
 *
 * Handles communication between the webview and the VS Code extension host
 * via the VS Code postMessage API.
 *
 * Extension → Webview messages:
 *   { type: 'update', content: string }  — full document text to render
 *
 * Webview → Extension messages:
 *   { type: 'ready' }                    — webview is ready to receive content
 *   { type: 'edit', content: string }    — new full document text after user edit
 */

(function () {
  'use strict';

  // Acquire the VS Code API (only callable once per webview lifetime)
  const vscode = acquireVsCodeApi();

  // ── DOM References ──────────────────────────────────────────────────────────

  /** @type {HTMLDivElement} */
  const editor = /** @type {HTMLDivElement} */ (document.getElementById('editor'));

  if (!editor) {
    console.error('MikeDown: #editor element not found.');
    return;
  }

  // ── State ───────────────────────────────────────────────────────────────────

  /**
   * The last content we sent to the extension host.
   * We track this to avoid sending redundant edits when the extension pushes
   * an update that originated from our own edit.
   * @type {string}
   */
  let lastSentContent = '';

  /**
   * Whether we are currently applying a programmatic update from the extension.
   * While true, input events should not trigger outbound edits.
   * @type {boolean}
   */
  let applyingUpdate = false;

  // ── Message Handling — Extension → Webview ──────────────────────────────────

  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.type) {
      case 'update':
        applyUpdate(message.content ?? '');
        break;
      default:
        console.warn(`MikeDown: unknown message type "${message.type}"`);
    }
  });

  /**
   * Apply new content from the extension host to the editor.
   * Preserves cursor position when possible.
   *
   * @param {string} content - Raw Markdown text
   */
  function applyUpdate(content) {
    // Avoid overwriting ongoing user edits with identical content
    if (content === editor.innerText) {
      return;
    }

    applyingUpdate = true;

    // Simple approach for M1: set as plain text.
    // M2 will replace this with a proper Markdown renderer.
    editor.innerText = content;
    lastSentContent = content;

    applyingUpdate = false;
  }

  // ── Input Handling — Webview → Extension ────────────────────────────────────

  /**
   * Debounce timer handle for batching rapid keystrokes.
   * @type {ReturnType<typeof setTimeout> | null}
   */
  let debounceTimer = null;

  editor.addEventListener('input', () => {
    if (applyingUpdate) {
      return;
    }

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const currentContent = editor.innerText;
      if (currentContent !== lastSentContent) {
        lastSentContent = currentContent;
        vscode.postMessage({ type: 'edit', content: currentContent });
      }
    }, 200);
  });

  // ── Toolbar Placeholder ─────────────────────────────────────────────────────
  // The toolbar is a static placeholder in M1.
  // M2 will wire up actual formatting buttons.

  // ── Initialise ──────────────────────────────────────────────────────────────

  // Signal to the extension host that the webview is ready.
  vscode.postMessage({ type: 'ready' });
})();
