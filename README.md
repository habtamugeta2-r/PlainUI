# PlainUI

**Write UI naturally. Build it with the frameworks you already use.**

PlainUI is an indentation-based declarative language for describing user interfaces. Screens,
layouts, components, state and interactions are written as a compact tree — no XML tags, no JSX
markup, no deeply nested widget constructors — and compiled into code for an existing UI framework.

It is a **source-to-source compiler**, not a framework: `.pui` in, `.dart` out. The first target is
**Flutter**, and it works today. Other targets are considered only after the core language is
proven; the AST already holds no framework nouns.

> **Status:** 1.0.0 (MVP). The compiler, CLI, formatter, watcher, language server, browser
> playground and library API are implemented and tested; see [`docs/08-mvp.md`](docs/08-mvp.md) for
> scope and the verification log.

## A first look

```plainui
screen Counter:

    state count: int = 0

    column padding=24 gap=16 main=center:

        text "Counter" style=heading
        text count style=display

        button "Add":
            on tap:
                set count = count + 1
```

becomes ordinary Dart — no PlainUI import, no runtime, nothing to look up:

```dart
// screen Counter — lib/ui/counter.pui:1
class Counter extends StatefulWidget {
  const Counter({super.key});

  @override
  State<Counter> createState() => _CounterState();
}

class _CounterState extends State<Counter> {
  int count = 0;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Text("Counter", style: Theme.of(context).textTheme.headlineSmall),
          SizedBox(height: 16),
          Text(
            count.toString(),
            style: Theme.of(context).textTheme.displaySmall,
          ),
          SizedBox(height: 16),
          ElevatedButton(
            onPressed: () {
              setState(() {
                count = count + 1;
              });
            },
            child: Text("Add"),
          ),
        ],
      ),
    );
  }
}
```

Flutter still does all the work — layout, rendering, state propagation, the build. PlainUI only
decides how you *write the tree down*.

## Why PlainUI?

Declarative UI is the right model; its surface syntax is the part that hurts. Flutter nests
constructors inside constructors, Compose nests calls inside calls, and both make large trees hard
to skim.

* **Indentation defines hierarchy.** Child elements are nested by indentation, so explicit closing
  tags and braces are unnecessary.
* **UI elements read like instructions.** Screens, components, layouts, properties and events have
  clear keywords, one line per element: `padding=24 gap=16`, `on tap:`.
* **Application logic stays in the host language.** PlainUI describes the interface and connects
  events to existing functions; it is not intended to replace Dart, Kotlin or TypeScript.
* **Existing frameworks do the hard work.** Generated code uses the framework's own widgets,
  lifecycle, state mechanisms and rendering pipeline.

## Goals

1. Define a small, readable syntax for declarative interfaces.
2. Parse `.pui` files into a framework-independent representation.
3. Validate syntax, component references, properties and expressions before code generation.
4. Generate readable, idiomatic Dart/Flutter code as the first backend.
5. Allow PlainUI screens to coexist with ordinary Flutter screens in the same application.
6. Reuse existing Dart functions and custom Flutter widgets.
7. Provide useful diagnostics that point to the original `.pui` file and line.

## Non-goals

PlainUI is not intended to:

* Create a new rendering engine or replace Flutter.
* Replace Dart or become a general-purpose programming language.
* Force developers to migrate an entire existing application.
* Hide the underlying framework or prevent access to its APIs.
* Support every framework in the first release.

## How it works

```text
.pui source
    |
    v
Lexer and parser            src/frontend/     indentation -> tokens -> AST
    |
    v
Framework-independent AST
    |
    v
Semantic validation         src/analysis/     scopes, widgets, diagnostics
    |
    v
Flutter code generator      src/codegen/      AST -> Dart (or static HTML)
    |
    v
Generated Dart
    |
    v
Existing Flutter build process
    |
    v
Running application
```

The parser and the AST contain no Flutter concepts; a target is one module plus a registry of
properties. [`docs/02-architecture.md`](docs/02-architecture.md) walks the pipeline and
[`docs/03-flutter-codegen.md`](docs/03-flutter-codegen.md) maps every construct to Flutter.

## Status

| Area | State |
|---|---|
| Lexer, parser, AST, formatter | ✅ implemented, tested |
| Semantic validation with coded, caret-accurate diagnostics | ✅ |
| Flutter code generator (screens, components, state, events, loops, conditionals, binding) | ✅ |
| Design tokens (`theme` blocks, shared by import, lowered per target) | ✅ |
| `task` — async values with `loading` / `error` / `value` / `retry()` | ✅ |
| CLI: `build`, `check`, `format`, `watch`, `lsp`, `init`, `ast`, `tokens`, `explain`, `widgets`, `next` | ✅ |
| Browser playground + HTML preview generator | ✅ |
| Examples (`examples/`), golden files, generated docs | ✅ |
| Language server (`plainui lsp`) | ✅ diagnostics, formatting, hover |
| Library API (`@plainui/compiler`) | ✅ compile, format, inspect, with type declarations |
| Screen parameters, `navigate` / `back()`, generated route table | ✅ |
| Forms: `form`, typed validators on `input`, `submit()` behind the validation gate | ✅ |
| Host surfaces: declared signatures on an import, calls checked against them | ✅ |
| `derived` — computed values, lowered to getters so they cannot go stale | ✅ |
| `effect on <state>` | 🧭 next — `plainui next` prints the current item |
| Compose / React generators | 🧭 roadmap — [`docs/09-vision.md`](docs/09-vision.md) names Compose as the second target |

Generated Dart is verified by golden-file tests in this repository. Running `flutter analyze`
over the generated output requires the Flutter SDK; `tests/golden` are also compiled by the CI
workflow `flutter-verify.yml` on machines that have it.

## Install

PlainUI is not published to npm yet; the MVP ships from this repository. Node 22.6+ is the only
requirement — a Flutter SDK is needed only to compile what it generates.

```bash
git clone https://github.com/habtamugeta2-r/PlainUI && cd PlainUI
npm ci && npm run build
npm pack                               # -> plainui-compiler-1.0.0.tgz
npm install -g ./plainui-compiler-1.0.0.tgz

plainui --version
plainui init                           # in a Flutter app: config + lib/ui/home.pui
```

Use it as a library instead:

```ts
import { compileOne } from '@plainui/compiler';

const result = compileOne('lib/ui/home.pui', source);
console.log(result.code, result.diagnostics);
```

Scope, acceptance criteria and the verification log are in [`docs/08-mvp.md`](docs/08-mvp.md).

## Quick start (working on the compiler)

```bash
npm ci                 # dev toolchain (TypeScript, esbuild, jsdom)
npm run build          # dist/cli.js + dist/index.js + dist/types
npm test               # lexer, parser, checker, codegen, formatter, CLI, LSP, docs

node dist/cli.js build examples/counter   # .pui -> lib/generated/*.pui.dart
node dist/cli.js watch examples/counter   # rebuild on save, incrementally
node dist/cli.js check .                  # validate only
node dist/cli.js format .                 # canonical formatting
node dist/cli.js widgets                  # what the language accepts
node dist/cli.js lsp                      # language server (stdio)
```

`npm run playground` opens the browser playground, `npm run goldens` refreshes the golden files,
`npm run examples` rebuilds the example projects, `npm run docs:ref` regenerates the reference
pages. `npm run verify` runs the type checker and the whole suite.

Or drive it from an existing Flutter app:

```bash
cd my_app
plainui init                # writes plainui.config.json + lib/ui/home.pui
plainui build               # -> lib/generated/home.pui.dart
plainui watch               # rebuild on save
```

```dart
import 'generated/home.pui.dart';

void main() => runApp(const MaterialApp(home: Home()));
```

## Language in one screen

```plainui
import "./components/profile_card.pui"

theme Shop:

    color brand = #2563eb
    color surface = #ffffff
    color danger = #dc2626

    space sm = 8
    space md = 16

    radius card = 12

component Header(title: String):

    row gap=12 cross=center:
        image "logo.png" size=32
        text title style=heading

style price:
    size=20
    weight=bold
    color=brand

screen Products:

    state query: String = ""
    state items: List<Product> = loadProducts()

    column padding=md gap=sm:

        Header("Products")

        input bind=query label="Search" placeholder="Search products"

        if items.isEmpty:

            text "Nothing here yet" style=secondary

        else:

            for index, product in items:

                ProfileCard(product)
                text "${index + 1}. ${product.name}" style=price

    button "Reload" fullWidth=true:
        on tap:
            set items = loadProducts()
```

## Documentation

| Document | Contents |
|---|---|
| [`docs/00-research.md`](docs/00-research.md) | Prior art (KV, Slint, SwiftUI, Haml, Elm), lessons, decision log |
| [`docs/01-language-spec.md`](docs/01-language-spec.md) | Normative language specification |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Compiler pipeline, modules, AST, extension points |
| [`docs/03-flutter-codegen.md`](docs/03-flutter-codegen.md) | Widget/property → Flutter mapping, generated code shape |
| [`docs/04-cli.md`](docs/04-cli.md) | Command reference and project configuration |
| [`docs/05-diagnostics.md`](docs/05-diagnostics.md) | Error code catalogue |
| [`docs/06-roadmap.md`](docs/06-roadmap.md) | What is next, and the honest risks |
| [`docs/07-reference.md`](docs/07-reference.md) | Widget + property reference (generated from the registry) |
| [`docs/09-vision.md`](docs/09-vision.md) | One language, many targets: tiers, type system, state model, sequencing |
| [`docs/10-decisions.md`](docs/10-decisions.md) | Decision record: what was decided, why, and what would reopen it |
| [`docs/11-todo.md`](docs/11-todo.md) | The roadmap as data (generated; also printed by `plainui next`) |

## Playground

```bash
npm run playground     # http://localhost:4173
```

Type PlainUI on the left; get a live preview, the generated Dart, the generated HTML and
clickable diagnostics on the right. The playground imports the compiler directly — the same
modules the CLI runs — so there is no server-side compilation and nothing is uploaded. Links
are shareable (`#code=…`), the formatter is one keystroke away (`⌘/Ctrl+S`), and three examples
are built in.

## Repository layout

The source tree follows the pipeline: each directory is one stage, and the code in it knows only
about the stages to its left.

```
src/
  frontend/       source.ts (text, spans) · lexer.ts · ast.ts · parser.ts
  analysis/       check.ts · diagnostics.ts · suggest.ts · targets.ts · events.ts
  analysis/widgets/registry.ts      the single source of truth for the vocabulary
  codegen/        dart.ts (emission helpers) · flutter.ts (Dart target) · html.ts (preview target)
  project/        paths.ts · workspace.ts · project.ts (multi-file + cache) · compile.ts · hash.ts
  tooling/        cli.ts · format.ts · watch.ts · lsp.ts · debug.ts
tests/            unit, registry, docs, golden (tests/golden) and end-to-end tests
examples/         runnable projects (counter, todo, gallery, async, navigation, forms) with their Dart host
web/              browser playground (the same compiler, bundled for the browser)
scripts/          CLI bundle, playground server, docs generator
docs/             research, specification, architecture, codegen, CLI, diagnostics,
                  roadmap, MVP, vision, decisions, todo
```

## Design principles

1. **The generated code is ordinary Flutter.** No runtime package, no reflection.
2. **The language stays small.** If it needs logic, it needs Dart.
3. **Errors are the product.** Every diagnostic has a code, a caret span, and a suggested fix.
4. **Incremental adoption is non-negotiable.** Any existing Dart widget is one capital-letter tag
   away from being used in a PlainUI screen.
5. **The AST is framework-neutral.** Only generators know about Flutter.

## Roadmap

What comes next, and the risks worth naming, live in [`docs/06-roadmap.md`](docs/06-roadmap.md):
a `build_runner` integration, completion and go-to-definition in the language server, a disk cache,
and the Compose / React / SwiftUI targets. The order is deliberate — the AST seam is ready, but a
half-built target is worse than none.

## Contributing

```bash
npm ci && npm test        # 225 tests, no network, no Flutter SDK required
npm run verify            # typecheck + tests
```

Every behavioural change needs the test that would have caught it being wrong; golden files are
regenerated with `npm run goldens`, and generated documentation with `npm run docs:ref`
(`--check` fails when they drift). Issues and pull requests are welcome.

## License

MIT
