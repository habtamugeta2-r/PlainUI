# Styling: what a style is, and what it is not

A style is the language's unit of *appearance*. It is not a class name, not a CSS rule and not a
widget wrapper: it is a named bundle of properties that the compiler applies to an element, with
one precedence rule and no cascade.

This page is the design record for that system. The normative rules are in
[`01-language-spec.md` §2.3](01-language-spec.md); the property tables are generated into
[`07-reference.md`](07-reference.md).

## The shape of a style

```
style panel:
    background=surface
    radius=card
    padding=md
    shadow=soft
    border=1
    borderColor=line
```

```
card style=panel:
    text "Hello"
```

Three properties of that design are deliberate:

1. **A style is data, not behaviour.** It holds property values — literals or design tokens — and
   nothing else: no conditionals, no expressions over state, no target vocabulary. That is what lets
   the compiler resolve it once and in both targets.
2. **Precedence is a single line.** Element property > style > target default. There is no cascade,
   no inheritance, no specificity and no `!important` to break a tie, because there are no ties.
   `text "x" style=price size=12` is size 12 — and reading the element is enough to know it.
3. **Structure is out of scope.** `main`, `cross`, `gap`, `align`, `expand` and `flex` are not
   stylable. A style answers "how does this look", never "where does this sit": responsive
   composition is the construct for the second question, and it has its own rules about coverage.

## Two halves, two rules

| Half | Properties | Where it applies |
|---|---|---|
| **text** | `size`, `weight`, `color`, `fontFamily`, `letterSpacing`, `lineHeight`, `italic` | Elements that draw text: `text`, `button`, `input` |
| **surface** | `padding`, `margin`, `width`, `height`, `opacity`, `background`/`bg`, `radius`, `border`, `borderColor`, `shadow` | **Every** element |

Text properties on an element that draws no text are an error (`PUI2373`), because the alternative
— accepting it and painting nothing — is the kind of quiet disappointment that makes a design
language untrustworthy.

Surface properties work everywhere because they are implemented the way the universal properties
always were: by wrapping the element. `column style=panel`, `Badge("new") style=panel` and
`card style=panel` are the same mechanism at three different levels of the language.

`size` is the one name that could belong to either half, so it belongs to text only: on a `text` it
is a font size, and a style that set it would mean two things depending on where it was applied.
Boxes are sized with `width` and `height`.

## Shadows

A shadow is three numbers and an optional colour, written as a list:

```
card shadow=[0, 2, 8]:                  // 12% black by default
card shadow=[0, 2, 8, #1f000000]:       // explicit colour, #AARRGGBB
card shadow=soft:                       // a shadow token
```

```
theme App:
    shadow soft = [0, 2, 8, #1f000000]
    shadow lifted = [0, 8, 24, #24000000]
```

One shape for the literal and the token, checked once (`PUI2306` for the token, `PUI2110` for the
property), so a shadow token cannot hold something the property would reject. `card elevation=…`
remains the card's shorthand; an explicit `shadow` replaces it rather than stacking a second CSS
declaration behind it.

## Lowering

| Element | Flutter | HTML preview |
|---|---|---|
| text properties | a `TextStyle` constant per declared style, `.copyWith()` for overrides | typography declarations on the element |
| surface properties | wrapping `Container`/`Padding`/`SizedBox`/`Opacity`, with a `BoxDecoration` for paint | declarations on the element's `style` attribute |
| `shadow` | `BoxShadow` in the decoration; a `BoxShadow` constant in the theme | `box-shadow` |
| style on a component call | the same decorators around the constructor call | the same declarations on the component wrapper |

Both targets implement the precedence rule, which is why the rule is stated once, in the
specification, rather than twice, in two generators. The golden file
`tests/golden/style.pui` is the review surface for the bytes both producers emit.

## Diagnostics

| Code | Meaning |
|---|---|
| `PUI2301` | Property is neither a text nor a surface property (includes structural properties) |
| `PUI2302` | Unknown style name, with a did-you-mean |
| `PUI2304` | Design token used in the wrong kind of slot |
| `PUI2306` | A token's value does not have the shape its category requires |
| `PUI2110` | A property's value does not have the shape its kind requires |
| `PUI2373` | A style with text properties applied to an element that draws no text |

## What is deliberately missing

- **Cascade and inheritance.** Two ways to win a property is one way too many.
- **Runtime theming.** A second token set that switches at run time is a different feature with a
  different design (who re-renders, and what happens to an already-built const tree); it is not
  smuggled in as "styles can now change".
- **Effects that need a pipeline** — blur, gradient, backdrop filters. Each needs a lowering that is
  faithful on both targets; until both can do it, they are not in the language.
- **Typography tokens** (`font body = "Inter", 16`) and **motion tokens** (`duration`, `curve`).
  The second needs motion to exist first, and the first needs a slot of its own rather than being
  pressed into `fontFamily` and `size`. Both are named in `PROMPT.md` P1/P2 as the remaining work.
