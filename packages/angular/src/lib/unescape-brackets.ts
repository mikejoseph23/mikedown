/**
 * Turns `\[` and `\]` back into `[` and `]`, leaving fenced code blocks and inline code spans untouched.
 *
 * The markdown serializer writes a literal `[Token]` as `\[Token\]`. Use this (or the component's `preserveBrackets`
 * input) when the text holds bracket template tokens and is not rendered as markdown by anything but the editor:
 * a hand-typed `[text](url)` that was meant as plain text reloads as a link.
 */
export function unescapeBrackets(markdown: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => (i % 2 === 1 ? part : part.replace(/\\([[\]])/g, '$1')))
        .join('');
    })
    .join('\n');
}
