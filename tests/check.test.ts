import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check, type CheckOptions } from '../src/analysis/check.ts';
import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { codes } from './helpers.ts';

function run(text: string, options: CheckOptions = {}) {
  const file = sourceFile('test.pui', text);
  const { program } = parse(file);
  const { bag, analysis } = check(file, program, options);
  return { bag, analysis, file, program };
}

function errorsOf(text: string): string[] {
  return run(text).bag.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
}

function warningsOf(text: string): string[] {
  return run(text).bag.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.code);
}

function diagnosticFor(text: string, code: string) {
  const match = run(text).bag.diagnostics.find((d) => d.code === code);
  assert.ok(match, `expected ${code}, got ${codes(run(text).bag.diagnostics).join(', ') || 'nothing'}`);
  return match;
}

test('a realistic screen validates cleanly', () => {
  const text = [
    'style price:',
    '    size=20',
    '    weight=bold',
    '',
    'component ProductCard(product: Product, compact: bool = false):',
    '    card padding=12 radius=8:',
    '        column gap=4:',
    '            text product.name style=heading',
    '            text product.price style=price',
    '',
    'screen Products:',
    '    state query: String = ""',
    '    state items: List<Product> = loadProducts()',
    '    column padding=16 gap=12:',
    '        input bind=query label="Search"',
    '        if items.isEmpty:',
    '            text "Nothing here" style=secondary',
    '        else:',
    '            for index, product in items:',
    '                ProductCard(product)',
    '                text "${index + 1}"',
    '',
  ].join('\n');
  const { bag } = run(text);
  const problems = bag.diagnostics.filter((d) => d.severity === 'error');
  assert.deepEqual(problems.map((d) => `${d.code} ${d.message}`), []);
});

test('unknown lowercase element suggests the nearest built-in', () => {
  const d = diagnosticFor('screen Home:\n    colum:\n        text "x"\n', 'PUI2001');
  assert.match(d.hint ?? '', /column/);
});

test('lowercase call of a component is explained', () => {
  const text = ['component Card2(label: String):', '    text label', '', 'screen Home:', '    card2("x")', ''].join('\n');
  const d = diagnosticFor(text, 'PUI2001');
  assert.match(d.hint ?? '', /uppercase/);
});

test('unknown property suggests a near match', () => {
  const d = diagnosticFor('screen Home:\n    column paddin=16:\n        text "x"\n', 'PUI2102');
  assert.match(d.hint ?? '', /padding/);
});

test('invalid enum value offers the accepted set', () => {
  const d = diagnosticFor('screen Home:\n    column main=centre:\n        text "x"\n', 'PUI2111');
  assert.match(d.hint ?? '', /did you mean `center`/);
});

test('missing required content argument', () => {
  assert.deepEqual(errorsOf('screen Home:\n    text\n'), ['PUI2107']);
});

test('children on a leaf element are rejected', () => {
  const text = ['screen Home:', '    text "a":', '        text "b"', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2004'));
});

test('multiple children in a single-child element is a warning', () => {
  const text = ['screen Home:', '    center:', '        text "a"', '        text "b"', ''].join('\n');
  assert.ok(warningsOf(text).includes('PUI2403'));
});

test('binding to an unknown state variable suggests a declared one', () => {
  const d = diagnosticFor('screen Home:\n    state email: String = ""\n    input bind=emial\n', 'PUI2104');
  assert.match(d.hint ?? '', /email/);
});

test('binding a text field to non-string state is rejected', () => {
  const text = ['screen Home:', '    state count: int = 0', '    input bind=count', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2110'));
});

test('bind plus on change is rejected', () => {
  const text = ['screen Home:', '    state q: String = ""', '    input bind=q:', '        on change:', '            log(q)', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2106'));
});

test('unknown event names list the accepted ones', () => {
  const d = diagnosticFor('screen Home:\n    button "go":\n        on press:\n            go()\n', 'PUI2101');
  assert.match(d.hint ?? '', /tap/);
});

test('assigning to a component parameter is rejected', () => {
  const text = ['component Chip(label: String):', '    button "x":', '        on tap:', '            set label = "y"', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2105'));
});

test('unknown value identifiers are errors but unknown called identifiers are host functions', () => {
  assert.ok(errorsOf('screen Home:\n    text missingValue\n').includes('PUI2005'));
  assert.deepEqual(errorsOf('screen Home:\n    button "x":\n        on tap:\n            doSomething()\n'), []);
});

test('host classes and imported roots are allowed as values', () => {
  const text = ['screen Home:', '    text Colors.red', '    text appState.user.name', ''].join('\n');
  const { bag } = run(text, { hostRoots: new Set(['appState']) });
  assert.deepEqual(bag.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), []);
});

test('host widgets are accepted with an informational note', () => {
  const text = ['import "package:my_app/widgets/app_logo.dart"', '', 'screen Home:', '    AppLogo()', ''].join('\n');
  const { bag } = run(text);
  assert.deepEqual(bag.diagnostics.filter((d) => d.severity === 'error'), []);
  assert.ok(bag.diagnostics.some((d) => d.code === 'PUI2406' && d.severity === 'info'));
});

test('slot requires a children parameter', () => {
  const text = ['component Shell(title: String):', '    column:', '        text title', '        slot', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2204'));
});

test('children supplied to a component without a slot are rejected', () => {
  const text = ['component Plain(title: String):', '    text title', '', 'screen Home:', '    Plain("x"):', '        text "extra"', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2203'));
});

test('a host widget that is one letter away from a component says so', () => {
  const text = [
    'component Card2(label: String):',
    '    text label',
    '',
    'screen Home:',
    '    column:',
    '        Card2x("x")',
    '',
  ].join('\n');
  const diagnostic = run(text).bag.diagnostics.find((d) => d.code === 'PUI2406');
  assert.ok(diagnostic, 'expected the host widget note');
  assert.match(diagnostic.hint ?? '', /did you mean `Card2`\?/);
});

test('Flutter enum spellings suggest the shorter PlainUI name', () => {
  const text = ['screen Home:', '    row main=spaceBetween:', '        text "a"', ''].join('\n');
  const diagnostic = run(text).bag.diagnostics.find((d) => d.code === 'PUI2111');
  assert.ok(diagnostic, 'expected an invalid enum value');
  assert.match(diagnostic.message, /"spaceBetween" is not a valid value for "main"/);
  assert.match(diagnostic.hint ?? '', /use `between`/);
});

test('a parameter used only through short interpolation counts as used', () => {
  const text = [
    'component Price(label: String):',
    '    text "$label"',
    '',
    'screen Home:',
    '    column:',
    '        Price("Total")',
    '',
  ].join('\n');
  assert.deepEqual(warningsOf(text), []);
  assert.deepEqual(errorsOf(text), []);
});

test('a typo in a short interpolation is an unknown identifier', () => {
  const text = ['screen Home:', '    text "$conut"', ''].join('\n');
  assert.deepEqual(errorsOf(text), ['PUI2005']);
});

test('escaped and non-identifier dollars are left alone', () => {
  const text = ['screen Home:', '    column:', '        text "\\$5 and \\$name"', '        text "$5"', ''].join('\n');
  assert.deepEqual(run(text).bag.diagnostics.map((d) => d.code), []);
});

test('missing required component parameter is reported at the call site', () => {
  const text = ['component Card2(label: String, size: int = 12):', '    text label', '', 'screen Home:', '    Card2()', ''].join('\n');
  const d = diagnosticFor(text, 'PUI2201');
  assert.match(d.message, /label/);
});

test('unknown component argument suggests a parameter', () => {
  const text = ['component Card2(label: String):', '    text label', '', 'screen Home:', '    Card2(lable: "x")', ''].join('\n');
  const d = diagnosticFor(text, 'PUI2108');
  assert.match(d.hint ?? '', /label/);
});

test('duplicate names are reported', () => {
  assert.ok(errorsOf('screen Home:\n    state a: int = 1\n    state a: int = 2\n    text a\n').includes('PUI2003'));
  const dup = ['screen Home:', '    text "x"', '', 'screen Home:', '    text "y"', ''].join('\n');
  assert.ok(errorsOf(dup).includes('PUI2006'));
});

test('nested state is rejected', () => {
  const text = ['screen Home:', '    column:', '        state a: int = 1', '        text a', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2002'));
});

test('style prop errors and unknown styles', () => {
  assert.ok(errorsOf(['style big:', '    padding=16', '', 'screen Home:', '    text "x"', ''].join('\n')).includes('PUI2301'));
  const d = diagnosticFor(['screen Home:', '    text "x" style=headng', ''].join('\n'), 'PUI2302');
  assert.match(d.hint ?? '', /heading/);
});

test('names that would shadow Flutter types or reserved words are rejected', () => {
  assert.ok(errorsOf(['screen Text:', '    text "x"', ''].join('\n')).includes('PUI2011'));
  assert.ok(errorsOf(['screen home:', '    text "x"', ''].join('\n')).includes('PUI2014'));
});

test('await is only allowed in event handlers', () => {
  const text = ['screen Home:', '    text await load()', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2112'));
  assert.deepEqual(errorsOf(['screen Home:', '    button "x":', '        on tap:', '            await save()', ''].join('\n')), []);
});

test('a non-call statement in an event handler does nothing', () => {
  const text = ['screen Home:', '    button "x":', '        on tap:', '            count + 1', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2113'));
});

test('looping over a string is rejected', () => {
  const text = ['screen Home:', '    state name: String = ""', '    for letter in name:', '        text letter', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2402'));
});

test('unused state produces a warning, not an error', () => {
  const text = ['screen Home:', '    state unused: int = 0', '    text "x"', ''].join('\n');
  assert.ok(warningsOf(text).includes('PUI2404'));
  assert.deepEqual(errorsOf(text), []);
});

test('property value shapes are checked', () => {
  assert.ok(errorsOf('screen Home:\n    column padding=[1, 2, 3]:\n        text "x"\n').includes('PUI2110'));
  assert.ok(errorsOf('screen Home:\n    column padding="wide":\n        text "x"\n').includes('PUI2110'));
  assert.deepEqual(errorsOf('screen Home:\n    column padding=16:\n        text "x"\n'), []);
});

test('component call argument types are checked against parameter types', () => {
  const text = ['component Card2(label: String):', '    text label', '', 'screen Home:', '    Card2(42)', ''].join('\n');
  assert.ok(errorsOf(text).includes('PUI2110'));
});

test('loop variable types are recorded for the generator', () => {
  const { analysis } = run(['screen Home:', '    state items: List<String> = []', '    for i, item in items:', '        text item', ''].join('\n'));
  const forNode = analysis.program.decls[0]!.kind === 'Screen' ? analysis.program.decls[0]!.body.find((n) => n.kind === 'For') : undefined;
  assert.ok(forNode);
  const types = analysis.loopTypes.get(forNode as never);
  assert.ok(types);
  assert.equal(types.get('item')?.kind, 'string');
  assert.equal(types.get('i')?.kind, 'int');
});

test('a core type written in the wrong case is reported', () => {
  assert.deepEqual(errorsOf(['screen Home:', '    state count: Int = 0', '    text count', ''].join('\n')), ['PUI2206']);
  assert.deepEqual(errorsOf(['screen Home:', '    state flag: Boolean = false', '    text flag', ''].join('\n')), ['PUI2206']);
  assert.deepEqual(errorsOf(['screen Home:', '    state count: int = 0', '    text count', ''].join('\n')), []);
  // A capitalised type that is not a core type stays a plain host type.
  assert.deepEqual(errorsOf(['screen Home:', '    state now: DateTime = 0', '    text "x"', ''].join('\n')), []);
});
