# The vision: one language, many targets

PlainUI exists to answer one question: **can a single language — with its own syntax, type system and
programming model — express the UI capabilities that today require learning five frameworks?**

The answer has to be earned target by target. This page states where we are going and, more
importantly, the rules that keep the language from becoming a thin wrapper over whichever framework
it learned most recently.

## What we are building

Write once, compile to the framework the platform actually wants:

```
                ┌──────────────┐
                │  .pui source │   one language, one type system, one model
                └──────┬───────┘
                       │  lexer → parser → analysis (framework-neutral)
        ┌──────────────┼──────────────┬──────────────┐
   ┌────▼────┐   ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
   │ Flutter │   │  Compose  │  │ React/TSX │  │  SwiftUI  │   … targets
   └────┬────┘   └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      Dart           Kotlin         TypeScript       Swift
```

The compiler is not a lowest-common-denominator transpiler. Each target is a **faithful lowering**:
it emits idiomatic code in the host language, using the host framework's own primitives (`setState`,
`remember { mutableStateOf }`, hooks, signals), so the result is debuggable, inspectable and fits the
ecosystem it lands in.

## Why Flutter first

Flutter is the first target because it forces the least pretending: its vocabulary (widgets, a
declarative tree, explicit state objects, `EdgeInsets`-style layout) is the closest to what the
language already models, and it is the only target we can verify end to end in CI today — generate
the examples, `dart analyze` them in a real Flutter app, and run a widget test against the result.

A target only counts as supported when it has all four:

1. a **registry** of elements and properties it can lower,
2. a **generator** in `src/codegen/`,
3. **verification** in CI — the generated host code compiles, and a test executes it,
4. **documentation** generated from the same table as the code, so the docs cannot drift.

"Generates something similar" is not a target. This is the rule that keeps the roadmap honest.

## Capability tiers

The language is not the intersection of its targets. Every construct is declared at one of three
levels, and the compiler enforces the level at use sites:

| Tier | Meaning | Examples |
| --- | --- | --- |
| `core` | Portable by definition; every target must lower it | `column`, `row`, `text`, `state`, `if`, `for`, `bind`, events |
| `common` | Lowerable everywhere, with per-target idioms | theming tokens, lists with keys, navigation, `task` (async), forms |
| `flutter.*` | A target's own vocabulary, namespaced | `flutter.sliverList`, `flutter.hero` |

Compiling a `core` or `common` file to any target works. Compiling a `flutter.*` node to Compose
fails with a diagnostic that names the alternative — it never silently emits something that looks
right and behaves differently. That failure is a feature: it is the language being honest about
what ports.

## The type system is ours

Types must not be Dart's with a `.pui` extension. PlainUI owns the semantic types and each target
maps them:

| PlainUI | Dart / Flutter | Kotlin / Compose | TypeScript |
| --- | --- | --- | --- |
| `Text` | `String` | `String` | `string` |
| `Int` | `int` | `Int` | `number` |
| `Float` | `double` | `Float` | `number` |
| `Bool` | `bool` | `Boolean` | `boolean` |
| `Color` | `Color` | `Color` | `string` |
| `Duration` | `Duration` | `Duration` | `number` (ms) |
| `List<T>` / `Optional<T>` / `Result<T>` | `List` / `T?` / sealed class | `List` / `T?` / `Result` | `T[]` / `T \| null` / union |

A type error therefore reads the same in every target, and the type checker is written once. The
compiler keeps the semantic `UiType` target-neutral; each `Target` owns a `types` map for primitive
names, generic constructors, and Optional representation. Flutter maps to Dart (`Text → String`,
`Optional<T> → T?`); the static HTML preview has its own descriptive map (`Text → string`,
`Optional<T> → T | null`) even though it emits no typed source. `tests/targets.test.ts` exercises both
maps, including nested generics, so adding a target cannot inherit Dart's type shapes by default.

## The programming model is the real design problem

State and asynchrony are what make "one language, many frameworks" hard, because no two frameworks
agree on how they work. PlainUI defines the semantics, and every target lowers the *same* four
constructs:

| PlainUI | Meaning | Flutter | Compose | React |
| --- | --- | --- | --- | --- |
| `state n: Int = 0` | mutable cell owned by the screen | field + `setState` | `remember { mutableStateOf }` | `useState` |
| `derived total = n * 2` | recomputed from state | getter in `build` | `remember { derivedStateOf }` | `useMemo` |
| `effect …` | runs after a change, keyed | `initState` / `didUpdateWidget` | `LaunchedEffect` | `useEffect` |
| `task …` | async unit exposing `loading`/`error`/`value` | guarded `Future` + status | `produceState` | effect + state |

`state` exists today; `derived`, `effect` and `task` are the next three, and they are a prerequisite
for a second target — not a nice-to-have. Adding targets before the model is settled means
inheriting four incompatible state stories later.

## Interop, or how to use the ecosystem

A language that cannot call the host ecosystem is a toy. The boundary is explicit and typed:

- **Host components** are declared with signatures (`AppLogo(size: Int)`), so the checker validates
  calls even though the implementation is host code.
- **Host imports** are target-tagged — `import dart: "package:flutter/material.dart"` — and the
  checker type-checks against the declared signature, never against the host's own type inference.
- A construct with no faithful lowering gets a **namespaced escape hatch plus a diagnostic**, not a
  silent approximation.

## Sequencing, with gates

| Phase | Content | Gate to leave it |
| --- | --- | --- |
| **v1.x — Flutter depth** | design tokens, `task` (async), navigation, list identity, forms and validation, typed interop, a minimal animation vocabulary | a non-trivial app (navigation + tokens + async + forms + lists) written without dropping into Dart for anything routine |
| **v2.0 — Target abstraction** | Flutter knowledge moves behind a `Target` contract; capability matrix generated and tested; Jetpack Compose becomes the second real target | one `.pui` project compiles to Flutter and Compose, both verified in CI, with a test asserting which files port and which fail with a named diagnostic |
| **v2.x — Multi-target projects** | one project, several targets, shared screens plus `target`-scoped overrides | a single source tree ships two platforms |
| **v3 — Breadth** | React/TSX, Svelte, Vue, Angular, SwiftUI; vocabulary packages per target | each ships with the four-point support definition above |

Jetpack Compose is the chosen second target: it is the closest mapping to Flutter and therefore the
best stress test of the state model — if `derived` and `task` lower cleanly to `derivedStateOf` and
`produceState`, the abstraction is real.

## Guardrails

What would make this fail, and the rules that keep it from failing:

- **The parity treadmill.** Frameworks ship faster than a compiler can absorb. A target's job is to
  lower PlainUI faithfully, not to expose everything its framework can do.
- **A lowest-common-denominator language.** If every construct must work everywhere, the language
  becomes the intersection of five models and loses to each of them. Hence the three tiers.
- **Leaking host syntax.** No `widget`, `useState` or `@Composable` nouns in `.pui`. If a concept is
  worth having, it gets a PlainUI spelling and a lowering table.
- **Pretending portability.** A construct that cannot lower faithfully fails at compile time with a
  code that names the alternative. Silent degradation is the one unforgivable bug.
- **Unverified targets.** A target with no CI-verified output is documentation, not support.

Every claim on this page is either backed by a test or listed as work in
[`11-todo.md`](11-todo.md) — the roadmap as data, printed by `plainui next` and rendered by
`npm run docs:ref`. When the two disagree, the todo table is right. The decisions behind the plan,
each with the condition that would reopen it, are in [`10-decisions.md`](10-decisions.md).
