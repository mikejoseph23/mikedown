/**
 * @mikedown/web-component: <mikedown-editor>, a form-associated custom element
 * around @mikedown/core.
 *
 *   import { defineMikeDownElement } from '@mikedown/web-component';
 *   import '@mikedown/core/styles.css';
 *   defineMikeDownElement();            // registers <mikedown-editor>
 *
 * or, for the side effect alone: `import '@mikedown/web-component/define'`.
 */

import { MikeDownElement } from './element';

export { MikeDownElement, dedentScriptText } from './element';
export type {
  MikeDownChangeEventDetail,
  MikeDownReadyEventDetail,
  MikeDownElementTheme,
  MikeDownElementHost,
} from './element';

export const DEFAULT_TAG = 'mikedown-editor';

/**
 * Register the element under `tag` (default `mikedown-editor`) and return its
 * constructor. Safe to call more than once: a tag that is already defined is
 * left alone and its existing constructor returned. A second tag gets its own
 * subclass, since one class can only be registered once.
 */
export function defineMikeDownElement(tag: string = DEFAULT_TAG): CustomElementConstructor {
  if (typeof customElements === 'undefined') {return MikeDownElement;}
  const existing = customElements.get(tag);
  if (existing) {return existing;}
  const registry = customElements as CustomElementRegistry & { getName?(ctor: CustomElementConstructor): string | null };
  const baseTaken = baseDefined || !!registry.getName?.(MikeDownElement);
  const ctor = baseTaken ? class extends MikeDownElement {} : MikeDownElement;
  customElements.define(tag, ctor);
  if (ctor === MikeDownElement) {baseDefined = true;}
  return ctor;
}

let baseDefined = false;

declare global {
  interface HTMLElementTagNameMap {
    'mikedown-editor': MikeDownElement;
  }
}
