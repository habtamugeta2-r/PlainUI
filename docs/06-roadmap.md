# Roadmap, and the honest risks

PlainUI v1 does one thing: `.pui` → Dart, for Flutter. This page is what comes next and what
could go wrong — the second half matters more.

## Where v1 stands

| Area | State |
| --- | --- |
| Language, parser, checker | 60 diagnostic codes, suggestions everywhere, error recovery |
| Flutter generator | 25 elements, universal properties, gestures, bound inputs, styles |
| Project compilation | imports, re-basing, duplicate detection, deterministic output |
| CLI | build, check, watch, format, init, ast, tokens, explain, widgets |
| Tooling | formatter, playground (browser), golden files, examples, generated docs |
| Tests | 213, no mocks, no network, no Flutter SDK required |
| Real Flutter verification | `flutter-verify.yml` — generate, `dart analyze`, widget test |

## Next, in order

### 1. A `build_runner` builder

The intended packaging is a Dart builder so a Flutter project adds one dev dependency and
`.dart_tool` regenerates on save:

```yaml
# pubspec.yaml
dev_dependencies:
  plainui: ^1.0.0
  build_runner: ^2.4.0
```

```bash
dart run build_runner watch
```

That means shipping the compiler as a Dart entry point. The practical route is to run the Node
compiler, or to port the front end to Dart. Porting is the better long-term answer: it removes
Node from the author's machine entirely and lets the CLI be `dart run plainui`. The AST and the
registry are the portable parts — that is what they were designed for.

### 2. A language server

`plainui check --json` already emits what an editor needs (file, code, severity, span, hint), and
`plainui explain` covers documentation on hover. What is missing:

- incremental parsing (the compiler currently re-analyses the whole project);
- completion candidates — the checker already computes legal names per position, so this is a
  matter of exposing them;
- formatting on type, which is `formatText` again.

Until then, the playground demonstrates the loop: type, see diagnostics, see output.

### 3. More targets

`src/codegen/html.ts` shows that a target is one file. The interesting ones:

- **Jetpack Compose** — the closest mapping (`Column`, `Row`, `remember { mutableStateOf }`).
  Kotlin's `when` and trailing lambdas fit the tree well.
- **React/TSX** — cheap to generate, but the state and event model needs a decision:
  `useState` per declaration is the honest mapping.
- **SwiftUI** — the reason PlainUI's syntax looks the way it does; mostly a translation table.

The AST holds no framework nouns, so the work is a registry variant plus an emitter, not a fork.

### 4. ~~Watch mode that watches (not polls)~~ — done

`src/watch.ts` now uses `fs.watch` (recursive → per-directory → polling), debounces saves by 60 ms
and queues one rebuild when a save lands mid-build. `ProjectCache` makes the rebuild incremental:
a fingerprint over the file's text, its imports and the project's declaration table means one save
recompiles one file (~40 ms instead of ~190 ms on a synthetic 300-screen project).

What is *not* done: the cache is in memory, so a cold `plainui build` still compiles everything.
A disk cache would help CI, but it needs a key that covers compiler version, flags and the full
import closure — a half-right disk cache is a stale-build bug waiting to happen, so it is not
shipped.

### 5. Layout intent, not just boxes

The one place PlainUI is weaker than hand-written Flutter is expressing *why* a layout is
arranged the way it is. Ideas worth testing:

- `stack` alignment helpers (`topLeft`, `fill`) rather than raw `align=`;
- named anchors for responsive breakpoints — but only if a design survives contact with real
  apps; guessing here is how DSLs bloat.

## Open questions we are deliberately not answering yet

- **Should `for` be a list comprehension?** It is currently a collection `for`, which composes
  with `if` inside children. Maps and sets are not covered.
- **Should state be typed at all?** Inference is literal-only today. A `var` that infers from the
  first assignment would hide Dart errors, so no.
- **Should components accept callbacks?** Today a component that needs to report an event takes a
  `VoidCallback` from Dart or re-renders from shared state. Passing an inline handler would need
  closures in the parameter list; syntax exists (`onTap: VoidCallback`), semantics do not.
- **Theming.** Styles currently drive text only. A token file (colours, spacing, radii) is the
  obvious next step and the least risky: it is data, not syntax.

## Risks

**The DSL gap.** Every UI DSL loses expressiveness somewhere; the moment a user needs a
`CustomPaint` or a sliver, they drop into Dart. That is by design — host widgets are a first-class
citizen (`AppLogo()` works, with a note) — but it means PlainUI cannot be the *only* way a file
is written. A project that is 60 % PlainUI and 40 % Dart is the expected shape, not a failure.

**Synchronised bindings.** `bind=` generates a `TextEditingController` and a `_syncControllers()`
call in `build`. That is correct, and it is also the most "clever" thing in the output. It is the
first thing to simplify if a bug report ever involves cursor position in a text field.

**Generated-code drift.** Generated files are committed by many teams. `plainui build --check`
exists so CI can fail when a `.pui` file changes without its output; teams that prefer
`.gitignore` get the same guarantee from a build step that runs before compilation.

**Diagnostic wording is a product.** The codes are stable, the messages are not. Anyone
depending on message text in CI will be disappointed; depend on codes.

**Indentation.** Tabs, mixed indentation and paste-from-web remain the most common source of
first-hour pain in every indentation-based language. Tabs are rejected (`PUI1005`), the width is
inferred, and the formatter fixes the rest — but a "paste with wrong indentation" experience
still exists, and always will.

## What would make us stop

If a real app cannot be written in PlainUI without fighting it for more than a day, the language
is wrong, not the app. The examples in `examples/` are the honesty check: they are compiled on
every commit, and they are small on purpose.
