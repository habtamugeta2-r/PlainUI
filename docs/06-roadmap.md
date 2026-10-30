# Roadmap, and the honest risks

PlainUI v1 does one thing: `.pui` → Dart, for Flutter. This page is what comes next and what
could go wrong — the second half matters more.

## Where v1 stands

| Area | State |
| --- | --- |
| Language, parser, checker | 85 diagnostic codes, suggestions everywhere, error recovery |
| Flutter generator | 25 elements, universal properties, gestures, bound inputs, forms, styles |
| Project compilation | imports, re-basing, duplicate detection, deterministic output |
| CLI | build, check, watch, format, init, ast, tokens, explain, widgets, lsp |
| Tooling | formatter, playground (browser), golden files, examples, generated docs |
| Tests | 200+, no mocks, no network, no Flutter SDK required |
| Real Flutter verification | `flutter-verify.yml` — generate, `dart analyze`, widget test |

## The plan in one line

Flutter depth first, then a target abstraction proven by Jetpack Compose, then breadth. The reasoning
and the rules — capability tiers, the type system, the state model, the four-point definition of
"supported" — are in [`09-vision.md`](09-vision.md).

The order itself is now data: [`11-todo.md`](11-todo.md) is generated from `src/tooling/todo.ts`,
`plainui next` prints the current item, and the test suite refuses an item without an acceptance
criterion. This page keeps the *narrative* — why this order, and what could go wrong; when the two
disagree about order, the table wins. The decisions behind both are in
[`10-decisions.md`](10-decisions.md).

## Next, in order

*(The machine-checked order is [`11-todo.md`](11-todo.md); the sections below are the reasoning
behind it. Ticked items are the ones already on `main`.)*

### 0. Flutter depth — complete

Feature work on the one target we can verify end to end, in this order:

- ~~**design tokens** — a `theme` block: colours, spacing, radii, referenced by name (`padding=md`,
  `color=brand`)~~ — done (`docs/03-flutter-codegen.md` §Design tokens),
- ~~**`task`** — async as a language construct with `loading` / `error` / `value`~~ — done
  (`docs/01-language-spec.md` §3.5, `examples/async`, verified by `flutter-verify.yml`),
- ~~**list identity** — `for … key=item.id`~~ — done,
- ~~**navigation** — `navigate` / `back` with screen parameters checked at compile time~~ — done
  (`docs/01-language-spec.md` §3.8 and §7, `examples/navigation`, tapped through in
  `flutter-verify.yml`),
- ~~**latest-wins task cancellation** — a retry during an in-flight load cannot lose to the older
  result~~ — done (`docs/01-language-spec.md` §3.5, races in `examples/async`),
- ~~**forms** — typed validation on `input`, gated by a `form` scope; `submit()` cannot reach the
  handler without validating~~ — done (`docs/01-language-spec.md` §3.9,
  `docs/03-flutter-codegen.md` §Forms, `examples/forms`, tapped through in `flutter-verify.yml`),
- ~~**typed interop** — a host surface on the import, so the calls a file makes are checked against
  declared signatures~~ — done (`docs/01-language-spec.md` §2.5, `docs/03-flutter-codegen.md`
  §Host interop, `examples/async`, verified by `dart analyze` in `flutter-verify.yml`),
- ~~**`derived`** — a computed value that is never stored, so it cannot go stale~~ — done
  (`docs/01-language-spec.md` §3.6, `docs/03-flutter-codegen.md` §Derived values,
  `tests/golden/derived.pui`, tapped through in `flutter-verify.yml`),
- ~~**`effect on <state>`** — actions that run on mount and when a named state changes, and at no
  other time~~ — done (`docs/01-language-spec.md` §3.7, `docs/03-flutter-codegen.md` §Effects,
  `tests/golden/effect.pui`, tapped through in `flutter-verify.yml`),
- ~~**the phase gate** — a non-trivial app written in `.pui` alone~~ — done (`examples/demo`: three
  screens, a shared theme, host-backed tasks, an effect that searches as you type, two validated
  forms and a keyed list; driven by widget tests in `flutter-verify.yml`).

The gate the vision document names — navigation + tokens + async + forms + lists, written without
dropping into Dart for anything routine — is `examples/demo`. Its hand-written Dart is `main.dart`
(first screen, theme, deep links) and `lib/model/data.dart` (the store). Everything the screens do
is `.pui`.

What the phase deliberately does not have is written down in
[`10-decisions.md`](10-decisions.md) B1–B5; the next phase opens with the `Target` contract.

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

### 2. A language server — started

`plainui lsp` (see [`04-cli.md`](04-cli.md)) already publishes diagnostics on open/change/save,
formats documents and answers hover, all project-aware. `tests/lsp.test.ts` drives it as a
subprocess over framed JSON-RPC, because a wrong `Content-Length` or a 1-based line number would
make it useless in every editor while unit tests still passed.

What is missing is the part that needs research rather than plumbing:

- **incremental parsing.** Every keystroke re-parses one file and recompiles the project around it.
  That is fast enough now (~1 ms for the file, ~40 ms for a 300-screen project with the cache), but
  it will not stay fast, and the cache is invalidated by any edit inside the open file.
- **completion.** The checker already computes the legal names at each position; exposing them
  means giving the parser a position → scope function, which does not exist yet.
- **go-to-definition and references.** These need a name index across the project, which is the
  same index a build_runner integration would want.

### 3. A target abstraction, then Compose — *contract done*

`src/codegen/html.ts` showed that a target is one file, but "one file" was not yet "one contract":
the front end still carried Flutter knowledge (`DART_RESERVED_WORDS`, `FLUTTER_TYPE_NAMES`, the enum
aliases). The contract now exists in `src/targets/`: a `Target` declares its reserved words, shadowed
types, type spellings, enum aliases and a nine-entry capability record, and `check.ts` asks it for
every one of those — so the front end names no framework and the same file can be legal for one
target and not for another. `PUI2501` refuses a construct whose capability is `none`, and the HTML
preview's capability table is the honest answer to "what does a static page actually do?"
([`02-architecture.md`](02-architecture.md#targets), [C5](10-decisions.md)).

The **capability matrix** is now a project setting (C2): `"targets": ["flutter", "html"]` in
`plainui.config.json` makes portability a per-file promise, enforced by `PUI2502` and asserted by
`tests/matrix.test.ts`, which compiles all seven examples for both targets and records which ones
port. What still stands between that and Compose: output paths per target, `plainui build` writing a
tree for anything other than Flutter (it refuses explicitly today), and a second generator that is
not a preview.

**Jetpack Compose is the second target**, chosen because it is the closest mapping to Flutter and
therefore the sharpest test of the state model: if `derived` lowers to `derivedStateOf` and `task`
to `produceState` without hand-written special cases, the abstraction is real. React/TSX, Svelte,
Vue, Angular and SwiftUI come after, each with the four things a target needs (registry, generator,
CI verification, generated documentation) — see [`09-vision.md`](09-vision.md).

### 4. ~~Watch mode that watches (not polls)~~ — done

`src/tooling/watch.ts` now uses `fs.watch` (recursive → per-directory → polling), debounces saves by 60 ms
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
