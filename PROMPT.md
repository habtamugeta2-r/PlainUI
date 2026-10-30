# PlainUI — the Design Language brief (V1.1 → V2)

**What this file is.** A rewritten version of the "build an entirely new frontend design language"
prompt, grounded in this repository as it actually stands on `main` today. It is written to be used
as the brief for the next implementation pass: paste it, or point an agent at it.

**One-line change from the original.** The original asked for a language to be built from nothing.
This repository already contains that language — a working compiler, checker, CLI, formatter,
language server, two generators, a playground, 7 example projects and 439 passing tests. So the
brief is not *"build a language"*; it is **"finish the design layer of the language that exists, and
earn the right to call it a language rather than a compiler"** — without discarding the parts that
already work.

---

## 0. Role and mission

You are the language's designer and compiler engineer, working inside `habtamugeta2-r/PlainUI`.

Your mission, in one sentence:

> Turn PlainUI from *a small indentation-based UI description language that compiles to Flutter* into
> **a self-contained design language whose native vocabulary covers styling, layout intent, motion,
> responsive composition and component events — with a runtime that executes it in a browser — while
> keeping the compiler that already exists and the promise that generated host code is idiomatic.**

Two standing constraints follow from the repo, not from taste. Do not trade them away:

1. **The compiler is the asset.** 14.4k lines of compiler source (front end, checker, both generators,
   tooling), 112 coded diagnostics, golden-file tests. Rewriting it is not a design decision; it is a
   regression.
2. **No silent degradation.** If a construct cannot mean the same thing on a target, the compiler
   refuses it with a named code. This rule is already enforced (`PUI2501`, the capability matrix in
   `src/targets/contract.ts`) and every new feature must enter through it.

---

## 1. Ground truth: what exists, verified

Run this before you change anything. Do not trust the roadmap prose over these commands.

```bash
npm ci
npm run verify          # tsc + 439 tests, all passing on a clean checkout
npm run docs:check      # generated reference/todo pages are in sync
node --experimental-strip-types src/tooling/cli.ts explain PUI2001
node --experimental-strip-types src/tooling/cli.ts widgets
```

| Fact | Value | Where |
|---|---|---|
| Language | PlainUI, `.pui`, UTF-8, indentation-scoped | `docs/01-language-spec.md` |
| Pipeline | lexer → parser → framework-neutral AST → semantic check → target generator | `src/frontend/`, `src/analysis/`, `src/codegen/` |
| Backends | **Flutter/Dart** (primary), **static HTML preview** | `src/codegen/flutter.ts`, `src/codegen/html.ts` |
| Target contract | reserved words, type maps, enum aliases, **9 capabilities** | `src/targets/contract.ts` |
| Elements | **25** built-ins: `column row stack wrap scroll list grid card scaffold center align expanded safeArea spacer text image icon button input form toggle checkbox slider divider progress` | `src/analysis/widgets/registry.ts` |
| Universal props | `padding margin width height size expand flex opacity background/bg radius border borderColor align main cross gap` | registry §`UNIVERSAL_PROPS` |
| Text props | `style color size weight textAlign maxLines overflow letterSpacing lineHeight fontFamily italic` | registry |
| Statements | `import theme style component screen`, `state task derived effect`, `if/elif/else for`, `on <event>`, `set`, `slot`, `navigate/back`, `form`, `submit` | spec §2–§3 |
| Events | generic `tap longTap doubleTap hover`; `input` adds `focus blur change submit`; typed payloads (`value`) | `src/analysis/events.ts` |
| Tokens | `color`, `space`/`spacing`, `radius`; **resolved at compile time**; per-target lowering (`AppTokens`/`--pui-*`) | spec §2.4 |
| Diagnostics | **112** stable codes, caret spans, suggestions, `plainui explain` | `src/analysis/diagnostics.ts`, `docs/05-diagnostics.md` |
| CLI | **12** commands: `build check watch format init ast tokens explain widgets migrate next lsp` | `src/tooling/cli.ts` |
| Tooling | formatter (idempotent, tested), LSP (diagnostics/format/hover), watch mode (fs.watch + incremental `ProjectCache`), browser playground on `:4173` | `src/tooling/`, `scripts/playground.ts` |
| Examples | 7 projects: `counter todo gallery async navigation forms demo`; `demo` is the phase gate app | `examples/` |
| Verification | 439 tests; golden files per construct; capability matrix compiles every example for every target; `flutter-verify.yml` runs `dart analyze` + widget tests where a Flutter SDK exists | `tests/`, `.github/workflows/` |
| Docs | 13 documents, reference + todo pages **generated** and drift-checked | `docs/` |

**Coverage of the original prompt's 11 deliverables — measured, not asserted:**

| # | Original deliverable | Status | Evidence | Gap that remains |
|---|---|---|---|---|
| 1 | Language identity & specification | **Met** | `README.md`, `docs/00-research.md`, `docs/09-vision.md`, `docs/10-decisions.md`, 750-line normative spec | Positioning still reads "compiles to a framework"; the *design* thesis is under-argued |
| 2 | Original syntax & grammar | **Met** | lexer 445 L, parser 1582 L, spec §1–§7, formatter | No expression grammar of its own (host passthrough) |
| 3 | Core architecture | **Met** | stage-separated `src/`, `Target` contract, capability tiers `core/common/target` | No intermediate program IR; no second real target |
| 4 | UI composition | **Met** | 25 elements, `if`/`for`, slots, screens, host widgets | No overlay/dialog primitive; layout intent thin |
| 5 | Styling system | **Partial** | universal props; `style` blocks are **text-only** | No element styles, shadow/elevation, effects, states, typography tokens, dark mode |
| 6 | Layout engine | **Partial** | flex, grid, wrap, stack, scroll, `expand/flex`, alignment | No breakpoints, min/max constraints, aspect ratio, positioning |
| 7 | Component system | **Met (mostly)** | `component`, typed params, defaults, `slot`, imports | Components cannot raise events; no shared library |
| 8 | Interaction system | **Partial** | `on tap/longTap/doubleTap/hover/focus/blur/change/submit`, `bind`, forms, `effect`, `task` | **No motion vocabulary at all**; no stylistic states |
| 9 | Responsive design | **Missing** | grep finds only roadmap musings | No breakpoint mechanism anywhere |
| 10 | Design tokens | **Partial** | `theme` colour/space/radius, compile-time, both targets | No typography, shadow, duration/curve, breakpoint tokens; no theme modes |
| 11 | Developer experience | **Partial** | coded diagnostics, formatter, LSP, watch, playground, `init`, `migrate` | No completion/go-to-definition; no interactive preview; no test runner |

Supporting infrastructure named by the original prompt (parser, compiler, dev server, build, docs
system, examples, starter) **exists**. The genuinely absent pieces are: a **runtime**, a **standard
library**, **motion**, **responsive composition**, and an **interactive development environment**.

> Do not spend effort re-creating rows marked *Met*. Spend it on *Partial* and *Missing* rows, and on
> making the design layer as principled as the language layer already is.

---

## 2. The fork in the road — decide it in writing before coding

The original prompt says "not another CSS alternative, framework or component system" and asks for a
language with its own execution model. Two readings are possible, and they produce different products:

**Reading A — a design language with a lowering model (recommended, and what the repo is).**
PlainUI owns the **surface, semantics and type system**; a target owns **execution** (`setState`,
`remember`, the DOM). This is the model Slint, SwiftUI-via-codegen and Kotlin/Compose-with-DSLs
actually use, and it is why the compiler can be verified today. The "language" claim is earned by
owning *design semantics* — tokens, styles, layout intent, states, motion, responsiveness — not by
writing a renderer.

**Reading B — a clean-room language with its own renderer.** A canvas/box engine, a scene graph, text
shaping, input handling, accessibility, and a browser compositor. This is a multi-year, multi-team
product; on this repository it would mean discarding 439 tests, both generators and the checker, and
shipping something visibly worse than Flutter in every dimension for a long time.

**Take Reading A. Make the design layer deep enough that the distinction stops mattering.** Concretely
that means the missing pieces in §3 get *first-class language syntax, specified semantics, a lowering
per target and a capability entry* — not properties glued onto Flutter widgets.

Record the decision in `docs/10-decisions.md` (it already expects entries with "what would reopen
it"), and state the honest limit on the first page of the spec: **the language owns design; the
target owns rendering.** If you believe Reading B is required, stop and say so before writing code —
that is a different brief and a different repository.

---

## 3. The work, in phases

Phases are sequential. Each phase ends with: spec section, registry entries, both generators (or an
explicit `none` capability), diagnostics with codes, golden files, an example that uses it, generated
docs in sync, and `npm run verify` green. **A phase with no example app is not finished.**

### P1 — Element styles and a real token system

*Why first:* styling is the language's core claim, it is cheap (data, not syntax), and every later
phase (motion, responsiveness) needs typed design values to reference.

```plainui
theme App:
    color brand = #2563eb
    color surface = #ffffff
    space md = 16
    radius card = 12
    font body = "Inter", 16
    weight strong = semiBold
    shadow soft = 0 2 8 #0000001f
    duration fast = 120
    curve enter = easeOut

style surface_card:
    background = surface
    radius = card
    padding = md
    shadow = soft
    border = 1 borderColor = #00000014

screen Home:
    column gap=md:
        card style=surface_card:
            text "Hello" style=body
```

**Deliver.**
1. **`style` blocks generalise** from text-only to *property bundles over universal + element props*.
   Text styles keep working unchanged (backwards compatibility is a hard requirement).
   - Precedence: explicit property on the element **>** style **>** built-in default. One level of
     indirection only — no cascade, no inheritance, no specificity ladder.
   - Kind checking per slot: a colour token in a numeric slot is `PUI2304`; a property that the
     element does not accept is a new `PUI2371` naming the element and the style.
   - Unused style ⇒ warning (mirror the existing unused-declaration behaviour, `PUI2372`).
2. **New token families:** `font`, `weight`, `shadow`, `duration`, `curve` (+ `breakpoint` in P3).
   Typed slots, compile-time resolution, one theme per file, theme composition by import.
3. **Theme modes:** `theme App.dark extends App:` overriding a subset. Compile-time resolution for
   both targets; *runtime* theme switching is explicitly deferred (capability note stays honest).
4. **Lowering:** Flutter inlines resolved values into `const`-friendly widgets and extends
   `AppTheme.light`; HTML emits CSS classes (`.pui-style-surface_card`) and custom properties.
5. **Capabilities:** add `styles` to `CAPABILITIES`; both targets answer `full` (HTML must emit real
   CSS, not inline approximations that disagree).

**Acceptance:** `examples/gallery` is rebuilt on styles and tokens with no literal colours or
spacings outside the theme; goldens for the new constructs; `tests/targets.test.ts` still passes with
the new capability answered by every target; a token used in the wrong slot fails with a code; docs
`docs/13-styling.md`, with its construct table generated from the registry so it cannot drift.

### P2 — Motion: transitions, states and enter/exit

*Why:* interaction without motion is a wireframe. This is the single largest gap between the current
language and "design language", and it is entirely expressible through lowerings the repo already
understands (`AnimatedContainer`, `AnimatedSwitcher`, CSS transitions).

```plainui
motion pop:
    duration = fast
    curve = enter

screen Buy:
    state added: Bool = false

    button "Add to cart" animate=pop:
        when hover:
            background = #1d4ed8
        when pressed:
            scale = 0.98

        on tap:
            set added = true

    if added:
        text "Added to cart" enter=fadeUp exit=fadeOut
```

**Deliver.**
1. **`motion` declaration** (duration + curve + optional keyframe values) — a design artifact, stored
   with tokens, referenced by name. No imperative timeline API.
2. **`animate=<motion|duration-token>`** on any element: property changes transition instead of
   snapping. Lowering: Flutter `AnimatedContainer`/`AnimatedDefaultTextStyle`/`AnimatedOpacity`;
   HTML `transition:` with generated CSS.
3. **`when <state>` blocks** on an element: *stylistic* overrides for `hover`, `pressed`, `focused`,
   `disabled` (closed set, target-checked) or a boolean expression over state. A `when` block is
   self-declaring — no separate `states` header — and any number may appear on one element. This is
   not `if`: `if` selects nodes, `when` overrides properties of the element it is attached to.
   Document that distinction in the spec, prominently — it is the kind of thing users get wrong once
   and then understand.
4. **`enter=` / `exit=`** for mount/unmount: Flutter `AnimatedSwitcher` + `TweenAnimationBuilder`,
   HTML keyframes + `animationend` removal.
5. **Capability `motion`** answered `full` by Flutter, `full` by the HTML target (CSS), with a note
   on what `pressed`/`focused` mean on a static page.
6. **Accessibility gate:** motion respects reduced-motion. Flutter: `MediaQuery.disableAnimations`;
   HTML: `@media (prefers-reduced-motion: reduce)`. A language whose animations ignore this is not
   shippable in 2026.

**Acceptance:** `examples/motion` (a card grid where hover/press/add transitions compose) with
goldens for both targets; a widget test in `flutter-verify.yml` that taps through a state change and
asserts the transition widget appears; a test asserting reduced-motion lowers correctly; zero
hand-written animation code in host Dart.

### P3 — Responsive composition as a language construct

*Why:* "responsive design" is in the original brief and **does not exist** in the language today
(grep finds it only in roadmap prose). Retrofitting it after motion would force restyling every
example.

```plainui
theme App:
    breakpoint sm = 480
    breakpoint md = 768
    breakpoint lg = 1200

screen Dashboard:
    responsive:
        below sm:
            column padding=sm gap=sm:
                Stats
                Feed
        below md:
            column padding=md gap=md:
                Stats
                Feed
        from md:
            row padding=lg gap=lg:
                Sidebar
                Feed expand=true
```

**Deliver.**
1. **`breakpoint` tokens** (P1 machinery, new category), used only in `responsive:`.
2. **`responsive:` statement** with `below <bp>` / `from <bp>` arms. Semantics stated as rules the
   compiler can check: arms are matched **top-down, first match wins** over the viewport width; the
   set must be **exhaustive** — the smallest width is covered and the last arm is unbounded
   (`from <bp>`), else `PUI2601` — and no arm may be **unreachable** because an earlier one already
   covers its whole range (`PUI2602`). There is no implicit fallback branch: an uncovered range is an
   error, not a default.
3. **Lowering:** Flutter `LayoutBuilder`/`MediaQuery.sizeOf` selecting one subtree; HTML `@media`
   blocks with the compiled subtrees; no JavaScript required. A responsive screen that would compile
   to nothing on a target is refused, not emitted empty.
4. **Layout intent pass** (small, evidence-driven): `maxWidth`/`minWidth`/`aspect`/`fit` universal
   props, and stack anchors (`topLeft` … `fill`) instead of raw `align=`. Stop there — do not add
   speculative layout vocabulary without an example that demands it (this is exactly what
   `docs/12-implementation-plan.md` warns about).

**Acceptance:** `examples/responsive` reusing one set of components across three widths;
`tests/matrix.test.ts` asserts both targets port it; tests for the exhaustiveness and unreachable-arm diagnostics;
Flutter widget test at two surface sizes asserting different subtrees render; docs
`docs/15-responsive.md`.

### P4 — A runtime, an interactive preview, and `plainui test`

*Why:* the original brief asks for a runtime and for interfaces "rendered in a browser". Today the
HTML target is **static by design** — `state` renders its initial value, `effects` are `none`, forms
don't validate (see `src/targets/html.ts`). That honesty is right; the absence of a runtime is the
gap. This phase is what makes the language executable outside Flutter and gives the project its own
development environment.

**Deliver.**
1. **Specify the expression subset** (it is currently host-passthrough with no written grammar):
   literals, arithmetic, comparison, boolean, ternary, string interpolation, member access, method
   calls on host values, list literals, `Optional` narrowing. Write it as `spec §4` with a normative
   table of operators and precedence. **Do not** grow it into a general-purpose language: no
   user-defined functions, no loops in expressions, no assignment inside expressions. This is the
   line that keeps the language a design language.
2. **`src/runtime/eval.ts` — a semantic evaluator** for that subset, target-neutral, tested directly.
   This is the piece that turns "expressions" from a hand-wave into language semantics.
3. **A real HTML runtime** (`src/runtime/`): compile `.pui` to a small program IR
   (`src/project/ir.ts`), plus a self-contained JS runtime (no framework, no CDN, no network) that
   mounts a DOM tree and implements `state`, `derived`, `if`/`for`, `on …` handlers, `set`,
   `navigation` (hash routes), validation for `form`/`submit`, `when` states, and `motion` via CSS.
   `task` runs against declared host surfaces imported as ES modules where available, and otherwise
   reports the same capability limit it reports today.
4. **Capability table rewritten honestly** — `html` moves to `state: full`, `effects: full`,
   `forms: full`, `motion: full`, with narrowed notes where the DOM genuinely can't match (e.g. list
   identity). `tests/matrix.test.ts` and `tests/targets.test.ts` must reflect the new answers.
5. **`plainui studio`** — the development environment the brief asks for: project tree, incremental
   build, live interactive preview in an iframe, diagnostics list that clicks through to source,
   a "generated code" pane (Dart / HTML), token inspector. Reuse the playground's bundling approach
   (`scripts/playground.ts`: esbuild on demand, same compiler modules, nothing uploaded). **Bind
   `0.0.0.0`**, accept the sandbox preview origin, keep all assets local.
6. **`plainui test`** — headless interaction specs run in `jsdom` against the same runtime:

   ```plainui
   test "counter increments":
       open Counter
       tap "Add"
       expect text "1"
       expect state count = 1
   ```

   Scope strictly to: `open`, `tap`, `type`, `expect text|state|visible`. Anything more is a later
   version. This single command is what turns the interaction system from "documented" to "verified
   without a Flutter SDK", which matters for CI and for the playground.

7. **LSP completion and go-to-definition** — the two items `docs/06-roadmap.md` names as missing.
   Completion for tags, properties, tokens, styles, events and in-scope state; go-to-definition for
   component references, imports and tokens. The checker already computes legal names per position;
   exposing them is the work, not re-deriving them.

**Acceptance:** the playground keeps working *and* becomes interactive; `plainui test` runs ≥3 specs
that fail when the runtime is wrong; `npm test` remains SDK-free; completion returns the registry's
properties for a tag and go-to-definition lands on the declaration line, both asserted in
`tests/lsp.test.ts`; docs `docs/16-runtime.md` states exactly what the runtime implements and what it
does not.

### P5 — Standard library, component events, and the ten-minute path

*Why:* a language without a library is a syntax; a component system that cannot raise events is not a
component system. Both are named in the original brief ("standard library", "component system").

1. **Component events** — the missing composition primitive:

   ```plainui
   component Stepper(value: Int, min: Int = 0, max: Int = 10) events change(Int):

       row gap=sm:
           button "-" disabled=value <= min:
               on tap:
                   emit change(value - 1)
           text "${value}"
           button "+" disabled=value >= max:
               on tap:
                   emit change(value + 1)
   ```

   Call site reuses existing `on` syntax:

   ```plainui
   Stepper(qty, min=1):
       on change:
           set qty = value
   ```

   Semantics: an event is declared once, must be raised with the declared payload type (`PUI2701`),
   and is optional at call sites unless marked `required` (`PUI2702`). Lowering: Flutter
   `ValueChanged<T>` constructor param; HTML runtime a callback in the program IR. **This closes an
   open question in `docs/06-roadmap.md` — update that question with the answer rather than leaving
   both.**

2. **`stdlib/`** — portable components written *in PlainUI*, imported as
   `import "plainui:ui/empty_state.pui"`:
   start with `NavBar`, `Sidebar`, `ListRow`, `EmptyState`, `Avatar`, `Badge`, `Field`, `Stepper`,
   `Stat`, `Toolbar` — no chrome/app-bar primitives, which are target-owned. Rules: core elements
   only (no host calls, no target-specific vocabulary), a doc page generated from the sources, and an
   exercise of each in `examples/gallery`. The stdlib versions with the compiler; no network fetch and
   no package manager in V1.
3. **`plainui new <template>`** — `app`, `landing`, `dashboard` starters with a runnable preview and
   no dead code.
4. **The ten-minute path:** install → `plainui new` → edit one screen → `plainui studio` → see it
   change. Written as a tutorial that is executed in CI (`tests/tutorial.test.ts` runs the commands).

### P6 — Earn the language claim: second target, packaging, versioning

Only after P1–P5 are green. These are the credibility items, not features.

1. **Jetpack Compose target** — the proof that the language is not Flutter in disguise: `state`→
   `remember { mutableStateOf }`, `derived`→`derivedStateOf`, `task`→`produceState`,
   `effect`→`LaunchedEffect`, `motion`→`animate*AsState`, `responsive`→`BoxWithConstraints`. The
   `Target` contract and capability matrix already exist; this is the test of whether they were
   designed right. Gate: one project compiles to Flutter **and** Compose, both CI-verified, with a
   test asserting which files port and which fail with a named code.
2. **Install path** — publish `@plainui/compiler` with a release workflow that packs, installs into a
   scratch project and runs the smoke test before publishing (`docs/11-todo.md` "Release pipeline").
3. **Versioning policy** (`docs/18-versioning.md`, plus the existing `CHANGELOG.md`): semver promise,
   clinical deprecation windows (`PUI2207` aliases are already scheduled for removal in 2.0.0),
   how capabilities may change level, and what "stable" means for the specification.
4. **Docs site** — `npm run docs:site` renders `docs/` + generated reference + the standard library
   into static HTML, served by `plainui studio`. The original brief's "documentation system" is
   already generated-and-checked; this makes it navigable.

---

## 4. Engineering rules that are not negotiable here

These are the repository's existing conventions. A change that violates one is a change that is wrong
for this codebase, however good it looks.

| Rule | Why it exists | What it means for you |
|---|---|---|
| **The registry is the single source of truth** (`src/analysis/widgets/registry.ts`) | validator, docs generator and LSP all read it; a test fails if the generator disagrees | a new element/property is one registry entry **plus** one emitter per target |
| **Diagnostics have stable codes** | `plainui explain`, CI depends on codes, not prose | every new failure mode gets a code from the right range and a caret span |
| **The front end names no framework** | `src/targets/contract.ts` invariant | no `Dart`, `Flutter`, `setState` in `src/frontend/`, `src/analysis/`, or in diagnostics |
| **Capabilities are declared, not inferred** | prevents silent degradation | add the capability to `CAPABILITIES`; every target answers `full`/`partial`/`none` |
| **Goldens are reviewed, not regenerated blindly** | they are the regression test for emitted code | `npm run goldens`, then read the diff |
| **Generated docs are drift-checked** | `npm run docs:check` fails on staleness | update the generator, not the page |
| **Every behaviour change ships with the test that would have caught it** | `README.md` contributing rule | no feature without a failing-first test |
| **Additive syntax only within 1.x** | existing `.pui` files and examples must keep compiling | new keywords are new; never repurpose `set`, `on`, `style`, `theme` |
| **No runtime dependency in Flutter output** | generated Dart is ordinary Dart | motion/responsive must lower to framework primitives, not a helper package |
| **Indentation rules stay** | `PUI1003`–`PUI1005` are the language's identity | new blocks must obey them and the formatter must format them |

Also keep the repository's voice: documents argue from evidence, name the risk, and say what would
reopen a decision. Do not write marketing copy in `docs/`.

---

## 5. Non-goals — refuse these explicitly

- **A rendering engine, scene graph, compositor or layout solver of our own.** Reading A (§2).
- **A general-purpose programming language.** No user functions, no top-level control flow, no
  classes, no imports of logic. Logic lives in the host with a declared, checked surface.
- **A CSS clone.** No cascade, no selectors, no specificity, no `!important`. If a CSS idea is worth
  having, it becomes a design-language construct with target-verified lowering.
- **A JSX/TSX or Flutter-widget rename.** No framework nouns in the surface syntax, ever.
- **Component marketplaces, plugins, a package registry, a build system of our own.** Out of V1.
- **Implementation of every roadmap idea.** `docs/11-todo.md` is the ordered truth; a phase is not
  started because it is interesting.
- **Silent approximations.** If HTML can't do it and Compose can't do it, it's `none` and a code.
- **Renaming the language.** It is PlainUI and the identity is established; renaming is churn with no
  user value. Refine the positioning statement instead.

---

## 6. Definition of done for this brief

The brief is complete when all of the following are true — each is checkable, and each maps to the
original prompt's deliverables:

- [ ] A `.pui` file can style **any** element with tokens and named styles, with typography, shadow,
      duration and curve tokens; no literal colour or spacing needed outside `theme`.
- [ ] Motion is language syntax (implicit transitions, named motions, `when` states, enter/exit) and
      respects reduced-motion, with goldens for both targets.
- [ ] Responsive composition is language syntax with exhaustiveness checking, lowered to
      `LayoutBuilder` and to CSS `@media` — not to JavaScript.
- [ ] Components raise typed events, and a standard library of portable components ships with the
      compiler.
- [ ] A specified expression subset exists with its own grammar and evaluator; the HTML target **runs**
      state, derived values, effects, forms and navigation in a browser through a real runtime.
- [ ] `plainui studio` serves an interactive, hot-rebuilding environment on `0.0.0.0`, and
      `plainui test` verifies interaction specs headlessly without a Flutter SDK.
- [ ] At least one example app uses every new construct together (`examples/showcase`), is compiled
      for both targets, and is exercised by the matrix test.
- [ ] Every new construct has: spec section, registry entry, per-target lowering, capability answer,
      diagnostic codes, golden file, doc page, and an example.
- [ ] `npm run verify` and `npm run docs:check` are green, and `npm test` still runs with no network
      and no Flutter SDK.
- [ ] `docs/10-decisions.md` records: Reading A over Reading B, the `when`-vs-`if` distinction, the
      motion model, the responsive exhaustiveness rule, and the runtime's honest scope — each with
      the condition that would reopen it.

**Report format at the end of each phase:** added syntax (with spec § anchors) · new diagnostic codes
· capability-table changes · lowerings per target · files touched · tests added and total count ·
examples added · what is deliberately still missing.

---

## 7. How this differs from the prompt you wrote

| Original clause | Problem it had | What the rewrite does |
|---|---|---|
| "Develop an entirely new programming language" | reads as greenfield; invites rebuilding what exists | opens with verified inventory of what is already shipped and forbids rebuilding it |
| "Not another CSS alternative, JavaScript framework, UI library" | true but undefined in practice | defines the boundary positively: own design semantics, delegated rendering — and names the clean-room alternative with its cost |
| "Its own syntax, rules, execution model" | "execution model" was ambiguous | splits it: own **semantics + evaluator + runtime** for the browser; target-owned **execution** for hosts |
| "Styling system … colours, typography, spacing, borders, shadows, effects" | half exists; the ask was unmeasurable | P1 with the exact missing families, precedence rule, and acceptance criteria |
| "Layout engine … grids, positioning, alignment, responsive" | implies a layout solver | P3: breakpoints, exhaustiveness semantics, `LayoutBuilder`/`@media` lowerings, intent props only where an example demands |
| "Interaction system … events, transitions, animations, states" | events exist; motion does not | P2: named motions, `animate=`, `when` states, enter/exit, reduced-motion gate |
| "Responsive design — native mechanisms" | absent from the language entirely | treated as a first-class construct with compile-time coverage checking |
| "Compiler, interpreter, or runtime" | ambiguous | keeps the compiler, adds a genuine runtime for the web target — the one place a runtime pays for itself |
| "Design tokens, themes, color systems" | colour/space/radius exist | extends to typography/shadow/motion/breakpoints, plus compile-time theme modes |
| "Developer experience, error messages, debugging, project organisation" | already strong; the brief risked duplication | keeps 112 codes + formatter + LSP, adds studio, `test`, completion, go-to-definition |
| "Standard library, documentation system, starter projects" | unnamed scope | P5: `plainui:` imports, 10 portable components, `plainui new`, CI-executed tutorial, docs site |
| "Complete language ecosystem, not a proof of concept" | unfalsifiable | replaced by a definition-of-done checklist and per-phase acceptance criteria |
| "Versioning and future evolution" | listed as a wish | P6: semver policy, deprecation windows, capability-change rules, Compose as the proof |
| "Do not attempt every advanced idea immediately" | correct but unenforced | phase gates; anything not in a phase goes to `docs/11-todo.md` as data, not prose |

---

## 8. Appendix — where new things live

| Concern | Location | Note |
|---|---|---|
| New element/property | `src/analysis/widgets/registry.ts` | plus one emitter per target; docs regenerate |
| New statement syntax | `src/frontend/parser.ts`, `src/frontend/ast.ts` | formatter support in `src/tooling/format.ts` is part of the feature |
| New semantics/type rules | `src/analysis/check.ts` | codes in `src/analysis/diagnostics.ts` |
| New capability | `src/targets/contract.ts` → `CAPABILITIES` | both targets must answer; `tests/targets.test.ts` enforces |
| Lowering | `src/codegen/flutter.ts`, `src/codegen/html.ts` | goldens under `tests/golden/` |
| Runtime & evaluator | `src/runtime/` (new) | program IR in `src/project/ir.ts` (new) |
| Studio | `src/tooling/studio.ts`, `web/studio/` (new) | reuse `scripts/playground.ts` bundling |
| `plainui test` | `src/tooling/test.ts` (new) | jsdom; specs in `.pui` `test` blocks |
| Stdlib | `stdlib/ui/*.pui` (new) | imported as `plainui:ui/...`; resolved by `src/project/paths.ts` |
| Spec | `docs/01-language-spec.md` | normative; new sections numbered, not appended as "extra" |
| Decisions | `docs/10-decisions.md` | one entry per non-obvious call, with a reopening condition |

**Suggested code ranges** (keep the existing allocation): `PUI23xx` styles/tokens/motion,
`PUI26xx` responsive, `PUI27xx` component events, `PUI32xx` runtime/studio/test, `PUI41xx` stdlib
imports. Never reuse a retired code.

**Proposed doc numbering:** `13-styling.md`, `14-motion.md`, `15-responsive.md`, `16-runtime.md`,
`17-stdlib.md`, `18-versioning.md`; cross-link from `README.md`'s table and let `docs:check` guard
them.

---

## 9. Handoff

This brief ends where the original prompt's V1 ends, not where the language ends: it delivers a design
layer complete enough to be taught, tested and extended, and it deliberately leaves the ambitious
surface (component callbacks with closures, animation timelines, design intelligence, a second
framework family, runtime theme switching, layout solving) to later versions. What must survive the
handoff is the **mechanism**, not the feature list: a specification that is normative, capabilities
that are declared, diagnostics that are coded, decisions that record their own reopening condition,
and examples that are compiled on every commit. Add the next feature through those five doors, and
the language keeps its identity; add it around them, and it becomes another framework with a
different syntax.
