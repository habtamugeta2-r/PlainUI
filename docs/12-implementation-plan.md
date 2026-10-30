# Implementation plan and checklist

A single, detailed, checkbox-driven view of the whole project: what is built and verified today,
and what is left, broken into concrete work items by milestone/phase.

This document is **derived**, not canonical. The machine-checked source of truth for status and
acceptance criteria is `src/tooling/todo.ts` (rendered into [`11-todo.md`](11-todo.md), printed by
`plainui next`). The narrative reasoning lives in [`06-roadmap.md`](06-roadmap.md) and
[`09-vision.md`](09-vision.md); the decisions and their revisit triggers are in
[`10-decisions.md`](10-decisions.md). This page exists because those are coarse (one line per
item, one phase table) — here every item is broken into the sub-tasks someone would actually pick
up, with the current repository state checked off as of this review.

> Keeping this honest: when an item here is finished, flip its checkbox **and** update
> `src/tooling/todo.ts` (the generated `11-todo.md` and `plainui next` read from there, not from
> this file). If the two ever disagree, `src/tooling/todo.ts` wins — fix this file to match it.

**Tracked in Linear.** This plan is mirrored as a work-tracking project in the connected Linear
workspace (team `HAB`): **"PlainUI Implementation Plan"**, with one issue per item above —
`phase-0-foundations` / `phase-1-flutter-depth` / `phase-2-architecture` / `phase-3-adoption` /
`phase-4-multi-target` / `phase-5-breadth` / `cross-cutting` labels stand in for milestones, and
the granular sub-tasks (2.1–2.18, 3.1–3.8, etc.) are sub-issues under their parent item
(`HAB-19`…`HAB-68`). `HAB-34` ("2.1 — Type vocabulary in the AST/parser") is done; `HAB-35`
("2.2 — Checker support, dual-accepting old spellings") is the current single next unit of work.
Use that project for status/assignment going forward; update both it and this file (and
`src/tooling/todo.ts`, which remains the real source of truth) as work lands.

**Repository snapshot at time of writing:** branch `arena/0d109071-plainui`, based on `main` @
`65f91c8` (PR #12, "Capability matrix: targets is a portability promise", merged). 410 tests
passing (`npm test`), typecheck clean (`npm run typecheck`), 25 built-in elements, 107 diagnostic
codes, 8 runnable examples, 2 shipped targets (Flutter, HTML-preview), CI workflows `ci.yml` and
`flutter-verify.yml`.

---

## How to read this

- `[x]` — done, on `main`, covered by tests (and CI where applicable).
- `[~]` — in progress / partially done; what remains is listed under it.
- `[ ]` — not started.

Phases follow `src/tooling/todo.ts`'s `PHASES` order (**Flutter depth → v2.0 architecture →
Adoption surface**), plus the two further-out phases named in `09-vision.md` (**v2.x multi-target
projects → v3 breadth**) so the full arc is visible in one place.

---

## Milestone 0 — Foundations (pre-phase, shipped as part of v1.0)

Everything the phased roadmap builds on. Not tracked in `todo.ts` because it predates the roadmap
table, but listed here so "what exists" is complete.

- [x] **Frontend pipeline** — `src/frontend/`: `source.ts` (text + spans), `lexer.ts`
      (indentation-aware tokenizer, tabs rejected as `PUI1005`), `ast.ts` (framework-neutral AST),
      `parser.ts` (recursive-descent, error recovery).
- [x] **Semantic analysis** — `src/analysis/`: `check.ts` (scopes, widget/property validation,
      expression checking), `diagnostics.ts`, `suggest.ts` (did-you-mean), `styles.ts`, `events.ts`.
- [x] **Widget registry** — `src/analysis/widgets/registry.ts`: 25 built-in elements, universal
      layout properties, gestures, bound inputs — the single source of truth the docs are
      generated from.
- [x] **Flutter code generator** — `src/codegen/flutter.ts` + `dart.ts`: stateless/stateful
      widgets, `setState` collapsing, `await` hoisting, controller lifecycle, deterministic
      wrapper order.
- [x] **HTML preview generator** — `src/codegen/html.ts`, used by the playground and by the
      capability-matrix tests.
- [x] **Project compilation** — `src/project/`: multi-file imports, re-basing, duplicate
      detection, incremental cache (`hash.ts`), deterministic output.
- [x] **CLI** — `src/tooling/cli.ts`: `build`, `check`, `format`, `watch`, `init`, `ast`, `tokens`,
      `explain`, `widgets`, `lsp`, `next`. JSON output mode on the relevant commands.
- [x] **Formatter** — `src/tooling/format.ts`, canonical formatting, idempotent.
- [x] **Watch mode** — `src/tooling/watch.ts`: `fs.watch` (recursive → per-directory → polling
      fallback), debounced, queues a rebuild if a save lands mid-build.
- [x] **Language server** — `src/tooling/lsp.ts`: diagnostics on open/change/save, formatting,
      hover, project-aware; driven over framed JSON-RPC in `tests/lsp.test.ts`.
- [x] **Library API** — `@plainui/compiler` (`src/index.ts`): `compileOne`, project compile,
      format, inspect; shipped with `.d.ts` via `tsconfig.types.json`.
- [x] **Diagnostics catalogue** — 107 coded diagnostics, severities, caret spans, hints,
      did-you-mean suggestions; generated into `05-diagnostics.md`.
- [x] **Examples** — `counter`, `todo`, `gallery`, `async`, `forms`, `navigation`, `demo` (7 apps),
      each with its own `plainui.config.json` and hand-written Flutter host where needed.
- [x] **Golden files & generated docs** — `tests/golden`, `07-reference.md` + `05-diagnostics.md`
      generated from source and checked for drift (`scripts/gen-reference.ts --check`).
- [x] **CI** — `.github/workflows/ci.yml` (typecheck, test, build, examples, docs-check) and
      `flutter-verify.yml` (generate → `dart analyze --fatal-warnings` → widget tests, needs a
      Flutter SDK runner).
- [ ] **Local verification gap** — this sandbox has no Flutter SDK, so `flutter-verify.yml`'s
      promise ("the generated Dart actually compiles") is only checked by GitHub's own runners.
      Nothing to build here; just the standing caveat `08-mvp.md` already names.

---

## Phase 1 — Flutter depth — **10/10 done**

*Gate (met): a non-trivial app — navigation, tokens, async, forms and keyed lists — written
without dropping into Dart for anything routine. Evidence: `examples/demo`.*

- [x] **Design tokens** — `theme` block (colours, spaces, radii), `padding=md` resolves at
      compile time, wrong-slot token is `PUI2304`; Flutter emits `AppTokens`/`AppTheme`, HTML
      emits `--pui-*` custom properties.
- [x] **`task` — async values** — `loading` / `error` / `value` / `retry()`; loader resets before
      `await` and checks `mounted` after; `examples/async`, widget-tested in CI.
- [x] **List identity** — `for item in items key=item.id:` → `KeyedSubtree(key: ValueKey(...))`;
      key checked in loop scope; used by `examples/todo`.
- [x] **Navigation** — `screen Detail(id: String)` parameters; `navigate`/`back()` checked against
      the target screen; generated project-level route table; `examples/navigation`.
- [x] **Latest-wins task cancellation** — sequence-numbered loads; a `retry()` mid-flight cannot
      be overwritten by the older result; proven with a two-different-delays race test.
- [x] **Forms and validation** — typed validators (required, min, max, pattern, email) on
      `input`; a `form` scope gates `submit()`; an invalid submission cannot be expressed.
- [x] **Typed interop** — host components and `import dart:` surfaces declared with signatures;
      calls checked against them, not passed through blind.
- [x] **`derived` values** — pure recomputation from state, lowered to a getter; never stored, so
      it cannot go stale (decision B1: memoisation deferred until dependency syntax exists).
- [x] **`effect on <state>`** — runs on mount and after a named-state change only; lowered as a
      nullable snapshot compared in `build` + `addPostFrameCallback` (decision B2's corrected
      lowering — not `didUpdateWidget`).
- [x] **Phase gate: `examples/demo`** — three screens, shared theme, host-backed tasks, a
      type-ahead effect, two validated forms, a keyed list; hand-written Dart limited to
      `main.dart` and `lib/model/data.dart`.

**Deferred out of this phase on purpose** (tracked as decisions, not todo items yet):
- [ ] B3 — `task` parameters with reload-on-change (needs B4's cancellation primitive, which
      exists, plus an equality rule for parameters — not yet designed).
- [ ] B5 — typed `Result<T, E>` task errors (blocked on A1/A2, see Phase 2).
- [ ] Layout-intent affordances named in `06-roadmap.md` §5 (`stack` alignment helpers like
      `topLeft`/`fill`, named responsive anchors) — explicitly "not yet", pending evidence from
      real apps that the raw `align=` escape hatch is actually painful.

---

## Phase 2 — v2.0 architecture — **2/4 done, 1 in progress**

*Gate (not yet met): one `.pui` project compiles to Flutter **and** Jetpack Compose, both verified
in CI, with a test asserting which files port and which fail with a named code.*

- [x] **The `Target` contract** (`src/targets/contract.ts`, `flutter.ts`, `html.ts`, `index.ts`) —
      reserved words, shadowed type names, wrong-spelling/enum aliases, and a 9-entry capability
      record live behind one interface per target; `check.ts` asks `this.target` for all of it.
- [x] **Capability matrix and its test** (decision C2) — `"targets"` in `plainui.config.json` is a
      portability promise; `PUI2501` (build target can't express it) and `PUI2502` (a *promised*
      target can't keep up, `partial` counts as failure); `tests/matrix.test.ts` compiles every
      example for Flutter and HTML and asserts the resulting table; `examples/gallery` is the one
      example that names two targets and still builds.
- [~] **PlainUI type system** (`plainui-types`, size `XL`, **current `next` item in `todo.ts`**) —
      `Text`/`Int`/`Float`/`Bool`/`Optional` replace Dart spellings in `.pui`; each target maps
      them; `plainui migrate` rewrites existing projects. Breaking this `XL` item into shippable
      steps (decisions A1, A2, A3):
  - [x] **2.1 — Type vocabulary in the AST/parser.** Add PlainUI-native type names (`Text`, `Int`,
        `Float`, `Bool`, `Color`, `Duration`, `List<T>`, `Optional<T>`) as first-class type syntax
        in `state`/`task`/component parameter declarations (`src/frontend/ast.ts`,
        `src/frontend/parser.ts`). Done: `typeFromText` (`src/frontend/ast.ts`) recognizes
        `Text`/`Int`/`Float`/`Bool`/`Optional<T>`/bare `Optional` alongside the existing Dart
        spellings, resolving to the same `UiType`, so every checker rule accepts them for free;
        `Color`/`Duration` already passed through unchanged via the `named` fallback. A new
        `toDartTypeText` helper rewrites a raw annotation into legal Dart text (unwrapping nested
        `Optional<...>` to a trailing `?`, word-boundary-safe primitive renaming, everything else
        passed through) and every codegen site that used to splice a raw annotation into generated
        Dart (`src/codegen/flutter.ts` field/derived/task/state declarations,
        `src/codegen/routes.ts` route-argument casts) now goes through it — without this fix the
        new spellings would emit invalid Dart. The pre-existing `PUI2206` "wrong type spelling"
        table in `src/targets/flutter.ts` no longer flags `Int`/`Float`/`Bool` (they're not
        mistakes anymore); `Integer`/`Double`/`Boolean`/`Num`/`Number`/`Dynamic` are still flagged.
        Covered by `tests/types.test.ts` (unit tests for `typeFromText`/`toDartTypeText`,
        including nested `Optional` and word-boundary edge cases), new assertions in
        `tests/check.test.ts`/`tests/targets.test.ts`, and the new `tests/golden/types.pui`
        fixture exercising all four primitives plus `Optional<T>` in state/task/derived/component-
        param position, whose generated `.pui.dart` uses correct Dart spellings throughout. Out of
        scope here (see below): deprecation diagnostics for the old spellings (2.2), per-target
        type ownership (2.4), non-null-by-default `Optional<T>` semantics (2.3), `plainui migrate`
        (2.5), and updating existing docs/examples to the new spellings (2.7).
  - [ ] **2.2 — Checker support, dual-accepting old spellings.** `check.ts` accepts both the new
        PlainUI types and the current Dart spellings (`String`, `int`, `double`, `bool`) as
        deprecated aliases, per A1; a new diagnostic (e.g. `PUI2xxx`, warning severity) flags the
        Dart spelling with a fix-it pointing at the PlainUI name.
  - [ ] **2.3 — `Optional<T>` semantics.** No implicit null (decision A2): absence is
        `Optional<T>`; `.orElse(...)` and `if x.exists:` are the only ways through; host interop
        converts nullable Dart values at the boundary. Needs checker rules + at least one codegen
        path (Flutter: `T?` + the helper pattern) and tests.
  - [ ] **2.4 — Per-target type maps.** Each target (`Target.types` or equivalent) owns its own
        mapping table per decision C4 — no shared "lowest common denominator" table. Flutter maps
        shown in `09-vision.md`'s table become the first target's table; HTML target needs its own
        (likely string-based, since it is a preview).
  - [ ] **2.5 — `plainui migrate` CLI command.** A codemod that rewrites `.pui` files in place:
        Dart spellings → PlainUI spellings, idempotent, dry-run (`--check`) mode for CI.
  - [ ] **2.6 — Deprecation and removal timeline.** Decide and document how long the Dart-spelling
        aliases are accepted (A1 says "during 1.x"); add the removal to a future major-version
        entry in `CHANGELOG.md`.
  - [ ] **2.7 — Docs and golden updates.** Update `01-language-spec.md`, `07-reference.md`
        (generated — update the registry/source it's generated from instead), golden files in
        `tests/golden`, and all `examples/*.pui` sources to the new spellings (keeping an alias
        test to prove the old spellings still work until removal).
  - [ ] **2.8 — Typed task errors, `Result<T, E>`** (decision B5, unblocks once 2.1–2.4 land) —
        `task.error` becomes `Result<T, E>` instead of a bare `String`; mapped error type per
        target.
- [ ] **Jetpack Compose target** (`compose-target`, size `XL`, status `todo`) — a `.pui` project
      generates Kotlin that compiles under Gradle in CI; `state`/`derived`/`task` lower to
      `remember`/`derivedStateOf`/`produceState` without special cases. Breaking this down:
  - [ ] **2.9 — `ComposeTarget` skeleton** implementing the `Target` contract
        (`src/targets/compose.ts`): reserved words, shadowed names, enum aliases, capability
        record (decision C5 — every one of the 9 capabilities gets a level + a one-sentence note,
        `none` is not silently allowed to generate).
  - [ ] **2.10 — Kotlin/Compose generator** (`src/codegen/kotlin.ts`): `screen` →
        `@Composable fun`, `column`/`row` → `Column`/`Row`, `text`/`button`/`input` → Compose
        equivalents, universal layout properties → `Modifier` chains.
  - [ ] **2.11 — State model lowering** — `state` → `remember { mutableStateOf(...) }`, `derived`
        → `remember { derivedStateOf { ... } }`, `task` → `produceState`, `effect on <state>` →
        `LaunchedEffect(state) { ... }`. This is the actual test of decision C1/C4: if any of these
        needs a special case, the abstraction in `src/targets/contract.ts` is incomplete.
  - [ ] **2.12 — Design tokens for Compose** — theme block → a `MaterialTheme`/`ColorScheme`
        (or a custom `CompositionLocal`) equivalent, mirroring what Flutter's `AppTokens` does.
  - [ ] **2.13 — Navigation for Compose** — route table → Compose Navigation (`NavHost`) or a
        minimal custom router, with the same compile-time parameter checking Flutter navigation has.
  - [ ] **2.14 — Forms for Compose** — validators lowered to Compose state + a submit gate
        equivalent to the Flutter `form` scope.
  - [ ] **2.15 — CI: a Gradle verification job** (decision C3 — "verified" means compiled by the
        target's own toolchain, not just structurally checked) — new workflow
        (`.github/workflows/compose-verify.yml`) that generates a sample app, runs
        `./gradlew compileDebugKotlin` (or equivalent), and ideally a Compose UI test.
  - [ ] **2.16 — A Compose example** mirroring `examples/demo`'s scope (navigation + tokens +
        async + forms + a keyed list) to serve as this target's own phase-gate evidence.
  - [ ] **2.17 — Capability-matrix extension** — add `COMPOSE_TARGET` to `tests/matrix.test.ts` so
        the "what ports, what fails with which code" table covers three targets, not two.
  - [ ] **2.18 — Docs** — `docs/13-compose-codegen.md` (mirroring `03-flutter-codegen.md`'s
        element/property → Compose mapping) + registry/widget-reference regeneration.

> **Sequencing note:** `todo.ts` orders the type system before Compose. The reasoning (decision
> A1): a second target is only evidence the abstraction works if it isn't also absorbing Dart's
> type spellings by accident. Do 2.1–2.7 (or at least 2.1–2.4) before starting 2.9+.

---

## Phase 3 — Adoption surface — **1/3 done**

*Gate (not yet met): a stranger can install the compiler, add it to an existing app, and be
productive in ten minutes.*

- [x] **`plainui next` — the roadmap as a command** — `src/tooling/todo.ts` is the source of
      truth; `plainui next [--json] [--all] [--phase]` prints it; `11-todo.md` is generated and
      checked by `npm run docs:check`.
- [ ] **Add PlainUI to an existing Flutter app** (size `S`, status `todo`) — a ten-minute tutorial:
      install, one screen compiled next to hand-written widgets, one import, no project-wide
      rewrite (decision D2 — this is the whole adoption pitch and today it is *true but
      undocumented*). Concrete steps:
  - [ ] **3.1** — Write the tutorial itself (new doc, e.g. `docs/14-adding-to-an-app.md`, or a
        README section) walking through: `npm install -g`, `plainui init` inside an existing
        `flutter create`'d app, one `.pui` screen, wiring it into existing `MaterialApp` routes
        alongside hand-written screens.
  - [ ] **3.2** — A fixture/smoke test that `plainui init` + `build` actually produces a screen
        that imports cleanly into a stock `flutter create` app skeleton (can reuse
        `flutter-verify.yml`'s pattern).
  - [ ] **3.3** — Time-box it for real: have someone unfamiliar with the repo follow the tutorial
        and note every point of friction, per the gate's own definition ("productive in ten
        minutes").
- [ ] **Release pipeline** (size `M`, status `todo`) — version lives in one place; CI packs the
      tarball, installs it into a scratch project and runs the smoke test before anything is
      published (decision D4). Concrete steps:
  - [ ] **3.4** — Single version source: `package.json`'s `version` already exists; confirm
        `CHANGELOG.md`, `plainui --version`, and any hard-coded strings all read from it (or are
        generated/checked against it) rather than being updated by hand in parallel.
  - [ ] **3.5** — A `package` CI job (mentioned as existing in `08-mvp.md §5` item 10, but not
        present as a named workflow today — confirm/create it): `npm pack` → install the tarball
        into a scratch project → run the CLI (`--version`, `init`, `build`, `check`) → import the
        library API — fail the build if any step fails.
  - [ ] **3.6** — Changeset-style versioning (decision D4 names "changesets" explicitly) —
        evaluate `@changesets/cli` or an equivalent, wire a release PR workflow.
  - [ ] **3.7** — Actual npm publish step, gated behind the smoke test in 3.5, likely manual
        (`workflow_dispatch`) for the first release rather than fully automatic.
  - [ ] **3.8** — Decide and document the Flutter-SDK-version support policy input to CI
        (decision D5: stable-only until a version-specific bug is reported) — already the
        practice; just confirm `flutter-verify.yml` pins `stable` explicitly and said policy is
        written down somewhere a contributor can find it (this plan, or a `CONTRIBUTING.md`).

---

## Phase 4 — v2.x: multi-target projects (not yet in `todo.ts`)

*Gate (per `09-vision.md`): a single source tree ships two platforms.*

Nothing in this phase has a `todo.ts` entry yet — it is intentionally one phase ahead of current
work, listed here so the arc is visible, and should gain real `todo.ts` items once Phase 2 lands.

- [ ] **4.1 — Per-target output directories.** `plainui build` currently refuses explicitly for
      anything other than Flutter (per `06-roadmap.md` §3); needs `outDir` to become
      target-keyed (e.g. `lib/generated/` for Flutter, `app/src/main/kotlin/generated/` for
      Compose) once a second real generator exists.
- [ ] **4.2 — `target`-scoped overrides.** Syntax for a block or property that only applies to one
      target (e.g. a Flutter-only `flutter.hero` sitting next to portable siblings in the same
      file) — the `flutter.*` capability tier named in `09-vision.md` exists in principle
      (capabilities model) but has no concrete escape-hatch syntax yet.
- [ ] **4.3 — Shared-screen build orchestration.** A CLI/config shape for "build this project for
      targets X and Y in one invocation", including per-target example/test fixtures.
- [ ] **4.4 — Cross-target example.** One project (likely evolving `examples/gallery`, which
      already names two targets) that ships a real Flutter app and a real Compose app from the
      same `.pui` sources, each independently run/tested in CI.

---

## Phase 5 — v3: breadth (not yet in `todo.ts`)

*Gate (per `09-vision.md`): each further target ships with the four-point support definition —
registry, generator, CI verification by the target's own toolchain, and generated documentation.*

- [ ] **5.1 — React/TSX target.** `state` → `useState`, `derived` → `useMemo`,
      `effect on <state>` → `useEffect([...])`, `task` → effect+state; registry + generator +
      a CI job that runs the generated app under a real bundler/test runner.
- [ ] **5.2 — SwiftUI target.** Closest in spirit to the declarative tree; needs its own
      nullability/type mapping story validated against decision A2.
- [ ] **5.3 — Svelte target.**
- [ ] **5.4 — Vue target.**
- [ ] **5.5 — Angular target.**

Each of 5.1–5.5 should be scoped into its own `todo.ts` entries (contract → generator →
state-model lowering → CI verification → example → docs, mirroring the Phase 2 Compose
breakdown) once Phase 2 and Phase 4 close.

---

## Cross-cutting / not phase-bound

Work that doesn't belong to one phase but is named as open in the docs today:

- [ ] **LSP: incremental parsing.** Every keystroke currently re-parses one file and recompiles
      the project around it (~1 ms/file, ~40 ms for a synthetic 300-screen project with the
      cache) — fast enough now, flagged in `06-roadmap.md` as not staying fast, and the cache is
      invalidated by any edit inside the open file.
- [ ] **LSP: completion.** The checker already computes legal names at a position in principle;
      needs the parser to expose a position → scope function.
- [ ] **LSP: go-to-definition / references.** Needs a cross-project name index — the same index a
      `build_runner` integration would also want (see next item).
- [ ] **`build_runner` builder.** Package the compiler as a Dart `build_runner` builder so a
      Flutter project adds one dev dependency and gets `.dart_tool` regeneration on save. Practical
      route per `06-roadmap.md`: either shell out to the Node compiler from a thin Dart builder, or
      (the better long-term answer) port the front end to Dart so the CLI becomes
      `dart run plainui` with no Node dependency on the author's machine. This is the single
      biggest architectural bet not yet started.
- [ ] **Disk cache for incremental builds.** Current cache is in-memory/per-process, so a cold
      `plainui build` always compiles everything. Needs a key covering compiler version, flags and
      the full import closure — deliberately not shipped half-right (`06-roadmap.md`).
- [ ] **`derived` memoisation with explicit dependencies** (decision B1) — once there's a real app
      showing a `derived` in a hot path, add explicit-dependency memoisation; never implicit
      tracking.
- [ ] **`task` parameters + reload-on-change** (decision B3, needs B4 — already done — plus an
      equality rule for parameters).
- [ ] **Layout-intent vocabulary** (`06-roadmap.md` §5) — `stack` alignment helpers, named
      responsive anchors — explicitly gated on evidence from real apps, not speculative design.
- [ ] **Open language questions not yet answered** (`06-roadmap.md`, listed there as deliberately
      unresolved, re-listed here so they aren't lost): should `for` become a list comprehension
      (maps/sets, not just lists)? Should state ever be inferred (`var`) — current answer leans
      no, it would hide Dart errors. Should components accept inline callback handlers, not just
      `VoidCallback` from Dart?

---

## Risk register (carried forward from `06-roadmap.md`, tracked so it isn't re-discovered)

These are not tasks with a "done" state — they are standing risks to re-check at each phase
boundary:

- [ ] **The DSL gap** — every UI DSL loses expressiveness somewhere (custom paint, slivers); host
      widgets are the escape hatch by design, but it means PlainUI is never "the only way a file
      is written" — re-confirm this stays comfortable as the Compose target adds its own gaps.
- [ ] **Synchronised bindings** — `bind=` generates a `TextEditingController` and a
      `_syncControllers()` call; the most "clever" part of the output, first thing to simplify if
      a cursor-position bug is ever reported.
- [ ] **Generated-code drift** — `plainui build --check` exists for CI; confirm the Compose target
      ships the same guarantee from day one (Phase 2, item 2.10+).
- [ ] **Diagnostic wording as a product** — codes are the only stable contract, message text is
      not; keep this true as diagnostics are added for the type system work (item 2.2).
- [ ] **Indentation pain** — tabs rejected, width inferred, formatter fixes drift, but
      paste-from-web with wrong indentation remains a known first-hour papercut with no planned
      fix.

---

## Summary table

| Phase | Items done | Items in progress | Items not started | Status |
| --- | --- | --- | --- | --- |
| 0 — Foundations | 15 | 0 | 0 (1 standing caveat) | ✅ complete |
| 1 — Flutter depth | 10 | 0 | 0 (3 deliberately deferred) | ✅ complete — gate met |
| 2 — v2.0 architecture | 2 | 1 (type system, 8 sub-steps) | 1 (Compose, 10 sub-steps) | 🔶 in progress |
| 3 — Adoption surface | 1 | 0 | 2 (8 sub-steps total) | 🔶 in progress |
| 4 — v2.x multi-target | 0 | 0 | 4 | ⏳ not started |
| 5 — v3 breadth | 0 | 0 | 5 targets | ⏳ not started |

**What "now" means concretely:** the active, single next unit of work — per `src/tooling/todo.ts`
and confirmed by this review — is **2.1, the PlainUI type vocabulary in the AST/parser**, the
first shippable slice of the `plainui-types` item. Everything in Phase 1 is done and verified;
everything in Phases 4–5 is intentionally not yet scoped into actionable items.
