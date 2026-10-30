/**
 * The HTML preview target: static HTML and CSS, no runtime.
 *
 * It exists for two reasons. A preview that renders a `.pui` file in a browser is useful on its
 * own, and it is the standing proof that the front end and the element vocabulary are not Flutter:
 * a second generator consumes the same `Analysis` and produces something else entirely.
 *
 * The capabilities are the interesting part. The preview renders state, computed values, lists and
 * navigation (every screen is a `<section>`, links become anchors), and it cannot run a task, an
 * effect, a form submission or a host call — it has no Dart, no runtime and no frames. Saying so
 * here is what lets the compiler refuse those constructs *for this target* instead of emitting a
 * page that looks finished and silently does nothing.
 */

import type { Target } from './contract.ts';

/**
 * Words the preview's output uses as attribute and element names. A `.pui` name that collides with
 * one of them would make the generated `id` ambiguous, so they are refused for this target the
 * same way Dart keywords are refused for Flutter.
 */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'body', 'class', 'dir', 'head', 'hidden', 'html', 'id', 'lang', 'script', 'style', 'title',
]);

export const HTML_TARGET: Target = {
  id: 'html',
  label: 'HTML preview',
  language: 'HTML',
  outputExtension: '.html',
  hostExtensions: [],
  reservedWords: RESERVED_WORDS,
  // The preview names nothing in its output, so there is no library for a `.pui` name to shadow.
  shadowedTypes: new Set<string>(),
  // A `.pui` type annotation is not written into the preview, so a near-miss spelling is not an
  // error there; the front end still reports it through `typeSpellings` when the target has one.
  typeSpellings: {},
  enumAliases: {},
  capabilities: {
    state: { level: 'full', note: 'The initial value of every state is rendered.' },
    derived: { level: 'full', note: 'Derived values are evaluated once, in declaration order, with the initial state.' },
    effects: {
      level: 'none',
      note: 'An effect runs after a frame; a static page has no frames. The initial state is what you see.',
    },
    tasks: {
      level: 'partial',
      note: 'A task renders its not-yet-loaded state: the empty list or the null value, never a result.',
    },
    forms: {
      level: 'partial',
      note: 'Inputs and their rules render, but nothing validates: there is no submit handler to run.',
    },
    navigation: {
      level: 'partial',
      note: 'Every screen renders as a section addressed by an anchor, so navigation is a jump, not a push.',
    },
    'host-surfaces': {
      level: 'none',
      note: 'There is no Dart runtime, so a host call cannot run and a host widget renders as a placeholder.',
    },
    themes: { level: 'full', note: 'Tokens are published as CSS custom properties and used by the generated styles.' },
    'list-identity': {
      level: 'partial',
      note: 'Keys are rendered as `data-key` attributes for inspection; a static list has no element state to keep.',
    },
  },
};
