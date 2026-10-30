/**
 * The registry is the single source of truth for what an element is: its arguments, properties,
 * children policy and events. These tests keep it honest and keep the generated documentation in
 * step with it.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileSource } from '../src/compile.ts';
import { CODES } from '../src/diagnostics.ts';
import { parse } from '../src/parser.ts';
import { sourceFile } from '../src/source.ts';
import { renderDiagnostics, renderReference, severitiesInSource } from '../scripts/gen-reference.ts';
import {
  GENERIC_EVENTS,
  UNIVERSAL_PROPS,
  WIDGETS,
  WIDGET_TAGS,
  eventsFor,
  propsFor,
  widgetSpec,
} from '../src/widgets/registry.ts';

test('every tag is lowercase, unique and documented', () => {
  const seen = new Set<string>();
  for (const spec of WIDGETS.values()) {
    // Built-in tags start lowercase (`column`, `safeArea`); a capitalised name would be a
    // component or a host widget instead.
    assert.equal(spec.tag[0], spec.tag[0]!.toLowerCase(), `${spec.tag} must start with a lowercase letter`);
    assert.match(spec.tag, /^[a-z][a-zA-Z0-9]*$/, `${spec.tag} is not a valid tag name`);
    assert.equal(seen.has(spec.tag), false, `duplicate tag ${spec.tag}`);
    seen.add(spec.tag);
    assert.ok(spec.summary.endsWith('.'), `${spec.tag} needs a summary ending in a full stop`);
    assert.ok(spec.group.length > 0, `${spec.tag} needs a group`);
  }
  assert.equal(seen.size, WIDGET_TAGS.length);
  assert.equal(widgetSpec('column')?.tag, 'column');
  assert.equal(widgetSpec('not-a-widget'), undefined);
});

test('a spec has no duplicate arguments, properties or events', () => {
  for (const spec of WIDGETS.values()) {
    const args = spec.args.map((arg) => arg.name);
    assert.equal(new Set(args).size, args.length, `${spec.tag} has duplicate arguments`);
    const props = spec.props.map((prop) => prop.name);
    assert.equal(new Set(props).size, props.length, `${spec.tag} has duplicate properties`);
    const events = eventsFor(spec);
    assert.equal(new Set(events).size, events.length, `${spec.tag} lists an event twice`);
  }
});

test('universal properties are available everywhere, once', () => {
  const universalNames = UNIVERSAL_PROPS.map((prop) => prop.name);
  assert.equal(new Set(universalNames).size, universalNames.length);

  for (const spec of WIDGETS.values()) {
    const names = propsFor(spec).map((prop) => prop.name);
    for (const name of universalNames) {
      assert.ok(names.includes(name), `${spec.tag} is missing the universal property ${name}`);
    }
    assert.equal(names.filter((name) => name === 'padding').length, 1, `${spec.tag} repeats padding`);
  }
});

test('generic gestures are available everywhere', () => {
  for (const spec of WIDGETS.values()) {
    for (const gesture of GENERIC_EVENTS) {
      assert.ok(eventsFor(spec).includes(gesture), `${spec.tag} cannot handle ${gesture}`);
    }
  }
});

test('every documented example parses without diagnostics', () => {
  for (const spec of WIDGETS.values()) {
    // Examples are body fragments, so they are documented and compiled inside a screen.
    const body = spec.example
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    // Examples may refer to the state a real screen would declare, so the wrapper declares the
    // names the documentation uses.
    const preamble = [
      'screen DocExample:',
      '    // The state the documented examples bind to.',
      '    state items: List<String> = ["a", "b"]',
      '    state email: String = ""',
      '    state notifications: bool = true',
      '    state remember: bool = false',
      '    state volume: double = 0.5',
      '',
    ].join('\n');
    const source = `${preamble}${body}\n`;
    const file = sourceFile(`${spec.tag}.pui`, source);
    const parsed = parse(file);
    assert.equal(parsed.bag.hasErrors, false, `the example for ${spec.tag} does not parse`);
    const result = compileSource(source, { path: `${spec.tag}.pui` });
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    assert.deepEqual(
      errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
      [],
      `the example for ${spec.tag} does not compile`,
    );
    assert.ok(spec.example.includes(spec.tag), `the example for ${spec.tag} does not use it`);
  }
});

test('every diagnostic code is used by the compiler', () => {
  const severities = severitiesInSource();
  const unused = Object.keys(CODES).filter((code) => !severities.has(code));
  assert.deepEqual(unused, [], 'these codes are in the catalogue but never raised');
});

test('the generated documentation is up to date', () => {
  assert.equal(
    readFileSync('docs/07-reference.md', 'utf8'),
    renderReference(),
    'docs/07-reference.md is stale — run npm run docs:ref',
  );
  assert.equal(
    readFileSync('docs/05-diagnostics.md', 'utf8'),
    renderDiagnostics(),
    'docs/05-diagnostics.md is stale — run npm run docs:ref',
  );
});
