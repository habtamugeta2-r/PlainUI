import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSource } from '../src/project/compile.ts';
import { FLUTTER_TARGET, HTML_TARGET } from '../src/targets/index.ts';

function compile(source: string, target = FLUTTER_TARGET) {
  return compileSource(source, { path: 'optional.pui', target });
}

function codes(source: string, target = FLUTTER_TARGET): string[] {
  return compile(source, target).diagnostics.map((diagnostic) => diagnostic.code);
}

test('Optional values lower to native nullable types and explicit accessors', () => {
  const source = [
    'screen Profile:',
    '    state nickname: Optional<Text> = null',
    '    state age: Optional<Int> = 42',
    '    column:',
    '        if nickname.exists:',
    '            text nickname.orElse("Guest")',
    '        text age.orElse(18)',
    "        text \"Hello ${nickname.orElse('Guest')}\"",
    '        text "Has age? ${age.exists}"',
    '',
  ].join('\n');
  const result = compile(source);
  assert.equal(result.ok, true, result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  assert.match(result.code ?? '', /String\? nickname = null;/);
  assert.match(result.code ?? '', /int\? age = 42;/);
  assert.match(result.code ?? '', /if \(\(nickname != null\)\)/);
  assert.match(result.code ?? '', /\(nickname \?\? "Guest"\)/);
  assert.match(result.code ?? '', /\(age \?\? 18\)/);
  assert.match(result.code ?? '', /Hello \$\{\(nickname \?\? 'Guest'\)\}/);
  assert.match(result.code ?? '', /Has age\? \$\{\(age != null\)\}/);
});

test('an exists branch narrows the Optional to its inner value', () => {
  const source = [
    'screen Profile:',
    '    state nickname: Optional<Text> = "Ada"',
    '    if nickname.exists:',
    '        text nickname',
    '',
  ].join('\n');
  const result = compile(source);
  assert.equal(result.ok, true, result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  assert.match(result.code ?? '', /if \(\(nickname != null\)\)/);
  assert.match(result.code ?? '', /Text\(nickname!\)/);
});

test('an Optional can be forwarded through typed host boundaries', () => {
  const source = [
    'import "../profile.dart" as profile:',
    '    loadNickname() -> Optional<Text>',
    '    greet(name: Optional<Text>) -> Text',
    '',
    'screen Home:',
    '    state nickname: Optional<Text> = profile.loadNickname()',
    '    column:',
    '        text profile.greet(name=nickname)',
    '        text nickname.orElse("Anonymous")',
    '',
  ].join('\n');
  const result = compile(source);
  assert.equal(result.ok, true, result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  assert.match(result.code ?? '', /profile\.loadNickname\(\)/);
  assert.match(result.code ?? '', /profile\.greet\(name: nickname\)/);
});

test('an Optional must be handled before it is used as an ordinary value', () => {
  const source = ['screen Home:', '    state nickname: Optional<Text> = null', '    text nickname', ''].join('\n');
  assert.ok(codes(source).includes('PUI2365'));
});

test('null is accepted only when an Optional type is expected', () => {
  const absent = ['screen Home:', '    state nickname: Optional<Text> = null', '    text nickname.orElse("Guest")', ''].join('\n');
  assert.equal(codes(absent).some((code) => code === 'PUI2365'), false);

  const implicit = ['screen Home:', '    state nickname: Text = null', '    text "Guest"', ''].join('\n');
  assert.ok(codes(implicit).includes('PUI2365'));
});

test('Optional rejects unknown members and incompatible fallbacks', () => {
  const member = ['screen Home:', '    state age: Optional<Int> = null', '    text age.value', ''].join('\n');
  assert.ok(codes(member).includes('PUI2366'));

  const fallback = ['screen Home:', '    state age: Optional<Int> = null', '    text age.orElse("unknown")', ''].join('\n');
  assert.ok(codes(fallback).includes('PUI2367'));
});

test('Optional needs an explicit element type', () => {
  const source = ['screen Home:', '    state value: Optional = null', '    text "none"', ''].join('\n');
  assert.ok(codes(source).includes('PUI2368'));
});

test('the HTML preview evaluates Optional accessors without inventing data', () => {
  const source = [
    'screen Home:',
    '    state value: Optional<Text> = null',
    '    column:',
    '        if value.exists:',
    '            text "present"',
    '        else:',
    '            text value.orElse("fallback")',
    "            text \"${value.orElse('preview fallback')}\"",
    '        text "${value.exists}"',
    '',
  ].join('\n');
  const result = compile(source, HTML_TARGET);
  assert.equal(result.ok, true, result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  assert.match(result.code ?? '', /fallback/);
  assert.match(result.code ?? '', /preview fallback/);
  assert.match(result.code ?? '', />false</);
});
