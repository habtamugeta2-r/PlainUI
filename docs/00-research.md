# PlainUI — Prior Art and Design Research

> This document is the research that precedes the implementation. It surveys how other
> languages and compilers solved the same problems, extracts the lessons that matter, and
> then fixes the design decisions that the rest of the repository implements.
>
> Companion documents: [`01-language-spec.md`](01-language-spec.md) (what `.pui` means),
> [`02-architecture.md`](02-architecture.md) (how the compiler is built),
> [`05-diagnostics.md`](05-diagnostics.md) (the error catalogue).

---

## 0. The question we are actually answering

PlainUI is not "a new UI framework". Flutter, Compose and React already solve rendering,
layout, and state propagation. The claim under test is narrower and sharper:

> **A line-oriented, indentation-scoped surface syntax can describe the same widget tree as a
> host-language declarative API, with less ceremony, without losing the ability to escape back
> into the host language.**

That means the research has to answer four questions:

1. **Has this been done?** Which languages already let you describe a UI by indentation, and
   what happened to them?
2. **Why did host-language DSLs win anyway?** SwiftUI, Compose, JSX and Flutter all chose to
   stay *inside* a general-purpose language. Why, and when is that the wrong trade-off?
3. **Where do indentation languages break?** Tabs, ambiguity, error recovery, and tooling.
4. **How do you compile this thing?** Source-to-source code generation in a host ecosystem,
   and what the generated code must look like for the framework to accept it.

The remaining sections answer those questions, and §6 converts them into a decision log.

---

## 1. Prior art: indentation-scoped UI description languages

### 1.1 Kivy KV language (Python) — the closest ancestor

KV is the single most direct precedent: an indentation-based language in which widget trees
are declared by nesting, properties are written `key: value` on the widget they belong to, and
event bindings are written `on_press: root.do_thing()`. The Kivy documentation states the
motivation explicitly: hand-building widget trees and bindings in Python becomes "verbose and
hard to maintain" as the application grows, and KV is "an attempt to overcome these
shortcomings" by separating UI description from logic [1](https://github.com/kivy/kivy/blob/master/doc/sources/guide/lang.rst).

Lessons taken:

* **Nesting by indentation works in practice** for real applications — KV has shipped in
  production apps for a decade.
* **Property syntax must be unobtrusive.** `key: value` reads well; `padding=24` reads
  better in a language where the value can also be an expression, so we adopt `key=value`.
* **Event handlers are the natural seam** between the DSL and the host language
  (`on_press: root.login()` ↔ our `on tap:`).
* **KV's weakness is that its expressions are Python.** The compiler must therefore
  *understand* enough of the host language to validate anything. PlainUI takes the same
  bargain (Dart-flavoured expressions) but limits expressions to a small, checked subset and
  validates identifiers against declared state, loop variables and component parameters.

### 1.2 Slint (`.slint`) — declarative UI DSL that compiles to native code

Slint describes UIs in a markup language and **compiles them to native code** — "the
compiler uses the typical compiler phases of lexing, parsing, optimization, and finally code
generation", with multiple back-ends producing C++, Rust, or interpreted output
[2](https://github.com/slint-ui/slint). Its published goals include independent UI design, a
language server, and a live-preview viewer — *tooling parity is treated as part of the
language*, not an afterthought [3](https://slint.dev/blog/announcing-slint-1.0).

Lessons taken:

* **Compile ahead of time; do not interpret.** PlainUI emits ordinary Dart files that Flutter
  then compiles. There is no PlainUI runtime and no new render loop.
* **One front end, many back ends.** PlainUI keeps the AST framework-independent and puts
  everything framework-specific in a generator, exactly as Slint does for its back-ends.
* **Tooling is a feature.** Diagnostics, a formatter and a watcher ship in v0.1 rather than
  "later", because indentation languages are unforgiving without them.

### 1.3 Qt QML, XAML, and other markup UIs

QML and XAML prove that markup UI description is viable at industrial scale; they also show
the failure mode: once the markup needs logic, it either grows a scripting sub-language (QML's
JavaScript) or forces everything into code-behind (XAML's C#). Both blur the "UI only" line
that PlainUI explicitly refuses to cross.

Lesson taken: **do not let PlainUI grow into a general-purpose language.** Event bodies are
restricted to `set`, calls, and `if`. Anything more belongs in Dart.

### 1.4 Haml, Slim, Pug — indentation as the syntax, and where it hurts

Indentation-based template engines are the best available evidence for how this syntax fails
in the wild. Their error catalogues are instructive: `Indentation can't use both tabs and
spaces`, `Inconsistent indentation: %s used for indentation but the rest of the document used
%s`, `The line was indented %d levels deeper than the previous line`, `Illegal nesting: content
can't be both given on the same line and nested within it`
[4](https://www.rubydoc.info/gems/haml/4.0.7/Haml/Error).

Tabs-versus-spaces is not a theoretical concern; Python 3 had to introduce `TabError` because
"a tab might render as 4 spaces in one editor, 8 in another", so a file could look correct and
parse wrong [5](https://algomaster.io/learn/python/indentation). YAML took the stricter route
and banned tabs in indentation outright — with the consequence that the single most common
YAML error is a tab character [6](https://devessentials.dev/learn/yaml-for-developers).

Lessons taken (these are hard requirements, not preferences):

* Tabs and spaces **mixed inside one indentation run** is an immediate, precise error.
* Indentation **width is inferred per file**, not hard-coded to 4, so 2-space files do not
  produce cascading nonsense. A block is opened by *any* deeper indent; siblings must match
  exactly; a dedent to a column that never existed is an error with the two candidate columns
  named.
* "Content on the opening line **and** nested content" is rejected for nodes — the same class
  of ambiguity Haml had to patch. The one deliberate exception is a single inline action after
  an event (`on tap: set x = 1`), which is unambiguous because actions cannot nest children.

---

## 2. Prior art: embedded DSLs in host languages

### 2.1 SwiftUI result builders

SwiftUI's declarative syntax is *sugar over ordinary Swift*: property wrappers, trailing
closures, and result builders that "collect the values computed in your DSL's code into a
return value" [7](https://developer.apple.com/videos/play/wwdc2021/10253/). Apple's own framing
of why the DSL exists is the sentence PlainUI is built on: without it you would be "creating
temporary variables all over the place to hold individual views, and the result wouldn't really
convey the way the views are nested".

Lessons taken:

* **Nesting must be visible at a glance.** That is the entire value proposition; every grammar
  decision in `01-language-spec.md` is tested against it.
* **Sugar must remain a subset of the host language's semantics.** PlainUI generates the
  closure/`setState` code a Flutter developer would have written by hand, so debugging is
  never blocked by a missing runtime concept.

### 2.2 Jetpack Compose and Flutter: same model, more ceremony

A widely shared practitioner comparison of SwiftUI / Compose / Flutter makes the concrete
criticism worth quoting: Flutter's readability is "awful when compared with SwiftUI", because
Flutter "feels more like a traditional OO program… there's nothing in the syntax… that
expedites [building the tree] other than it supports trailing commas"
[8](https://www.reddit.com/r/iOSProgramming/comments/1e0z36s/swiftui_compared_with_jetpack_compose_and_flutter/).
Kotlin's Compose is closer to a DSL, but nesting is still expressed by repeated function calls
and argument lists, and conditional/loop children rely on scope receivers.

Lesson taken: **the win is real but it is a syntax win.** Therefore PlainUI must not invent new
semantics; it must map to the idiomatic host structures (`children: [...]`, collection-`if`,
collection-`for`, `setState`) so a Flutter developer reading the generated Dart recognises it.

### 2.3 Why embedded DSLs usually beat standalone ones

Embedded DSLs inherit the host's type checker, debugger, refactoring tools and package
ecosystem for free. A standalone DSL must rebuild all of it. PlainUI's answer is not to compete
but to **delegate**: the *expressions* and *event bodies* are host language, the *shape of the
tree* is PlainUI's, and the toolchain reuses the host compiler for the final check. PlainUI
does not type-check Dart; it checks UI-level invariants and then hands over.

---

## 3. Prior art: source-to-source code generation inside a real ecosystem

Flutter's ecosystem already normalises generated code. `build_runner` + `source_gen` support
builders that map `.dart` inputs to arbitrary outputs, configured through `build.yaml`, with
generated files next to or redirected away from their sources
[9](https://github.com/dart-lang/source_gen). Package authors routinely redirect outputs into
`lib/generated/` via `build_extensions` capture groups
[10](https://www.simonbinder.eu/posts/build_directory_moves/). Tools such as Freezed and
json_serializable have trained Flutter developers to accept "never edit the generated file,
edit the input" as normal practice.

Lessons taken:

* **The generated-file convention is already accepted.** PlainUI can adopt `home.pui →
  home.pui.dart` with a do-not-edit banner and lose nothing in developer trust.
* **Output location must be configurable**, because monorepos redirect generated code; hence
  `plainui.config.json` with `srcDir`/`outDir`.
* **Relative imports must be rewritten.** If `lib/ui/home.pui` imports `../widgets/app_logo.dart`
  and the output lands in `lib/generated/home.pui.dart`, the path string must be recomputed.
  This is the kind of detail that decides whether a codegen tool survives contact with a real
  project.
* **build_runner integration is a "later"**, not a v1 requirement: a standalone CLI
  (`dart run tool/plainui.dart build` in the original sketch) has a much smaller blast radius
  and can be wrapped in a `build.yaml` builder once the output is stable.

---

## 4. Prior art: what good compiler errors look like

Elm is the standard reference: errors are friendly in tone, quote the offending source with
carets under the exact expression, list near-miss candidates ("These names seem close
though"), and attach a hint [11](https://mccue.dev/pages/8-13-23-java-compiler-error-messages).
Rust is usually ranked alongside it for the same properties. Research summaries of developer
productivity converge on the same three properties: *provide context*, *use a positive tone*,
*show hints or solutions* [12](https://www.amazingcto.com/developer-productivity-compiler-errors/).

This matters more for PlainUI than for a general-purpose compiler, because an indentation
language has no redundant structure: one mis-indented line changes the meaning of the program
silently. A tool that reports `unexpected token` is unusable here.

Requirements adopted:

* Every diagnostic carries a **stable code** (`PUI1004`), a **span with a caret range**, a
  **one-line message in plain language**, and — where one exists — a **hint** with the fix.
* "Did you mean" suggestions are generated from edit distance over the actual *legal* set
  (widget tags, property names, enum values, state variables, style names) rather than being
  hand-written.
* Related spans are reported together, so a bad component call points at the declaration too.
* Machine-readable output (`--json`) exists from day one, because the playground, the watcher
  and any future editor integration all consume diagnostics, not log lines.

---

## 5. Feasibility assessment

The proposal's own risk table ranks basic layouts/state/events as "high" and cross-framework
consistency as "challenging". The research sharpens that:

| Area | Verdict | Why | Consequence for the build |
|---|---|---|---|
| Parse + validate + emit a widget tree | **Feasible, low risk** | Nothing but tree translation; no new runtime | Ship in v0.1 |
| State / events | **Feasible** | Maps onto `StatefulWidget` + `setState` | v0.2 |
| Two-way input binding | **Medium** | Needs `TextEditingController` lifecycle (init/dispose/sync) | Generated `initState`/`dispose` + a sync helper |
| Conditionals / loops as children | **Feasible, elegant** | Dart has collection-`if`/`for`; `.indexed` gives index loops | Direct emission |
| Cross-file components | **Medium** | Needs a module graph and import rewriting | Project-level compile |
| Host-widget interop | **Feasible** | Any capitalised tag is a constructor call | Escape hatch by convention |
| Animations / lifecycle / advanced state mgmt | **Meh** | Would need per-framework semantics leaking into the language | Deliberately out of scope for v1 |
| React/Compose generators | **Medium** | AST is framework-neutral, but *expressions* are Dart-flavoured | Second generator proves the seam; JS expression translation is an explicit later task |

The last row is the honest structural risk of the whole idea, and it is worth stating plainly:
**the AST can be framework-independent, the expressions cannot, unless the language grows a
target-neutral expression model.** PlainUI v1 therefore emits Dart expressions verbatim and
documents that constraint, instead of pretending portability is free.

---

## 6. Decision log

Each decision lists the alternative that was rejected. These are normative for the
implementation.

| # | Decision | Rationale | Rejected alternative |
|---|---|---|---|
| D1 | Indentation-scoped blocks, `:` opens a block | The core premise; proven by KV/Slint/Haml | `{}` braces with optional indentation |
| D2 | `//` line comments; `#` reserved for colours | `#` as comment collides with `#ff6b6b` colour literals — a real ambiguity seen in YAML/SCSS-adjacent languages | `#` comments, colour literals as strings |
| D3 | Tabs allowed, width 4; mixing tabs+spaces in one indent run is an error | Matches Python's `TabError` lesson without banning tabs | Tabs banned outright (YAML) |
| D4 | Indent width inferred per file; blocks open on *any* deeper indent; siblings must match | Keeps 2-space projects usable; error quality beats strictness | Enforce exactly 4 spaces |
| D5 | No content on a line that also opens a nested block — except a one-line action after `on <event>:` | Removes Haml's "illegal nesting" class of ambiguity | Allow `column: text "x"` |
| D6 | Lowercase tag = built-in widget (from a registry); Capitalised tag = component or host widget constructor | One rule that makes interop free and keeps the built-in vocabulary closed and checkable | Explicit `widget`/`native` keywords for every case |
| D7 | Properties are `name=value` on the element line; `=` is tight | Reads as a declaration, not an assignment; KV/XAML precedent | `name: value` (collides with block colon) |
| D8 | Expressions are a checked Dart-flavoured subset | Full Dart parser is out of scope; but *some* parsing is needed for validation, formatting and future targets | Opaque expression strings (no validation possible) |
| D9 | Unknown *value* identifiers are errors; unknown *called* identifiers are assumed host functions — unless a host surface declares them (D29) | Preserves "logic lives in Dart" without demanding declarations, while letting a file opt into checking the calls it cares about | Require `extern` declarations for every host function |
| D10 | `state name: Type = init`; only at screen/component top level | Keeps state model trivial and explicable | Nested/derived state, reactive graphs |
| D11 | `set x = e`, `set x += e` are the only mutations | Explicit and greppable; maps to `setState` | Implicit assignment |
| D12 | Event bodies auto-`async` when they contain `await` | Forget-proof; otherwise every async button needs a modifier | Explicit `on tap async:` everywhere |
| D13 | Generic layout properties (`padding`, `gap`, `width`, `expand`, …) work on **every** element via wrapper compositing | Avoids 25 near-identical property tables; `padding=` should never be widget-specific | Per-widget property duplication |
| D14 | Enumerated properties (`main=center`, `cross=stretch`, `align=topLeft`) are validated against closed value sets | Turns runtime asserts into compile-time "did you mean" | Free-form strings passed to Dart |
| D15 | Single-child containers wrap multiple children in a `Column` and **warn** | Never silently drops a child; still compiles | Error out / silently keep first child |
| D16 | Generated code is self-contained: no PlainUI runtime package | "Generated code is ordinary Flutter"; nothing to depend on, nothing to break | A `plainui_runtime` package |
| D17 | Generated files are written only when content changes, with a do-not-edit banner | Avoids build churn and accidental edits | Always rewrite |
| D18 | Imports: `package:`/`dart:` pass through; relative paths are re-based from `.pui` source to generated output | Necessary for real project layouts | Require developers to pre-adjust paths |
| D19 | Diagnostics are structured objects with codes, spans, hints, related info; `--json` supported | Elm/Rust lesson; needed by playground + future LSP | Print strings |
| D20 | Reference implementation is TypeScript/Node, emitting Dart | Independent compiler, testable here, runs in the browser playground; the *generated* artefact stays pure Dart | Writing the compiler in Dart (nothing wrong with it; see note below) |
| D21 | Language is versioned inside the file (`pui 1` implicit) and generators declare a target Dart/Flutter floor | Generated code should not silently require a newer Flutter | Unversioned output |

Decisions made while building the compiler, recorded after the fact because they changed the
shape of the product rather than the language:

| # | Decision | Rationale | Rejected alternative |
|---|---|---|---|
| D22 | A formatter ships with the compiler, and golden sources are required to be formatter-clean | A language without one canonical layout turns every diff into a style argument; making the goldens canonical keeps the formatter honest | Leave formatting to editors |
| D23 | A second target (static HTML) exists for previews | It is the cheapest way to prove the AST is host-neutral, and it gives the playground a real visual preview without a Flutter toolchain | Playground that only shows Dart |
| D24 | Project roots are derived from `plainui.config.json`, not from the working directory | `plainui build examples/counter` and running from a subdirectory both have to work, and only the config knows where a project starts | Always resolve against `cwd` |
| D25 | Diagnostic severity lives in the catalogue and call sites are checked against it | Severity is a property of the rule; a second table would drift. A test compares the catalogue with every `this.error('PUI…')` site | Per-site severity, documented by hand |
| D26 | Calls that mutate state run inside `setState`; other calls do not | `tasks.add(x)` without a rebuild is a silent bug, while wrapping host calls hides their side effects | Wrap every call / wrap nothing |
| D27 | The playground imports the compiler rather than calling a server | Same code path as the CLI, nothing uploaded, no cold starts; a test drives it through jsdom | Server-side compile endpoint |
| D28 | Examples are compiled on every commit and their `main.dart` is checked in | Documentation that cannot rot; the generated Dart stays out of git | Screenshots and prose |
| D29 | Host surfaces are written *in the `.pui` file*, on the import, and are opt-in per module | Declaring a module is a deliberate act with a payoff (call sites are checked, qualified calls name their module); files that do not need it are unchanged, which is what keeps D9 true | Require `extern` for the whole project / parse the imported Dart for signatures |
| D30 | The case of a declared name decides whether it is a function or a constructor | One rule, already true of elements (D6), so a surface needs no extra keywords and reads like the rest of the language | `fn`/`widget` keywords inside the block |
| D31 | `-> Future<T>` in a surface means "asynchronous, yields `T`" | The distinction that matters at a call site is awaitability, not the wrapper type; `Result` and friends are a v2 type-system question | A full `Future<T>` in the type model, unwrapped by every generator |

**On D29 — the prior art, and why not the alternatives.** Three ecosystems solve this problem
differently, and each one shows what the trade is:

* **ReScript `external`** (v11 manual, "External — Bind to Any JS Library"): every host binding is
  declared with a *mandatory* type, attributed with the module it comes from
  (`@module("path") external dirname: string => string = "dirname"`), and inlined at the call site
  with no runtime. That is the design adopted here, minus the mandatory part: PlainUI cannot make
  declarations mandatory without breaking D9 and every file that calls `log(…)`, but where a
  module *is* declared, the check is the same one ReScript performs.
* **Slint `callback`/`function`**: the `.slint` language declares `callback hello(int, string) -> int`
  and the host must install a handler; the DSL's surface is closed and typed, and the host side is
  generated from it (`on_hello`, `invoke_hello`). Closedness is right for Slint because the DSL is
  the whole program. PlainUI is embedded in an existing Dart app, so closing the boundary would mean
  declaring the host's entire API — which is why the closure here is per *module* and opt-in.
* **TypeScript `.d.ts` / `dart ffigen`**: declarations are *generated from* the host. This is the
  most faithful option and the most expensive one: it needs a Dart parser in the toolchain, and the
  generated file becomes a second source of truth to review. It is recorded on the roadmap rather
  than rejected — a `plainui bind` that writes a surface from an imported `.dart` file is the
  natural follow-up, and the surface syntax above is exactly what it would emit.

What the three share, and what PlainUI copies: **the declaration lives next to the call site's
module, is written in the language that makes the calls, and is verified against the host by the
host's own compiler.** The last part is free here — generated Dart is analysed in CI — and it is
what makes an opt-in surface safe: a surface that lies fails the build one step later.

**On D20.** The original sketch suggests `dart run tool/plainui.dart build`. Hosting the
compiler in Dart is a fine choice and is *the* right long-term choice for a Dart-first
ecosystem (no extra toolchain in CI, and `build_runner` integration becomes natural). It was
not chosen for this implementation because it makes the compiler untestable in the environment
the compiler was written in, and an unverified compiler is worse than an unconventional one.
The architecture is deliberately host-agnostic — the parser, AST, validator and generators have
no Node dependencies, so porting the front end to Dart is mechanical. This is recorded as a
roadmap item rather than a silent deviation: see [`06-roadmap.md`](06-roadmap.md).

---

## 7. What PlainUI deliberately does not do

* No new rendering, layout, or state-management model.
* No general-purpose language features: no functions, classes, generics, imports-with-logic,
  or networking. If you need it, write Dart.
* No stringly-typed framework escape hatches that bypass validation for the 25 built-ins.
* No promise that the *same* expressions compile to React/Compose in v1 (see §5).

---

## 8. References

1. Kivy documentation — Kv language (concept, rules, bindings): https://github.com/kivy/kivy/blob/master/doc/sources/guide/lang.rst
2. Slint — compiler architecture, back-ends, LSP: https://github.com/slint-ui/slint
3. Slint 1.0 announcement — DSL compiled to native code, tooling: https://slint.dev/blog/announcing-slint-1.0
4. Haml error catalogue — indentation and nesting error messages: https://www.rubydoc.info/gems/haml/4.0.7/Haml/Error
5. Indentation as grammar, `TabError`, spaces vs tabs: https://algomaster.io/learn/python/indentation
6. YAML indentation rules and the tab ban: https://devessentials.dev/learn/yaml-for-developers
7. Apple WWDC21 — "Write a DSL in Swift using result builders": https://developer.apple.com/videos/play/wwdc2021/10253/
8. Practitioner comparison of SwiftUI / Compose / Flutter nesting readability: https://www.reddit.com/r/iOSProgramming/comments/1e0z36s/swiftui_compared_with_jetpack_compose_and_flutter/
9. `source_gen` — build_runner code generation for Dart: https://github.com/dart-lang/source_gen
10. Redirecting build outputs into `lib/generated/`: https://www.simonbinder.eu/posts/build_directory_moves/
11. Why Elm/Rust error messages work (context, tone, hints, carets): https://mccue.dev/pages/8-13-23-java-compiler-error-messages
12. Survey of compiler error quality across languages: https://www.amazingcto.com/developer-productivity-compiler-errors/
13. ReScript manual — `external`, binding typed host values and modules: https://rescript-lang.org/docs/manual/latest/external
14. Slint language reference — `callback` and `function` declarations, host side generated from them: https://releases.slint.dev/0.2.5/docs/cpp/markdown/langref.html
15. `ffigen` — generating Dart bindings *from* the host's headers, the alternative recorded in D29: https://pub.dev/packages/ffigen
