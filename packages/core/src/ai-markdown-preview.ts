/**
 * A small, safe markdown renderer for the AI result popover's preview.
 *
 * Model output is untrusted text. This builds DOM with `createElement` and
 * `textContent` only: no `innerHTML`, no raw HTML passthrough (a `<script>`
 * stays literal text) and no `href` or `src` is ever set, so a link shows
 * its label and nothing can be followed or fetched from the preview.
 *
 * Covers what models return for summaries, outlines and rewrites:
 * paragraphs, ATX headings, nested bullet and numbered lists, block quotes,
 * fenced code, rules, and inline code, bold, italic, strikethrough, links
 * and images (as their label). Anything else stays literal. Newlines inside
 * a paragraph are kept (the preview is `white-space: pre-wrap`), so plain
 * prose looks as it did when the preview was raw text.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {node.className = className;}
  return node;
}

/** Index of the closer for a delimiter opened at `from`, or -1. */
function findCloser(s: string, delim: string, from: number): number {
  for (let j = s.indexOf(delim, from); j !== -1; j = s.indexOf(delim, j + 1)) {
    if (s[j - 1] === '\\' || isSpace(s[j - 1])) {continue;}
    // A single `*` or `_` is not the first half of a doubled one.
    if (delim.length === 1 && (s[j + 1] === delim || s[j - 1] === delim)) {continue;}
    if (delim === '_' && isWord(s[j + 1])) {continue;}
    return j;
  }
  return -1;
}

/** Index just past the `)` of a `](url)` that starts at `close`, or -1. */
function linkEnd(s: string, close: number): number {
  if (s[close + 1] !== '(') {return -1;}
  let depth = 0;
  for (let k = close + 1; k < s.length; k++) {
    if (s[k] === '\n') {return -1;}
    if (s[k] === '(') {depth++;} else if (s[k] === ')' && --depth === 0) {return k + 1;}
  }
  return -1;
}

function matchingBracket(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === '\\') {k++;} else if (s[k] === '[') {depth++;} else if (s[k] === ']' && --depth === 0) {return k;}
  }
  return -1;
}

/** Append `s` to `parent` with its inline markdown as elements. */
function appendInline(parent: Node, s: string): void {
  let buf = '';
  const flush = (): void => {
    if (buf) {parent.appendChild(document.createTextNode(buf)); buf = '';}
  };
  const wrap = (tag: 'strong' | 'em' | 'del' | 'span', inner: string, className?: string): void => {
    flush();
    const node = make(tag, className);
    appendInline(node, inner);
    parent.appendChild(node);
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!~>|]/.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') {n++;}
      const run = '`'.repeat(n);
      const end = s.indexOf(run, i + n);
      if (end !== -1 && s[end + n] !== '`') {
        flush();
        const code = make('code');
        code.textContent = s.slice(i + n, end).replace(/^ (.*) $/, '$1');
        parent.appendChild(code);
        i = end + n;
        continue;
      }
      buf += run;
      i += n;
      continue;
    }
    if (c === '*' || c === '_') {
      const doubled = s[i + 1] === c;
      const delim = doubled ? c + c : c;
      const after = s[i + delim.length];
      const leftOk = c === '*' || !isWord(s[i - 1]);
      if (leftOk && !isSpace(after) && after !== c) {
        const end = findCloser(s, delim, i + delim.length);
        if (end > i + delim.length) {
          wrap(doubled ? 'strong' : 'em', s.slice(i + delim.length, end));
          i = end + delim.length;
          continue;
        }
      }
      buf += delim;
      i += delim.length;
      continue;
    }
    if (c === '~' && s[i + 1] === '~' && !isSpace(s[i + 2])) {
      const end = findCloser(s, '~~', i + 2);
      if (end > i + 2) {
        wrap('del', s.slice(i + 2, end));
        i = end + 2;
        continue;
      }
    }
    if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const open = c === '!' ? i + 1 : i;
      const close = matchingBracket(s, open);
      const end = close === -1 ? -1 : linkEnd(s, close);
      if (end !== -1) {
        // The label only: the target is never put on the element.
        wrap('span', s.slice(open + 1, close), c === '!' ? 'ai-rw-md-image' : 'ai-rw-md-link');
        i = end;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
}

interface ListFrame {
  indent: number;
  ordered: boolean;
  list: HTMLElement;
  item: HTMLElement | null;
}

const indentOf = (ws: string): number => ws.replace(/\t/g, '    ').length;

/** Replace the children of `into` with `markdown`, rendered. */
export function renderPreviewMarkdown(into: HTMLElement, markdown: string): void {
  const out: Node[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const startsBlock = (line: string): boolean => FENCE.test(line) || HEADING.test(line) || ITEM.test(line) || QUOTE.test(line) || RULE.test(line);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {i++; continue;}

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      // An unclosed fence (a stream still running) shows what it has.
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`).test(lines[i])) {body.push(lines[i++]);}
      i++;
      const pre = make('pre', 'ai-rw-md-pre');
      const code = make('code');
      code.textContent = body.join('\n');
      pre.appendChild(code);
      out.push(pre);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const node = make('div', 'ai-rw-md-h');
      node.dataset.level = String(heading[1].length);
      appendInline(node, heading[2]);
      out.push(node);
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push(make('hr', 'ai-rw-md-hr'));
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {inner.push(QUOTE.exec(lines[i++])![1]);}
      const quote = make('blockquote', 'ai-rw-md-quote');
      renderPreviewMarkdown(quote, inner.join('\n'));
      out.push(quote);
      continue;
    }

    if (ITEM.test(line)) {
      const stack: ListFrame[] = [];
      const roots: HTMLElement[] = [];
      while (i < lines.length) {
        const m = ITEM.exec(lines[i]);
        if (!m) {
          // A blank line ends the list unless an item follows it; an indented line continues the item.
          if (lines[i].trim() && /^[ \t]+\S/.test(lines[i]) && !startsBlock(lines[i]) && stack.length) {
            const item = stack[stack.length - 1].item!;
            item.appendChild(document.createTextNode(`\n${lines[i].trim()}`));
            i++;
            continue;
          }
          if (!lines[i].trim() && ITEM.test(lines[i + 1] ?? '')) {i++; continue;}
          break;
        }
        const indent = indentOf(m[1]);
        const ordered = /\d/.test(m[2]);
        while (stack.length && indent < stack[stack.length - 1].indent) {stack.pop();}
        let top = stack[stack.length - 1];
        if (top && indent === top.indent && ordered !== top.ordered) {stack.pop(); top = stack[stack.length - 1];}
        if (!top || indent > top.indent) {
          const list = make(ordered ? 'ol' : 'ul', 'ai-rw-md-list');
          if (ordered) {
            const start = parseInt(m[2], 10);
            if (start !== 1) {list.setAttribute('start', String(start));}
          }
          if (top?.item) {top.item.appendChild(list);} else {roots.push(list);}
          top = { indent, ordered, list, item: null };
          stack.push(top);
        }
        const li = make('li');
        appendInline(li, m[3]);
        top.list.appendChild(li);
        top.item = li;
        i++;
      }
      out.push(...roots);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines[i]))) {para.push(lines[i++]);}
    const p = make('p', 'ai-rw-md-p');
    appendInline(p, para.join('\n'));
    out.push(p);
  }
  into.replaceChildren(...out);
}
