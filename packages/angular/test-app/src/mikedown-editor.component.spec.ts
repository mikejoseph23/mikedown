// Ported from the vendored LymeStarter spec, plus the Quantico Creek legacy fork's preserveBrackets and shell-theme
// tests, against the package's generic inputs. Compiled from the library source (tsconfig path) on Angular 19.
import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { provideRouter } from '@angular/router';
import type { MikeDownAiHost, MikeDownEditorHandle } from '@mikedown/core';
import { of } from 'rxjs';
import {
  MIKEDOWN_SETTINGS_KEY,
  MikeDownEditorComponent,
  MikeDownImageUpload,
  MikeDownModule,
  unescapeBrackets,
} from '@mikedown/angular';

/** Type into the editor the way a user edit reaches the host: through a ProseMirror transaction. */
function typeInto(handle: MikeDownEditorHandle, text: string): void {
  handle.tiptap.commands.insertContent(text);
}

function pasteImage(handle: MikeDownEditorHandle): void {
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
  const clipboardData = {
    files: Object.assign([file], { item: (i: number) => (i === 0 ? file : null) }),
    items: [],
    types: ['Files'],
    getData: () => '',
  };
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  handle.tiptap.view.dom.dispatchEvent(event);
}

@Component({
  standalone: true,
  imports: [MikeDownEditorComponent, ReactiveFormsModule],
  template: `<mikedown-editor
    [formControl]="control"
    [imageUpload]="upload"
    [ai]="ai"
    [preserveBrackets]="preserveBrackets"
    [debounceMs]="debounceMs"
    (ready)="handle = $event"
  />`,
})
class ControlHostComponent {
  control = new FormControl<string>('', { nonNullable: true });
  upload?: MikeDownImageUpload;
  ai?: MikeDownAiHost;
  preserveBrackets = false;
  debounceMs = 150;
  handle?: MikeDownEditorHandle;
}

@Component({
  standalone: true,
  imports: [MikeDownEditorComponent, ReactiveFormsModule],
  template: `<form [formGroup]="form"><mikedown-editor formControlName="notes" (ready)="handle = $event" /></form>`,
})
class FormGroupHostComponent {
  form = new FormGroup({ notes: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }) });
  handle?: MikeDownEditorHandle;
}

// The permanent alias selector, through the NgModule.
@Component({
  standalone: true,
  imports: [MikeDownModule, FormsModule],
  template: `<lyme-markdown-editor [(ngModel)]="notes" (ready)="handle = $event" />`,
})
class NgModelHostComponent {
  notes = '';
  handle?: MikeDownEditorHandle;
}

// Quantico Creek legacy shell: theme="auto" follows a .dark-theme wrapper class.
@Component({
  standalone: true,
  imports: [MikeDownEditorComponent, FormsModule],
  template: `<div [class.dark-theme]="dark"><mikedown-editor darkSelector=".dark-theme" [(ngModel)]="notes" /></div>`,
})
class ShellClassThemeHostComponent {
  dark = true;
  notes = '';
}

// LymeStack shell: theme="auto" follows html[data-mode].
@Component({
  standalone: true,
  imports: [MikeDownEditorComponent],
  template: `<mikedown-editor darkSelector="html[data-mode=dark]" [theme]="theme" />`,
})
class HtmlModeThemeHostComponent {
  theme: 'auto' | 'light' | 'dark' = 'auto';
}

@Component({
  standalone: true,
  imports: [MikeDownEditorComponent],
  template: `<mikedown-editor />`,
})
class OsThemeHostComponent {}

@Component({
  standalone: true,
  imports: [MikeDownEditorComponent],
  template: `<label for="notes-input">Notes</label>
    <mikedown-editor inputId="notes-input" placeholder="Write the notes" [settings]="settings" />`,
})
class OptionsHostComponent {
  settings: Record<string, unknown> = { fontSize: 18, fontFamily: '"Open Sans", sans-serif' };
}

function root(fixture: ComponentFixture<unknown>): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector('.mikedown-field__editor .mikedown-root');
}

function surface(fixture: ComponentFixture<unknown>): HTMLElement | null {
  return root(fixture)?.querySelector<HTMLElement>('.ProseMirror') ?? null;
}

/** First change detection creates the editor (ngAfterViewInit); flush the microtask that fires `ready`. */
function init(fixture: ComponentFixture<unknown>): void {
  fixture.detectChanges();
  flushMicrotasks();
  fixture.detectChanges();
}

/** MutationObserver callbacks are native microtasks, which fakeAsync cannot flush. */
const settle = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

describe('MikeDownEditorComponent', () => {
  beforeEach(() => {
    localStorage.removeItem(MIKEDOWN_SETTINGS_KEY);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  describe('as a form control', () => {
    let fixture: ComponentFixture<ControlHostComponent>;
    let host: ControlHostComponent;
    let emitted: string[];

    function setup(initial = '', configure?: (h: ControlHostComponent) => void): void {
      fixture = TestBed.createComponent(ControlHostComponent);
      host = fixture.componentInstance;
      configure?.(host);
      host.control.setValue(initial);
      emitted = [];
      host.control.valueChanges.subscribe((v) => emitted.push(v));
      init(fixture);
    }

    it('renders writeValue as markdown without emitting a change', fakeAsync(() => {
      setup();
      host.control.setValue('# Hi');
      fixture.detectChanges();
      tick(150);
      expect(root(fixture)?.querySelector('h1')?.textContent).toBe('Hi');
      expect(host.handle?.getMarkdown().trim()).toBe('# Hi');
      expect(host.control.dirty).toBeFalse();
      // Only the setValue itself emits on the control; the editor must not echo it back as an edit.
      expect(emitted).toEqual(['# Hi']);
      fixture.destroy();
    }));

    it('renders a value written before the editor exists', fakeAsync(() => {
      setup('# Early');
      expect(root(fixture)?.querySelector('h1')?.textContent).toBe('Early');
      expect(host.control.pristine).toBeTrue();
      fixture.destroy();
    }));

    it('loads pristine: writing the same value again keeps the caret and emits nothing', fakeAsync(() => {
      setup('hello');
      const setMarkdown = spyOn(host.handle!, 'setMarkdown').and.callThrough();
      host.control.setValue(host.handle!.getMarkdown());
      tick(500);
      expect(setMarkdown).not.toHaveBeenCalled();
      host.control.setValue('changed');
      expect(setMarkdown).toHaveBeenCalledOnceWith('changed', { pristine: true });
      tick(500);
      // Only the two setValue calls; the editor echoes neither back.
      expect(emitted.length).toBe(2);
      expect(emitted[1]).toBe('changed');
      expect(host.control.dirty).toBeFalse();
      fixture.destroy();
    }));

    it('emits exactly one debounced change for an edit', fakeAsync(() => {
      setup();
      emitted.length = 0;
      typeInto(host.handle!, 'a');
      typeInto(host.handle!, 'b');
      tick(100);
      expect(emitted).toEqual([]);
      tick(60);
      expect(emitted.length).toBe(1);
      expect(emitted[0]).toContain('ab');
      expect(host.control.dirty).toBeTrue();
      tick(500);
      expect(emitted.length).toBe(1);
      fixture.destroy();
    }));

    it('honours debounceMs', fakeAsync(() => {
      setup('', (h) => (h.debounceMs = 400));
      emitted.length = 0;
      typeInto(host.handle!, 'slow');
      tick(300);
      expect(emitted).toEqual([]);
      tick(110);
      expect(emitted.length).toBe(1);
      fixture.destroy();
    }));

    it('an external write cancels keystrokes still waiting in the debounce', fakeAsync(() => {
      setup();
      emitted.length = 0;
      typeInto(host.handle!, 'typed');
      tick(50);
      host.control.setValue('# Server');
      tick(500);
      expect(emitted).toEqual(['# Server']);
      expect(host.handle!.getMarkdown().trim()).toBe('# Server');
      fixture.destroy();
    }));

    it('flushes a pending change at once and marks touched when focus leaves', fakeAsync(() => {
      setup();
      emitted.length = 0;
      typeInto(host.handle!, 'blurred');
      expect(host.control.touched).toBeFalse();
      const editorHost = (fixture.nativeElement as HTMLElement).querySelector('.mikedown-field__editor')!;
      editorHost.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
      expect(emitted.length).toBe(1);
      expect(emitted[0]).toContain('blurred');
      expect(host.control.touched).toBeTrue();
      tick(500);
      expect(emitted.length).toBe(1);
      fixture.destroy();
    }));

    it('setDisabledState makes the editor read-only and the frame inert', fakeAsync(() => {
      setup();
      host.control.disable();
      fixture.detectChanges();
      expect(host.handle?.tiptap.isEditable).toBeFalse();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('mikedown-editor')?.classList.contains('mikedown-field--disabled')).toBeTrue();
      expect(el.querySelector('.mikedown-field__frame')?.hasAttribute('inert')).toBeTrue();
      host.control.enable();
      fixture.detectChanges();
      expect(host.handle?.tiptap.isEditable).toBeTrue();
      expect(el.querySelector('.mikedown-field__frame')?.hasAttribute('inert')).toBeFalse();
      fixture.destroy();
    }));

    it('starts read-only when the control is disabled before the editor exists', fakeAsync(() => {
      fixture = TestBed.createComponent(ControlHostComponent);
      host = fixture.componentInstance;
      host.control.disable();
      init(fixture);
      expect(host.handle?.tiptap.isEditable).toBeFalse();
      expect((fixture.nativeElement as HTMLElement).querySelector('.mikedown-field__frame')?.hasAttribute('inert')).toBeTrue();
      fixture.destroy();
    }));

    it('removes the editor DOM and its window listeners on destroy', fakeAsync(() => {
      const added: Array<[string, unknown]> = [];
      const removed: Array<[string, unknown]> = [];
      const add = window.addEventListener.bind(window);
      const remove = window.removeEventListener.bind(window);
      spyOn(window, 'addEventListener').and.callFake(((type: string, l: any, o?: any) => {
        added.push([type, l]);
        add(type, l, o);
      }) as typeof window.addEventListener);
      spyOn(window, 'removeEventListener').and.callFake(((type: string, l: any, o?: any) => {
        removed.push([type, l]);
        remove(type, l, o);
      }) as typeof window.removeEventListener);

      setup('# Hi');
      expect(root(fixture)).not.toBeNull();
      const el = fixture.nativeElement as HTMLElement;
      fixture.destroy();

      expect(el.querySelector('.mikedown-root')).toBeNull();
      expect(document.querySelector('.mikedown-root')).toBeNull();
      // Every listener the editor added to window must be gone (matched by type and function).
      const leaked = added.filter(([t, l]) => !removed.some(([rt, rl]) => rt === t && rl === l));
      expect(leaked.map(([t]) => t)).toEqual([]);
    }));

    it('ignores image paste when imageUpload is absent', fakeAsync(() => {
      setup('hello');
      const before = host.handle!.getMarkdown();
      pasteImage(host.handle!);
      tick(500);
      expect(host.handle!.getMarkdown()).toBe(before);
      expect(root(fixture)?.querySelectorAll('img').length).toBe(0);
      fixture.destroy();
    }));

    it('hands the ai input to the core: no AI tab without it', fakeAsync(() => {
      setup('');
      host.handle!.command('openAiSettings');
      expect(document.querySelector('.settings-panel--ai')).toBeNull();
      fixture.destroy();
    }));

    it('hands the ai input to the core: the AI tab opens with it', async () => {
      fixture = TestBed.createComponent(ControlHostComponent);
      host = fixture.componentInstance;
      host.ai = { complete: () => Promise.reject(new Error('unused')) };
      fixture.detectChanges();
      await fixture.whenStable();
      await settle();
      host.handle!.command('openAiSettings');
      // Core loads its AI UI chunk first; the modal opens once it is there.
      for (let i = 0; i < 100 && !document.querySelector('.settings-panel--ai'); i++) {
        await new Promise<void>((r) => setTimeout(r, 20));
      }
      expect(document.querySelector('.settings-panel--ai')).not.toBeNull();
      document.getElementById('mikedown-settings-overlay')?.remove();
      fixture.destroy();
    });

    it('puts the uploaded src into the markdown when imageUpload is present', async () => {
      fixture = TestBed.createComponent(ControlHostComponent);
      host = fixture.componentInstance;
      host.upload = () => of({ src: 'https://example.test/uploaded.png' });
      fixture.detectChanges();
      await fixture.whenStable();
      await settle();
      pasteImage(host.handle!);
      await new Promise<void>((r) => setTimeout(r, 300));
      expect(host.handle!.getMarkdown()).toContain('https://example.test/uploaded.png');
      expect(host.control.value).toContain('https://example.test/uploaded.png');
      fixture.destroy();
    });

    describe('preserveBrackets', () => {
      it('is off by default: the serializer escapes literal brackets', fakeAsync(() => {
        setup();
        typeInto(host.handle!, 'Quote [PalletCharge]');
        tick(150);
        expect(host.control.value).toContain('\\[PalletCharge\\]');
        fixture.destroy();
      }));

      it('reports literal brackets unescaped', fakeAsync(() => {
        setup('', (h) => (h.preserveBrackets = true));
        typeInto(host.handle!, 'Quote [PalletCharge]');
        tick(150);
        expect(host.control.value).toContain('Quote [PalletCharge]');
        expect(host.control.value).not.toContain('\\[');
        fixture.destroy();
      }));

      it('treats a written bracket value as unchanged (no reload, no echo)', fakeAsync(() => {
        setup('', (h) => (h.preserveBrackets = true));
        typeInto(host.handle!, 'Use [Token] here');
        tick(150);
        const value = host.control.value;
        emitted.length = 0;
        const setMarkdown = spyOn(host.handle!, 'setMarkdown').and.callThrough();
        host.control.setValue(value);
        tick(500);
        expect(setMarkdown).not.toHaveBeenCalled();
        expect(emitted).toEqual([value]);
        fixture.destroy();
      }));
    });
  });

  describe('inside a FormGroup with Validators.required', () => {
    it('is invalid when empty, valid once typed, and empty and pristine after reset', fakeAsync(() => {
      const fixture = TestBed.createComponent(FormGroupHostComponent);
      const host = fixture.componentInstance;
      init(fixture);
      const control = host.form.controls.notes;

      expect(control.invalid).toBeTrue();
      expect(host.form.valid).toBeFalse();

      typeInto(host.handle!, 'some text');
      tick(150);
      expect(control.valid).toBeTrue();
      expect(control.value).toContain('some text');
      expect(control.dirty).toBeTrue();

      host.form.reset();
      fixture.detectChanges();
      tick(150);
      expect(control.value).toBeFalsy();
      expect(control.pristine).toBeTrue();
      expect(control.invalid).toBeTrue();
      expect(host.handle!.getMarkdown().trim()).toBe('');
      fixture.destroy();
    }));
  });

  describe('with ngModel (lyme-markdown-editor alias, MikeDownModule)', () => {
    it('updates the model after an edit and renders model changes', fakeAsync(() => {
      const fixture = TestBed.createComponent(NgModelHostComponent);
      const host = fixture.componentInstance;
      init(fixture);
      tick(); // ngModel writes its value in a resolved promise
      expect((fixture.nativeElement as HTMLElement).querySelector('lyme-markdown-editor.mikedown-field')).not.toBeNull();

      typeInto(host.handle!, 'typed');
      tick(150);
      expect(host.notes).toContain('typed');

      host.notes = '# From model';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(root(fixture)?.querySelector('h1')?.textContent).toBe('From model');
      expect(host.handle!.getMarkdown().trim()).toBe('# From model');
      fixture.destroy();
    }));
  });

  describe('darkSelector', () => {
    afterEach(() => document.documentElement.removeAttribute('data-mode'));

    it('is dark inside a .dark-theme ancestor and follows the class when it changes', async () => {
      const fixture = TestBed.createComponent(ShellClassThemeHostComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(root(fixture)?.getAttribute('data-mikedown-theme')).toBe('dark');

      fixture.componentInstance.dark = false;
      fixture.detectChanges();
      await settle();
      expect(root(fixture)?.getAttribute('data-mikedown-theme')).toBe('light');

      fixture.componentInstance.dark = true;
      fixture.detectChanges();
      await settle();
      expect(root(fixture)?.getAttribute('data-mikedown-theme')).toBe('dark');
      fixture.destroy();
    });

    it('follows html[data-mode] and stops following once the theme is pinned', async () => {
      document.documentElement.setAttribute('data-mode', 'dark');
      const fixture = TestBed.createComponent(HtmlModeThemeHostComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(root(fixture)?.getAttribute('data-mikedown-theme')).toBe('dark');

      document.documentElement.setAttribute('data-mode', 'light');
      await settle();
      expect(root(fixture)?.getAttribute('data-mikedown-theme')).toBe('light');

      fixture.componentInstance.theme = 'dark';
      fixture.detectChanges();
      await settle();
      expect(root(fixture)?.getAttribute('data-mikedown-theme')).toBe('dark');
      document.documentElement.setAttribute('data-mode', 'light');
      await settle();
      expect(root(fixture)?.getAttribute('data-mikedown-theme')).toBe('dark');
      fixture.destroy();
    });

    it('without one, auto follows prefers-color-scheme', async () => {
      const fixture = TestBed.createComponent(OsThemeHostComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      const osDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      expect(root(fixture)?.getAttribute('data-mikedown-theme')).toBe(osDark ? 'dark' : 'light');
      fixture.destroy();
    });
  });

  describe('options', () => {
    it('passes placeholder and inputId to the core, and <label for> names the surface', fakeAsync(() => {
      const fixture = TestBed.createComponent(OptionsHostComponent);
      init(fixture);
      const el = surface(fixture)!;
      expect(el.id).toBe('notes-input');
      const label = (fixture.nativeElement as HTMLElement).querySelector('label')!;
      expect(label.id).toBeTruthy();
      expect(el.getAttribute('aria-labelledby')).toBe(label.id);
      expect(el.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe('Write the notes');
      // The host element must not carry the surface's id.
      expect((fixture.nativeElement as HTMLElement).querySelector('mikedown-editor')?.id).toBeFalsy();
      fixture.destroy();
    }));

    it('merges settings over the form-field defaults, and saved Settings-dialog choices win', fakeAsync(() => {
      let fixture = TestBed.createComponent(OptionsHostComponent);
      init(fixture);
      expect(root(fixture)?.style.getPropertyValue('--mikedown-font-size')).toBe('18px');
      expect(root(fixture)?.style.getPropertyValue('--mikedown-content-width')).toBe('100%');
      fixture.destroy();

      localStorage.setItem(MIKEDOWN_SETTINGS_KEY, JSON.stringify({ fontSize: 21 }));
      fixture = TestBed.createComponent(OptionsHostComponent);
      init(fixture);
      expect(root(fixture)?.style.getPropertyValue('--mikedown-font-size')).toBe('21px');
      fixture.destroy();
    }));
  });

  describe('unescapeBrackets', () => {
    it('restores escaped brackets in text', () => {
      expect(unescapeBrackets('Quote \\[PalletCharge\\] and \\[{"a": 1}\\]')).toBe('Quote [PalletCharge] and [{"a": 1}]');
    });

    it('leaves inline code and fenced blocks alone', () => {
      const md = 'Use `\\[x\\]` then \\[y\\]\n```\n\\[z\\]\n```\n\\[w\\]';
      expect(unescapeBrackets(md)).toBe('Use `\\[x\\]` then [y]\n```\n\\[z\\]\n```\n[w]');
    });

    it('keeps an escaped backslash before a bracket', () => {
      expect(unescapeBrackets('a \\\\ b [c]')).toBe('a \\\\ b [c]');
    });
  });
});
