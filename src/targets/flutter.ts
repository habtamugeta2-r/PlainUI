/**
 * The Flutter target: Dart as the output language, `package:flutter/material.dart` as the library.
 *
 * Everything here is knowledge the *front end* needs before generating anything — which names are
 * illegal, which type names would shadow the library, which spellings are wrong — plus the honest
 * statement of what Flutter can express. The generator's own maps (constructor names, argument
 * names, icon names) stay in `codegen/flutter.ts`, because those are only needed once a program has
 * been accepted.
 */

import type { Target } from './contract.ts';

/** Dart keywords and reserved words that cannot be used as screen/component/state names. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'abstract', 'as', 'assert', 'async', 'await', 'base', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export',
  'extends', 'extension', 'external', 'factory', 'false', 'final', 'finally', 'for', 'Function',
  'get', 'hide', 'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library', 'mixin',
  'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow', 'return', 'sealed', 'set', 'show',
  'static', 'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'type', 'typedef', 'var',
  'void', 'when', 'while', 'with', 'yield',
]);

/**
 * Flutter types the generated code may reference. A screen or component with one of these names
 * would shadow the type inside the generated library and silently change the meaning of the
 * output, so they are rejected.
 */
const SHADOWED_TYPES: ReadonlySet<string> = new Set([
  'Align', 'Alignment', 'AppBar', 'Border', 'BorderRadius', 'BoxDecoration', 'BoxFit', 'BuildContext',
  'Card', 'Center', 'Checkbox', 'ClipRRect', 'Color', 'Colors', 'Column', 'Container',
  'CrossAxisAlignment', 'Divider', 'EdgeInsets', 'ElevatedButton', 'Expanded', 'Flexible', 'FontWeight',
  'Form', 'GestureDetector', 'GridView', 'Icon', 'Icons', 'Image', 'InputDecoration', 'LinearProgressIndicator',
  'ListTile', 'ListView', 'MainAxisAlignment', 'MaterialApp', 'MouseRegion', 'Navigator', 'Opacity',
  'OutlinedButton', 'Padding', 'ProgressIndicator', 'Row', 'SafeArea', 'Scaffold', 'Scrollbar', 'SingleChildScrollView',
  'SizedBox', 'Slider', 'Spacer', 'Stack', 'StatelessWidget', 'State', 'StatefulWidget', 'Switch',
  'Text', 'TextAlign', 'TextButton', 'TextEditingController', 'TextField', 'TextOverflow', 'TextStyle',
  'Theme', 'Visibility', 'Widget', 'Wrap', 'CircularProgressIndicator',
]);

/** Dart core types that people write in another language's capitalisation by mistake. */
const TYPE_SPELLINGS: Readonly<Record<string, string>> = {
  Int: 'int',
  Integer: 'int',
  Double: 'double',
  Float: 'double',
  Bool: 'bool',
  Boolean: 'bool',
  Num: 'num',
  Number: 'num',
  Dynamic: 'dynamic',
  Object: 'Object',
};

/**
 * Flutter's own enum names, mapped to the PlainUI spelling. Someone who knows
 * `MainAxisAlignment.spaceBetween` will type `main=spaceBetween`; the error is right, but the hint
 * should teach the shorter name instead of just listing six words.
 */
const ENUM_ALIASES: Readonly<Record<string, string>> = {
  spaceBetween: 'between',
  spaceAround: 'around',
  spaceEvenly: 'evenly',
  flexStart: 'start',
  flexEnd: 'end',
  mainAxisAlignment: 'start',
  crossAxisAlignment: 'start',
  centerLeft: 'center',
  centerRight: 'center',
  topStart: 'topLeft',
  topEnd: 'topRight',
  bottomStart: 'bottomLeft',
  bottomEnd: 'bottomRight',
};

export const FLUTTER_TARGET: Target = {
  id: 'flutter',
  label: 'Flutter',
  language: 'Dart',
  outputExtension: '.dart',
  hostExtensions: ['.dart'],
  reservedWords: RESERVED_WORDS,
  shadowedTypes: SHADOWED_TYPES,
  typeSpellings: TYPE_SPELLINGS,
  enumAliases: ENUM_ALIASES,
  capabilities: {
    state: { level: 'full', note: 'State is a field on the generated `State` class, changed through `setState`.' },
    derived: { level: 'full', note: 'A getter on the state class: computed on every read, never stored.' },
    effects: {
      level: 'full',
      note: 'A nullable snapshot is compared in `build` and the body runs in a post-frame callback.',
    },
    tasks: {
      level: 'full',
      note: 'A loader with `loading` / `error` / `value` fields, a sequence number, and latest-wins cancellation.',
    },
    forms: {
      level: 'full',
      note: '`Form` + `TextFormField` validators, with `submit()` inlining the handler inside the validation gate.',
    },
    navigation: { level: 'full', note: 'A `MaterialPageRoute` built from the screen constructor, so arguments are checked by Dart.' },
    'host-surfaces': {
      level: 'full',
      note: 'Declared signatures are checked at every call site and the module is imported into the generated file.',
    },
    themes: { level: 'full', note: 'Tokens are resolved at compile time and also emitted as `ThemeData` for Flutter’s own widgets.' },
    'list-identity': { level: 'full', note: '`key=` becomes a `KeyedSubtree` key, so a rebuilt list keeps its element state.' },
  },
};
