import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComponentDecl, ElementNode, ForNode, IfNode, ScreenDecl, StyleDecl } from '../src/frontend/ast.ts';
import { describeExpr, renderAst } from '../src/tooling/debug.ts';
import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { assertNoErrors, hasError } from './helpers.ts';

function parseText(text: string) {
  return parse(sourceFile('test.pui', text));
}

function screenOf(text: string): ScreenDecl {
  const { program, bag } = parseText(text);
  assertNoErrors(bag);
  const screen = program.decls.find((d) => d.kind === 'Screen');
  assert.ok(screen, 'expected a screen');
  return screen as ScreenDecl;
}

test('parses a screen with state, layout, text, input and an event', () => {
  const text = [
    'screen Login:',
    '',
    '    state email: String = ""',
    '    state password: String = ""',
    '',
    '    column padding=24 gap=16:',
    '',
    '        text "Welcome Back" style=heading',
    '',
    '        input bind=email label="Email"',
    '',
    '        button "Sign In":',
    '            on tap:',
    '                signIn(email, password)',
    '',
  ].join('\n');

  const { program, bag } = parseText(text);
  assertNoErrors(bag);
  assert.equal(renderAst(program), [
    'screen Login',
    '  state email: String = ""',
    '  state password: String = ""',
    '  column padding=24 gap=16',
    '    text "Welcome Back" style=heading',
    '    input bind=email label="Email"',
    '    button "Sign In"',
    '      on tap',
    '        call signIn(email, password)',
    '',
  ].join('\n'));
});

test('parses components with typed, untyped and defaulted parameters', () => {
  const text = [
    'component ProfileCard(user: User, compact: bool = false, onTap):',
    '    card padding=16 radius=12:',
    '        text user.name',
    '',
  ].join('\n');
  const { program, bag } = parseText(text);
  assertNoErrors(bag);
  const component = program.decls[0] as ComponentDecl;
  assert.equal(component.kind, 'Component');
  assert.deepEqual(
    component.params.map((p) => [p.name, p.typeText, p.defaultValue?.kind]),
    [
      ['user', 'User', undefined],
      ['compact', 'bool', 'Bool'],
      ['onTap', undefined, undefined],
    ],
  );
});

test('parses component call sites with positional and named arguments', () => {
  const text = ['screen Home:', '    ProfileCard(user)', '    ProfileCard(user: user, compact: true)', ''].join('\n');
  const screen = screenOf(text);
  const [first, second] = screen.body as ElementNode[];
  assert.equal(first!.tag, 'ProfileCard');
  assert.equal(first!.callStyle, true);
  assert.equal(first!.args[0]!.name, undefined);
  assert.equal(second!.args[0]!.name, 'user');
  assert.equal(describeExpr(second!.args[0]!.value), 'user');
  assert.equal(second!.args[1]!.name, 'compact');
});

test('parses styles in block and inline form', () => {
  const text = [
    'style heading:',
    '    size=32',
    '    weight=bold',
    '    color=#111111',
    '',
    'style price: size=20 weight=bold',
    '',
    'screen Home:',
    '    text "x" style=heading',
    '',
  ].join('\n');
  const { program, bag } = parseText(text);
  assertNoErrors(bag);
  const [heading, price] = program.decls as StyleDecl[];
  assert.equal(heading!.props.length, 3);
  assert.equal(price!.props.length, 2);
  assert.equal(describeExpr(heading!.props[2]!.value), '#111111');
});

test('binds else to the nearest if, respecting nesting', () => {
  const text = [
    'screen Home:',
    '    if a:',
    '        if b:',
    '            text "both"',
    '    else:',
    '        text "not a"',
    '',
  ].join('\n');
  const screen = screenOf(text);
  const outer = screen.body[0] as IfNode;
  assert.equal(outer.kind, 'If');
  assert.equal(outer.branches.length, 1);
  assert.ok(outer.elseBody, 'outer if should own the else');
  assert.equal((outer.branches[0]!.body[0] as IfNode).elseBody, undefined);
});

test('parses elif chains', () => {
  const text = ['screen Home:', '    if a:', '        text "a"', '    elif b:', '        text "b"', '    else:', '        text "c"', ''].join('\n');
  const screen = screenOf(text);
  const node = screen.body[0] as IfNode;
  assert.equal(node.branches.length, 2);
  assert.equal(node.elseBody?.length, 1);
});

test('parses for loops with and without an index', () => {
  const text = ['screen Home:', '    for product in products:', '        text product.name', '    for i, item in items:', '        text i', ''].join('\n');
  const screen = screenOf(text);
  const [first, second] = screen.body as ForNode[];
  assert.equal(first!.itemName, 'product');
  assert.equal(first!.indexName, undefined);
  assert.equal(second!.indexName, 'i');
  assert.equal(second!.itemName, 'item');
});

test('parses a one-line event handler', () => {
  const screen = screenOf(['screen Home:', '    button "Retry":', '        on tap: retry()', ''].join('\n'));
  const button = screen.body[0] as ElementNode;
  assert.equal(button.events.length, 1);
  assert.equal(button.events[0]!.actions.length, 1);
  assert.equal(button.events[0]!.actions[0]!.kind, 'Call');
});

test('parses multi-action handlers with set, compound assignment and if', () => {
  const text = [
    'screen Counter:',
    '    state count: int = 0',
    '    button "Add":',
    '        on tap:',
    '            set count = count + 1',
    '            set count += 1',
    '            if count > 10:',
    '                set count = 0',
    '            else:',
    '                log(count)',
    '',
  ].join('\n');
  const screen = screenOf(text);
  const button = screen.body[0] as ElementNode;
  const actions = button.events[0]!.actions;
  assert.deepEqual(
    actions.map((a) => a.kind),
    ['Set', 'Set', 'ActionIf'],
  );
  assert.equal((actions[1] as { op: string }).op, '+=');
});

test('parses imports', () => {
  const { program, bag } = parseText(['import "package:my_app/widgets/app_logo.dart"', 'import "./card.pui"', '', 'screen Home:', '    text "x"', ''].join('\n'));
  assertNoErrors(bag);
  assert.deepEqual(
    program.imports.map((i) => i.path),
    ['package:my_app/widgets/app_logo.dart', './card.pui'],
  );
});

test('expression precedence and shape', () => {
  const screen = screenOf(['screen Home:', '    text 1 + 2 * 3', ''].join('\n'));
  const text = screen.body[0] as ElementNode;
  assert.equal(describeExpr(text.args[0]!.value), '(1 + (2 * 3))');
});

test('expression postfix chain: member, call, index', () => {
  const screen = screenOf(['screen Home:', '    text user.posts[0].title.toLowerCase()', ''].join('\n'));
  const text = screen.body[0] as ElementNode;
  assert.equal(describeExpr(text.args[0]!.value), 'user.posts[0].title.toLowerCase()');
});

test('expression ternary, list, unary and await', () => {
  const screen = screenOf(['screen Home:', '    text busy ? -1 : 1', '    text [1, 2, 3]', '    text !done', ''].join('\n'));
  const body = screen.body as ElementNode[];
  assert.equal(describeExpr(body[0]!.args[0]!.value), '(busy ? -1 : 1)');
  assert.equal(describeExpr(body[1]!.args[0]!.value), '[1, 2, 3]');
  assert.equal(describeExpr(body[2]!.args[0]!.value), '!done');
});

test('string interpolation fragments are captured', () => {
  const screen = screenOf(['screen Home:', '    text "Hello ${user.name}, you are ${count + 1}"', ''].join('\n'));
  const text = screen.body[0] as ElementNode;
  const literal = text.args[0]!.value;
  assert.equal(literal.kind, 'String');
  if (literal.kind !== 'String') return;
  assert.deepEqual(
    literal.interpolations.map((i) => i.text),
    ['user.name', 'count + 1'],
  );
});

test('no content may follow ":" on an element line', () => {
  const { bag } = parseText(['screen Home:', '    column: text "a"', ''].join('\n'));
  assert.ok(hasError(bag, 'PUI1010'));
});

test('empty block is reported', () => {
  const { bag } = parseText(['screen Home:', '    column:', '    text "a"', ''].join('\n'));
  assert.ok(hasError(bag, 'PUI1008'));
});

test('orphan else is reported', () => {
  const { bag } = parseText(['screen Home:', '    else:', '        text "a"', ''].join('\n'));
  assert.ok(hasError(bag, 'PUI1013'));
});

test('state without an initial value is reported', () => {
  const { bag } = parseText(['screen Home:', '    state count: int', ''].join('\n'));
  assert.ok(hasError(bag, 'PUI1023'));
});

test('parenthesised arguments on a built-in element are reported', () => {
  const { bag } = parseText(['screen Home:', '    text("hello")', ''].join('\n'));
  assert.ok(hasError(bag, 'PUI1020'));
});

test('missing "in" in a for loop is reported', () => {
  const { bag } = parseText(['screen Home:', '    for item items:', '        text item', ''].join('\n'));
  assert.ok(hasError(bag, 'PUI1007'));
});

test('a declaration nested in a screen is reported', () => {
  const { bag } = parseText(['screen Home:', '    screen Other:', '        text "x"', ''].join('\n'));
  assert.ok(hasError(bag, 'PUI1027'));
});

test('set outside an event handler is reported', () => {
  const { bag } = parseText(['screen Home:', '    set count = 1', ''].join('\n'));
  assert.ok(hasError(bag, 'PUI1026'));
});

test('map literals and casts are rejected as unsupported expressions', () => {
  assert.ok(hasError(parseText(['screen Home:', '    text {a: 1}', ''].join('\n')).bag, 'PUI1021'));
  assert.ok(hasError(parseText(['screen Home:', '    text user as Admin', ''].join('\n')).bag, 'PUI1021'));
});

test('deep nesting keeps a stable shape', () => {
  const text = [
    'screen Home:',
    '    column:',
    '        row:',
    '            stack:',
    '                text "a"',
    '                text "b"',
    '',
  ].join('\n');
  const { program, bag } = parseText(text);
  assertNoErrors(bag);
  assert.equal(renderAst(program), ['screen Home', '  column', '    row', '      stack', '        text "a"', '        text "b"', ''].join('\n'));
});
