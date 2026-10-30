/**
 * The styles the language provides, independent of any target.
 *
 * A style is PlainUI vocabulary — `style=heading` means "the heading style" everywhere — so these
 * lists live beside the checker rather than in a generator. What a target does with a style name is
 * the target's business: Flutter maps it onto `Theme.of(context).textTheme` or a `TextStyle`
 * constant, the preview onto CSS.
 *
 * A declared style is a **bundle of properties**, and it comes in two halves with different rules:
 *
 * - **text properties** (`size`, `weight`, `color`, …) change how an element's text is drawn. They
 *   only mean something on an element that draws text, so applying a style that sets them to, say,
 *   `column` is an error rather than a no-op (`PUI2373`).
 * - **surface properties** (`padding`, `background`, `radius`, `shadow`, …) decorate whatever the
 *   element renders. They work on every built-in element and component call site, because the
 *   language implements them by wrapping the element — the same reason `UNIVERSAL_PROPS` works
 *   everywhere a wrapper can be placed.
 *
 * `size` is deliberately absent from the surface half: on an element that draws text it is a font
 * size, so a style that set it would mean two things. Sizing a box uses `width` and `height`.
 *
 * What is deliberately *not* stylable is structure: `main`, `cross`, `gap`, `align`, `expand` and
 * `flex` describe how a layout is arranged, not how it looks. A style that rearranged a layout
 * would be a breakpoint by another name, and the language has a place for those (P3 of the brief).
 */

import type { Expr, StyleDecl } from '../frontend/ast.ts';

/** Text styles that exist without being declared. */
export const BUILTIN_STYLES: readonly string[] = [
  'display',
  'heading',
  'subheading',
  'body',
  'caption',
  'label',
  'secondary',
];

/** Properties allowed inside a `style` declaration that change how text is drawn. */
export const STYLE_PROPS: readonly string[] = [
  'size',
  'weight',
  'color',
  'fontFamily',
  'letterSpacing',
  'lineHeight',
  'italic',
];

/**
 * Properties allowed inside a `style` declaration that decorate an element's surface.
 *
 * These are the universal paint/spacing properties, in the order the generators apply them. They
 * are listed here rather than derived from `UNIVERSAL_PROPS` on purpose: adding a universal
 * property must not silently make it stylable — that is a language decision, and it is this list.
 */
export const STYLE_SURFACE_PROPS: readonly string[] = [
  'padding',
  'margin',
  'width',
  'height',
  'opacity',
  'background',
  'bg',
  'radius',
  'border',
  'borderColor',
  'shadow',
];

const SURFACE = new Set(STYLE_SURFACE_PROPS);

/** Every property name a `style` block accepts. */
export const STYLE_ALL_PROPS: readonly string[] = [...STYLE_PROPS, ...STYLE_SURFACE_PROPS];

/** True when `name` is a property that decorates an element rather than its text. */
export function isSurfaceStyleProp(name: string): boolean {
  return SURFACE.has(name);
}

/** True when a style declares at least one text property. */
export function hasTextProps(decl: StyleDecl): boolean {
  return decl.props.some((prop) => STYLE_PROPS.includes(prop.name));
}

/**
 * The value a style gives a surface property, or nothing.
 *
 * Generators ask for this only after the element's own property came back empty, which is what
 * implements the precedence rule: an explicit property on the element wins over the style, and the
 * style wins over the target's default.
 */
export function surfacePropValue(decl: StyleDecl, name: string): Expr | undefined {
  if (!SURFACE.has(name)) return undefined;
  return decl.props.find((prop) => prop.name === name)?.value;
}
