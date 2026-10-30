/**
 * `form`: validation as a construct.
 *
 * The value of this feature is not the widget it generates — `Form` and `TextFormField` already
 * exist. It is that validation cannot be forgotten: `submit()` is the only way to run a form's
 * handler, and the compiler emits the gate around it. These tests pin the generated gate, the
 * per-field validators, and every way the pieces can be put together wrongly.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { check } from '../src/analysis/check.ts';
import { generateHtml } from '../src/codegen/html.ts';
import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { compileOne } from '../src/project/project.ts';
import { codes } from './helpers.ts';

const SIGNUP = [
  'screen Signup:',
  '',
  '    state email: String = ""',
  '    state password: String = ""',
  '    state feedback: String = ""',
  '',
  '    form:',
  '',
  '        column padding=20 gap=12:',
  '',
  '            input bind=email validate=[required, email] label="Email"',
  '            input bind=password validate=[required, min(8)] label="Password" secret',
  '            button "Create account":',
  '                on tap: submit()',
  '',
  '        on submit:',
  '            set feedback = "Welcome, ${email}"',
  '',
].join('\n');

function compile(text: string) {
  return compileOne('signup.pui', text);
}

function errors(text: string): string[] {
  return compile(text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code);
}

function warnings(text: string): string[] {
  return compile(text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')
    .map((diagnostic) => diagnostic.code);
}

function hints(text: string): string[] {
  return compile(text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.hint ?? '');
}

function screen(...body: readonly string[]): string {
  return ['screen Home:', '', '    state email: String = ""', '', ...body, ''].join('\n');
}

// ---------------------------------------------------------------------------------------------
// The generated gate
// ---------------------------------------------------------------------------------------------

test('a form compiles to a Form with one generated key', () => {
  const result = compile(SIGNUP);
  assert.deepEqual(errors(SIGNUP), []);
  const code = result.code!;

  assert.match(code, /class Signup extends StatefulWidget \{/);
  assert.match(code, /final GlobalKey<FormState> _puiFormKey = GlobalKey<FormState>\(\);/);
  assert.match(code, /return Form\(\n\s*key: _puiFormKey,/);
});

test('a form makes an otherwise stateless screen stateful, because the key is state', () => {
  const code = compile(
    screen(
      '    form:',
      '',
      '        input bind=email validate=required',
      '        button "Go":',
      '            on tap: submit()',
      '',
      '        on submit:',
      '            log(email)',
    ),
  ).code!;
  assert.match(code, /class Home extends StatefulWidget \{/);
  assert.match(code, /int|String email = "";|String email = "";/);
});

test('submit() expands to validate-then-run, not a call to a method', () => {
  const code = compile(SIGNUP).code!;
  // The gate wraps the handler body, so a later edit cannot call the body without validating.
  assert.match(code, /if \(_puiFormKey\.currentState!\.validate\(\)\) \{/);
  assert.match(code, /setState\(\(\) \{\s*feedback = "Welcome, \$\{email\}";\s*\}\);/);
});

test('an input inside a form becomes a TextFormField with a validator', () => {
  const code = compile(SIGNUP).code!;
  assert.equal(code.match(/TextFormField\(/g)?.length, 2);
  assert.equal(code.match(/validator: \(value\) \{/g)?.length, 2);
  // Required first, then the rule, then the success path.
  assert.match(code, /if \(text\.isEmpty\) \{\s*return 'This field is required';\s*\}/);
  assert.match(code, /if \(!_puiEmailPattern\.hasMatch\(text\)\) \{\s*return 'Enter a valid email address';\s*\}/);
  assert.match(code, /if \(text\.length < 8\) \{\s*return 'Use at least 8 characters';\s*\}/);
  // The email pattern is emitted once for the whole file, not once per field.
  assert.equal(code.match(/final RegExp _puiEmailPattern/g)?.length, 1);
});

test('an optional field lets an empty value through instead of failing its other rules', () => {
  const code = compile(screen('    form:', '', '        input bind=email validate=min(8)', '', '        on submit:', '            log(email)')).code!;
  assert.match(code, /if \(text\.isEmpty\) \{\s*return null;/);
  assert.doesNotMatch(code, /This field is required/);
});

test('validators map to their rules, in the order they are written', () => {
  const code = compile(
    screen(
      '    form:',
      '',
      '        input bind=email validate=[required, min(3), max(10), pattern("^[a-z]+$")]',
      '',
      '        on submit:',
      '            log(email)',
    ),
  ).code!;
  const order = ['text.isEmpty', 'text.length < 3', 'text.length > 10', 'RegExp(r\'^[a-z]+$\')'].map((needle) => code.indexOf(needle));
  assert.ok(order.every((index) => index > 0), `missing a validator rule: ${order.join(', ')}`);
  assert.deepEqual([...order].sort((left, right) => left - right), order, 'validators run in source order');
});

test('two forms in one screen get one key each', () => {
  const code = compile(
    screen(
      '    form:',
      '',
      '        input bind=email validate=required',
      '        button "A":',
      '            on tap: submit()',
      '',
      '        on submit:',
      '            log(email)',
      '',
      '    form:',
      '',
      '        input bind=email validate=email',
      '        button "B":',
      '            on tap: submit()',
      '',
      '        on submit:',
      '            log(email)',
    ),
  ).code!;
  assert.match(code, /_puiFormKey = GlobalKey<FormState>\(\)/);
  assert.match(code, /_puiFormKey2 = GlobalKey<FormState>\(\)/);
  // Each submit() validates the form it is written in.
  assert.equal(code.match(/currentState!\.validate\(\)/g)?.length, 2);
});

// ---------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------

test('submit() outside a form is refused', () => {
  assert.deepEqual(errors(screen('    column:', '', '        button "Go":', '            on tap: submit()')), ['PUI2331']);
  assert.match(hints(screen('    column:', '', '        button "Go":', '            on tap: submit()')).join(' '), /wrap the fields and the button in a form/);
});

test('validate= outside a form is refused', () => {
  assert.deepEqual(errors(screen('    column:', '', '        input bind=email validate=required')), ['PUI2332']);
});

test('a form with a submit() but no handler is refused', () => {
  const text = screen(
    '    form:',
    '',
    '        input bind=email validate=required',
    '        button "Go":',
    '            on tap: submit()',
  );
  assert.deepEqual(errors(text), ['PUI2333']);
});

test('a handler nothing triggers, and a form that validates nothing, are warnings', () => {
  const unusedHandler = screen(
    '    form:',
    '',
    '        input bind=email validate=required',
    '',
    '        on submit:',
    '            log(email)',
  );
  assert.deepEqual(warnings(unusedHandler), ['PUI2408']);

  const noFields = screen(
    '    form:',
    '',
    '        input bind=email',
    '        button "Go":',
    '            on tap: submit()',
    '',
    '        on submit:',
    '            log(email)',
  );
  assert.deepEqual(warnings(noFields), ['PUI2409']);
});

test('submit() inside the form’s own handler would recurse, and is refused', () => {
  const text = screen(
    '    form:',
    '',
    '        input bind=email validate=required',
    '        button "Go":',
    '            on tap: submit()',
    '',
    '        on submit:',
    '            submit()',
  );
  assert.ok(errors(text).includes('PUI2334'), `expected PUI2334, got ${errors(text).join(', ')}`);
});

test('a form inside a form is refused', () => {
  const text = screen(
    '    form:',
    '',
    '        form:',
    '',
    '            input bind=email validate=required',
    '',
    '        on submit:',
    '            log(email)',
  );
  assert.ok(errors(text).includes('PUI2335'), `expected PUI2335, got ${errors(text).join(', ')}`);
});

test('submit() takes no arguments, and has no value', () => {
  const withArgs = screen(
    '    form:',
    '',
    '        input bind=email validate=required',
    '        button "Go":',
    '            on tap: submit(email)',
    '',
    '        on submit:',
    '            log(email)',
  );
  assert.deepEqual(errors(withArgs), ['PUI2336']);

  const asValue = screen(
    '    state done: bool = false',
    '',
    '    form:',
    '',
    '        input bind=email validate=required',
    '        button "Go":',
    '            on tap: set done = submit()',
    '',
    '        on submit:',
    '            log(email)',
  );
  assert.ok(errors(asValue).includes('PUI2331'), `expected PUI2331, got ${errors(asValue).join(', ')}`);
});

test('validators are checked by name and by argument', () => {
  const field = (validate: string): string =>
    screen('    form:', '', `        input bind=email validate=${validate}`, '', '        on submit:', '            log(email)');

  assert.deepEqual(errors(field('email')), []);
  assert.deepEqual(errors(field('[required, min(8)]')), []);

  // A misspelt name is a suggestion, not a silent no-op.
  assert.deepEqual(errors(field('emial')), ['PUI2330']);
  assert.match(hints(field('emial')).join(' '), /email/);

  // Arguments are part of the validator: `min` needs a number, `pattern` a literal.
  assert.deepEqual(errors(field('min("8")')), ['PUI2330']);
  assert.deepEqual(errors(field('min()')), ['PUI2330']);
  assert.deepEqual(errors(field('min(8, 9)')), ['PUI2330']);
  assert.deepEqual(errors(field('pattern(2)')), ['PUI2330']);
  assert.deepEqual(errors(field('required(1)')), ['PUI2330']);
});

// ---------------------------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------------------------

test('the preview marks the form and the rules each field carries', () => {
  const file = sourceFile('signup.pui', SIGNUP);
  const { program } = parse(file);
  const analysis = check(file, program, {}).analysis;
  const html = generateHtml(analysis).code;

  assert.match(html, /<div class="pui-form" data-form="required email min\(8\)"/);
  // `required` and `pattern` are things HTML can enforce by itself, so they become attributes.
  assert.match(html, /<input type="text" required="required" data-validate="required email"/);
  assert.match(html, /data-validate="required min\(8\)"/);

  const patterned = screen('    form:', '', '        input bind=email validate=pattern("^[a-z]+$")', '', '        on submit:', '            log(email)');
  const patternedFile = sourceFile('p.pui', patterned);
  const patternedProgram = parse(patternedFile).program;
  const patternedHtml = generateHtml(check(patternedFile, patternedProgram, {}).analysis).code;
  assert.match(patternedHtml, /pattern="\^\[a-z\]\+\$"/);
});

test('the preview still renders a plain input as it always did', () => {
  const text = screen('    column:', '', '        input bind=email label="Email"');
  const file = sourceFile('one.pui', text);
  const { program } = parse(file);
  const html = generateHtml(check(file, program, {}).analysis).code;
  assert.doesNotMatch(html, /pui-form/);
  assert.doesNotMatch(html, /required/);
});

test('the form parses into an element whose submit handler is an event', () => {
  const file = sourceFile('signup.pui', SIGNUP);
  const { program, bag } = parse(file);
  assert.deepEqual(codes(bag.diagnostics), []);
  const target = program.decls.find((decl) => decl.kind === 'Screen')!;
  assert.ok(target.kind === 'Screen');
  const form = target.body.find((node) => node.kind === 'Element' && node.tag === 'form');
  assert.ok(form !== undefined && form.kind === 'Element');
  assert.deepEqual(form.events.map((event) => event.name), ['submit']);
  assert.deepEqual(form.events[0]!.actions.map((action) => action.kind), ['Set']);
});

test('an awaiting submit body makes the button closure async', () => {
  // `submit()` inlines the form's `on submit:` body at the call site, so an `await` inside that body
  // lands inside the button's closure — which therefore has to be emitted as `async`. Without this
  // the generated Dart is `await` inside a non-async function, and only the analyzer notices.
  const source = [
    'screen Comment:',
    '',
    '    state note: String = ""',
    '',
    '    form:',
    '',
    '        column gap=8:',
    '',
    '            input bind=note label="Comment" validate=[required]',
    '            button "Post":',
    '                on tap: submit()',
    '',
    '        on submit:',
    '            await saveComment(note)',
    '',
  ].join('\n');
  const result = compile(source);
  assert.deepEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code),
    [],
  );
  assert.match(result.code ?? '', /onPressed: \(\) async \{/);
  assert.match(result.code ?? '', /await saveComment\(note\);/);
});

test('a submit body with nothing to await stays synchronous', () => {
  const result = compile(SIGNUP);
  assert.match(result.code ?? '', /onPressed: \(\) \{/);
  assert.doesNotMatch(result.code ?? '', /onPressed: \(\) async \{/);
});
