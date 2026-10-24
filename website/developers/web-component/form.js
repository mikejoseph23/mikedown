import '@mikedown/core/styles.css';
import '@mikedown/web-component/define';

const form = document.querySelector('#post-form');
const editor = form.querySelector('mikedown-editor');
const value = document.querySelector('#post-value');
const result = form.querySelector('output');

const showValue = () => { value.textContent = editor.value; };
editor.addEventListener('ready', showValue);
editor.addEventListener('change', showValue);

form.addEventListener('submit', (event) => {
  // This page has no server, so show what the browser would send.
  event.preventDefault();
  const body = new FormData(form).get('body');
  result.textContent = `Sent body: ${body.length} characters of markdown`;
});

form.addEventListener('reset', () => {
  result.textContent = '';
  setTimeout(showValue);
});
