import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAINUI_TYPE_ALIASES, toDartTypeText, typeFromText, typeToText } from '../src/frontend/ast.ts';

// PlainUI's own type vocabulary (decision A1, docs/10-decisions.md) parses to the same semantic
// `UiType` as the Dart spelling it aliases.

test('typeFromText accepts PlainUI spellings as aliases of the Dart ones', () => {
  assert.equal(typeFromText('Text').kind, 'string');
  assert.equal(typeFromText('Int').kind, 'int');
  assert.equal(typeFromText('Float').kind, 'double');
  assert.equal(typeFromText('Bool').kind, 'bool');
  assert.deepEqual(typeFromText('Text'), typeFromText('String'));
  assert.deepEqual(typeFromText('Int'), typeFromText('int'));
  assert.deepEqual(typeFromText('Float'), typeFromText('double'));
  assert.deepEqual(typeFromText('Bool'), typeFromText('bool'));
});

test('typeFromText accepts Optional<T>, including nested and bare Optional', () => {
  const maybeInt = typeFromText('Optional<Int>');
  assert.equal(maybeInt.kind, 'nullable');
  assert.equal(maybeInt.kind === 'nullable' ? maybeInt.inner.kind : undefined, 'int');

  const listOfMaybeText = typeFromText('List<Optional<Text>>');
  assert.equal(listOfMaybeText.kind, 'list');
  const element = listOfMaybeText.kind === 'list' ? listOfMaybeText.element : undefined;
  assert.equal(element?.kind, 'nullable');
  assert.equal(element?.kind === 'nullable' ? element.inner.kind : undefined, 'string');

  const bare = typeFromText('Optional');
  assert.equal(bare.kind, 'nullable');
  assert.equal(bare.kind === 'nullable' ? bare.inner.kind : undefined, 'dynamic');
});

test('PLAINUI_TYPE_ALIASES documents PlainUI spelling -> Dart spelling for the primitives', () => {
  assert.equal(PLAINUI_TYPE_ALIASES.get('Text'), 'String');
  assert.equal(PLAINUI_TYPE_ALIASES.get('Int'), 'int');
  assert.equal(PLAINUI_TYPE_ALIASES.get('Float'), 'double');
  assert.equal(PLAINUI_TYPE_ALIASES.get('Bool'), 'bool');
});

test('typeToText keeps emitting Dart spellings regardless of which alias was parsed', () => {
  assert.equal(typeToText(typeFromText('Int')), 'int');
  assert.equal(typeToText(typeFromText('Text')), 'String');
  assert.equal(typeToText(typeFromText('Float')), 'double');
  assert.equal(typeToText(typeFromText('Bool')), 'bool');
});

// `toDartTypeText` is the surgical rewrite codegen uses on a *raw* annotation (as opposed to
// round-tripping through the semantic `UiType`, which is lossy for List/Iterable/Set/Map).

test('toDartTypeText rewrites the four PlainUI primitives to their Dart spelling', () => {
  assert.equal(toDartTypeText('Text'), 'String');
  assert.equal(toDartTypeText('Int'), 'int');
  assert.equal(toDartTypeText('Float'), 'double');
  assert.equal(toDartTypeText('Bool'), 'bool');
});

test('toDartTypeText leaves existing Dart-spelled annotations untouched', () => {
  assert.equal(toDartTypeText('String'), 'String');
  assert.equal(toDartTypeText('int'), 'int');
  assert.equal(toDartTypeText('double?'), 'double?');
  assert.equal(toDartTypeText('List<String>'), 'List<String>');
  assert.equal(toDartTypeText('Iterable<int>'), 'Iterable<int>');
  assert.equal(toDartTypeText('Set<String>'), 'Set<String>');
  assert.equal(toDartTypeText('Map<String, dynamic>'), 'Map<String, dynamic>');
  assert.equal(toDartTypeText('DateTime'), 'DateTime');
  assert.equal(toDartTypeText('MyModel'), 'MyModel');
});

test('toDartTypeText does not corrupt identifiers that merely contain a primitive name', () => {
  assert.equal(toDartTypeText('TextStyle'), 'TextStyle');
  assert.equal(toDartTypeText('FloatValue'), 'FloatValue');
  assert.equal(toDartTypeText('List<TextStyle>'), 'List<TextStyle>');
});

test('toDartTypeText unwraps Optional<T> into a trailing ?, including nested occurrences', () => {
  assert.equal(toDartTypeText('Optional<Int>'), 'int?');
  assert.equal(toDartTypeText('Optional<Text>'), 'String?');
  assert.equal(toDartTypeText('Optional<DateTime>'), 'DateTime?');
  assert.equal(toDartTypeText('List<Optional<Int>>'), 'List<int?>');
  assert.equal(toDartTypeText('Optional<List<Text>>'), 'List<String>?');
  assert.equal(toDartTypeText('Optional'), 'dynamic?');
});
