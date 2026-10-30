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

Nothing above the generators knows what Flutter is. `src/ast.ts` has `ElementNode` with a `tag`
string; the registry decides which tags exist and what they take; the generator decides what
they become. That separation is what makes a second target a weekend rather than a rewrite —
`src/codegen/html.ts` is the proof.

## Modules

| File | Lines | Responsibility |
| --- | ---: | --- |
| `src/source.ts` | 117 | A file's text plus line/column mapping. Every span is an offset pair. |
| `src/diagnostics.ts` | 659 | `Diagnostic`, `DiagnosticBag`, the `CODES` catalogue, rendering, JSON form. |
| `src/lexer.ts` | 444 | Indentation stack, strings with interpolation, numbers, colours, operators, comments. |
| `src/ast.ts` | 528 | AST types, `UiType`, type helpers, tree walkers. |
| `src/parser.ts` | 1159 | Recursive descent over the token stream, including recovery and the action grammar. |
| `src/check.ts` | 1207 | Scopes, property/argument validation, event rules, `Analysis` for generators. |
| `src/widgets/registry.ts` | 486 | The element catalogue: arguments, properties, children policy, events, example. |
| `src/targets.ts` | 46 | Target-wide constants: style properties, built-in style names, Flutter type names. |
| `src/suggest.ts` | 70 | Edit-distance suggestions used by every "did you mean". |
| `src/events.ts` | 22 | Event metadata (which events carry a value, and its type). |
| `src/codegen/dart.ts` | 84 | Emission helpers: `dartCall`, `listArgument`, `indentAll`, Dart string escaping. |
| `src/codegen/flutter.ts` | 1531 | The Flutter generator. |
| `src/codegen/html.ts` | 1127 | The HTML preview generator. |
| `src/project.ts` | 202 | Multi-file compilation: import resolution, import re-basing, project diagnostics. |
| `src/format.ts` | 245 | Token-driven formatter. |
| `src/compile.ts` | 73 | Single-file pipeline used by the playground and tests. |
| `src/paths.ts` | 83 | POSIX path helpers; no `node:path`, so the browser can use them. |
| `src/cli.ts` | 641 | Commands, configuration, file discovery, watching. |

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

Checking deliberately stops at the language boundary: host types and host functions are assumed
to exist, because only Dart can answer questions about them. The generated file is the place
where the boundary becomes visible.

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

Compilation is linear in source size; the whole test suite (208 tests, including 60+ compiles)
runs in about six seconds, and a single screen compiles in well under a millisecond. The
playground recompiles the whole file on every keystroke, which is why the compiler never keeps
global mutable state.
