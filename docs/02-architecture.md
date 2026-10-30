# Architecture

How a `.pui` file becomes Dart, and where to change things.

## The shape of the thing

```
             source text
                  │
              ┌───▼────┐
              │ lexer  │  indentation → INDENT / DEDENT tokens, comments kept aside
              └───┬────┘
              ┌───▼────┐
              │ parser │  tokens → AST (framework neutral: `Element`, not `Column`)
              └───┬────┘
              ┌───▼────┐
              │ check  │  names, types, properties, events → Analysis
              └───┬────┘
        ┌─────────┴──────────┐
   ┌────▼─────┐        ┌─────▼──────┐
   │ flutter  │        │   html     │   generators (one per target)
   └────┬─────┘        └─────┬──────┘
      Dart                  HTML
```

Nothing above the generators knows what Flutter is. `src/frontend/ast.ts` has `ElementNode` with a `tag`
string; the registry decides which tags exist and what they take; the generator decides what
they become. That separation is what makes a second target a weekend rather than a rewrite —
`src/codegen/html.ts` is the proof.

## Modules

The tree mirrors the pipeline, so a file's folder says which stage it belongs to — and whether it
is allowed to know about Flutter.

| Stage | Directory | Contains |
| --- | --- | --- |
| Front end | `src/frontend/` | text → tokens → AST. No Flutter, no file system, no options. |
| Analysis | `src/analysis/` | Scopes, the widget catalogue, diagnostics, suggestions. Framework-neutral. |
| Code generation | `src/codegen/` | Dart emission helpers, the Flutter target, the HTML preview. |
| Project | `src/project/` | Paths, config discovery, multi-file compilation, the incremental cache. |
| Tooling | `src/tooling/` | CLI, formatter, watcher, language server, AST debug printer. |

| File | Lines | Responsibility |
| --- | ---: | --- |
| `src/frontend/ast.ts` | 528 | AST types, `UiType`, type helpers, tree walkers. |
| `src/frontend/lexer.ts` | 444 | Indentation stack, strings with interpolation, numbers, colours, operators, comments. |
| `src/frontend/parser.ts` | 1169 | Recursive descent over the token stream, including recovery and the action grammar. |
| `src/frontend/source.ts` | 117 | A file's text plus line/column mapping. Every span is an offset pair. |
| `src/analysis/check.ts` | 1241 | Scopes, property/argument validation, event rules, `Analysis` for generators. |
| `src/analysis/diagnostics.ts` | 659 | `Diagnostic`, `DiagnosticBag`, the `CODES` catalogue, rendering, JSON form. |
| `src/analysis/events.ts` | 22 | Event metadata (which events carry a value, and its type). |
| `src/analysis/suggest.ts` | 70 | Edit-distance suggestions used by every "did you mean". |
| `src/analysis/targets.ts` | 46 | Target-wide constants: style properties, built-in style names, Flutter type names. |
| `src/analysis/widgets/registry.ts` | 486 | The element catalogue: arguments, properties, children policy, events, example. |
| `src/codegen/dart.ts` | 84 | Emission helpers: `dartCall`, `listArgument`, `indentAll`, Dart string escaping. |
| `src/codegen/flutter.ts` | 1532 | The Flutter generator. |
| `src/codegen/html.ts` | 1127 | The HTML preview generator. |
| `src/project/compile.ts` | 73 | Single-file pipeline used by the playground and tests. |
| `src/project/hash.ts` | 35 | FNV-1a + djb2 cache keys, with no Node builtins so the browser can use it. |
| `src/project/paths.ts` | 83 | POSIX path helpers; no `node:path`, so the browser can use them. |
| `src/project/project.ts` | 297 | Multi-file compilation, import resolution/re-basing, the incremental `ProjectCache`. |
| `src/project/workspace.ts` | 157 | Where the project is: config discovery, source discovery, path re-basing. |
| `src/tooling/cli.ts` | 567 | Commands and output; no grammar, no Flutter. |
| `src/tooling/debug.ts` | 132 | AST and expression printers behind `plainui ast`. |
| `src/tooling/format.ts` | 245 | Token-driven formatter. |
| `src/tooling/lsp.ts` | 399 | Language server: JSON-RPC framing, diagnostics, formatting, hover. |
| `src/tooling/watch.ts` | 234 | File watching: recursive → per-directory → polling, debounced. |

## The pipeline, step by step

**Lexing.** The lexer converts leading whitespace into `indent`/`dedent` tokens against a stack.
It infers the indent width from the first indented line, rejects mixed tabs and spaces
(`PUI1005`), and keeps comments in a side list rather than in the token stream, so the parser
never has to skip them and the formatter can put them back. Strings carry their interpolations
so that `${...}` can be validated as a name, not as text.

**Parsing.** Indentation *is* the block structure, so the parser is a plain recursive descent
with `parseNodeBody` on each block. Elements are `tag args props:` + children; `component`,
`screen`, `style` and `import` are declarations; `state`, `if`, `for`, `slot` and the action
statement group (`set`, `return`-free calls, `if`) are nodes. Recovery is local: an unexpected
token produces a diagnostic, the parser resynchronises at the next line at the same or lower
indent, and the rest of the file still parses. That is why one run reports every error in a
file rather than only the first.

**Checking.** `check()` walks declarations and bodies with a scope per declaration (plus a
nested scope per `for` body), resolves each tag (`builtin`, `component`, `host`), validates
arguments against the registry and properties against the widget plus the universal set, tracks
which state and parameters are used, and records the types generators need (`Analysis.stateTypes`,
`paramTypes`, `loopTypes`). It also computes the "did you mean" lists, so every suggestion is
drawn from names that are legal *at that position*, not from a global list.

Checking stops at the language boundary, but not before it: host types and host functions are
assumed to exist, because only Dart can answer questions about them, while a *declared* surface
(§2.5 of the spec) is checked at every call site. The two are complements rather than alternatives —
Dart remains the authority on its own signatures, and the surface exists so the mistake is reported
where a person is looking.

**Generating.** Generators receive `Analysis` and the source, never the tokens. They are pure
and deterministic: same input, same bytes. When the analysis has errors, no generator runs — a
broken file produces diagnostics, never half a widget tree.

## The AST seam

Two rules keep the AST portable:

1. **No framework nouns.** `ElementNode.tag` is a string. The registry, not the AST, says
   `column` exists and takes `gap`.
2. **No framework types.** Types are a small model (`string`, `int`, `double`, `bool`, `list`,
   `map`, `named`, `nullable`, `dynamic`) that maps to Dart type text on demand.

Adding a target means implementing one function per node kind and one case per registry tag. The
HTML target does exactly that, and it is a good template.

## Where the pieces meet

- **Registry ↔ generators.** `tests/codegen.test.ts` compiles the registry's own example for
  every widget, so a tag without an emitter (or an emitter without a tag) fails the build.
- **Registry ↔ docs.** `docs/07-reference.md` is generated from the registry and compared in CI.
- **Catalogue ↔ call sites.** `CodeInfo.severity` is declared once and compared against the
  severity each `this.error('PUI…')` call site uses.
- **Examples ↔ compiler.** `examples/**` is compiled by the test suite.
- **Playground ↔ compiler.** The playground imports the compiler modules; it has no rules of its
  own.

## Deliberate boundaries

- **No type inference beyond literals.** `state count = 0` infers `int`; anything else needs an
  annotation. Guessing more would produce Dart that fails later, further from the source.
- **No macros, no loops in the language.** Repeated structure is a `component` or a `for` node.
- **No runtime.** The output imports `package:flutter` and nothing else. There is no PlainUI
  package to depend on, no `InheritedWidget`, no codec.
- **No semantic analysis of host code.** `AppLogo()` compiles to `AppLogo()` with a note
  (`PUI2406`) rather than pretending to know the constructor.

## Performance

Compilation is linear in source size; the whole test suite (200+ tests, including 60+ compiles)
runs in about six seconds, and a single screen compiles in well under a millisecond. The
playground recompiles the whole file on every keystroke, which is why the compiler never keeps
global mutable state.

### Incremental compilation

`plainui watch` keeps a `ProjectCache` for the session. Each file gets a fingerprint of
everything that can change its result:

- its own text,
- the compiler version and `outDir` (they appear in the generated imports and banner),
- the text of every `.pui` file it imports (their component declarations shape the analysis),
- the project-wide table of declared names (duplicate and shadowing checks are project-wide).

Anything else in the project is irrelevant, so editing one widget body recompiles one file. On a
synthetic 300-screen project a cold build takes ~190 ms and a one-file edit ~40 ms; parsing is only
14% of a cold build, so the cache skips the part that costs the most (checking and generation).
Errors are cached too — while a file is broken, a save elsewhere must not re-analyse it.

The hash is `src/project/hash.ts`, FNV-1a and djb2 over the text, not `node:crypto`: the same module is
bundled into the browser playground, where a Node builtin would break the build. Two independent
32-bit lanes make an accidental collision between two versions of one file negligible, and a
collision there would only mean a stale result for a keystroke or two.

The cache lives in memory only. A process-wide disk cache would help `plainui build` in CI, and it
needs a version-and-flags key that this one does not have yet — listed in the roadmap rather than
half-built.
