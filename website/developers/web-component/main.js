// Page glue: puts the sample's markup (form.html) on the stage, runs its
// script (form.js), and passes the stage's controls to the element.
import '../common/stage.js';
import '../../shared/copy.js';
import markup from './form.html?raw';

document.getElementById('demo-root').innerHTML = markup;

import('./form.js').then(() => {
  const editor = document.querySelector('#demo-root mikedown-editor');
  const apply = ({ theme, readOnly }) => {
    editor.theme = theme;
    editor.readOnly = readOnly;
  };
  apply(window.mikedownStage.state);
  document.addEventListener('stage:controls', (e) => apply(e.detail));
});
