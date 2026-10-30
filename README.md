# PlainUI

**Write UI naturally. Build it with the frameworks you already use.**

PlainUI is a proposed indentation-based declarative UI language designed to make user interfaces easier to read and write. The goal is to let developers describe screens, layouts, components, state, and interactions with a compact syntax—without XML tags, JSX markup, or deeply nested widget constructors.

PlainUI is intended to compile into code for existing UI frameworks rather than replace their rendering engines. The first target is **Flutter**, with other targets considered only after the core language is proven.

> **Project status:** Early design / pre-alpha. The syntax and architecture are proposals. A working compiler and framework integration are not available yet.

## Why PlainUI?

Declarative UI is a useful model: developers describe what an interface should look like, and the framework manages rendering and updates. But the syntax of existing approaches can become noisy as interfaces grow.

PlainUI explores a different way to express the same ideas:

- **Indentation defines hierarchy.** Child elements are nested by indentation, so explicit closing tags and braces are unnecessary.
- **UI elements read like instructions.** Screens, components, layouts, properties, and events have clear keywords.
- **Application logic stays in the host language.** PlainUI describes the interface and connects events to existing functions; it is not intended to replace Dart, Kotlin, or TypeScript.
- **Existing frameworks do the hard work.** Generated code uses the framework's own widgets, lifecycle, state mechanisms, and rendering pipeline.

## A first look

A conceptual PlainUI counter screen:

```plainui
screen Counter:
    state count: int = 0

    column gap=12:
        text "Count: {count}"

        button "Add":
            on tap:
                set count = count + 1
```

The syntax above is illustrative and may change as the language is designed and tested.

A reusable component could look like this:

```plainui
component ProfileCard(user: User):
    card padding=16 radius=12:
        row gap=12:
            image user.photo size=48

            column gap=4:
                text user.name style=heading
                text user.role style=secondary
```

## Goals

1. Define a small, readable syntax for declarative interfaces.
2. Parse `.pui` files into a framework-independent representation.
3. Validate syntax, component references, properties, and expressions before code generation.
4. Generate readable, idiomatic Dart/Flutter code as the first backend.
5. Allow PlainUI screens to coexist with ordinary Flutter screens in the same application.
6. Reuse existing Dart functions and custom Flutter widgets.
7. Provide useful diagnostics that point to the original `.pui` file and line.

## Non-goals

PlainUI is not intended to:

- Create a new rendering engine or replace Flutter.
- Replace Dart or become a general-purpose programming language.
- Force developers to migrate an entire existing application.
- Hide the underlying framework or prevent access to its APIs.
- Support every framework in the first release.

## How it is intended to work

PlainUI is designed as a **source-to-source compiler**. It translates `.pui` source files into regular source code for a target framework.

```text
.pui source
    |
    v
Lexer and parser
    |
    v
Framework-independent AST
    |
    v
Semantic validation
    |
    v
Flutter code generator
    |
    v
Generated Dart source
    |
    v
Existing Flutter build process
    |
    v
Running application
```

### Main stages

1. **Lexing and parsing** — recognize keywords, identifiers, values, expressions, indentation, and blocks.
2. **AST construction** — represent screens, components, layouts, state declarations, and events in a framework-independent syntax tree.
3. **Semantic validation** — check names, component arguments, property values, event handlers, and supported language features.
4. **Code generation** — convert the validated AST into idiomatic code for the selected framework.
5. **Build and run** — let the existing framework toolchain compile and execute the generated application.

The parser and AST should not contain Flutter-specific concepts. A target-specific generator should map general concepts such as `column`, `text`, and `button` to the appropriate framework APIs.

## Flutter-first adoption

The first implementation will target Flutter to keep the initial scope realistic.

The intended development workflow is:

1. Add PlainUI tooling to an existing Flutter project.
2. Create a `.pui` file for a new screen or component.
3. Run the PlainUI compiler to validate the file and generate Dart code.
4. Import the generated Dart widget into the application as an ordinary widget.
5. Continue using existing Dart screens, packages, and custom widgets alongside generated screens.

Conceptual project layout:

```text
my_app/
├── lib/
│   ├── main.dart
│   ├── ui/
│   │   └── home.pui
│   └── generated/
│       └── home.pui.dart
├── tool/
│   └── plainui.dart
└── pubspec.yaml
```

Generated files should be reproducible and should not be edited manually. The `.pui` file remains the source of truth. The first prototype can use a standalone Dart command; integration with tools such as `build_runner` can be evaluated later.

## Planned language features

| Feature | Purpose | Initial priority |
|---|---|---:|
| Screens | Declare UI entry points | MVP |
| Text, images, buttons | Basic visual elements | MVP |
| Rows and columns | Compose layouts | MVP |
| Properties | Configure UI elements | MVP |
| State | Represent reactive values | Next |
| Events | Connect user actions to functions | Next |
| Conditions and loops | Render dynamic content | Next |
| Components and parameters | Reuse UI structures | Next |
| Imports and custom widgets | Interoperate with existing Dart code | Later MVP stage |
| Themes and styles | Reuse visual rules | Later |
| Additional targets | Generate Kotlin or TypeScript | Future |

The exact syntax and feature order will be revised based on prototype results.

## Roadmap

### Phase 0 — Language design

- [ ] Agree on core syntax and indentation rules.
- [ ] Define the first set of tokens and grammar.
- [ ] Define the framework-independent AST.
- [ ] Specify how host-language expressions and function calls work.
- [ ] Document compiler errors and source locations.

### Phase 1 — Small Flutter prototype

- [ ] Implement a lexer and indentation-aware parser.
- [ ] Parse a screen containing text, a button, a row, and a column.
- [ ] Generate valid Dart code for those elements.
- [ ] Compile and run a generated screen in a Flutter example app.
- [ ] Verify generated output with `dart format` and `flutter analyze`.

### Phase 2 — Interaction and reuse

- [ ] Add state and event handling.
- [ ] Add conditions and repeated elements.
- [ ] Add components and parameters.
- [ ] Support imports and reuse of existing Flutter widgets.
- [ ] Add source-mapped diagnostics and useful validation messages.

### Phase 3 — Developer tooling

- [ ] Add `build`, `check`, `watch`, and `format` commands.
- [ ] Add examples and language documentation.
- [ ] Evaluate integration with the Dart build ecosystem.
- [ ] Improve editor support and diagnostics.

### Phase 4 — Stabilization and future targets

- [ ] Test real-world screens and larger component trees.
- [ ] Document supported Flutter behavior and limitations.
- [ ] Stabilize the language specification.
- [ ] Evaluate additional framework code generators.

## Proposed command-line interface

The eventual CLI may expose commands like these:

```bash
plainui check
plainui build
plainui watch
plainui format
```

These commands are design proposals, not implemented commands yet.

## Design principles

- **Readable before clever:** prefer obvious syntax over compact but cryptic notation.
- **Explicit over magical:** make state, events, and data flow understandable.
- **Framework-friendly:** preserve access to native framework capabilities.
- **Incremental adoption:** support gradual use in existing projects.
- **Predictable generation:** the same source and compiler version should produce consistent output.
- **Good diagnostics:** report errors at the source, not only in generated code.
- **Small core:** keep business logic and complex application behavior in the host language.

## Contributing

PlainUI is at the design stage. Early contributions are most useful in language design, grammar discussions, AST design, compiler architecture, and small proof-of-concept implementations.

Before proposing a feature, consider whether it makes common UI code easier to read without introducing hidden behavior or unnecessary language complexity.

## License

No license has been selected yet. Until a license is added, normal copyright restrictions apply; please do not assume the project is open for unrestricted reuse or redistribution.

---

**PlainUI:** a simpler way to describe interfaces, powered by the frameworks developers already trust.
