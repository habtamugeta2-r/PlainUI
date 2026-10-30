# The MVP

What ships in PlainUI 1.0, what it explicitly does not do, and the evidence that it works.

The MVP is one complete path: a `.pui` file becomes Dart a Flutter project can import, with the
tooling that path needs to be usable daily — check, format, watch, editor integration, docs, tests.

---

## 1. The user story it serves

> I describe a screen in a small file. I get Dart I could have written by hand. I never debug the
> generator.

Concretely, all of this works today:

```plainui
// lib/ui/counter.pui
screen Counter:

    state count: int = 0

    column padding=24 gap=16 main=center:
        text "Counter" style=heading
        text count style=display
        button "Add":
            on tap:
                set count = count + 1
```

```bash
plainui build      # → lib/generated/counter.pui.dart
```

```dart
// lib/main.dart
import 'generated/counter.pui.dart';

void main() => runApp(const MaterialApp(home: Counter()));
```

No PlainUI import in the generated file, no runtime package, no reflection.

---

## 2. What is in scope

| Area | In the MVP | Evidence |
| --- | --- | --- |
| Language | `screen`, `component`, `state`, `style`, imports, `if`/`for`, events with `set`, checked Dart expressions | `docs/01-language-spec.md`, `tests/parser.test.ts`, `tests/check.test.ts` |
| Elements | 25 built-ins (`column` … `progress`), universal layout properties, gestures, two-way `bind=` | `docs/07-reference.md` (generated), `tests/registry.test.ts` |
| Diagnostics | 60 codes, severities, caret spans, hints, did-you-mean; `--json` | `docs/05-diagnostics.md` (generated), `tests/diagnostics` assertions across the suite |
| Flutter target | stateless/stateful widgets, `setState` collapsing, `await` hoisting, controller lifecycle, wrapper order | `docs/03-flutter-codegen.md`, `tests/golden`, `tests/codegen.test.ts` |
| Second target | static HTML, used by the playground preview | `tests/html.test.ts`, `tests/golden/expected/*.html` |
| CLI | `build check watch format lsp init ast tokens explain widgets`, exit codes, `--json` | `tests/cli.test.ts` |
| Incremental builds | per-file cache keyed by text, imports and declaration table | `tests/project.test.ts` |
| Editor | LSP: diagnostics, formatting, hover, project-aware | `tests/lsp.test.ts` |
| Library | `@plainui/compiler` with `dist/index.js` + `.d.ts` | `tests/api.test.ts`, CI `package` job |
| Examples | `counter`, `todo`, `gallery` — runnable Flutter apps | `tests/examples.test.ts` |
| Packaging | `npm pack` → install → bin works → API imports | CI `package` job |

---

## 3. What is deliberately out of scope

- **Compose / React / SwiftUI targets.** The AST holds no framework nouns and `codegen/html.ts`
  proves a second target is one file, but none of these is built. Shipping a half-target would be
  worse than shipping none.
- **A general-purpose language.** No functions, classes, generics, loops with indices beyond
  `for index, item in`, or networking. Logic belongs in Dart.
- **A runtime package.** Nothing to depend on means nothing to break.
- **Completion and go-to-definition.** The LSP publishes diagnostics, formats and hovers; the rest
  needs an incremental parse and a cross-file name index (`docs/06-roadmap.md`).
- **A disk cache.** The incremental cache is per-process. A disk cache needs a key covering the
  full import closure plus compiler version and flags — a half-right one is a stale-build bug.
- **Publishing to npm.** The MVP ships as a tarball from this repository (see §4).

---

## 4. Getting it

```bash
git clone https://github.com/habtamugeta2-r/PlainUI && cd PlainUI
npm ci && npm run build
npm pack                                # -> plainui-compiler-1.0.0.tgz
npm install -g ./plainui-compiler-1.0.0.tgz
plainui --version                       # 1.0.0
```

Requires Node 22.6+ (the tests and scripts run TypeScript directly). A Flutter SDK is needed only
to compile the generated Dart, and only the `flutter-verify` workflow uses it.

---

## 5. Acceptance criteria

Each of these was run against a clean checkout (`git archive HEAD` → empty directory → `npm ci`),
not against the working tree that had already been built.

| # | Criterion | Command | Result |
| --- | --- | --- | --- |
| 1 | Types are sound | `npm run typecheck` | pass |
| 2 | The suite passes | `npm test` | **220 tests, 0 failures** |
| 3 | The CLI, API and declarations build | `npm run build` | `dist/cli.js` 234 KiB, `dist/index.js` 234 KiB, 14 `.d.ts` files |
| 4 | The documented examples compile | `npm run examples` | 3 projects, 0 errors |
| 5 | Documentation cannot drift | `scripts/gen-reference.ts --check` | `07-reference.md`, `05-diagnostics.md` up to date |
| 6 | Generated Dart matches its sources | `plainui build examples/* --check` | 3 projects up to date |
| 7 | The playground bundle builds | `scripts/playground.ts --build-only` | built |
| 8 | A fresh project works end to end | `plainui init && build && check && format --check && build --check` | pass |
| 9 | Diagnostics are machine readable | `plainui check home.pui --json` | `PUI2001`, `severity: "error"` |
| 10 | The published package works | `npm pack` → install → `plainui --version` → `import { compileOne }` | bin prints `1.0.0`; API compiles; types present |
| 11 | An editor can use it | LSP over a pipe: initialize, didOpen, didChange, formatting, hover | `tests/lsp.test.ts` |

**Not verified here:** `flutter-verify.yml` (generate → `dart analyze --fatal-warnings` → widget
tests) needs a Flutter SDK, which this environment does not have. As the nearest available
substitute the generated Dart is checked for structure, for golden equality, and against a list of
deprecated Flutter APIs (`tests/flutter-api.test.ts`). That workflow is the first thing to watch on
the next run.

---

## 6. What "done" meant while building it

Every feature in this repository arrived with the test that would have caught it being wrong:

- a bug found by writing a test (the playground's clipboard call, the `"$name"` interpolation that
  generated `for (final _ in items)`, the wrapper order documented backwards);
- a bug found by running CI's steps on a clean archive (missing lockfile, Node 20, example tests
  that depended on a previous build);
- a bug found by installing the package (a bin symlink made the CLI exit 0 and print nothing).

The pattern is the same each time: the thing that was never executed was the thing that was broken.
