# Changelog

All notable changes to PlainUI are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`icon` names are translated to Material's spelling.** `icon heart` used to emit `Icons.heart`,
  which does not exist and failed `dart analyze`. Friendly names now map to the real ones (`heart`
  → `favorite`, `trash` → `delete`, `pencil` → `edit`, `bell` → `notifications`, …); names that are
  already correct pass through untouched.
- **No more unnecessary `package:flutter/services.dart` import.** `TextInputType` comes with
  `material.dart`, so every file with a `keyboard=` hint carried an import the analyzer flagged.
- **`plainui watch` no longer misses saves made while the first build runs.** Watching starts
  before the first compile, so a save that lands during it queues a rebuild instead of joining
  polling's baseline snapshot and never being reported.
- **`plainui watch` picks up a file created inside a new directory** (`mkdir parts && … >
  parts/a.pui` gave the file no event of its own), and ignores the generated output directory so a
  build cannot trigger the next one. `PLAINUI_WATCH_MODE=recursive|per-directory|polling` forces a
  strategy for network filesystems.

## [1.0.0] — 2026-10-30

The first release. PlainUI 1.0 is a complete path from an indentation-scoped `.pui` file to Dart
that a Flutter project can import, with the tooling that path needs to be usable: a CLI, a
formatter, a watcher, a language server, a browser playground, generated documentation and golden
files.

### Added

- **The language** (`docs/01-language-spec.md`): indentation-scoped blocks, `screen` and
  `component` declarations, `state`, `style`, `.pui` imports, `if`/`for` nodes, event handlers with
  `set`, and a checked subset of Dart expressions. 25 built-in elements.
- **Diagnostics**: 60 codes with stable identifiers, severities, caret spans, hints and
  did-you-mean suggestions; `plainui check --json` for machines.
- **The Flutter target** (`docs/03-flutter-codegen.md`): `StatelessWidget`/`StatefulWidget` output,
  `setState` collapsing, `await` hoisting, controller lifecycle for bound inputs, wrapper
  compositing for universal properties, gestures, and imports re-based from source to output.
- **A second target**: static HTML, used for the playground preview. It exists to prove the AST
  holds no framework nouns.
- **CLI**: `build`, `check`, `watch`, `format`, `lsp`, `init`, `ast`, `tokens`, `explain`,
  `widgets`, with exit codes and `--json`.
- **Incremental builds**: `ProjectCache` fingerprints a file's text, imports and the project's
  declaration table, so one save recompiles one file (~40 ms instead of ~190 ms on 300 screens).
- **Watch mode**: `fs.watch` (recursive → per-directory → polling), 60 ms debounce, rebuilds queued
  rather than stacked.
- **Language server**: diagnostics, formatting and hover over LSP, project-aware.
- **Library API**: `@plainui/compiler` exports `compileOne`, `compileProject` (+`ProjectCache`),
  `compileSource`, `formatText`, `parse`, `tokenize`, `check`, the catalogues and both generators,
  with type declarations.
- **Documentation**: research and decision log (`00`), language spec (`01`), architecture (`02`),
  Flutter target (`03`), CLI (`04`), diagnostics (`05`), roadmap (`06`), reference (`07`) — the last
  two generated from the compiler, with a `--check` mode that fails on drift.
- **Examples**: `counter`, `todo`, `gallery` — runnable Flutter apps whose widgets are generated.
- **CI**: typecheck, tests, build, examples, docs check, generated-code sync, playground bundle,
  a fresh-project smoke test, a `--json` assertion, a packaging job (pack → install → run → import)
  and a Flutter job that runs `dart analyze` and widget tests on the generated Dart.

### Notes

- Generated code is self-contained: no runtime package, no reflection, nothing to depend on.
- The compiler is TypeScript and runs on Node 22.6+; the generated artefact is pure Dart, and the
  Flutter job is the only place a Flutter SDK is required.
- Compose and TSX targets are designed for but not built — the roadmap says what they need.

[1.0.0]: https://github.com/habtamugeta2-r/PlainUI/releases/tag/v1.0.0
