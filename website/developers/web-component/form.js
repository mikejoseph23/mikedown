import '@mikedown/core/styles.css';
import '@mikedown/web-component/define';
import { stubAiHost, stubAiSettings } from '../common/stub-ai';

const form = document.querySelector('#post-form');
const editor = form.querySelector('mikedown-editor');
const value = document.querySelector('#post-value');
const result = form.querySelector('output');

// The demo's AI is a stub: it streams canned text and calls no server.
editor.settings = { ai: stubAiSettings };
editor.ai = stubAiHost;

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
