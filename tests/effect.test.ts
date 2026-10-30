/**
 * `effect on <state>`: actions that run on mount and when a named state changes.
 *
 * The construct exists because "run after every change" is a re-render loop and implicit tracking
 * cannot be lowered to Flutter at all. So the tests pin three things: the dependency list is
 * written by hand, the lowerings that would silently differ between targets are refused, and the
 * generated Dart schedules the body after the frame instead of during it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateHtml } from '../src/codegen/html.ts';
import { compileSource } from '../src/project/compile.ts';
import { formatText } from '../src/tooling/format.ts';

function compile(text: string) {
  const result = compileSource(text, { path: 'effect.pui' });
  return { ...result, html: result.ok ? generateHtml(result.analysis).code : undefined };
}

/** A screen with the two states the effect tests watch, plus a third to write into. */
function screen(...body: readonly string[]): string {
  return [
    'screen Home:',
    '',
    '    state query: String = ""',
    '    state count: int = 0',
    '    state hits: int = 0',
    '',
    ...body,
    '',
  ].join('\n');
}

const IGNORED = new Set(['PUI2404', 'PUI2405']);

function errors(text: string): string[] {
  return compile(text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code)
    .filter((code) => !IGNORED.has(code));
}

function code(text: string): string {
  const result = compile(text);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.code ?? '';
}

function diagnostics(text: string): string {
  return compile(text)
    .diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message} ${diagnostic.hint ?? ''}`)
    .join('\n');
}

const VIEW = ['    column:', '', '        text "${query} ${count} ${hits}"'];

// ---------------------------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------------------------

test('an effect parses its header and its actions', () => {
  const result = compile(screen('    effect on query, count:', '        set hits = hits + 1', ...VIEW));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const decl = result.program.decls[0];
  assert.equal(decl?.kind, 'Screen');
  if (decl?.kind !== 'Screen') return;
  assert.equal(decl.effects.length, 1);
  assert.deepEqual(decl.effects[0]!.watches.map((watch) => watch.name), ['query', 'count']);
  assert.equal(decl.effects[0]!.body.length, 1);
  assert.equal(decl.effects[0]!.body[0]!.kind, 'Set');
});

test('a repeated name in the header is watched once', () => {
  const result = compile(screen('    effect on query, query:', '        set hits = 1', ...VIEW));
  const decl = result.program.decls[0];
  if (decl?.kind !== 'Screen') assert.fail('expected a screen');
  assert.deepEqual(decl.effects[0]!.watches.map((watch) => watch.name), ['query']);
});

test('the one-line form works like an event handler', () => {
  const result = compile(screen('    effect on count: set hits = 0', ...VIEW));
  assert.deepEqual(errors(screen('    effect on count: set hits = 0', ...VIEW)), []);
  const decl = result.program.decls[0];
  if (decl?.kind !== 'Screen') assert.fail('expected a screen');
  assert.equal(decl.effects[0]!.body.length, 1);
});

test('the formatter leaves an effect header alone, and is idempotent', () => {
  const messy = ['screen Home:', '  state query: String = ""', '  effect on query:', '    set query = query', ''].join('\n');
  const once = formatText('effect.pui', messy).text;
  assert.match(once, /^ {4}effect on query:$/m);
  assert.equal(formatText('effect.pui', once).text, once);
});

test('an effect on a component is legal, and runs in the component', () => {
  const source = [
    'component Field(label: String):',
    '',
    '    state touched: bool = false',
    '',
    '    effect on touched:',
    '        set touched = touched',
    '',
    '    column:',
    '',
    '        text "${label} ${touched}"',
    '',
  ].join('\n');
  // Writing what it watches is still an error inside a component: the rule is about the construct.
  assert.deepEqual(errors(source), ['PUI2363']);
});

// ---------------------------------------------------------------------------------------------
// Lowering
// ---------------------------------------------------------------------------------------------

test('an effect lowers to a method, a snapshot field and a post-frame callback', () => {
  const dart = code(screen('    effect on query:', '        set hits = 0', ...VIEW));
  assert.match(dart, /String\? _puiEffect0Query;/);
  assert.match(dart, /\/\/\/ `effect on query` — runs on mount and whenever query changes, never otherwise\./);
  assert.match(dart, /void _puiEffect0\(\) \{/);
  assert.match(dart, /final puiEffect0Due = _puiEffect0Query != query;/);
  assert.match(dart, /_puiEffect0Query = query;/);
  assert.match(dart, /WidgetsBinding\.instance\.addPostFrameCallback\(\(_\) \{/);
  assert.match(dart, /if \(mounted\) _puiEffect0\(\);/);
});

test('the snapshot starts null, so the effect also runs on mount', () => {
  const dart = code(screen('    effect on count:', '        set hits = 0', ...VIEW));
  // A nullable field initialised to nothing is unequal to every value, including 0.
  assert.match(dart, /int\? _puiEffect0Count;/);
  assert.doesNotMatch(dart, /_puiEffect0Count = 0/);
});

test('an unrelated state change does not schedule the effect', () => {
  const dart = code(screen('    effect on query:', '        set hits = 0', ...VIEW));
  const due = /final puiEffect0Due = (.+);/.exec(dart)?.[1];
  assert.equal(due, '_puiEffect0Query != query');
  assert.doesNotMatch(due ?? '', /count|hits/);
});

test('every state in the header is compared, so either one runs the effect', () => {
  const dart = code(screen('    effect on query, count:', '        set hits = 0', ...VIEW));
  assert.match(dart, /final puiEffect0Due = _puiEffect0Query != query \|\| _puiEffect0Count != count;/);
});

test('the snapshot field takes the state type', () => {
  const dart = code(screen('    effect on hits:', '        set count = 0', ...VIEW));
  assert.match(dart, /int\? _puiEffect0Hits;/);
});

test('two effects keep their declaration order and their own snapshots', () => {
  const dart = code(
    screen(
      '    effect on query:',
      '        set hits = 1',
      '    effect on count:',
      '        set hits = 2',
      ...VIEW,
    ),
  );
  assert.match(dart, /void _puiEffect0\(\)/);
  assert.match(dart, /void _puiEffect1\(\)/);
  assert.ok(dart.indexOf('final puiEffect0Due') < dart.indexOf('final puiEffect1Due'));
});

test('an awaiting effect is emitted async', () => {
  const dart = code(screen('    effect on count:', '        set hits = await fetchHits(count)', ...VIEW));
  assert.match(dart, /void _puiEffect0\(\) async \{/);
});

// ---------------------------------------------------------------------------------------------
// What the checker refuses
// ---------------------------------------------------------------------------------------------

test('an effect may watch state, and nothing else', () => {
  const derived = screen('    derived doubled = count * 2', '    effect on doubled:', '        set hits = 0', ...VIEW);
  assert.deepEqual(errors(derived), ['PUI2360']);
  assert.match(diagnostics(derived), /effect watches "doubled", which is derived/);

  const task = screen('    task items: List<String> = loadItems()', '    effect on items:', '        set hits = 0', ...VIEW);
  assert.deepEqual(errors(task), ['PUI2360']);

  const param = ['component Panel(label: String):', '', '    state hits: int = 0', '', '    effect on label:', '        set hits = 1', '', '    text "${label} ${hits}"', ''].join('\n');
  assert.deepEqual(errors(param), ['PUI2360']);
});

test('an undeclared name is its own error, with a suggestion', () => {
  const source = screen('    effect on qeury:', '        set hits = 0', ...VIEW);
  assert.deepEqual(errors(source), ['PUI2364']);
  assert.match(diagnostics(source), /did you mean `query`/);
});

test('an effect with no actions is an error', () => {
  const source = screen('    effect on query:', ...VIEW);
  assert.ok(errors(source).includes('PUI2361'));
});

test('a nested effect is refused where it stands', () => {
  const source = screen('    column:', '', '        effect on query:', '            set hits = 0', ...VIEW);
  assert.deepEqual(errors(source), ['PUI2362']);
});

test('an effect that writes what it watches is refused', () => {
  const source = screen('    effect on query:', '        set query = query + "!"', ...VIEW);
  assert.deepEqual(errors(source), ['PUI2363']);
  assert.match(diagnostics(source), /every run would schedule the next one/);
});

test('writing a state the effect does not watch is fine', () => {
  const source = screen('    effect on query:', '        set hits = hits + 1', ...VIEW);
  assert.deepEqual(errors(source), []);
});

test('a nested assignment is found too', () => {
  const source = screen(
    '    effect on query:',
    '        if query == "":',
    '            set query = "empty"',
    ...VIEW,
  );
  assert.deepEqual(errors(source), ['PUI2363']);
});

test('watching a state counts as using it', () => {
  const source = screen('    effect on hits:', '        set count = hits', ...VIEW);
  assert.doesNotMatch(diagnostics(source), /state "hits" is never used/);
});

test('the header needs "on" and a name', () => {
  const noOn = compile(screen('    effect query:', '        set hits = 0', ...VIEW));
  assert.ok(noOn.diagnostics.some((diagnostic) => diagnostic.code === 'PUI1022'));
});

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

test('the preview builds a screen with an effect instead of dropping it', () => {
  const result = compile(screen('    effect on query:', '        set hits = 1', ...VIEW));
  assert.equal(result.ok, true);
  assert.match(result.html ?? '', /pui-text/);
});
