import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  PLATFORM_ID,
  SimpleChanges,
  ViewChild,
  booleanAttribute,
  forwardRef,
  inject,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Router } from '@angular/router';
import { bindMikeDownValue } from '@mikedown/core';
import type { MikeDownBinding, MikeDownEditorHandle, MikeDownFeatures, MikeDownSettings } from '@mikedown/core';
import { AngularMikeDownHost, MikeDownImageSrcResolver, MikeDownImageUpload } from './angular-mikedown-host';
import { unescapeBrackets } from './unescape-brackets';

export type MikeDownThemeInput = 'light' | 'dark' | 'auto';

/**
 * Defaults that make the editor read as a form field instead of a full-page document. No font: the editor inherits
 * the core's UI font unless the `settings` input sets one.
 */
export const MIKEDOWN_FORM_FIELD_SETTINGS: Readonly<Partial<MikeDownSettings>> = Object.freeze({
  contentWidth: '100%',
  fontSize: 15,
});

/**
 * `<mikedown-editor>` (alias `<lyme-markdown-editor>`): the MikeDown WYSIWYG markdown editor as a reactive-forms /
 * ngModel control. The value is the markdown string.
 *
 * Built on the core's `bindMikeDownValue`: `writeValue` loads the pristine baseline (patching or resetting the form
 * never marks it dirty), typing reports the new markdown after `debounceMs` (and at once when focus leaves), and
 * `theme="auto"` follows `darkSelector` or the OS.
 *
 * The editor runs outside the Angular zone; value changes, touched, `ready`, link navigation and image uploads
 * re-enter it.
 */
@Component({
  selector: 'mikedown-editor, lyme-markdown-editor',
  standalone: true,
  templateUrl: './mikedown-editor.component.html',
  styleUrls: ['./mikedown-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mikedown-field' },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MikeDownEditorComponent),
      multi: true,
    },
  ],
})
export class MikeDownEditorComponent implements ControlValueAccessor, AfterViewInit, OnChanges, OnDestroy {
  /**
   * `auto` is dark when the editor or an ancestor matches `darkSelector`, and follows the OS
   * (`prefers-color-scheme`) without one. `light` or `dark` pins it.
   */
  @Input() theme: MikeDownThemeInput = 'auto';
  /**
   * CSS selector that means dark for `theme="auto"`, matched with `closest()`: `html[data-mode=dark]` (LymeStack),
   * `.dark-theme` (a shell class on a wrapper). Changes to the matched attributes are followed. Read once, at creation.
   */
  @Input() darkSelector?: string;
  /**
   * Editor settings (fonts, size, content width, heading numbering...). Merged over the form-field defaults
   * (`contentWidth: '100%'`, `fontSize: 15`); choices the user saved from the editor's own Settings dialog win.
   */
  @Input() settings: Partial<MikeDownSettings> = {};
  /** Feature switches (toolbar, sourceMode, slashCommands, math, mermaid, findReplace, frontmatter...). Read once, at creation. */
  @Input() features: Partial<MikeDownFeatures> = {};
  @Input({ transform: booleanAttribute }) readOnly = false;
  /**
   * Keep literal square brackets as typed. The serializer writes a literal `[Token]` as `\[Token\]`; with this on,
   * `\[` and `\]` outside code reach the form as `[` and `]` (see `unescapeBrackets`). Use it only for text that is
   * not rendered as markdown by anything but the editor.
   */
  @Input({ transform: booleanAttribute }) preserveBrackets = false;
  /** Text shown in an empty editor. Defaults to the core's "Type / for commands". Read once, at creation. */
  @Input() placeholder?: string;
  /** Initial height and the smallest the user can drag it to. Any CSS length. */
  @Input() minHeight = '240px';
  /** Quiet time in ms after the last keystroke before the form control updates. Read once, at creation. */
  @Input() debounceMs = 150;
  /**
   * Base URL of the core's spell-check dictionaries (the folder that holds `en/` and `en-GB/`), e.g.
   * `/assets/mikedown-dictionaries`. Without it spell check stays off and nothing is fetched. Read once, at creation.
   */
  @Input() spellcheckDictionaryUrl?: string;
  /**
   * `id` of the editable surface, so `<label for="...">` names it and focuses it on click. Not `id`: that would put
   * the same id on this host element too. Read once, at creation.
   */
  @Input() inputId?: string;
  /** Accessible name of the editable surface. Read once, at creation. */
  @Input() ariaLabel?: string;
  /** Id(s) of the element(s) that name the editable surface. The most robust labelling. Read once, at creation. */
  @Input() ariaLabelledBy?: string;
  /**
   * Uploads a pasted or dropped image and emits `{ src, alt? }`. Without it, image paste and drop are off.
   * Read once, at creation (presence decides whether the feature exists); the latest function is called.
   */
  @Input() imageUpload?: MikeDownImageUpload;
  /** Base URL that relative image paths in the markdown are loaded from (e.g. `${api}Files/`). Without it (and without
   * `imageSrcResolver`) they show the core's missing-image placeholder. Absolute http(s), data: and blob: URLs always load. */
  @Input() imageBaseUrl?: string;
  /** Full control over image paths the core cannot load as is. Wins over `imageBaseUrl`. Return null for the placeholder. */
  @Input() imageSrcResolver?: MikeDownImageSrcResolver;

  /** Emits the editor handle once the editor exists, for advanced use (`command`, `getHtml`, `focus`...). */
  @Output() ready = new EventEmitter<MikeDownEditorHandle>();

  @ViewChild('editorHost', { static: true }) private editorHost!: ElementRef<HTMLDivElement>;

  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly router = inject(Router, { optional: true });
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private binding: MikeDownBinding | null = null;
  /** Value written before the editor existed (reactive forms write during the first change detection). */
  private pendingValue = '';
  /** @internal Bound in the template (the frame's `inert`). */
  disabled = false;
  private onChangeFn: (value: string) => void = () => {};
  private onTouchedFn: () => void = () => {};

  @HostBinding('class.mikedown-field--disabled') get disabledClass(): boolean {
    return this.disabled;
  }

  @HostBinding('class.mikedown-field--readonly') get readOnlyClass(): boolean {
    return this.readOnly && !this.disabled;
  }

  @HostBinding('style.--mikedown-field-min-height') get minHeightVar(): string {
    return this.minHeight;
  }

  /** The editor handle, once the editor exists (null before `ngAfterViewInit` and after destroy). */
  get handle(): MikeDownEditorHandle | null {
    return this.binding?.handle ?? null;
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) {
      return;
    }
    const host = new AngularMikeDownHost({
      zone: this.zone,
      router: this.router,
      imageUpload: () => this.imageUpload,
      imageSrcResolver: () => this.imageSrcResolver,
      imageBaseUrl: () => this.imageBaseUrl,
    });

    this.zone.runOutsideAngular(() => {
      const binding = bindMikeDownValue(this.editorHost.nativeElement, {
        host,
        initialValue: this.pendingValue,
        debounceMs: this.debounceMs,
        onValue: (markdown) => this.zone.run(() => this.onChangeFn(markdown)),
        onTouched: () => this.zone.run(() => this.onTouchedFn()),
        // Read on every call, so toggling preserveBrackets applies to the next change.
        outputTransform: (markdown) => (this.preserveBrackets ? unescapeBrackets(markdown) : markdown),
        disabled: this.disabled,
        readOnly: this.readOnly,
        theme: this.theme,
        darkSelector: this.darkSelector || undefined,
        settings: this.mergedSettings(),
        features: { sidebar: false, supportCard: false, ...this.features },
        placeholder: this.placeholder,
        spellcheckDictionaryUrl: this.spellcheckDictionaryUrl,
        id: this.inputId,
        ariaLabel: this.ariaLabel,
        ariaLabelledBy: this.ariaLabelledBy,
        hostOwnsShortcuts: false,
      });
      this.binding = binding;
      const handle = binding.handle;
      handle.on('ready', () => this.zone.run(() => this.ready.emit(handle)));
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    const binding = this.binding;
    if (!binding) {
      return;
    }
    if (changes['theme']) {
      binding.setTheme(this.theme);
    }
    if (changes['readOnly']) {
      binding.setReadOnly(this.readOnly);
    }
    if (changes['settings']) {
      this.zone.runOutsideAngular(() => binding.handle.updateSettings(this.mergedSettings()));
    }
  }

  ngOnDestroy(): void {
    const binding = this.binding;
    this.binding = null;
    // destroy() reports a pending change first.
    binding?.destroy();
  }

  // ControlValueAccessor

  writeValue(value: string | null | undefined): void {
    const markdown = value ?? '';
    if (!this.binding) {
      this.pendingValue = markdown;
      return;
    }
    const binding = this.binding;
    this.zone.runOutsideAngular(() => binding.setValue(markdown));
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChangeFn = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouchedFn = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    this.binding?.setDisabled(isDisabled);
    // Forms call this outside this OnPush view's change detection; the frame's inert attribute needs a pass.
    this.cdr.markForCheck();
  }

  /** Focus the editor (for a `<label (click)>` or after a validation error). */
  focus(): void {
    this.binding?.focus();
  }

  /** Form-field defaults < the `settings` input < the user's saved Settings-dialog choices. */
  private mergedSettings(): Partial<MikeDownSettings> {
    return { ...MIKEDOWN_FORM_FIELD_SETTINGS, ...this.settings, ...AngularMikeDownHost.loadSettings() };
  }
}
