/**
 * The playground.
 *
 * It is a thin shell around the compiler: every keystroke re-runs the same `compileOne` the CLI
 * runs, then feeds the analysis to the HTML target for the preview. Nothing here re-implements
 * language rules — if the playground and the CLI ever disagree, that is a bug in this file.
 */

import { check } from '../src/check.ts';
import { generateHtml } from '../src/codegen/html.ts';
import type { Diagnostic } from '../src/diagnostics.ts';
import { formatText } from '../src/format.ts';
import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';
import { compileOne } from '../src/project.ts';
import { sourceFile, type SourceFile } from '../src/source.ts';
import { EXAMPLES } from './examples.ts';

const STORAGE_KEY = 'plainui.playground.source';
const STORAGE_EXAMPLE = 'plainui.playground.example';

// ---------------------------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element as T;
};

const editor = $<HTMLTextAreaElement>('source');
const highlight = $<HTMLPreElement>('highlight');
const gutter = $<HTMLDivElement>('gutter');
const status = $<HTMLSpanElement>('status');
const diagnosticsList = $<HTMLElement>('diagnostics');
const preview = $<HTMLIFrameElement>('preview');
const dartOut = $<HTMLElement>('dart');
const htmlOut = $<HTMLElement>('html');
const examplesSelect = $<HTMLSelectElement>('examples');

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

interface Compilation {
  readonly source: SourceFile;
  readonly diagnostics: readonly Diagnostic[];
  readonly dart?: string;
  readonly html?: string;
  readonly hasErrors: boolean;
  readonly durationMs: number;
}

let latest: Compilation | undefined;

// ---------------------------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------------------------

function compile(text: string): Compilation {
  const started = performance.now();
  const file = compileOne('main.pui', text);
  const hasErrors = file.diagnostics.some((diagnostic) => diagnostic.severity === 'error');

  if (hasErrors) {
    return { source: file.source, diagnostics: file.diagnostics, hasErrors, durationMs: performance.now() - started };
  }

  const parsed = parse(file.source);
  const analysis = check(file.source, parsed.program, {});
  const allDiagnostics = [...file.diagnostics, ...analysis.bag.diagnostics];

  return {
    source: file.source,
    diagnostics: allDiagnostics,
    dart: file.code,
    html: generateHtml(analysis.analysis, { title: 'PlainUI preview' }).code,
    hasErrors,
    durationMs: performance.now() - started,
  };
}

function refresh(): void {
  const text = editor.value;
  latest = compile(text);
  paintStatus(latest);
  paintDiagnostics(latest);
  paintOutput(latest);
  paintEditor(text);
  store(text);
}

// ---------------------------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------------------------

function paintStatus(compilation: Compilation): void {
  const errors = compilation.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = compilation.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const parts = [`${compilation.durationMs.toFixed(1)} ms`];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (errors === 0 && warnings === 0) parts.push('no problems');
  status.textContent = parts.join(' · ');
  status.className = `status ${errors > 0 ? 'error' : 'ok'}`;
}

function paintOutput(compilation: Compilation): void {
  if (compilation.hasErrors) {
    dartOut.textContent = '// Fix the errors below to see the generated Dart.';
    htmlOut.textContent = '<!-- Fix the errors below to see the preview. -->';
    preview.srcdoc = errorDocument(compilation);
    return;
  }
  dartOut.textContent = compilation.dart ?? '';
  htmlOut.textContent = compilation.html ?? '';
  preview.srcdoc = compilation.html ?? '';
}

function errorDocument(compilation: Compilation): string {
  const items = compilation.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .slice(0, 8)
    .map((diagnostic) => {
      const position = positionOf(compilation.source, diagnostic);
      return `<li><code>${escapeHtml(diagnostic.code)}</code> ${escapeHtml(diagnostic.message)} <span>line ${position.line}</span></li>`;
    })
    .join('');
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#0f172a">
    <h2 style="font-size:15px;margin:0 0 12px">Nothing to preview yet</h2>
    <ul style="padding-left:18px;margin:0;color:#b91c1c;font-size:13px;line-height:1.6">${items}</ul>
  </body></html>`;
}

function paintDiagnostics(compilation: Compilation): void {
  diagnosticsList.replaceChildren();

  const diagnostics = compilation.diagnostics.filter(
    (diagnostic) => diagnostic.severity !== 'info' || compilation.hasErrors,
  );

  if (diagnostics.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-diagnostics';
    empty.textContent = 'No problems found.';
    diagnosticsList.append(empty);
    return;
  }

  for (const diagnostic of diagnostics) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `diagnostic ${diagnostic.severity}`;

    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = diagnostic.code;

    const message = document.createElement('span');
    message.className = 'message';
    message.textContent = diagnostic.message;
    if (diagnostic.hint !== undefined) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = diagnostic.hint;
      message.append(hint);
    }

    const where = document.createElement('span');
    where.className = 'where';
    const position = positionOf(compilation.source, diagnostic);
    where.textContent = `${position.line}:${position.column}`;

    item.append(code, message, where);
    item.addEventListener('click', () => jumpTo(diagnostic));
    diagnosticsList.append(item);
  }
}

function positionOf(file: SourceFile, diagnostic: Diagnostic): { line: number; column: number; offset: number } {
  const target = diagnostic.file ?? file;
  const offset = Math.min(diagnostic.span.start, target.text.length);
  const before = target.text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return { line, column, offset };
}

function jumpTo(diagnostic: Diagnostic): void {
  if (latest === undefined) return;
  const { offset } = positionOf(latest.source, diagnostic);
  const end = Math.min(diagnostic.span.end, editor.value.length);
  editor.focus();
  editor.setSelectionRange(offset, Math.max(offset, end));
  const lineHeight = 20;
  const line = editor.value.slice(0, offset).split('\n').length;
  editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
  syncScroll();
}

// ---------------------------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------------------------

const TOKEN_CLASS: Record<string, string> = {
  keyword: 'tok-keyword',
  string: 'tok-string',
  number: 'tok-number',
  op: 'tok-operator',
  color: 'tok-number',
};

function paintEditor(text: string): void {
  highlight.innerHTML = highlightSource(text);
  const lines = text.split('\n').length;
  let numbers = '';
  for (let line = 1; line <= lines; line++) numbers += `${line}\n`;
  gutter.textContent = numbers;
  syncScroll();
}

function highlightSource(text: string): string {
  const file = sourceFile('main.pui', text);
  const parsed = parse(file);
  const lexed = tokenize(file, parsed.bag);

  interface Mark {
    readonly start: number;
    readonly end: number;
    readonly cls: string;
  }

  const marks: Mark[] = [];
  const lineStart = new Set<number>();

  // Names that are followed by `=` on the same line are properties; the first name on a line
  // after the indentation is the element itself.
  const tokens = lexed.tokens;
  let expectingElement = true;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind === 'newline') {
      expectingElement = true;
      lineStart.add(token.span.end);
      continue;
    }
    if (token.kind === 'indent' || token.kind === 'dedent') {
      expectingElement = true;
      continue;
    }
    if (token.kind === 'comment') {
      marks.push({ start: token.span.start, end: token.span.end, cls: 'tok-comment' });
      continue;
    }
    if (token.kind === 'string') {
      marks.push({ start: token.span.start, end: token.span.end, cls: 'tok-string' });
      continue;
    }
    if (token.kind === 'number' || token.kind === 'color') {
      marks.push({ start: token.span.start, end: token.span.end, cls: TOKEN_CLASS[token.kind] ?? '' });
      continue;
    }
    if (token.kind === 'op') {
      marks.push({ start: token.span.start, end: token.span.end, cls: 'tok-operator' });
      continue;
    }
    if (token.kind === 'keyword') {
      marks.push({ start: token.span.start, end: token.span.end, cls: 'tok-keyword' });
      expectingElement = token.value === 'on' || token.value === 'for' || token.value === 'if';
      continue;
    }
    if (token.kind === 'ident') {
      const next = tokens[index + 1];
      const isProperty = next !== undefined && next.kind === 'op' && next.value === '=';
      const cls = expectingElement ? 'tok-element' : isProperty ? 'tok-prop' : '';
      if (cls !== '') marks.push({ start: token.span.start, end: token.span.end, cls });
      expectingElement = false;
    }
  }

  marks.sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    out += escapeHtml(text.slice(cursor, mark.start));
    out += `<span class="${mark.cls}">${escapeHtml(text.slice(mark.start, mark.end))}</span>`;
    cursor = mark.end;
  }
  out += escapeHtml(text.slice(cursor));
  // A trailing newline keeps the last line scrollable in step with the textarea.
  return `${out}\n`;
}

function syncScroll(): void {
  gutter.scrollTop = editor.scrollTop;
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'));
}

editor.addEventListener('input', () => {
  queue();
  paintEditor(editor.value);
});

editor.addEventListener('scroll', syncScroll);

editor.addEventListener('keydown', (event) => {
  const command = event.metaKey || event.ctrlKey;

  if (command && event.key.toLowerCase() === 's') {
    event.preventDefault();
    applyFormat();
    return;
  }
  if (command && event.key === 'Enter') {
    event.preventDefault();
    refresh();
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = editor;
    editor.value = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`;
    editor.selectionStart = editor.selectionEnd = selectionStart + 4;
    queue();
    paintEditor(editor.value);
    return;
  }

  if (event.key === 'Enter') {
    // Keep the indentation of the current line and add a level after a block opener.
    const { selectionStart, value } = editor;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const line = value.slice(lineStart, selectionStart);
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    const opensBlock = line.trimEnd().endsWith(':');
    const insertion = `\n${indent}${opensBlock ? '    ' : ''}`;
    event.preventDefault();
    editor.value = `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionStart)}`;
    editor.selectionStart = editor.selectionEnd = selectionStart + insertion.length;
    queue();
    paintEditor(editor.value);
  }
});

// ---------------------------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------------------------

let timer: number | undefined;

function queue(): void {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = undefined;
    refresh();
  }, 120);
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

function applyFormat(): void {
  const result = formatText('main.pui', editor.value);
  if (result.skipped || !result.changed) {
    refresh();
    return;
  }
  const scroll = editor.scrollTop;
  editor.value = result.text;
  editor.scrollTop = scroll;
  refresh();
}

function setSource(text: string): void {
  editor.value = text;
  editor.scrollTop = 0;
  refresh();
}

$('format').addEventListener('click', applyFormat);

$('copy').addEventListener('click', () => {
  const activeTab = document.querySelector<HTMLButtonElement>('.tab[aria-selected="true"]');
  const text =
    activeTab?.dataset['tab'] === 'html' ? latest?.html ?? '' : activeTab?.dataset['tab'] === 'preview' ? latest?.html ?? '' : latest?.dart ?? '';
  void navigator.clipboard.writeText(text).then(() => flash('copy', 'Copied'));
});

$('download').addEventListener('click', () => {
  const blob = new Blob([latest?.dart ?? ''], { type: 'text/x-dart' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'main.pui.dart';
  link.click();
  URL.revokeObjectURL(url);
});

$('share').addEventListener('click', () => {
  const encoded = btoa(encodeURIComponent(editor.value));
  const url = `${location.origin}${location.pathname}#code=${encoded}`;
  history.replaceState(null, '', `#code=${encoded}`);
  void navigator.clipboard.writeText(url).then(
    () => flash('share', 'Link copied'),
    () => flash('share', 'Link is in the address bar'),
  );
});

function flash(id: string, message: string): void {
  const button = $(id);
  const original = button.textContent ?? '';
  button.textContent = message;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------

const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];

function selectTab(name: string): void {
  for (const tab of tabs) {
    const selected = tab.dataset['tab'] === name;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    const panel = document.getElementById(`panel-${tab.dataset['tab'] ?? ''}`);
    if (panel !== null) panel.hidden = !selected;
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab.dataset['tab'] ?? 'preview'));
}

// ---------------------------------------------------------------------------------------------
// Examples and persistence
// ---------------------------------------------------------------------------------------------

function populateExamples(): void {
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose…';
  examplesSelect.append(placeholder);

  for (const example of EXAMPLES) {
    const option = document.createElement('option');
    option.value = example.id;
    option.textContent = example.title;
    examplesSelect.append(option);
  }

  examplesSelect.addEventListener('change', () => {
    const example = EXAMPLES.find((candidate) => candidate.id === examplesSelect.value);
    if (example === undefined) return;
    localStorage.setItem(STORAGE_EXAMPLE, example.id);
    setSource(example.source);
  });
}

function store(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // Private browsing and storage quotas are not worth an error message.
  }
}

function fromHash(): string | undefined {
  const match = /#code=([^&]+)/.exec(location.hash);
  if (match === null) return undefined;
  try {
    return decodeURIComponent(atob(match[1]!));
  } catch {
    return undefined;
  }
}

function initialSource(): string {
  const shared = fromHash();
  if (shared !== undefined) return shared;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null && stored.trim().length > 0) return stored;

  const remembered = localStorage.getItem(STORAGE_EXAMPLE);
  const example = EXAMPLES.find((candidate) => candidate.id === remembered) ?? EXAMPLES[0];
  return example?.source ?? 'screen Home:\n    text "Hello"\n';
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

populateExamples();
selectTab('preview');
setSource(initialSource());
