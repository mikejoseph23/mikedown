// The demo stage's controls (theme and read-only), shared by every developer
// page. No imports or exports, so it also runs as a classic script (the Angular
// demo loads it through angular.json "scripts").
//
// Page markup: [data-stage] holding radios name="stage-theme" and a checkbox
// [data-stage-readonly]. Each demo reads window.mikedownStage.state at start
// and listens for the `stage:controls` event on document ({ theme, readOnly }).
// [data-stage-live] flashes when the demo's markdown value (.demo__value) changes.
{
  const stage = document.querySelector('[data-stage]');
  const state = { theme: 'auto', readOnly: false };

  if (stage) {
    const checked = stage.querySelector('input[name="stage-theme"]:checked');
    state.theme = checked ? checked.value : 'auto';
    state.readOnly = Boolean(stage.querySelector('[data-stage-readonly]')?.checked);

    stage.addEventListener('change', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      if (input.name === 'stage-theme') {
        state.theme = input.value;
      } else if (input.hasAttribute('data-stage-readonly')) {
        state.readOnly = input.checked;
      } else {
        return;
      }
      document.dispatchEvent(new CustomEvent('stage:controls', { detail: { ...state } }));
    });

    const live = stage.querySelector('[data-stage-live]');
    const body = stage.querySelector('.stage__body');
    if (live && body) {
      let last = null;
      let timer = 0;
      // Watches only text; it never writes to the editor's DOM.
      new MutationObserver(() => {
        const value = body.querySelector('.demo__value');
        const text = value ? value.textContent : null;
        if (text === null || text === last) {
          return;
        }
        const first = last === null;
        last = text;
        if (first) {
          return;
        }
        live.classList.add('is-updated');
        clearTimeout(timer);
        timer = setTimeout(() => live.classList.remove('is-updated'), 450);
      }).observe(body, { subtree: true, childList: true, characterData: true });
    }
  }

  window.mikedownStage = {
    get state() {
      return { ...state };
    },
  };
}
