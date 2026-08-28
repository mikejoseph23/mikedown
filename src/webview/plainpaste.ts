import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Fragment, Slice } from '@tiptap/pm/model';

// Paste Without Formatting (issue #4). Cmd/Ctrl+Shift+V drops all clipboard
// markup — no autolinking, no bold/heading carry-over from a browser copy.
//
// The keystroke reaches us through the VS Code command (`pasteWithoutFormatting`
// → requestPlainPaste), but Chromium may ALSO fire its own native paste for
// that chord ("paste and match style"). So we arm a short window: whichever
// arrives first wins, and the other is a no-op. If no native paste event lands
// inside the window we read the clipboard ourselves.
const ARM_WINDOW_MS = 400;
const NATIVE_PASTE_GRACE_MS = 150;

let armedUntil = 0;

function disarm(): boolean {
  if (Date.now() > armedUntil) return false;
  armedUntil = 0;
  return true;
}

/** Insert `text` verbatim: no markdown parsing, no mark inheritance. */
export function insertPlainText(view: EditorView, text: string): void {
  if (!text) return;
  const { state } = view;
  const { schema } = state;
  const tr = state.tr;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const inCode = state.selection.$from.parent.type.spec.code === true;

  if (lines.length === 1 || inCode) {
    // Code blocks keep newlines as literal text; single lines are trivial.
    tr.replaceSelectionWith(schema.text(inCode ? text.replace(/\r\n?/g, '\n') : lines[0]), false);
  } else {
    const paragraph = schema.nodes.paragraph;
    const nodes = lines.map(line => (line ? paragraph.create(null, schema.text(line)) : paragraph.create()));
    tr.replaceSelection(new Slice(Fragment.from(nodes), 1, 1));
  }
  tr.setStoredMarks([]);
  view.dispatch(tr.scrollIntoView());
}

/** Called by the `pasteWithoutFormatting` command from the extension host. */
export function requestPlainPaste(view: EditorView): void {
  armedUntil = Date.now() + ARM_WINDOW_MS;
  setTimeout(() => {
    if (!disarm()) return; // a native paste event already handled it
    navigator.clipboard
      ?.readText()
      .then(text => insertPlainText(view, text))
      .catch(() => {});
  }, NATIVE_PASTE_GRACE_MS);
}

// Higher priority than SmartPaste/ImagePaste so the armed window wins.
export const PlainPasteExtension = Extension.create({
  name: 'plainPaste',
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('plainPaste'),
        props: {
          handlePaste: (view, event) => {
            if (!disarm()) return false;
            const text = event.clipboardData?.getData('text/plain') ?? '';
            insertPlainText(view, text);
            return true;
          },
        },
      }),
    ];
  },
});
