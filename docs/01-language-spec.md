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
* A host import may carry a name and a **surface** — typed declarations for what this file may call
  (§2.5). Without one, host calls are passed through to Dart unchanged.

### 2.1 Screens

```
screen Login:
    <body>
```

A screen is an entry point: the generator emits a public widget class with the screen's name and
must contain at least one element (`PUI2010`).

A screen may take parameters, which is what makes it a destination:

```
screen Detail(id: String, title: String = "Task"):
    <body>
```

The parameter forms are the component's: `name`, `name: Type`, `name: Type = default`. A parameter
without a default is required at every `navigate` to that screen (`PUI2322`). Inside the body a
parameter reads like any other value; inside `state` it is written without qualification and is
emitted through the widget (`widget.id`).

Parameters are declared, not implicit: a screen that needs nothing takes nothing, and the
parameterless form stays the common one.

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

### 2.5 Host surfaces

```
import "../data.dart" as data:

    loadTasks(filter: String) -> Future<List<String>>
    save(email: String, password: String)
    AppLogo(size: double = 24)
```

```
import "<path>" as <name>:
    <name>(<param>: <Type> = <default>, …) -> <Type>
    <Name>(<param>: <Type> = <default>, …)
```

* The block declares the host's surface. The **case of the name decides what it is**, exactly as it
  does for elements: lowercase is a function, capitalised is a widget constructor (`PUI2346`).
* Every parameter needs a type (`PUI2346`). Types are written in the same vocabulary as `state` and
  parameters — the host's own type text, today Dart's (`String`, `int`, `double`, `List<String>`,
  `Todo`). A return type of `Future<T>` says the call is **asynchronous** and yields a `T`.
* A declared name is checked at every call site: it takes its declared parameters, once each, by
  name or position (`PUI2341`, `PUI2342`), and each argument has the declared type (`PUI2343`).
* An asynchronous call needs `await` or a `task` (`PUI2344`); the value it produces is checked where
  it lands — in a `task`, in `state`, in `set` (`PUI2343`).
* `data.loadTasks(…)` is a **qualified** call, and the name is part of the check: a module that does
  not declare the name says so, with a suggestion (`PUI2340`). A qualified call on an import without
  a surface is an error (`PUI2347`), because the generated Dart would reference a prefix that does
  not exist.
* An *unqualified* call to a declared name works too, as long as one module declares it
  (`PUI2345` otherwise). A name declared by nobody is still passed through to the host — the
  language does not require declaring the world, only what it is to check. When such a name is one
  character away from a declared one, the compiler says so (`PUI2410`).

A surface is a promise about the host, and it is checked twice. PlainUI checks the call sites; the
target's own compiler then checks the generated call against the real signature. A declaration that
lies therefore fails the build one step later than the `.pui` error — after the file a person can
read, which is the right order for the person.

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

`key=` names each row's identity, which is what keeps widget state attached to the right row when
the list changes:

```
for product in products key=product.id:
    ProductRow(product)
```

Without a key, a framework reuses widgets by position: delete row 2 and row 3 inherits its scroll
offset, its text field, its animation. The key is a value expression, checked in the loop's scope, so
`key=product.id` and `key=index` are both legal — the first is almost always what you want. Keys lower
to `KeyedSubtree(key: ValueKey(...))` around the row in Flutter; the HTML preview has no
reconciliation, so it ignores them.

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

### 3.5 Tasks

Asynchronous values are declared with `task`, not assembled from a flag, a nullable field and a
`try`/`catch` in a handler.

```
screen Tasks:

    task items: List<Todo> = loadTodos()

    if items.loading:
        progress

    elif items.error != null:
        text items.error color=danger
        button "Try again":
            on tap:
                items.retry()

    else:
        for item in items.value:
            text item.title
```

* `task <name>: <Type> = <call>` is only valid at the **top level** of a screen or component
  (`PUI2002`), and the value must be a call, because a call is what can be awaited and re-run
  (`PUI2310`).
* The type is optional but strongly recommended: it is what `items.value` is typed as, and what a
  `for` over it uses for the loop variable.
* A task exposes exactly four parts (`PUI2312`):
  * `items.loading` — `bool`, true while a load is in flight, including during a retry;
  * `items.error` — `String?`, the failure text of the last attempt, cleared when a new one starts;
  * `items.value` — the loaded value. For a `List<T>` it reads as an empty list before the first
    load finishes, so `for item in items.value` and `items.value.isEmpty` need no null handling;
    for any other type it is nullable, and `items.value != null` is the gate;
  * `items.retry()` — runs the load again, resetting the error first.
* A task starts when its screen is created. It cannot be assigned (`PUI2311`); `retry()` is the
  only way to run it again. A task and a state variable may not share a name (`PUI2003`).
* A load that completes after the screen is gone is discarded instead of updating a disposed widget.
* **The latest load wins.** Every run of a task takes a sequence number, and a result whose number is
  no longer current is dropped. Retrying a slow load therefore cannot end up showing the older
  answer, which is what would happen if the two attempts simply raced.

### 3.6 Computed values

A value that only needs to be read is declared with `derived`, not kept in `state` and updated by
hand.

```
screen Counter:

    state count: int = 0
    state name: String = ""

    derived doubled = count * 2
    derived greeting = name == "" ? "Hello, stranger" : "Hello, ${name}"

    text "${doubled}"
    text greeting
```

* `derived <name> = <expression>` is only valid at the **top level** of a screen or component
  (`PUI2352`), next to `state` and `task`, and it follows the same naming rules (`PUI2003`,
  `PUI2012`).
* **The value is computed on every read and never stored.** The Dart target lowers it to a getter
  (`int get doubled => count * 2;`), which is exactly the guarantee: there is no field that could
  hold a value older than the state it was computed from. The cost is one evaluation per read, so
  keep hot-path expressions cheap; a cache is a separate, later decision (`docs/10-decisions.md` B1)
  and it would have to name its dependencies explicitly.
* The type is inferred from the expression (`PUI2353` if a declared type disagrees):

  | Expression | Type |
  | --- | --- |
  | `count * 2`, `items.value.length` | `Int` |
  | `count / step` (the `/` operator), `1.5` | `Float` |
  | `count > step`, `items.loading` | `Bool` |
  | `name + "!"`, `"${count}"` | `Text` |
  | `[count, step]` | `List<Int>` |
  | `name == "" ? "a" : "b"` | `Text` — both branches must agree |
  | anything else, including a host call | `Dynamic` |

* A derived value may read state, other derived values, tasks and parameters, in any declaration
  order. Depending on itself is an error (`PUI2351`), transitively too — a cycle has no first
  value to compute.
* It cannot be assigned: `set doubled = 4` is `PUI2350`, and `on <event>: doubled = 4` says the same
  thing. There is no second source of truth to write to.
* It is read-only in expressions and in `${...}`, and it drives elements, styles, conditions and
  loops like any other value.
* A derived value that is never read is a warning (`PUI2411`), not an error: it is usually a
  leftover.
* The preview (`plainui preview`) evaluates derived values once, in declaration order, so a screen
  built only from literals renders correctly without Dart.

### 3.7 Effects

Some work is neither a value nor a response to a click: it has to happen when the screen appears, or
when one particular piece of state moves. That is what `effect` is for.

```
screen Search:

    state query: String = ""
    state busy: bool = false
    state results: List<String> = []

    effect on query:
        set busy = true
```

* `effect on <state>[, <state>]*:` is only valid at the **top level** of a screen or component
  (`PUI2362`), and the body is a block of actions — the same actions an event handler takes.
* **The header is the whole dependency list.** The effect runs once after the screen is mounted, and
  again whenever one of the named states changes. It does not run for an unrelated change, for a
  rebuild caused by a parent, or on every frame. Nothing is inferred: there is no "watch everything"
  and no automatic tracking.
* Every name in the header must be `state`, declared in the same screen or component (`PUI2364`,
  `PUI2360`). A `task` changes when a load finishes, a parameter changes when the parent rebuilds and
  a `derived` value has no storage at all — none of them has a moment this construct can name, so a
  task's result is copied into state and that state is watched.
* An effect may read anything; it may write any state except the states it watches (`PUI2363`).
  Writing a watched one is a loop by construction: the run that changes the value is the run that
  reacts to it.
* The body runs **after the frame** whose build noticed the change, never during it. That is why an
  effect can assign state without recursing into the build it was scheduled from.
* Several effects run in declaration order when they are due in the same frame.
* An effect may `await`; it is emitted as an async method, and the frame it was scheduled from is not
  blocked.
* There is no cleanup function. The language has no subscription to tear down, and the lifetimes that
  would need one (a task's request) are already handled by tasks and their cancellation.

### 3.8 Events

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
  `focus`, `blur` on input-like widgets; `submit` on `form` (§3.9).
* At most one handler per event per element (`PUI2103`).
* A handler containing `await` is emitted as an `async` closure automatically.

#### Actions

| Action | Meaning |
|---|---|
| `set x = expr` | Assign to a state variable and trigger a rebuild. |
| `set x += expr` | Compound assignment; `+= -= *= /=` are supported. |
| `f(a, b)` | Call a host function or an expression statement. |
| `navigate Screen(name: value)` | Open a screen (`PUI2320`, `PUI2322`). |
| `back()` | Close the current screen (`PUI2323`). |
| `submit()` | Validate the enclosing `form`, then run its handler (`PUI2331`). |
| `if cond:` … `else:` | Conditional actions. |

`set` may only target a state variable declared in the enclosing screen or component
(`PUI2104`); component parameters are read-only (`PUI2105`).

#### Navigation

```
screen Home:
    button "Open":
        on tap: navigate Detail(id: "42", title: "Item 42")

screen Detail(id: String, title: String = "Task"):
    text title
    button "Back":
        on tap: back()
```

* `navigate` names a screen that this file declares or imports. Navigation follows imports for the
  same reason components do: the generated code has to import the file it constructs, so a screen
  you cannot import is a screen you cannot reach.
* Arguments are named. A parameter with a default may be omitted; one without must be supplied, and
  an unknown name is an error — the call is checked against the target's parameter list, not turned
  into a string route name.
* `navigate` and `back` are actions: inside a handler, never in a value position (`PUI2321`).
  `back()` takes no arguments (`PUI2323`).
* A project that navigates also gets `plainui_routes.dart`: a map from screen name to widget, for
  host code that has a name (a deep link, a notification) and no import.

### 3.9 Forms and validation

```
form:

    column gap=12:

        input bind=email label="Email" keyboard=email validate=[required, email]
        input bind=password label="Password" secret validate=[required, min(8)]

        button "Create account":
            on tap: submit()

    on submit:
        set feedback = "Welcome, ${email}"
```

```
form:
    <elements>
    on submit:
        <actions>
```

* `form` is a container and an owner: it holds a validation key, and it declares exactly what
  happens when validation passes, in its own `on submit:` body (`PUI2333`).
* `validate=` on `input` takes a validator or a list of them, applied in the order written:

  | Validator | Argument | Fails when |
  |---|---|---|
  | `required` | — | The field is empty. |
  | `email` | — | The value is not `x@y.z`. |
  | `min(n)` | integer | Fewer than `n` characters. |
  | `max(n)` | integer | More than `n` characters. |
  | `pattern("…")` | string literal | The value does not match the regular expression. |

  Names and arguments are checked (`PUI2330`), so a misspelt validator with a suggestion is an
  error rather than a rule that silently never runs.
* An empty field short-circuits: it is `required`'s failure if `required` is present, and valid
  otherwise. `min(8)` on an optional field does not fire before the visitor has typed anything.
* `submit()` takes no arguments (`PUI2336`) and is an action, never a value (`PUI2331`). It is the
  only route into the form's handler, and it validates first — which is why there is no way to run
  the handler against unvalidated input.
* `submit()` outside a form is an error (`PUI2331`), and so is `validate=` outside one (`PUI2332`):
  a rule that nothing would ever run is not a rule.
* A form inside a form is an error (`PUI2335`), as is `submit()` inside the form's own handler
  (`PUI2334`, which would validate and re-enter the body).
* A form with a `submit()` but no `on submit:` body is an error (`PUI2333`); a form whose handler
  nothing calls (`PUI2408`) or that validates no field (`PUI2409`) is a warning.

Whitespace, trimming and message wording belong to the target: the generated validators trim
before testing, and the messages above are what the Flutter generator emits (`03-flutter-codegen`).

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
2. parameters of the enclosing screen or component,
3. loop variables of enclosing `for` nodes,
4. `true`, `false`, `null`.

An identifier in **value position** that resolves to none of these is an error with a suggestion
(`PUI2005`), because the compiler cannot know it exists. An identifier in **call position**
(`signIn(...)`) is assumed to be a host-language function and is allowed — that is the seam where
application logic stays in Dart. Host *values* are supported too, through `import`s that expose
them: `import "package:my_app/app_state.dart"` then `appState.user.name` is allowed because the
root `appState` is imported.

---

## 7. Navigation order

Screens are pushed onto the platform's own navigation stack, in the order the user pushes them.
A screen is constructed from its parameters, so each entry in the stack owns its own state — two
`Detail` screens with different ids are two widgets, not one widget whose fields changed.

`back()` closes the current screen and does nothing when there is nothing to close, so a screen can
be the app's entry point and call `back()` without a guard.

## 8. Generated-code contract

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

## 9. Versioning

* The language is versioned in the spec, not in files; the compiler accepts the syntax defined
  here and reports `PUI1100` for syntax it recognises from a future version.
* Each generator declares a minimum framework version. The Flutter generator targets **Dart 3**
  (`for (final (i, x) in ...)` patterns, records) and Flutter 3.10+, and states so in the file
  banner when it uses a 3.x-only construct.
