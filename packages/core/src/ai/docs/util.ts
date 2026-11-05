/**
 * Small text helpers the documentation-base modules share. Every rule here is
 * written to be ported to Rust exactly (Desktop), so none of them leans on
 * locale behaviour or on a Unicode table.
 */

/**
 * Case folding used by ids, slugs and keyword ranking: ASCII `A` to `Z`
 * become `a` to `z`, every other code point is left alone. (No Unicode
 * lowercasing: `É` stays `É`, and `İ` or the Kelvin sign are not touched, so
 * JavaScript and Rust agree without a table.)
 */
export function foldAscii(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : text[i];
  }
  return out;
}

/**
 * Non-ASCII code points that count as whitespace for slugs and keyword
 * tokens. An explicit list, so no host depends on its own "is whitespace".
 * ASCII whitespace is space, tab, LF, VT, FF and CR.
 */
const NON_ASCII_SPACE = new Set<number>([
  0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

/** Whitespace as slugs and tokens see it: ASCII whitespace plus the fixed non-ASCII list. */
export function isDocsSpace(cp: number): boolean {
  return cp === 0x20 || (cp >= 0x09 && cp <= 0x0d) || NON_ASCII_SPACE.has(cp);
}

/** True for `a-z`, `A-Z`, `0-9`. */
export function isAsciiAlnum(cp: number): boolean {
  return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
}

/**
 * Compare two strings by Unicode code point (the order UTF-8 bytes give, so
 * Rust's `str::cmp` agrees). JavaScript's `<` compares UTF-16 units, which
 * differs for characters above U+FFFF. Returns -1, 0 or 1.
 */
export function cmpCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) as number;
    const y = b.codePointAt(j) as number;
    if (x !== y) {return x < y ? -1 : 1;}
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  if (i < a.length) {return 1;}
  if (j < b.length) {return -1;}
  return 0;
}

/** Length of `text` in UTF-8 bytes (a lone surrogate counts as 3, like U+FFFD). */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {n += 1;}
    else if (c < 0x800) {n += 2;}
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      n += 4;
      i++;
    } else {n += 3;}
  }
  return n;
}

/** Cut `text` to at most `maxBytes` UTF-8 bytes, on a code point boundary. */
export function cutUtf8(text: string, maxBytes: number): string {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let size = 3;
    let width = 1;
    if (c < 0x80) {size = 1;}
    else if (c < 0x800) {size = 2;}
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      size = 4;
      width = 2;
    }
    if (n + size > maxBytes) {return text.slice(0, i);}
    n += size;
    i += width - 1;
  }
  return text;
}

/** `1 section`, `3 sections`. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
