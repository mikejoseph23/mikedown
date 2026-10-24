// Copy buttons: <button type="button" data-copy="text to copy">Copy</button>,
// or data-copy-target="#id" to copy an element's text. The button's label
// switches to "Copied" for a moment and a polite live region announces it.
const live = document.createElement('span');
live.className = 'visually-hidden';
live.setAttribute('aria-live', 'polite');
document.body.append(live);

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure origins: fall back to a selected textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-copy], [data-copy-target]') : null;
  if (!button) {
    return;
  }
  const target = button.dataset.copyTarget ? document.querySelector(button.dataset.copyTarget) : null;
  const text = button.dataset.copy ?? target?.textContent?.trim() ?? '';
  const ok = text !== '' && (await copy(text));
  const label = button.querySelector('[data-copy-label]') ?? button;
  const original = label.dataset.original ?? label.textContent;
  label.dataset.original = original;
  label.textContent = ok ? 'Copied' : 'Copy failed';
  live.textContent = ok ? 'Copied to the clipboard' : 'Could not copy. Select the text and copy it yourself.';
  clearTimeout(Number(button.dataset.copyTimer));
  button.dataset.copyTimer = String(setTimeout(() => { label.textContent = original; }, 1800));
});
