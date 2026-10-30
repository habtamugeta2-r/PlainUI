# Decision record

The decisions that shape the language, each with the reasoning and **the trigger that forces a
revisit**. They are provisional by design: a decision with no revisit condition is a guess that
nobody is allowed to correct.

The plan these decisions serve is in [`09-vision.md`](09-vision.md); the work they order is in
[`11-todo.md`](11-todo.md) (generated from `src/tooling/todo.ts`, printed by `plainui next`).

Status legend: **decided** (act on it), **provisional** (act on it, cheap to reverse),
**deferred** (deliberately not now, with the condition that unblocks it).

---

## A. Identity

### A1 — PlainUI owns its type system — *provisional, lands in v2.0*

`.pui` files write `Text`, `Int`, `Float`, `Bool`, `Color`, `Duration`, `List<T>`, `Optional<T>`.
Each target maps them (`Text → String / String / string`). Dart's spellings (`String`, `int`) remain
accepted as deprecated aliases during 1.x and are rewritten by `plainui migrate`.

**Why:** a type error has to read the same in every target, and the mapping *is* what makes a second
target a compiler rather than a translator. Dual syntax forever is how languages accumulate
ambiguity, so the aliases are time-boxed.

**Revisit when:** a target needs a type PlainUI cannot express without leaking host syntax (for
example a Compose `Modifier`, a TS discriminated union). Then the type system is wrong, not the target.

### A2 — Nullability is explicit — *provisional, lands with A1*

There is no implicit `null`. Absence is `Optional<T>`; a value is either present or asked-for, and
`.orElse(...)` / `if x.exists:` are the only ways through. Host interop converts at the boundary.

**Why:** null is exactly where cross-target semantics diverge (Kotlin `?`, Swift `Optional`, TS
`| null`, JS `undefined`). One rule everywhere beats four faithful translations of four different
habits.

**Revisit when:** interop with a null-heavy host API turns every call site into a ceremony. Then the
fix is an explicit `fromHost()` conversion, not nullable-by-default.

### A3 — The expression language is frozen; capability arrives as named constructs — *decided*

Expressions stay a checked subset (literals, identifiers, arithmetic, comparisons, calls, member
access, ternaries, list literals). "I need `.where().map()`" is answered with a construct
(`list items filteredBy=query sortedBy=name:`), not by accepting arbitrary Dart.

**Why:** a named construct can be lowered per target and diagnosed per target; an arbitrary
expression can only be passed through to one host language.

**Revisit when:** a construct is so general that its lowering is a tiny expression interpreter —
that is a sign the construct should have been syntax, not that expressions should be unbounded.

### A4 — What PlainUI will never do — *decided*

Not a layout engine, not a state-management framework, not a design tool, not a general-purpose
language. Specifically out of scope: custom painting, slivers and other target-only layout
primitives (namespaced escape hatch instead), persistence, threading, navigation *transitions*
beyond the platform default, and any construct whose only faithful lowering is one target.

**Why:** every DSL that died of ambition died by becoming a worse host language.

**Revisit when:** never for the last item; the rest can move if a *named construct* proves portable
in two targets, which is a data question, not an opinion.

---

## B. Programming model

### B1 — `derived` recomputes; memoisation comes later — *provisional*

`derived total = price * count` is a pure function of its inputs, recomputed when the widget builds.
A Flutter getter, a React `useMemo`, a Compose `derivedStateOf` — the semantics are "recompute", the
optimisation is per target.

**Why:** correctness first, and memoisation needs explicit dependencies, which is B2's syntax. Adding
memoisation before the dependency syntax exists means inventing implicit tracking, which is the one
design that does not survive four targets.

**Revisit when:** a real app shows a `derived` in a hot path (a long list rebuilt per frame). Then
memoise *with* explicit dependencies, never with implicit ones.

### B2 — `effect on <state>` names its dependencies — *implemented*

```
effect on query:
    set results = search(query)
```

The effect runs once after the screen mounts and again whenever one of the states it names changes,
and at no other time.

**Why:** it is the only spelling that lowers to `useEffect([query])`, `LaunchedEffect(query)` and a
Flutter comparison with the same meaning. "Run after every change" is a re-render loop waiting to
happen; implicit tracking cannot be expressed in Flutter at all.

**Correction to the original lowering.** This record said `didUpdateWidget` with a key comparison.
That hook fires when a parent rebuilds the widget, not when the screen's own `setState` runs, so it
would have produced an effect that never reacts to the state it names. The lowering is a nullable
snapshot field compared at the top of `build`, with the body in an `addPostFrameCallback` — the same
"compare the dependencies, then run after the frame" that `useEffect` performs, written out. The
naive alternative, a `setState` that runs the effect inline, is exactly the shape Dart forbids.

**Also decided:** an effect runs on mount. `useEffect` runs after the first commit and
`LaunchedEffect` runs when it enters composition, so "only on later changes" would be a third
semantic for the same word. Nullable snapshots give the mount run for free.

**Revisit when:** an effect needs to depend on a *derived* value, which is common enough to be
expected. The answer is to allow `effect on <derived>` and document the recomputation cost, not to
invent implicit tracking.

### B3 — `task` gains parameters and reload-on-change — *deferred*

`task results(query: String) = search(query)` re-runs when `query` changes, superseding the current
load. Today a task runs once on creation and on `retry()`, which covers the simple case and is
honest about the hard one.

**Why deferred:** reload-on-change is cancellation plus equality, and both need B4 first.

**Revisit when:** B4 lands. Then a task parameter is a dependency, exactly like `effect on`.

### B4 — Latest-wins cancellation — *decided, small*

Every load carries a sequence number; a result whose sequence is not the current one is discarded.
A `retry()` during an in-flight load cannot be overwritten by the older result.

**Why:** without it the most natural user action (retry after a slow load) produces the wrong data,
intermittently, which is the worst class of bug.

**Revisit when:** a target offers real cancellation (a `CancellationToken`) — then the sequence
number stays as the correctness guarantee and cancellation becomes the optimisation.

### B5 — Typed errors: `Result<T, E>` — *deferred until A1/A2*

`task.error` is a `String` today (the exception's text). It becomes `Result<T, E>` with a mapped
error type per target.

**Why deferred:** a cross-target error type needs the type system (A1) and the absence rules (A2) to
exist first, or it will be a string with extra steps.

**Revisit when:** A1/A2 land, or when a user needs to branch on error *kind* rather than show text.

---

## C. Architecture

### C1 — Target discipline per feature, extraction at v2.0 — *implemented*

Every feature from here on writes its target-specific work behind one function per target, even
while the targets share a file. The `Target` interface extraction at v2.0 is then mechanical.

**Why:** extracting the interface first would freeze vocabulary before the features that test it
(navigation's route table, forms' validators) exist.

**Revisit when:** a feature needs a target-specific *checker* rule, not just an emitter. That is the
signal the interface is overdue.

**Outcome (v2.0):** the signal arrived — the checker held Dart's keywords and Material's type names,
so a second target would have meant a second checker. The extraction was mechanical as predicted:
the constants became `Target` fields, each use became `this.target.…`, and no rule changed shape.
See C5 for the parts that were not mechanical (capabilities, message wording).

### C2 — Portability is a project setting, checked per file — *implemented*

`plainui.config.json` declares the project's targets (`"targets": ["flutter", "compose"]`). The
compiler fails a file that uses a construct outside the intersection, naming the file, the construct
and the code.

**Why:** a file-level directive is easy to forget and impossible to verify across a project; a flag
is invisible in the repository. The config is the only place that is both checked in and checkable.

**Revisit when:** a project legitimately mixes (a Flutter-only admin screen next to portable
screens). Then a per-file override is justified — as an exception the config allows, not as the
default.

**Outcome (v2.0):** `"targets"` is read from the config, validated at load (an unknown id fails
with the list of known targets), and threaded into the checker as a set of `Target` records. Each
capability site asks twice: can the **build** target express this (`PUI2501`), and can every
**promised** target keep up (`PUI2502`, `partial` included — a construct that ports with different
behaviour is exactly what the setting exists to catch). `tests/matrix.test.ts` compiles every
example for Flutter *and* the HTML preview and asserts the resulting table, so a construct that
gains a lowering has to update the table on purpose.

### C3 — "Verified" means compiled — *decided*

A target is supported when its output is compiled by the target's own toolchain in CI, plus
structural checks on every commit. For Compose that means a Gradle job, not only a structural
checker.

**Why:** the vision promises "the generated host code compiles". A structural checker cannot promise
that, and a roadmap that cannot keep its promises is marketing.

**Revisit when:** never. If CI cost becomes the objection, the answer is a smaller matrix, not a
weaker claim.

### C4 — Type maps belong to targets — *decided*

Each target owns its mapping table. There is no shared "lowest common denominator" table.

**Why:** a shared table is how Compose would inherit Dart's shape of thinking, and how "faithful
lowering" quietly becomes "uniform output".

**Revisit when:** three targets need the same conversion *and* disagree about nothing. Then it is a
shared helper, not a shared model.

### C5 — A target declares what it can do; the front end asks and names none — *decided*

`Target` carries a fixed set of nine capabilities, and every target answers for every one of them
with a level (`full`, `partial`, `none`) and one sentence saying how it delivers it. `none` is an
error (`PUI2501`, whose hint is the target's own note); `partial` is legal and documented.

**Why:** a capability model with holes lets a target forget to have an opinion, and a `none` that
generates anyway produces output that looks finished and silently does nothing — the failure mode
PlainUI exists to prevent. Making the note *the* hint means the person who wrote the lowering also
wrote the explanation, and the two cannot drift.

**Why the level split:** a static preview genuinely renders a task's not-yet-loaded state, and
calling that "supported" would be a lie, while refusing it would make the preview useless. `partial`
is the honest middle, and because the note is required prose, "partial" can never be a shrug.

**Why the front end owns so much:** name and type rules *are* target rules (`late`, `Card`, `Int`,
`spaceBetween`), and they must be applied while checking, before any generator runs. What stays in
the generator is what only matters after acceptance: constructor names, argument maps, icon names,
style lowering. `style=heading` itself is language vocabulary (`src/analysis/styles.ts`), because a
shared style name is not one target's idea — how to paint it is.

**Revisit when:** a target needs a capability at a *finer* grain than the construct (for example,
Flutter supports `task` but not a task that reloads on argument change). Then capabilities become
per-construct levels, and the current enum is the special case where they agree.

---

## D. Tooling and product

### D1 — The vision is cross-platform; the wedge is Flutter teams — *decided*

Sell "one screen, one design system, two platforms" to teams already shipping both; start where the
code is (Flutter) and where the verification is real.

**Why:** a multi-target language with one working target is a promise; a Flutter language with great
ergonomics is a product.

**Revisit when:** the Compose target ships and a real project builds both from one source. Then the
vision becomes the pitch.

### D2 — Incremental adoption is the adoption path — *decided*

PlainUI must be adoptable one screen at a time inside an existing Flutter app: generate into a
subdirectory, import one widget, keep everything else. This is true today and undocumented.

**Why:** no team rewrites an app to try a language. The first screen is the entire sales pitch.

**Revisit when:** a `build_runner` builder exists — then adoption can be a dev dependency instead of
a CLI invocation, which is better, but not a requirement.

### D3 — The roadmap is data — *decided, this document's sibling*

`src/tooling/todo.ts` is the source of truth: `plainui next` prints it, `docs/11-todo.md` is rendered
from it, and the test suite refuses an item with no acceptance criterion.

**Why:** prose roadmaps rot silently. A roadmap that is checked by CI cannot.

**Revisit when:** the table outgrows one file (past ~50 items), which is a good problem and a
mechanical split.

### D4 — Releases are automated before they are public — *decided, deferred in time*

One version source, changesets, CI that packs the tarball, installs it into a scratch project and
runs the smoke test before anything is published.

**Why:** the current manual `npm pack` is exactly how a broken tarball reaches users once.

**Revisit when:** an announcement is scheduled, or a second person needs to cut a release.

### D5 — One Flutter version until a bug says otherwise — *decided*

CI runs Flutter `stable`. A version matrix is added when a user reports a version-specific failure.

**Why:** a matrix is CI cost bought with no information until there is a failure to explain.

**Revisit when:** the first version-specific bug report.

---

## How these decisions are kept honest

- Every decision above that is not yet implemented appears in [`11-todo.md`](11-todo.md) as an item
  with an acceptance criterion.
- A decision that turns out wrong is edited here, with the trigger that fired written next to it —
  the record keeps the *reason*, not just the outcome.
- `docs/07-reference.md` and `docs/05-diagnostics.md` are generated from source, so the language
  reference cannot drift from what the compiler does.
