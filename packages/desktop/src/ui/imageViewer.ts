/**
 * Minimal image viewer for image files opened from a link or the OS: the
 * picture centered over the editor with its name, size and a Back button.
 * The editor keeps its document underneath; `hide()` returns to it.
 */

export interface ImageViewer {
  show(path: string, url: string, onBack: () => void): void;
  hide(): void;
  isVisible(): boolean;
}

export function createImageViewer(root: HTMLElement, editorEl: HTMLElement): ImageViewer {
  const el = document.createElement('div');
  el.className = 'mdapp-image-viewer';
  el.hidden = true;
  el.innerHTML = `
    <div class="mdapp-image-viewer__bar">
      <button type="button" class="mdapp-btn" data-action="back">← Back to document</button>
      <span class="mdapp-image-viewer__name"></span>
      <span class="mdapp-image-viewer__dims"></span>
    </div>
    <div class="mdapp-image-viewer__stage"><img alt="" /></div>`;
  root.insertBefore(el, editorEl);
  const img = el.querySelector('img') as HTMLImageElement;
  const name = el.querySelector('.mdapp-image-viewer__name') as HTMLSpanElement;
  const dims = el.querySelector('.mdapp-image-viewer__dims') as HTMLSpanElement;
  const back = el.querySelector('[data-action="back"]') as HTMLButtonElement;
  let onBackHandler: (() => void) | null = null;
  back.addEventListener('click', () => onBackHandler?.());
  img.addEventListener('load', () => { dims.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; });
  img.addEventListener('error', () => { dims.textContent = 'could not load'; });

  return {
    show(path, url, onBack) {
      onBackHandler = onBack;
      name.textContent = path.split(/[\\/]/).pop() ?? path;
      dims.textContent = '';
      img.src = url;
      img.alt = name.textContent;
      el.hidden = false;
      editorEl.hidden = true;
      back.focus();
    },
    hide() {
      if (el.hidden) {return;}
      el.hidden = true;
      editorEl.hidden = false;
      img.removeAttribute('src');
    },
    isVisible: () => !el.hidden,
  };
}
