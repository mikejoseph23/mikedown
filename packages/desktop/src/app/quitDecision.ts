/**
 * Quit and close decisions (edge case 7), pure so the matrix is tested
 * without dialogs: which documents block, what the one dialog says, and
 * what each button does.
 */
import type { DocumentModel } from '../documents/documentModel';
import { fileName } from '../documents/documentModel';

export type QuitChoice = 'saveAll' | 'dontSave' | 'cancel';

export interface QuitDialogSpec {
  message: string;
  /** One line per dirty document. */
  detail: string;
  buttons: { saveAll: string; dontSave: string; cancel: string };
}

/** Dirty documents, Untitled ones included (their text would be lost). */
export function dirtyDocuments<T extends Pick<DocumentModel, 'dirty' | 'path'>>(docs: T[]): T[] {
  return docs.filter((d) => d.dirty);
}

/** null when nothing is dirty: no dialog, go ahead. */
export function quitDialogSpec(dirty: Array<Pick<DocumentModel, 'path'>>, what: 'quit' | 'close' = 'quit'): QuitDialogSpec | null {
  if (dirty.length === 0) {return null;}
  const names = dirty.map((d) => fileName(d));
  const verb = what === 'quit' ? 'quit' : 'close the window';
  const message = dirty.length === 1
    ? `Save changes to “${names[0]}” before you ${verb}?`
    : `Save changes to ${dirty.length} documents before you ${verb}?`;
  return {
    message,
    detail: dirty.length === 1 ? 'Your changes will be lost if you don’t save them.' : names.map((n) => `• ${n}`).join('\n'),
    buttons: { saveAll: dirty.length === 1 ? 'Save' : 'Save All', dontSave: 'Don’t Save', cancel: 'Cancel' },
  };
}

/** What a single tab's close dialog says. */
export function closeTabDialogSpec(doc: Pick<DocumentModel, 'path'>): QuitDialogSpec {
  return {
    message: `Save changes to “${fileName(doc)}” before closing?`,
    detail: 'Your changes will be lost if you don’t save them.',
    buttons: { saveAll: 'Save', dontSave: 'Don’t Save', cancel: 'Cancel' },
  };
}

/**
 * Resolve a choice against the dirty list: which documents to save (in
 * order), whether to proceed. A Save that is cancelled (Save As dismissed)
 * stops the whole thing, as editors do.
 */
export function applyQuitChoice<T>(choice: QuitChoice, dirty: T[]): { save: T[]; discard: T[]; proceed: boolean } {
  switch (choice) {
    case 'saveAll': return { save: dirty, discard: [], proceed: true };
    case 'dontSave': return { save: [], discard: dirty, proceed: true };
    case 'cancel': return { save: [], discard: [], proceed: false };
  }
}
