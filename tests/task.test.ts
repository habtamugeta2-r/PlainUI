/**
 * `task`: async as a language construct.
 *
 * The value of this feature is what the *compiler* refuses to let you do — forget the loading flag,
 * forget the error branch, `setState` after the screen is gone. These tests pin both the shape of
 * the generated state machine and the diagnostics that stop a hand-written one from creeping back.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { check } from '../src/analysis/check.ts';
import { generateHtml } from '../src/codegen/html.ts';
import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { compileOne } from '../src/project/project.ts';
import { codes } from './helpers.ts';

const SCREEN = [
  'screen Todo:',
  '',
  '    task items: List<String> = loadTodos()',
  '',
  '    column:',
  '',
  '        if items.loading:',
  '            progress',
  '',
  '        elif items.error != null:',
  '            text items.error',
  '',
  '            button "Try again":',
  '                on tap:',
  '                    items.retry()',
  '',
  '        else:',
  '',
  '            for item in items.value:',
  '                text item',
  '',
].join('\n');

function compile(text: string) {
  return compileOne('todo.pui', text);
}

function errors(text: string): string[] {
  const result = compile(text);
  return result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
}

test('a task parses into a typed async value', () => {
  const file = sourceFile('todo.pui', SCREEN);
  const { program, bag } = parse(file);
  assert.deepEqual(codes(bag.diagnostics), []);
  const screen = program.decls.find((decl) => decl.kind === 'Screen');
  assert.ok(screen !== undefined && screen.kind === 'Screen');
  assert.equal(screen.tasks.length, 1);
  assert.equal(screen.tasks[0]!.name, 'items');
  assert.equal(screen.tasks[0]!.typeText, 'List<String>');
  assert.equal(screen.tasks[0]!.init.kind, 'Call');
  // The task is not part of the rendered body.
  assert.equal(screen.body.some((node) => node.kind === 'Task'), false);
});

test('the generated screen owns the whole state machine', () => {
  const result = compile(SCREEN);
  assert.equal(result.code !== undefined, true, JSON.stringify(result.diagnostics));
  const code = result.code!;

  // Three fields: the value, the error, the flag.
  assert.match(code, /List<String>\? _items;/);
  assert.match(code, /String\? _itemsError;/);
  assert.match(code, /bool _itemsLoading = true;/);

  // It starts when the screen does, and a retry reuses the same loader.
  assert.match(code, /void initState\(\) \{\n {4}super\.initState\(\);\n {4}_loadItems\(\);\n {2}\}/);
  assert.match(code, /Future<void> _loadItems\(\) async \{/);
  assert.match(code, /final result = await loadTodos\(\);/);

  // A load that finishes after the screen is gone must not call setState — and neither must a
  // load that has been superseded by a newer one.
  assert.equal(
    code.match(/if \(!mounted \|\| request != _itemsRequest\) return;/g)?.length,
    2,
    'one guard after the await, one in catch',
  );
  assert.match(code, /int _itemsRequest = 0;/);
  assert.match(code, /final request = \+\+_itemsRequest;/);

  // Retry resets the previous failure before running again.
  assert.match(code, /_itemsLoading = true;\n {6}_itemsError = null;/);
  assert.match(code, /onPressed: \(\) \{\s*_loadItems\(\);/);
});

test('a retry cannot be overwritten by the older load it superseded', () => {
  const code = compile(SCREEN).code!;
  // Every run takes a number; a result whose number is stale is dropped before setState. Without
  // this the most natural thing a user does — retry a slow load — intermittently shows the old
  // data, which is the failure mode that is hardest to reproduce and easiest to blame on the server.
  const loader = /Future<void> _loadItems\(\) async \{([\s\S]*?)\n {2}\}/.exec(code)?.[1] ?? '';
  assert.match(loader, /final request = \+\+_itemsRequest;/);
  assert.equal(loader.match(/request != _itemsRequest/g)?.length, 2, 'both the success and the error path');
  // The counter is per task, not per screen: two tasks can be in flight at once.
  const two = compile(
    ['screen Two:', '', '    task a: List<String> = loadA()', '    task b: List<String> = loadB()', '', '    column:', '', '        text a.error ?? ""', '        text b.error ?? ""', ''].join('\n'),
  ).code!;
  assert.match(two, /int _aRequest = 0;/);
  assert.match(two, /int _bRequest = 0;/);
});

test('task members map to those fields, and a missing value reads as an empty list', () => {
  const code = compile(SCREEN).code!;
  assert.match(code, /if \(_itemsLoading\)/);
  assert.match(code, /else if \(_itemsError != null\)/);
  // A nullable error inside Text would not compile; the compiler supplies the fallback.
  assert.match(code, /Text\(\(_itemsError \?\? ''\)/);
  // `items.value` is iterable before the first load finishes.
  assert.match(code, /for \(final item in \(_items \?\? const <String>\[\]\)\)/);
});

test('a component can own a task as well as a screen', () => {
  const result = compile(
    ['component Feed():', '', '    task posts: List<String> = loadPosts()', '', '    if posts.loading:', '        progress', '    else:', '        for post in posts.value:', '            text post', ''].join('\n'),
  );
  assert.equal(result.code !== undefined, true, JSON.stringify(result.diagnostics));
  assert.match(result.code!, /class Feed extends StatefulWidget/);
  assert.match(result.code!, /Future<void> _loadPosts\(\) async \{/);
});

test('a task must await a call', () => {
  assert.deepEqual(errors(['screen Home:', '    task items: List<String> = []', '    text "x"', ''].join('\n')), ['PUI2310']);
});

test('a task cannot be assigned, and cannot share a name with state', () => {
  const assigned = [
    'screen Home:',
    '    task items: List<String> = load()',
    '    button "x":',
    '        on tap:',
    '            set items = []',
    '',
  ].join('\n');
  assert.deepEqual(errors(assigned), ['PUI2311']);

  const duplicate = [
    'screen Home:',
    '    state items: List<String> = []',
    '    task items: List<String> = load()',
    '    text "x"',
    '',
  ].join('\n');
  assert.deepEqual(errors(duplicate), ['PUI2003']);
});

test('a task exposes four parts and says so when asked for a fifth', () => {
  const result = compile(['screen Home:', '    task items: List<String> = load()', '    text items.count', ''].join('\n'));
  const unknown = result.diagnostics.find((d) => d.code === 'PUI2312');
  assert.ok(unknown !== undefined, `expected PUI2312, got ${result.diagnostics.map((d) => d.code).join(', ')}`);
  assert.match(unknown.hint ?? '', /loading, error, value, retry/);
});

test('a typed task gives the loop variable its element type', () => {
  const code = compile(SCREEN).code!;
  // Without the element type, `text item` would emit `item.toString()`.
  assert.doesNotMatch(code, /Text\(\(item\)\.toString\(\)\)/);
});

test('the HTML preview renders the loaded state, because it has no host runtime', () => {
  const file = sourceFile('todo.pui', SCREEN);
  const { program } = parse(file);
  const analysis = check(file, program, {}).analysis;
  const html = generateHtml(analysis).code;
  // No spinner and no crash: the preview shows what the screen looks like once the value arrives.
  assert.doesNotMatch(html, /CircularProgressIndicator|pui-progress/);
  assert.match(html, /pui-screen/);
});
