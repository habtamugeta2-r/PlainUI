# PlainUI

**A small, indentation-scoped language for describing user interfaces — compiled to ordinary
Flutter/Dart.**

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

becomes ordinary, editable-by-nobody-but-the-compiler Dart:

```dart
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
          Text('Counter', style: Theme.of(context).textTheme.headlineSmall),
          Text(count.toString(), style: Theme.of(context).textTheme.displaySmall),
          ElevatedButton(
            onPressed: () => setState(() { count = count + 1; }),
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }
}
```

Flutter still does all the work — layout, rendering, state propagation, the build. PlainUI only
decides how you *write the tree down*.

---

## Why

Declarative UI is the right model; its surface syntax is the part that hurts. Flutter nests
constructors inside constructors, Compose nests calls inside calls, and both make large trees
hard to skim. PlainUI keeps the model and replaces the notation:

* one line per element, nesting by indentation — no closing tags, no `children: [` boilerplate,
  no parenthesis pyramids;
* properties on the line they belong to, `padding=24 gap=16`;
* events as readable blocks, `on tap:`;
* everything else is Dart, untouched.

It is a **source-to-source compiler**, not a framework: `.pui` in, `.dart` out. Existing Flutter
projects adopt it one screen at a time.

## Status

| Area | State |
|---|---|
| Lexer, parser, AST, formatter | ✅ implemented, tested |
| Semantic validation with coded, caret-accurate diagnostics | ✅ |
| Flutter code generator (screens, components, state, events, loops, conditionals, binding) | ✅ |
| CLI: `build`, `check`, `format`, `watch`, `init`, `ast`, `explain` | ✅ |
| Browser playground + HTML preview generator | ✅ |
| Compose / React generators | 🧭 roadmap (the AST seam exists; see `docs/06-roadmap.md`) |

Generated Dart is verified by golden-file tests in this repository. Running `flutter analyze`
over the generated output requires the Flutter SDK; `tests/golden` are also compiled by the CI
workflow `flutter-verify.yml` on machines that have it.

## Quick start

```bash
npm install            # dev toolchain (TypeScript, esbuild)
npm run build          # compile the CLI to dist/
npm test               # unit + golden tests

node dist/cli.js build examples/counter/lib/ui   # .pui -> .pui.dart
node dist/cli.js watch examples/counter/lib/ui   # rebuild on save
node dist/cli.js check .                          # validate only
node dist/cli.js format --write .                 # canonical formatting
```

Or drive it from an existing Flutter app:

```bash
cd my_app
npx plainui init            # writes plainui.config.json + lib/ui/home.pui
npx plainui build           # -> lib/generated/home.pui.dart
```

```dart
import 'generated/home.pui.dart';

void main() => runApp(const MaterialApp(home: Home()));
```

## Language in one screen

```plainui
import "./components/profile_card.pui"

component Header(title: String):

    row gap=12 cross=center:
        image "logo.png" size=32
        text title style=heading

style price:
    size=20
    weight=bold
    color=#0a7d33

screen Products:

    state query: String = ""
    state items: List<Product> = loadProducts()

    column padding=16 gap=12:

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

## Playground

```bash
npm run playground     # http://localhost:4173
```

Type PlainUI on the left; get generated Dart, diagnostics with carets, and an HTML layout preview
on the right. The playground runs the compiler in the browser — same code as the CLI.

## Repository layout

```
src/
  lexer.ts        indentation-aware tokenizer
  parser.ts       recursive-descent parser -> AST
  ast.ts          framework-neutral AST types
  checker.ts      semantic validation (scope, widgets, properties, events)
  widgets/        widget registry (the single source of truth for the vocabulary)
  codegen/        flutter.ts (Dart), html.ts (playground preview)
  format.ts       canonical formatter
  compile.ts      pipeline orchestration
  cli.ts          command line interface
tests/            unit tests + golden files
examples/         runnable Flutter projects using .pui screens
web/              browser playground
```

## Design principles

1. **The generated code is ordinary Flutter.** No runtime package, no reflection.
2. **The language stays small.** If it needs logic, it needs Dart.
3. **Errors are the product.** Every diagnostic has a code, a caret span, and a suggested fix.
4. **Incremental adoption is non-negotiable.** Any existing Dart widget is one capital-letter tag
   away from being used in a PlainUI screen.
5. **The AST is framework-neutral.** Only generators know about Flutter.

## License

MIT
