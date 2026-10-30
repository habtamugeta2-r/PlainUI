import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSource } from '../src/project/compile.ts';
import { checkDartStructure } from './dart-syntax.ts';

function generate(source: string, path = 'lib/ui/test.pui'): string {
  const result = compileSource(source, { path });
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  assert.deepEqual(
    errors.map((d) => `${d.code}: ${d.message}`),
    [],
    'source should compile',
  );
  assert.ok(result.code, 'expected generated code');
  const problems = checkDartStructure(result.code);
  assert.deepEqual(problems, [], 'generated Dart should be structurally sound');
  return result.code;
}

test('a stateless screen becomes a StatelessWidget', () => {
  const code = generate(['screen Home:', '    column padding=20:', '        text "Home Page"', ''].join('\n'));
  assert.match(code, /class Home extends StatelessWidget \{/);
  assert.match(code, /return Padding\(\n {6}padding: const EdgeInsets\.all\(20\),/);
  assert.match(code, /Text\("Home Page"\)/);
  assert.match(code, /^import 'package:flutter\/material\.dart';$/m);
  assert.match(code, /GENERATED FILE - DO NOT EDIT/);
});

test('a screen with state becomes a StatefulWidget with setState', () => {
  const code = generate(
    ['screen Counter:', '    state count: int = 0', '    column:', '        text count', '        button "Add":', '            on tap:', '                set count = count + 1', ''].join('\n'),
  );
  assert.match(code, /class Counter extends StatefulWidget \{/);
  assert.match(code, /State<Counter> createState\(\) => _CounterState\(\);/);
  assert.match(code, /class _CounterState extends State<Counter> \{/);
  assert.match(code, /int count = 0;/);
  assert.match(code, /Text\(count\.toString\(\)\)/);
  assert.match(code, /onPressed: \(\) \{\n\s+setState\(\(\) \{\n\s+count = count \+ 1;\n\s+\}\);\n\s+\},/);
});

test('bound text fields get a controller, a sync step and a dispose', () => {
  const code = generate(['screen Login:', '    state email: String = ""', '    input bind=email label="Email"', ''].join('\n'));
  assert.match(code, /late final TextEditingController _emailController = TextEditingController\(text: email\);/);
  assert.match(code, /void dispose\(\) \{/);
  assert.match(code, /_emailController\.dispose\(\);/);
  assert.match(code, /void _syncControllers\(\) \{/);
  assert.match(code, /_syncControllers\(\);/);
  assert.match(code, /onChanged: \(value\) \{/);
});

test('conditionals and loops become collection-if and collection-for', () => {
  const code = generate(
    [
      'screen ItemList:',
      '    state items: List<String> = []',
      '    column:',
      '        if items.isEmpty:',
      '            text "empty"',
      '        else:',
      '            for item in items:',
      '                text item',
      '    for i, item in items:',
      '        text "${i}"',
      '',
    ].join('\n'),
  );
  assert.match(code, /if \(items\.isEmpty\)\n\s+Text\("empty"\)\n\s+else\n\s+for \(final item in items\)/);
  assert.match(code, /for \(final \(i, _\) in items\.indexed\)/);
});

test('await is hoisted out of setState', () => {
  const code = generate(
    ['screen Load:', '    state data: String = ""', '    button "Go":', '        on tap:', '            set data = await fetchData()', ''].join('\n'),
  );
  assert.match(code, /onPressed: \(\) async \{/);
  assert.match(code, /final puiValue0 = await fetchData\(\);/);
  assert.match(code, /setState\(\(\) \{\n\s+data = puiValue0;\n\s+\}\);/);
  assert.doesNotMatch(code, /await[^;]*\n\s*\}\);/);
});

test('a loop variable used only inside a string keeps its name', () => {
  const code = generate(
    [
      'screen Home:',
      '    state items: List<String> = []',
      '',
      '    column:',
      '        for item in items:',
      '            text "$item"',
      '        for unused in items:',
      '            text "x"',
      '',
    ].join('\n'),
  );
  assert.match(code, /for \(final item in items\)/);
  assert.match(code, /for \(final _ in items\)/);
});

test('universal layout properties wrap the element in a deterministic order', () => {
  const code = generate([
    'screen Home:',
    '    text "x" padding=8 width=100 expand opacity=0.5 background=#ff0000 align=center',
    '',
  ].join('\n'));
  // Outside in: Align wraps Expanded, which wraps Opacity, … down to the element itself.
  const order = ['Align', 'Expanded', 'Opacity', 'Container', 'SizedBox', 'Padding', 'Text'];
  let cursor = -1;
  for (const name of order) {
    const index = code.indexOf(`${name}(`);
    assert.ok(index > cursor, `expected ${name} after the previous wrapper, got:\n${code}`);
    cursor = index;
  }
  assert.match(code, /color: Color\(0xFFFF0000\)/);
});

test('text conversion depends on the inferred type', () => {
  const code = generate(
    [
      'screen Home:',
      '    state name: String = ""',
      '    state count: int = 0',
      '    state items: List<String> = []',
      '    text name',
      '    text count',
      '    text items',
      '',
    ].join('\n'),
  );
  assert.match(code, /Text\(name\)/);
  assert.match(code, /Text\(count\.toString\(\)\)/);
  assert.match(code, /Text\(items\.join\(', '\)\)/);
});

test('custom styles become const TextStyle and theme styles stay themed', () => {
  const code = generate(
    [
      'style price:',
      '    size=20',
      '    weight=bold',
      '    color=#0a7d33',
      '',
      'screen Home:',
      '    text "a" style=price',
      '    text "b" style=heading',
      '    text "c" style=body size=18',
      '',
    ].join('\n'),
  );
  assert.match(code, /const TextStyle _puiStylePrice = TextStyle\(\n\s+fontSize: 20,\n\s+fontWeight: FontWeight\.w700,\n\s+color: Color\(0xFF0A7D33\),\n\);/);
  assert.match(code, /Text\("a", style: _puiStylePrice\)/);
  assert.match(code, /Text\("b", style: Theme\.of\(context\)\.textTheme\.headlineSmall\)/);
  assert.match(code, /Text\(\n\s+"c",\n\s+style: Theme\.of\(context\)\.textTheme\.bodyMedium\?\.copyWith\(fontSize: 18\),\n\s+\)/);
});

test('unused styles are not emitted', () => {
  const code = generate(['style unused:', '    size=20', '', 'screen Home:', '    text "x"', ''].join('\n'));
  assert.doesNotMatch(code, /_puiStyleUnused/);
});

test('components with a slot spread the children field', () => {
  const code = generate(
    [
      'component Shell(title: String, children: List<Widget>):',
      '    column gap=8:',
      '        text title',
      '        slot',
      '',
      'screen Home:',
      '    Shell("hi"):',
      '        text "inside"',
      '',
    ].join('\n'),
  );
  assert.match(code, /class Shell extends StatelessWidget \{/);
  assert.match(code, /const Shell\(\{super\.key, required this\.title, required this\.children\}\);/);
  assert.match(code, /\.\.\.children,/);
  assert.match(code, /Shell\(\n\s+title: "hi",\n\s+children: <Widget>\[\n\s+Text\("inside"\),\n\s+\],\n\s+\)/);
});

test('components with state reach parameters through widget.', () => {
  const code = generate(
    [
      'component Ticker(label: String):',
      '    state ticks: int = 0',
      '    column:',
      '        text label',
      '        text ticks',
      '        button "tick":',
      '            on tap:',
      '                set ticks = ticks + 1',
      '',
    ].join('\n'),
  );
  assert.match(code, /class Ticker extends StatefulWidget \{/);
  assert.match(code, /Text\(widget\.label\)/);
  assert.match(code, /int ticks = 0;/);
});

test('host widgets are emitted as constructor calls with children', () => {
  const code = generate(['import "package:my_app/widgets/app_logo.dart"', '', 'screen Home:', '    AppLogo():', '        text "x"', ''].join('\n'));
  assert.match(code, /AppLogo\(child: Text\("x"\)\)/);
  assert.match(code, /import 'package:my_app\/widgets\/app_logo\.dart';/);
});

test('relative imports are re-based for the output directory', () => {
  const result = compileSource(['screen Home:', '    AppLogo()', ''].join('\n'), {
    path: 'lib/ui/home.pui',
  });
  assert.ok(result.code);
});

test('relative import rebasing uses the provided resolver', () => {
  const result = compileSource(
    ['import "../widgets/app_logo.dart"', '', 'screen Home:', '    AppLogo()', ''].join('\n'),
    {
      path: 'lib/ui/home.pui',
      resolvePlainuiImport: () => 'unused',
    },
  );
  assert.ok(result.code);
  assert.match(result.code, /import '\.\.\/widgets\/app_logo\.dart';/);
});

test('input properties map to a TextField', () => {
  const code = generate(
    ['screen Home:', '    state p: String = ""', '    input bind=p label="Password" secret keyboard=email autofocus maxLines=2', ''].join('\n'),
  );
  assert.match(code, /obscureText: true/);
  assert.match(code, /keyboardType: TextInputType\.emailAddress/);
  assert.match(code, /autofocus: true/);
  assert.match(code, /maxLines: 2/);
  // `TextInputType` comes with material.dart, so importing services.dart here would be flagged by
  // `dart analyze` as an unnecessary import in every file with a keyboard hint.
  assert.doesNotMatch(code, /services\.dart/);
});

test('buttons switch widget type by variant and disable without a handler', () => {
  const outlined = generate(['screen Home:', '    button "a" variant=outlined', ''].join('\n'));
  assert.match(outlined, /OutlinedButton\(onPressed: null, child: Text\("a"\)\)/);
  const full = generate(['screen Home:', '    button "a" fullWidth disabled', ''].join('\n'));
  assert.match(full, /SizedBox\(\n\s+width: double\.infinity,/);
  assert.match(full, /onPressed: null/);
});

test('generic gesture events wrap any element', () => {
  const code = generate(
    ['screen Home:', '    card padding=8:', '        on tap:', '            log("tapped")', '        text "tap me"', ''].join('\n'),
  );
  assert.match(code, /GestureDetector\(\n\s+onTap: \(\) \{\n\s+log\("tapped"\);\n\s+\},/);
});

test('focus and blur wrap a field in a Focus widget', () => {
  const code = generate(
    [
      'screen Home:',
      '    state q: String = ""',
      '    input bind=q:',
      '        on focus:',
      '            log()',
      '        on blur:',
      '            save()',
      '',
    ].join('\n'),
  );
  assert.match(code, /Focus\(\n\s+onFocusChange: \(hasFocus\) \{/);
  assert.match(code, /if \(hasFocus\) \{/);
  assert.match(code, /else \{/);
});

test('grids, wraps, stacks, lists and scaffolds emit their Flutter counterparts', () => {
  const code = generate(
    [
      'screen Home:',
      '    scaffold title="T":',
      '        grid columns=3 gap=4:',
      '            text "a"',
      '        wrap gap=4 runGap=8:',
      '            text "b"',
      '        stack align=center fit=expand:',
      '            text "c"',
      '        list gap=2:',
      '            text "d"',
      '',
    ].join('\n'),
  );
  assert.match(code, /Scaffold\(\n\s+appBar: AppBar\(title: Text\("T"\)\),/);
  assert.match(code, /GridView\.count\(\n\s+crossAxisCount: 3,/);
  assert.match(code, /Wrap\(\n\s+spacing: 4,\n\s+runSpacing: 8,/);
  assert.match(code, /Stack\(\n\s+alignment: Alignment\.center,\n\s+fit: StackFit\.expand,/);
  assert.match(code, /ListView\(\n\s+children: <Widget>\[/);
});

test('output is deterministic', () => {
  const source = ['screen Home:', '    state a: int = 0', '    column gap=4:', '        text a', ''].join('\n');
  assert.equal(generate(source), generate(source));
});

test('nothing is generated when there are errors', () => {
  const result = compileSource(['screen Home:', '    colum:', '        text "x"', ''].join('\n'));
  assert.equal(result.code, undefined);
  assert.equal(result.ok, false);
});

test('icon names are translated to the Material spelling', () => {
  // `Icons.heart` does not exist; `Icons.favorite` does. A DSL whose icon names are guessable has
  // to carry the translation, and a name that is already correct must pass through untouched.
  const code = generate(
    ['screen Home:', '    row:', '        icon heart color=#dc2626', '        icon search', '        icon "photo_camera"', ''].join('\n'),
  );
  assert.match(code, /Icon\(Icons\.favorite/);
  assert.match(code, /Icon\(Icons\.search/);
  assert.match(code, /Icon\(Icons\.photo_camera/);
  assert.match(code, /^import 'package:flutter\/material\.dart';$/m);
  assert.doesNotMatch(code, /services\.dart/, 'material.dart already provides TextInputType');
});
