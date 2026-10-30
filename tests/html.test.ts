/**
 * The HTML target is a preview renderer: it must produce a self contained document, escape user
 * text, evaluate the initial state it can know, and never claim more than it knows.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { generateHtml } from '../src/codegen/html.ts';
import { check } from '../src/analysis/check.ts';
import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';

function render(source: string): string {
  const file = sourceFile('preview.pui', source);
  const parsed = parse(file);
  const result = check(file, parsed.program, {});
  return generateHtml(result.analysis).code;
}

test('the document is self contained', () => {
  const html = render('screen Home:\n    text "hi"\n');
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Home<\/title>/);
  assert.match(html, /<style>/);
  assert.match(html, /<\/html>\n$/);
  // The preview runs inside an iframe in the playground: no scripts, no remote requests.
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('text is escaped', () => {
  const html = render('screen Home:\n    text "<b>bold</b> & \'quotes\'"\n');
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt; &amp; &#39;quotes&#39;/);
  assert.doesNotMatch(html, /<b>bold/);
});

test('literal state is substituted into interpolation', () => {
  const html = render(
    ['screen Home:', '    state name: String = "Ada"', '    text "Hello, ${name}"', ''].join('\n'),
  );
  assert.match(html, /Hello, Ada/);
});

test('a loop over a literal list repeats its body', () => {
  const html = render(
    [
      'screen Home:',
      '    state items: List<String> = ["a", "b", "c"]',
      '    column:',
      '        for item in items:',
      '            text item',
      '',
    ].join('\n'),
  );
  assert.equal((html.match(/class="pui-text"/g) ?? []).length, 3);
  assert.match(html, />a</);
  assert.match(html, />c</);
});

test('a loop over an unknown value renders one marked placeholder iteration', () => {
  const html = render(
    [
      'import "data.dart"',
      '',
      'screen Home:',
      '    column:',
      '        for item in products:',
      '            text item',
      '',
    ].join('\n'),
  );
  assert.equal((html.match(/class="pui-text"/g) ?? []).length, 1);
  assert.match(html, /pui-repeat/);
  assert.match(html, /‹item›/);
  assert.match(html, /title="for item in products"/);
});

test('conditional branches are chosen when the condition is known', () => {
  const known = render(
    [
      'screen Home:',
      '    state count: int = 3',
      '    if count > 2:',
      '        text "many"',
      '    else:',
      '        text "few"',
      '',
    ].join('\n'),
  );
  assert.match(known, /many/);
  assert.doesNotMatch(known, /few/);

  const unknown = render(
    [
      'import "data.dart"',
      '',
      'screen Home:',
      '    if busy:',
      '        text "working"',
      '',
    ].join('\n'),
  );
  assert.match(unknown, /pui-conditional/);
  assert.match(unknown, /title="if busy"/);
});

test('a component is expanded with its arguments and its slot', () => {
  const html = render(
    [
      'component Shell(title: String, children: List<Widget>):',
      '    card padding=8:',
      '        text title',
      '        slot',
      '',
      'screen Home:',
      '    Shell("Hello"):',
      '        text "inside"',
      '',
    ].join('\n'),
  );
  assert.match(html, /data-component="Shell"/);
  assert.match(html, />Hello</);
  assert.match(html, />inside</);
});

test('a slot with no children leaves a comment instead of breaking the layout', () => {
  const html = render(
    ['component Bare(children: List<Widget>):', '    column:', '        slot', '', 'screen Home:', '    Bare()', ''].join('\n'),
  );
  assert.match(html, /<!-- slot: no children were passed -->/);
});

test('host widgets become labelled placeholders and unknown tags say so', () => {
  const host = render(['import "widgets/app_logo.dart"', '', 'screen Home:', '    AppLogo()', ''].join('\n'));
  assert.match(host, /class="pui-host"/);
  assert.match(host, /host Dart widget/);

  const unknown = render('screen Home:\n    mysterious:\n        text "x"\n');
  assert.match(unknown, /class="pui-unknown"/);
});

test('style declarations become inline CSS', () => {
  const html = render(
    [
      'style price:',
      '    size=20',
      '    weight=bold',
      '    color=#1d4ed8',
      '    italic',
      '',
      'screen Home:',
      '    text "10 ETB" style=price',
      '',
    ].join('\n'),
  );
  assert.match(html, /font-size: 20px/);
  assert.match(html, /font-weight: 700/);
  assert.match(html, /color: #1d4ed8/);
  assert.match(html, /font-style: italic/);
});

test('universal properties become CSS in the same order as the Flutter wrappers', () => {
  const html = render('screen Home:\n    column padding=12 gap=8 bg=#eeeeee:\n        text "x"\n');
  assert.match(html, /gap: 8px; padding: 12px; background: #eeeeee/);
});

test('inputs keep their placeholder and obscure flag', () => {
  const html = render(
    [
      'screen Home:',
      '    state secret: String = ""',
      '    input bind=secret placeholder="Password" secret',
      '',
    ].join('\n'),
  );
  assert.match(html, /type="password"/);
  assert.match(html, /placeholder="Password"/);
});

test('a file without a screen still renders a document', () => {
  const html = render('component Only(label: String):\n    text label\n');
  assert.match(html, /no screen to preview/);
});

test('the title can be overridden', () => {
  const file = sourceFile('preview.pui', 'screen Home:\n    text "hi"\n');
  const parsed = parse(file);
  const analysis = check(file, parsed.program, {});
  assert.match(generateHtml(analysis.analysis, { title: 'PlainUI playground' }).code, /<title>PlainUI playground<\/title>/);
});
