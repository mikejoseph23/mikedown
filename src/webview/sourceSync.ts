/**
 * Source-mode divergence tracking (issue #5).
 *
 * When the user leaves source mode, the WYSIWYG document only needs reloading
 * if the CodeMirror buffer actually diverged from what it was seeded with.
 * Skipping the reload otherwise is deliberate — it preserves ProseMirror's undo
 * history and avoids re-parsing round-trip-lossy syntax on a no-op toggle.
 *
 * The decision used to compare the buffer against `originalContent`, which is
 * the on-disk/dirty baseline and is rewritten by the host's `saved` and
 * `update` messages. So: edit in source mode, press Cmd+S, and the host echoes
 * the saved text back as `originalContent` — now equal to the buffer. The
 * reload was skipped, TipTap kept the pre-edit document, and the next WYSIWYG
 * keystroke serialized that stale document back over the file.
 *
 * This tracks the seed text separately so a save can't disguise a real edit.
 */
export class SourceModeSync {
  private entry: string | null = null;

  /** CodeMirror has just been seeded with `md` on the way into source mode. */
  enter(md: string): void {
    this.entry = md;
  }

  /**
   * The host pushed new content and BOTH views were reloaded from it, so they
   * agree again. No-op outside source mode.
   */
  rebaseline(md: string): void {
    if (this.entry !== null) this.entry = md;
  }

  /**
   * Whether `md` diverged from the seed — i.e. the WYSIWYG document has to be
   * reloaded from source. True when the seed is unknown, which is the safe
   * answer: a needless reload costs undo history, a skipped one loses edits.
   */
  hasSourceEdits(md: string): boolean {
    return this.entry === null || md !== this.entry;
  }

  /** Back in WYSIWYG mode; the seed no longer applies. */
  exit(): void {
    this.entry = null;
  }

  /** The recorded seed text, or `null` outside source mode. Exposed for tests. */
  get entryContent(): string | null {
    return this.entry;
  }
}
