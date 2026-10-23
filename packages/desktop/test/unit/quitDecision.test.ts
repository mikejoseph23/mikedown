/**
 * Quit and close decisions (edge case 7): which documents block, what the
 * one dialog says, and what each button does.
 */
import { describe, expect, it } from 'vitest';
import { applyQuitChoice, closeTabDialogSpec, dirtyDocuments, quitDialogSpec } from '../../src/app/quitDecision';

const docs = [
  { path: '/n/a.md', dirty: true },
  { path: '/n/b.md', dirty: false },
  { path: null, dirty: true },
];

describe('quit decision', () => {
  it('nothing dirty: no dialog', () => {
    expect(dirtyDocuments([docs[1]])).toEqual([]);
    expect(quitDialogSpec([])).toBeNull();
  });

  it('lists every dirty document, Untitled included', () => {
    const dirty = dirtyDocuments(docs);
    expect(dirty).toHaveLength(2);
    const spec = quitDialogSpec(dirty, 'quit')!;
    expect(spec.message).toBe('Save changes to 2 documents before you quit?');
    expect(spec.detail).toBe('• a.md\n• Untitled');
    expect(spec.buttons).toEqual({ saveAll: 'Save All', dontSave: 'Don’t Save', cancel: 'Cancel' });
  });

  it('one dirty document names it and says Save', () => {
    const spec = quitDialogSpec([docs[0]], 'close')!;
    expect(spec.message).toBe('Save changes to “a.md” before you close the window?');
    expect(spec.buttons.saveAll).toBe('Save');
    expect(closeTabDialogSpec(docs[2]).message).toBe('Save changes to “Untitled” before closing?');
  });

  it('Save All saves everything, Don’t Save discards, Cancel stops', () => {
    const dirty = dirtyDocuments(docs);
    expect(applyQuitChoice('saveAll', dirty)).toEqual({ save: dirty, discard: [], proceed: true });
    expect(applyQuitChoice('dontSave', dirty)).toEqual({ save: [], discard: dirty, proceed: true });
    expect(applyQuitChoice('cancel', dirty)).toEqual({ save: [], discard: [], proceed: false });
  });
});
