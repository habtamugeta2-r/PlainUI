# PlainUI Language Specification — v1.0

**Status:** stable for the v1 feature set. **File extension:** `.pui`. **Encoding:** UTF-8.

This document is normative. Where it says *must*, the reference compiler reports an error and
refuses to generate code; where it says *should*, it reports a warning.

PlainUI describes **the shape of a user interface**. It does not execute logic. Every value is
either a literal or an expression in the *host language* (Dart, for the Flutter target), and
every event body is a short list of instructions that the compiler turns into a host-language
closure. Anything beyond that belongs in Dart.

---

## 1. Lexical structure

### 1.1 Lines, indentation, blocks

A `.pui` file is a sequence of lines. Blank lines are ignored (and are allowed anywhere,
including inside blocks and between `if`/`else`). A line ends at `\n` or `\r\n`.

**Indentation is part of the grammar.**

1. Leading spaces and tabs form a line's indentation. For measurement, a tab counts as
   **4 columns**.
2. A line's indentation must not mix tabs and spaces (`PUI1005`).
3. A block is opened by a `:` at the end of a line. The first line after it must be indented
   deeper than the line that opened the block; that column becomes the block's indentation.
4. Every direct child of a block must start at exactly the block's indentation column.
5. Deeper indentation opens a nested block. It is an error to indent deeper when the previous
   line did not open a block (`PUI1003`).
6. A dedent must return to a column that an enclosing block actually used
   (`PUI1004` — "no block at this indentation"). This is what catches the classic
   "one line is 4 spaces, the next is 6" mistake.
7. The indent *width* is inferred per file. 2-space, 4-space and 8-space files all work; the
   compiler reports the expected column when it disagrees with you.

```
screen Home:            ← column 0
    column:             ← column 4  (block of `screen`)
        text "Hi"       ← column 8  (block of `column`)
```

### 1.2 Comments

```
// a line comment
```

`//` starts a comment that runs to end of line. `#` is **not** a comment: it introduces a
colour literal (§1.3). There are no block comments.

### 1.3 Literals

| Kind | Examples | Notes |
|---|---|---|
| String | `"Hello"`, `"a\nb"`, `"Hi ${name}"` | Double quotes. `\$` escapes a dollar sign. `${expr}` interpolation is passed through to the target. |
| Number | `0`, `42`, `-3`, `1.5`, `0.25` | Leading `-` is part of the literal when it is not a binary minus. |
| Boolean | `true`, `false` | |
| Null | `null` | |
| Colour | `#fff`, `#ff6b6b`, `#80ff6b6b` | 3, 6 or 8 hex digits (`#RGB`, `#RRGGBB`, `#AARRGGBB`). |
| List | `[1, 2, 3]`, `[]` | Also used for 2- and 4-value spacing shorthand (§4.1). |

Numeric property values are **logical pixels**.

### 1.4 Identifiers and names

* Lowercase-initial: built-in widget tags (`column`, `text`, `button`) and property names.
* Uppercase-initial: components (`ProfileCard`), host widgets (`AppLogo`), and enum values
  (`center`, `stretch` — enum *values* are lowercase even though their Dart counterparts are not).
* Reserved words: `import screen component style state on set if elif else for in slot true
  false null`.
* Names must match `[A-Za-z_][A-Za-z0-9_]*`.

### 1.5 Line continuation

An unterminated `(`, `[` or `{` continues the logical line onto the next physical line. This is
the only implicit continuation; otherwise one line is one statement.

---

## 2. Files and declarations

A file contains imports, then any number of declarations. Declaration order is free; screens may
use components declared later in the same file.

```
import "package:my_app/widgets/app_logo.dart"     // host library
import "./components/profile_card.pui"            // another PlainUI file
```

* `package:` and `dart:` URIs pass through unchanged.
* Relative paths are resolved **from the directory of the `.pui` file**, and re-based by the
  generator so they remain correct from the generated file's location.
* A `.pui` import makes that file's components **and its design tokens** available; importing a
  `.pui` that does not exist is an error (`PUI2102`).

### 2.1 Screens

```
screen Login:
    <body>
```

A screen is an entry point: the generator emits a public widget class with the screen's name.
A screen has no parameters and must contain at least one element (`PUI2010`).

### 2.2 Components

```
component ProfileCard(user: User, compact: bool = false):
    <body>
```

* Parameters may be written `name` (untyped), `name: Type`, or `name: Type = default`.
* A parameter without a default is **required** at every call site (`PUI2201`).
* A component emits a public widget class: `StatelessWidget`, or `StatefulWidget` if the body
  declares `state`.
* `slot` may appear in the body at most once; it marks where the children supplied by the call
  site are rendered. A component that uses `slot` must declare a `children` parameter:
  `component Shell(children: List<Widget>, title: String)`. Using `slot` without `children` is
  an error (`PUI2204`); supplying children to a component with no `slot` is an error (`PUI2203`).

### 2.3 Styles

A named text style, referenced with `style=<name>` on `text`, `input` and `button`.

```
style heading:
    size=32
    weight=bold
    color=#111111
```

Styles accept the text properties `size`, `weight`, `color`, `family`, `letterSpacing`,
`lineHeight`, `italic`. Unknown properties are errors (`PUI2301`). Built-in style names —
`display`, `heading`, `subheading`, `body`, `caption`, `label`, `secondary` — may be used without
declaring anything and are overridable.

### 2.4 Themes and design tokens

A file may declare one theme. The theme names the values a design system uses, so screens refer to
`brand` and `md` instead of repeating `#2563eb` and `16`.

```
theme App:

    color brand = #2563eb
    color surface = #ffffff
    color ink = #0f172a
    color danger = #dc2626

    space sm = 8
    space md = 16
    space lg = 24

    radius card = 12
```

* Three categories: `color`, `space` (`spacing` is accepted as a spelling of the same thing) and
  `radius`. A colour token takes a colour literal (`PUI2306`); a space or radius token takes a
  number (`PUI2306`).
* One theme per file (`PUI2307`); duplicate token names are errors (`PUI2305`), including against a
  token from an imported theme.
* Tokens are in scope for the whole file — including `style` declarations written above the theme —
  and for any file that imports it.
* A token may be referenced wherever a value is expected: any colour position (`color=brand`) or
  number position (`padding=md`, `gap=sm`, `radius=card`, `padding=[md, sm]`). A token in the wrong
  kind of slot is an error (`PUI2304`), not a value of the wrong type in the output.
* Tokens are **values, not variables**: `set md = 4` is an error (`PUI2114`), and a state variable
  with a token's name is an error (`PUI2309`).

Tokens are resolved by the compiler, not at run time. `padding=md` becomes `16` in the generated
code, which keeps generated widget trees `const` and makes every target produce the same values from
the same source. The Flutter target additionally emits the palette as data — `AppTokens.brand` — and
a `ThemeData` (`AppTheme.light`) built from it, so Flutter's own widgets use the design; the HTML
target publishes the same values as CSS custom properties (`--pui-brand`). Runtime theming, such as
switching to a dark token set, is a separate feature and is not part of this one.

---

## 3. Statements

A statement is either a state declaration or a node. Nodes are elements (`widget`), control flow
(`if`, `for`) or `slot`.

### 3.1 Elements

```
tag <positional-args...> <name=value ...>:
    <children>
```

The tag decides the meaning:

| Tag form | Meaning |
|---|---|
| `lowercase` | A **built-in** widget from the compiler's widget registry (§5). Unknown lowercase tags are errors with a "did you mean" (`PUI2001`). |
| `Uppercase` | A **component** in scope, or a **host widget constructor**. Not found anywhere ⇒ treated as a host class and passed through as a Dart constructor call (`AppLogo()`), which is the interoperability escape hatch. |

Arguments are space-separated for built-ins and comma-separated inside parentheses for
components and host widgets:

```
text "Welcome" style=heading           // built-in
ProfileCard(user)                      // positional component argument
ProfileCard(user: user, compact: true) // named component arguments
AppLogo()                              // host widget
```

Properties may be written with `=` for built-ins (`padding=24`) or with `:` inside a component or
host call (`Padding(padding: ...)` style); both mean the same thing.

An element with no positional arguments and no properties needs no colon: `divider`, `spacer`.

**No line may both carry content and open a nested block.** `column: text "x"` is an error
(`PUI1010`) — the child must be on its own line. This keeps nesting unambiguous.

### 3.2 Conditionals

```
if user.isLoggedIn:
    text "Welcome back"
elif user.isGuest:
    text "Hello guest"
else:
    text "Please sign in"
```

`if` must be the first keyword; `elif`/`else` must follow a sibling `if` at the same indentation
(`PUI1013`). Conditions are host-language boolean expressions.

### 3.3 Repetition

```
for product in products:
    ProductCard(product)

for index, product in products:
    text "${index}"
```

The single-name form binds each element; the two-name form binds `index, value` and requires an
`Iterable` (`PUI2402` says so if the compiler can prove otherwise from a literal).

### 3.4 State

```
state count: int = 0
state email: String = ""
state items: List<String> = []
```

* `state` is only valid at the **top level** of a screen or component (`PUI2002`).
* The type is optional; without it the type is inferred from the initializer when that is a
  literal. Otherwise the state is `dynamic`, and `text` uses `toString()` on it.
* State is private to the screen or component instance. It is not shared between instances.
* Duplicate names are errors (`PUI2003`).

### 3.5 Events

```
button "Sign In":
    on tap:
        set busy = true
        signIn(email, password)
```

```
on <event>:
    <actions>
```

or, for a single action, on one line:

```
button "Retry":
    on tap: retry()
```

* The event name must be one the widget supports (`PUI2101`), either natively or through the
  generic event set: `tap`, `longTap`, `doubleTap`, `hover` on every element; `change`,
  `submit`, `focus`, `blur` on input-like widgets.
* At most one handler per event per element (`PUI2103`).
* A handler containing `await` is emitted as an `async` closure automatically.

#### Actions

| Action | Meaning |
|---|---|
| `set x = expr` | Assign to a state variable and trigger a rebuild. |
| `set x += expr` | Compound assignment; `+= -= *= /=` are supported. |
| `f(a, b)` | Call a host function or an expression statement. |
| `if cond:` … `else:` | Conditional actions. |

`set` may only target a state variable declared in the enclosing screen or component
(`PUI2104`); component parameters are read-only (`PUI2105`).

---

## 4. Properties

### 4.1 Universal properties

These work on **every** element, built-in or host, because they are implemented by wrapping the
element rather than by being passed to it.

| Property | Value | Effect |
|---|---|---|
| `padding` | number, `[vertical, horizontal]`, `[top, right, bottom, left]` | Inner spacing |
| `margin` | same | Outer spacing |
| `width`, `height` | number | Fixed size |
| `size` | number | Square size |
| `expand` | bool | Fill available space along the parent's main axis |
| `flex` | integer | Flex factor when expanding |
| `opacity` | number `0..1` | Transparency |
| `background`, `bg` | colour | Fill |
| `radius` | number | Rounded corners |
| `border` | number | Border width (needs `borderColor`) |
| `borderColor` | colour | Border colour |
| `align` | `topLeft … bottomRight`, `center` | Alignment within available space |
| `main` | `start`, `end`, `center`, `between`, `around`, `evenly` | Main-axis distribution of `column`/`row` children |
| `cross` | `start`, `end`, `center`, `stretch`, `baseline` | Cross-axis alignment of children |
| `gap` | number | Space inserted **between** children of `column`, `row`, `wrap`, `list` |

Wrapping order is deterministic. Read from the element outwards: `padding`, then size
(`width`/`height`/`size`), then `background`/`radius`/`border`/`margin`, then `opacity`, then
`expand`/`flex`, then `align`, then any generic gesture or hover handler. In generated code that
reads outside-in as `gestures → Align → Expanded/Flexible → Opacity → Container → SizedBox →
Padding → element`.

Alignment enums are validated against their closed value sets, so `align=centre` is a compile
error with the correct spelling offered (`PUI2401`).

### 4.2 Widget properties

The full property table per built-in widget lives in
[`07-reference.md`](07-reference.md) and is generated from the compiler's widget registry, so it
cannot drift from the implementation. Highlights:

* `text "hi" style=heading color=#333 maxLines=2 overflow=ellipsis`
* `image "avatar.png" size=48 radius=24 fit=cover`
* `input bind=email label="Email" secret=true keyboard=email`
* `button "Save" variant=outlined disabled=busy`
* `toggle bind=notifications label="Notifications"`

Properties that are meaningless for a widget are rejected rather than ignored (`PUI2102`).

### 4.3 Two-way binding

`bind=<state>` on `input`, `toggle`, `checkbox` and `slider` reads and writes the named state
variable. The generator owns the controller lifecycle for text inputs (create, sync, dispose), so
`state` remains the single source of truth.

`bind` requires a declared state variable (`PUI2104`) and must not be combined with an explicit
`on change` handler on the same element (`PUI2106`).

---

## 5. Built-in widgets

`column`, `row`, `stack`, `wrap`, `scroll`, `list`, `grid`, `card`, `center`, `align`,
`expanded`, `safeArea`, `scaffold`, `text`, `image`, `icon`, `button`, `input`, `toggle`,
`checkbox`, `slider`, `divider`, `spacer`, `progress`.

Container rules:

* **Multi-child** (`column`, `row`, `stack`, `wrap`, `scroll`, `list`, `grid`, `scaffold`,
  `card`): any number of children, including `if`/`for` nodes.
* **Single-child** (`center`, `align`, `expanded`, `safeArea`): exactly one child. More than one
  is a warning (`PUI2403`) and the children are wrapped in a `column` by the generator — never
  dropped.
* **Leaf** (`text`, `image`, `icon`, `button`, `input`, `toggle`, `checkbox`, `slider`,
  `divider`, `spacer`, `progress`): no children; a nested block is an error (`PUI2004`).

---

## 6. Expressions

Expressions are a **checked subset of Dart**. The compiler parses them (it does not just pass
strings through), which is what lets it validate identifiers, format code, and report errors at
the right column.

```
expr    := ternary
ternary := binary [ '?' expr ':' expr ]
binary  := unary { ('+'|'-'|'*'|'/'|'%'|'=='|'!='|'<'|'<='|'>'|'>='|'&&'|'||'|'??') unary }
unary   := ('-'|'!') unary | postfix
postfix := primary { '.' IDENT | '(' args ')' | '[' expr ']' }
primary := NUMBER | STRING | 'true' | 'false' | 'null' | COLOUR
         | '[' [ expr { ',' expr } ] ']'
         | '(' expr ')'
         | 'await' unary
         | IDENT
```

Supported: member access, calls (positional and named arguments), indexing, list literals,
ternaries, `??`, comparisons, arithmetic, `await`, string interpolation.

Not supported (each is a clear error rather than a silent pass-through, `PUI1021`): function
literals, `as`/`is` casts, spread `...`, cascade `..`, assignment expressions, statements
inside expressions.

### 6.1 Scope and name resolution

Visible names inside expressions:

1. `state` variables of the enclosing screen/component,
2. parameters of the enclosing component,
3. loop variables of enclosing `for` nodes,
4. `true`, `false`, `null`.

An identifier in **value position** that resolves to none of these is an error with a suggestion
(`PUI2005`), because the compiler cannot know it exists. An identifier in **call position**
(`signIn(...)`) is assumed to be a host-language function and is allowed — that is the seam where
application logic stays in Dart. Host *values* are supported too, through `import`s that expose
them: `import "package:my_app/app_state.dart"` then `appState.user.name` is allowed because the
root `appState` is imported.

---

## 7. Generated-code contract

For the Flutter target the compiler guarantees:

1. **Ordinary Dart.** Only `package:flutter/*` imports; no PlainUI runtime, no reflection, no
   code generation at runtime.
2. **Do not edit.** Every file starts with a generated banner naming the `.pui` source and the
   compiler version.
3. **`flutter analyze`-clean** for generated constructs (CI verifies this on a machine with the
   Flutter SDK).
4. **Stable output.** Formatting is deterministic; regenerating an unchanged source produces a
   byte-identical file, and the file is not rewritten at all.
5. **Idiomatic structures.** Screens become `StatefulWidget` only when they declare `state`;
   children become `children: <Widget>[...]`; conditionals and loops become Dart
   collection-`if` / collection-`for`.
6. **Traceability.** When a `.pui` line produced a generated line, a `// source: file.pui:12`
   comment marks the start of the generated block if the block spans more than one line.

Screens and components are public classes; state fields are private to the generated library.
Nothing else is exported, so the generated file can be imported into any existing Dart code
exactly like a hand-written widget.

---

## 8. Versioning

* The language is versioned in the spec, not in files; the compiler accepts the syntax defined
  here and reports `PUI1100` for syntax it recognises from a future version.
* Each generator declares a minimum framework version. The Flutter generator targets **Dart 3**
  (`for (final (i, x) in ...)` patterns, records) and Flutter 3.10+, and states so in the file
  banner when it uses a 3.x-only construct.
