/**
 * The target contract.
 *
 * Two things are tested here, and the second is the reason the interface exists at all.
 *
 * 1. **Completeness.** Every target answers for every capability, so "this target cannot do that"
 *    is a decision someone made rather than an entry nobody wrote.
 * 2. **Neutrality.** The checker follows the target it is given. The same `.pui` file is legal for
 *    one target and not for another, with a message that names *that* target — which is only
 *    possible if the front end asks instead of assuming.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { check } from '../src/analysis/check.ts';
import { compileSource } from '../src/project/compile.ts';
import { compileOne } from '../src/project/project.ts';
import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { typeTextForTarget, typeToTargetText } from '../src/codegen/types.ts';
import { DYNAMIC, INT, STRING, typeFromText } from '../src/frontend/ast.ts';
import {
  CAPABILITIES,
  DEFAULT_TARGET,
  FLUTTER_TARGET,
  HTML_TARGET,
  TARGETS,
  fullySupports,
  supports,
  targetById,
  targetIds,
} from '../src/targets/index.ts';

function codesOf(text: string, target = FLUTTER_TARGET): string[] {
  const file = sourceFile('target.pui', text);
  const { program } = parse(file);
  return check(file, program, { target }).bag.sorted().map((diagnostic) => diagnostic.code);
}

function messagesOf(text: string, target = FLUTTER_TARGET): string {
  const file = sourceFile('target.pui', text);
  const { program } = parse(file);
  return check(file, program, { target })
    .bag.sorted()
    .map((diagnostic) => `${diagnostic.code} ${diagnostic.message} ${diagnostic.hint ?? ''}`)
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

test('every target answers for every capability', () => {
  for (const target of TARGETS.values()) {
    assert.deepEqual(
      Object.keys(target.capabilities).sort(),
      [...CAPABILITIES].sort(),
      `${target.id} does not answer for exactly the capabilities in CAPABILITIES`,
    );
    for (const capability of CAPABILITIES) {
      const note = target.capabilities[capability];
      assert.ok(note.note.length > 10, `${target.id}.${capability} needs a real sentence, not a placeholder`);
      assert.ok(note.note.trim().endsWith('.'), `${target.id}.${capability} needs a sentence that ends`);
    }
  }
});

test('every target owns a complete, distinct map for PlainUI types', () => {
  const requiredNames = ['Text', 'Int', 'Float', 'Bool', 'Color', 'Duration', 'Num', 'Dynamic'];
  for (const target of TARGETS.values()) {
    for (const name of requiredNames) {
      assert.equal(typeof target.types.names[name], 'string', `${target.id} needs a mapping for ${name}`);
      assert.ok(target.types.names[name]!.length > 0, `${target.id}.${name} cannot map to an empty type`);
    }
    for (const constructor of ['List', 'Iterable', 'Set', 'Map', 'Future'] as const) {
      assert.ok(target.types.generics[constructor], `${target.id} needs a ${constructor} mapping`);
    }
    assert.ok(target.types.optional, `${target.id} needs an Optional mapping`);
  }
  assert.notEqual(FLUTTER_TARGET.types, HTML_TARGET.types);
  assert.equal(FLUTTER_TARGET.types.names.Text, 'String');
  assert.equal(HTML_TARGET.types.names.Text, 'string');
});

test('semantic and annotated types render through the selected target map', () => {
  assert.equal(typeToTargetText(STRING, FLUTTER_TARGET.types), 'String');
  assert.equal(typeToTargetText(INT, FLUTTER_TARGET.types), 'int');
  assert.equal(typeToTargetText(DYNAMIC, FLUTTER_TARGET.types), 'dynamic');
  assert.equal(typeToTargetText(typeFromText('Optional<Int>'), FLUTTER_TARGET.types), 'int?');
  assert.equal(typeToTargetText(typeFromText('Optional<Optional<Int>>'), FLUTTER_TARGET.types), 'int?');
  assert.equal(typeToTargetText(typeFromText('List<Optional<Text>>'), FLUTTER_TARGET.types), 'List<String?>');
  assert.equal(typeToTargetText(typeFromText('Optional<List<Text>>'), FLUTTER_TARGET.types), 'List<String>?');
  assert.equal(typeToTargetText(typeFromText('Color'), FLUTTER_TARGET.types), 'Color');
  assert.equal(typeToTargetText(typeFromText('Duration'), FLUTTER_TARGET.types), 'Duration');

  assert.equal(typeToTargetText(STRING, HTML_TARGET.types), 'string');
  assert.equal(typeToTargetText(INT, HTML_TARGET.types), 'number');
  assert.equal(typeToTargetText(DYNAMIC, HTML_TARGET.types), 'unknown');
  assert.equal(typeToTargetText(typeFromText('Optional<Int>'), HTML_TARGET.types), 'number | null');
  assert.equal(typeToTargetText(typeFromText('Optional<Optional<Int>>'), HTML_TARGET.types), 'number | null');
  assert.equal(typeToTargetText(typeFromText('List<Optional<Text>>'), HTML_TARGET.types), 'Array<string | null>');
  assert.equal(typeToTargetText(typeFromText('Optional<List<Text>>'), HTML_TARGET.types), 'Array<string> | null');
  assert.equal(typeToTargetText(typeFromText('Color'), HTML_TARGET.types), 'string');
  assert.equal(typeToTargetText(typeFromText('Duration'), HTML_TARGET.types), 'number');

  assert.equal(typeTextForTarget('Optional<Optional<Int>>', FLUTTER_TARGET.types), 'int?');
  assert.equal(typeTextForTarget('Optional<Optional<Int>>', HTML_TARGET.types), 'number | null');
  assert.equal(typeTextForTarget('Future<Optional<List<Text>>>', FLUTTER_TARGET.types), 'Future<List<String>?>');
  assert.equal(typeTextForTarget('Future<Optional<List<Text>>>', HTML_TARGET.types), 'Promise<Array<string> | null>');
  assert.equal(typeTextForTarget('Map<String, Optional<Int>>', HTML_TARGET.types), 'Record<string, number | null>');
  assert.equal(typeTextForTarget('DateTime', HTML_TARGET.types), 'DateTime');
});

test('the targets are distinct and addressable by id', () => {
  assert.equal(new Set(targetIds()).size, TARGETS.size);
  for (const id of targetIds()) {
    assert.equal(targetById(id)?.id, id);
    assert.equal(TARGETS.get(id)?.id, id);
  }
  assert.equal(targetById('swiftui'), undefined);
  assert.notEqual(FLUTTER_TARGET.outputExtension, HTML_TARGET.outputExtension);
  assert.notEqual(FLUTTER_TARGET.label, HTML_TARGET.label);
});

test('Flutter is the default target, and it supports the whole language', () => {
  assert.equal(DEFAULT_TARGET.id, 'flutter');
  for (const capability of CAPABILITIES) {
    assert.equal(fullySupports(FLUTTER_TARGET, capability), true, `Flutter should fully support ${capability}`);
  }
});

test('the preview declares exactly what it cannot do', () => {
  // The interesting ones are the absences: a preview has no frames, no Dart and no submit handler.
  assert.equal(supports(HTML_TARGET, 'effects'), false);
  assert.equal(supports(HTML_TARGET, 'host-surfaces'), false);
  assert.equal(fullySupports(HTML_TARGET, 'tasks'), false);
  assert.equal(fullySupports(HTML_TARGET, 'forms'), false);
  assert.equal(fullySupports(HTML_TARGET, 'navigation'), false);
  assert.equal(fullySupports(HTML_TARGET, 'state'), true);
  assert.equal(fullySupports(HTML_TARGET, 'derived'), true);
  assert.equal(fullySupports(HTML_TARGET, 'themes'), true);
});

// ---------------------------------------------------------------------------------------------
// The front end follows the target
// ---------------------------------------------------------------------------------------------

test('a reserved word is judged by the target that reserves it', () => {
  // `style` is an attribute name the preview writes into its output, and nothing in Dart reserves it.
  const htmlWord = ['screen Profile:', '', '    state style: String = ""', '', '    text "${style}"', ''].join('\n');
  assert.equal(codesOf(htmlWord, HTML_TARGET).includes('PUI2012'), true);
  assert.equal(messagesOf(htmlWord, HTML_TARGET).includes('reserved word in HTML'), true);
  assert.equal(codesOf(htmlWord, FLUTTER_TARGET).includes('PUI2012'), false);

  // `late` is a Dart keyword and means nothing to the preview.
  const dartWord = ['screen Profile:', '', '    state late: int = 0', '', '    text "${late}"', ''].join('\n');
  assert.equal(codesOf(dartWord, FLUTTER_TARGET).includes('PUI2012'), true);
  assert.equal(messagesOf(dartWord, FLUTTER_TARGET).includes('reserved word in Dart'), true);
  assert.equal(codesOf(dartWord, HTML_TARGET).includes('PUI2012'), false);
});

test('a shadowed type is judged by the target library', () => {
  // `Card` is a Material class the generated library imports.
  const source = ['screen Card:', '', '    text "Hi"', ''].join('\n');
  assert.equal(codesOf(source, FLUTTER_TARGET).includes('PUI2011'), true);
  assert.equal(messagesOf(source, FLUTTER_TARGET).includes('shadow a Dart type'), true);
  // The preview names nothing in its output, so there is nothing to shadow.
  assert.equal(codesOf(source, HTML_TARGET).includes('PUI2011'), false);
});

test('a type spelling is judged by the target type system', () => {
  // `Integer` is nobody's spelling here; `Int` is PlainUI's own (decision A1) and is not an error.
  const source = ['screen Count:', '', '    state count: Integer = 0', '', '    text "${count}"', ''].join('\n');
  assert.equal(codesOf(source, FLUTTER_TARGET).includes('PUI2206'), true);
  assert.equal(messagesOf(source, FLUTTER_TARGET).includes('not a Dart type'), true);
  // The preview writes no type annotation, so the same file is legal there.
  assert.equal(codesOf(source, HTML_TARGET).includes('PUI2206'), false);
});

test('an enum alias hint comes from the target', () => {
  const source = ['screen Row2:', '', '    row main=spaceBetween:', '', '        text "a"', ''].join('\n');
  assert.equal(messagesOf(source, FLUTTER_TARGET).includes('between'), true);
});

// ---------------------------------------------------------------------------------------------
// Refusing what a target cannot run
// ---------------------------------------------------------------------------------------------

test('an effect is refused by a target with no frames', () => {
  const source = [
    'screen Cart:',
    '',
    '    state total: int = 0',
    '',
    '    effect on total:',
    '        print("changed")',
    '',
    '    text "Total: ${total}"',
    '',
  ].join('\n');
  assert.equal(codesOf(source, FLUTTER_TARGET).includes('PUI2501'), false);
  const html = messagesOf(source, HTML_TARGET);
  assert.match(html, /PUI2501 .*"effect" needs effects, which HTML preview does not have/);
  // The hint is the target's own sentence, so a reader learns *why* rather than just "no".
  assert.match(html, /static page has no frames/);
});

test('a host surface is refused by a target with no runtime', () => {
  const source = [
    'import "../data.dart" as data:',
    '    load(): List<String>',
    '',
    'screen Cart:',
    '',
    '    text "Hi"',
    '',
  ].join('\n');
  assert.equal(codesOf(source, FLUTTER_TARGET).includes('PUI2501'), false);
  assert.match(messagesOf(source, HTML_TARGET), /PUI2501 .*host surface.* HTML preview does not have/);
});

test('the pipeline dispatches on the target', () => {
  const source = ['screen Hello:', '', '    text "Hi"', ''].join('\n');
  const dart = compileSource(source);
  assert.equal(dart.ok, true);
  assert.match(dart.code ?? '', /class Hello/);

  const page = compileSource(source, { target: HTML_TARGET });
  assert.equal(page.ok, true);
  assert.match(page.code ?? '', /^<!doctype html>/i);
  assert.match(page.code ?? '', /data-screen="Hello"/);
  assert.equal(page.imports?.length, 0);
});

test('a project build refuses a target it cannot write a tree for', () => {
  // Honest refusal at the boundary: `build` owns output paths and a route table, which are
  // Flutter-shaped. Silently writing Dart into an `html` build would be the failure mode.
  assert.throws(
    () => compileOne('lib/ui/home.pui', 'screen Home:\n\n    text "Hi"\n', { target: HTML_TARGET }),
    /cannot emit HTML preview yet/,
  );
});

test('every target has an extension the project can write', () => {
  for (const target of TARGETS.values()) {
    assert.match(target.outputExtension, /^\.[a-z]+$/);
  }
});

// ---------------------------------------------------------------------------------------------
// Layering
// ---------------------------------------------------------------------------------------------

test('the front end imports no generator', () => {
  const roots = ['src/frontend', 'src/analysis'];
  const offenders: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const text = readFileSync(full, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.startsWith('import ')) continue;
        if (/from '[^']*codegen\//.test(line)) offenders.push(`${full}: ${line.trim()}`);
        if (/from '[^']*targets\/(flutter|html)\.ts'/.test(line)) offenders.push(`${full}: ${line.trim()}`);
      }
    }
  };
  for (const root of roots) visit(root);
  assert.deepEqual(offenders, [], 'the front end must reach a target through the contract, not a generator');
});

test('the checker reaches framework knowledge through the target', () => {
  // A framework name in the checker would mean the front end had gone back to knowing one target.
  // The guard is about *identifiers and tables*, so the target modules are excluded on purpose.
  const text = readFileSync('src/analysis/check.ts', 'utf8');
  for (const forbidden of ['DART_RESERVED_WORDS', 'FLUTTER_TYPE_NAMES', 'CASE_MISTAKES', 'FLUTTER_ENUM_ALIASES']) {
    assert.equal(text.includes(forbidden), false, `check.ts still uses ${forbidden}; ask the target instead`);
  }
  assert.match(text, /this\.target\.reservedWords/);
  assert.match(text, /this\.target\.shadowedTypes/);
  assert.match(text, /this\.target\.typeSpellings/);
});
