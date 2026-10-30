// ============================================================================
// Tables on the clipboard, as text.
//
//   • Paste: `detectTextTable` recognises a markdown pipe table (with its
//     delimiter row) or tab-separated lines with equal cell counts, and
//     `textTableToNode` builds the table node. SmartPaste wires it in.
//   • Copy: `tableCopyPlugin` gives a slice that holds a table (or a
//     CellSelection) a GFM pipe table as its plain-text flavour, through the
//     same markdown serializer as save. The HTML flavour is untouched, so
//     spreadsheets still get cells.
// ============================================================================

import { getTextBetween, getTextSerializersFromSchema, type Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser, Fragment, type Node as PMNode, type Schema, type Slice } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { ColumnAlign } from './table-align';

export interface TextTable {
  kind: 'pipe' | 'tsv';
  /** First row is the header. Pipe cells are raw markdown, TSV cells plain text. */
  rows: string[][];
  /** Per column; null is the GFM default (left). Always null for TSV. */
  align: Array<ColumnAlign | null>;
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * A pasted text that is entirely one table, or null. Leading and trailing
 * blank lines are ignored; a blank line inside means it is not a table.
 * `singleRow` also accepts one tab-separated line (used inside a table, where
 * a literal tab in a cell is never what the paste meant).
 */
export function detectTextTable(text: string, opts: { singleRow?: boolean } = {}): TextTable | null {
  if (!text || text.length > 500_000) {return null;}
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) {lines.shift();}
  while (lines.length && !lines[lines.length - 1].trim()) {lines.pop();}
  if (lines.length === 0 || lines.some((l) => !l.trim())) {return null;}
  if (lines.length === 1) {return opts.singleRow ? detectTsv(lines) : null;}
  return detectPipeTable(lines) ?? detectTsv(lines);
}

const DELIMITER_CELL = /^:?-+:?$/;

function detectPipeTable(lines: string[]): TextTable | null {
  if (!lines.every(hasUnescapedPipe)) {return null;}
  const header = splitPipeRow(lines[0]);
  const delimiter = splitPipeRow(lines[1]);
  if (header.length === 0 || header.length !== delimiter.length) {return null;}
  if (!delimiter.every((c) => DELIMITER_CELL.test(c))) {return null;}
  // A one-column table needs an outer pipe on its rows, as in GFM.
  if (header.length === 1 && !/^\s*\|/.test(lines[0])) {return null;}
  const width = header.length;
  const body = lines.slice(2).map((line) => fitRow(splitPipeRow(line), width));
  const align = delimiter.map((c): ColumnAlign | null => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) {return 'center';}
    if (right) {return 'right';}
    return null;
  });
  return { kind: 'pipe', rows: [header, ...body], align };
}

function detectTsv(lines: string[]): TextTable | null {
  if (!lines.every((l) => l.includes('\t'))) {return null;}
  const rows = lines.map((l) => l.split('\t').map((c) => c.trim()));
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width)) {return null;}
  // Tab-indented code (every line starts with a tab) is not a table.
  if (rows.every((r) => r[0] === '')) {return null;}
  return { kind: 'tsv', rows, align: rows[0].map(() => null) };
}

function hasUnescapedPipe(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {i++; continue;}
    if (line[i] === '|') {return true;}
  }
  return false;
}

/** Split a pipe-table row on unescaped `|`, dropping the outer pipes. `\|` stays escaped. */
function splitPipeRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  const t = line.trim();
  const lead = t.startsWith('|');
  const trail = t.length > 1 && t.endsWith('|') && !t.endsWith('\\|');
  const trimmed = cells.map((c) => c.trim());
  if (lead) {trimmed.shift();}
  if (trail) {trimmed.pop();}
  return trimmed;
}

function fitRow(row: string[], width: number): string[] {
  const out = row.slice(0, width);
  while (out.length < width) {out.push('');}
  return out;
}

// ── Building the node ───────────────────────────────────────────────────────

function delimiterFor(align: ColumnAlign | null): string {
  if (align === 'center') {return ':---:';}
  if (align === 'right') {return '---:';}
  return '---';
}

/** The table as a GFM pipe table (pipe cells are already markdown). */
function pipeMarkdown(table: TextTable): string {
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [row(table.rows[0]), row(table.align.map(delimiterFor)), ...table.rows.slice(1).map(row)].join('\n') + '\n';
}

/**
 * Build a table node. Pipe tables go through the editor's markdown parser
 * (inline marks, `\|`, `<br>` and alignment come out as on open); TSV cells
 * are plain text.
 */
export function textTableToNode(editor: Editor, table: TextTable): PMNode | null {
  const { schema } = editor;
  const parser = (editor.storage as { markdown?: { parser?: { parse(md: string): string } } }).markdown?.parser;
  if (table.kind === 'pipe' && parser) {
    const html = parser.parse(pipeMarkdown(table));
    const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    let found: PMNode | null = null;
    doc.descendants((node) => {
      if (found) {return false;}
      if (node.type.name === 'table') {found = node; return false;}
      return true;
    });
    if (found) {return found;}
  }
  return plainTableNode(schema, table);
}

function plainTableNode(schema: Schema, table: TextTable): PMNode | null {
  const { table: tableType, tableRow, tableHeader, tableCell, paragraph } = schema.nodes;
  if (!tableType || !tableRow || !tableHeader || !tableCell || !paragraph) {return null;}
  const rows = table.rows.map((cells, r) =>
    tableRow.create(null, cells.map((text, c) => {
      const attrs = table.align[c] ? { textAlign: table.align[c] } : null;
      const para = paragraph.create(null, text ? schema.text(text) : null);
      return (r === 0 ? tableHeader : tableCell).create(attrs, para);
    })),
  );
  return tableType.create(null, rows);
}

// ── Copy ────────────────────────────────────────────────────────────────────

type MarkdownSerializer = { serialize(content: Fragment | PMNode): string };

function markdownSerializer(editor: Editor): MarkdownSerializer | null {
  return (editor.storage as { markdown?: { serializer?: MarkdownSerializer } }).markdown?.serializer ?? null;
}

/**
 * Rebuild a (possibly partial) table as GFM: rectangular rows, header cells
 * in the first row only. A CellSelection of body cells comes out with its
 * first row as the header.
 */
function gfmTable(schema: Schema, rows: PMNode[]): PMNode | null {
  const { table, tableRow, tableHeader, tableCell, paragraph } = schema.nodes;
  if (!table || !tableRow || !tableHeader || !tableCell || !paragraph) {return null;}
  const width = Math.max(0, ...rows.map((r) => r.childCount));
  if (!width) {return null;}
  const out = rows.map((row, r) => {
    const want = r === 0 ? tableHeader : tableCell;
    const cells: PMNode[] = [];
    row.forEach((cell) => {
      const attrs = { ...cell.attrs, colspan: 1, rowspan: 1 };
      cells.push(want.create(attrs, cell.content.size ? cell.content : paragraph.create()));
    });
    while (cells.length < width) {cells.push(want.create(null, paragraph.create()));}
    return tableRow.create(row.attrs, cells);
  });
  return table.create(null, out);
}

function rowsOf(table: PMNode): PMNode[] {
  const rows: PMNode[] = [];
  table.forEach((row) => rows.push(row));
  return rows;
}

/**
 * The plain-text clipboard flavour for a slice that holds a table: tables as
 * GFM pipe tables, other blocks as the default plain text. Null when the
 * slice has no table, so the default serializer runs.
 */
export function sliceToMarkdown(editor: Editor, slice: Slice): string | null {
  const serializer = markdownSerializer(editor);
  if (!serializer) {return null;}
  const { schema } = editor;
  let content = slice.content;
  // A CellSelection that is not the whole table copies bare rows.
  if (content.firstChild?.type.name === 'tableRow') {
    const rows: PMNode[] = [];
    content.forEach((n) => { if (n.type.name === 'tableRow') {rows.push(n);} });
    const table = gfmTable(schema, rows);
    if (!table) {return null;}
    content = Fragment.from(table);
  }
  let hasTable = false;
  content.forEach((n) => { if (n.type.name === 'table') {hasTable = true;} });
  if (!hasTable) {return null;}

  const textSerializers = getTextSerializersFromSchema(schema);
  const parts: string[] = [];
  content.forEach((node) => {
    if (node.type.name === 'table') {
      const table = gfmTable(schema, rowsOf(node));
      if (table) {parts.push(serializer.serialize(Fragment.from(table)).trimEnd());}
      return;
    }
    const wrapper = schema.topNodeType.create(null, node);
    const text = getTextBetween(wrapper, { from: 0, to: wrapper.content.size }, { textSerializers });
    if (text) {parts.push(text);}
  });
  return parts.join('\n\n');
}

/** Position of the table around the selection (or the selected table), or -1. */
export function tablePosAt(state: EditorState): number {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'table') {return sel.from;}
  const { $from } = sel;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') {return $from.before(d);}
  }
  return -1;
}

/** The whole table around the cursor as a GFM pipe table, or null. */
export function tableMarkdownAt(editor: Editor): string | null {
  const pos = tablePosAt(editor.state);
  const node = pos >= 0 ? editor.state.doc.nodeAt(pos) : null;
  const serializer = markdownSerializer(editor);
  if (!node || !serializer) {return null;}
  const table = gfmTable(editor.schema, rowsOf(node));
  return table ? serializer.serialize(Fragment.from(table)).trimEnd() + '\n' : null;
}

/** Context menu "Copy Table as Markdown". */
export function copyTableAsMarkdown(editor: Editor): boolean {
  const md = tableMarkdownAt(editor);
  if (md === null) {return false;}
  void navigator.clipboard?.writeText(md).catch(() => {});
  return true;
}

/**
 * Plain-text flavour for copied tables. Must sit before TipTap's core
 * clipboardTextSerializer plugin; returning null falls through to it.
 */
export function tableCopyPlugin(editor: Editor): Plugin {
  return new Plugin({
    key: new PluginKey('tableCopy'),
    props: {
      clipboardTextSerializer: (slice) => {
        try {
          return sliceToMarkdown(editor, slice) ?? '';
        } catch {
          return '';
        }
      },
    },
  });
}
