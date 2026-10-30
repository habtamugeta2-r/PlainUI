/**
 * The styles the language provides, independent of any target.
 *
 * A style is PlainUI vocabulary — `style=heading` means "the heading style" everywhere — so these
 * lists live beside the checker rather than in a generator. What a target does with a style name is
 * the target's business: Flutter maps it onto `Theme.of(context).textTheme`, the preview onto CSS.
 */

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

/** Properties allowed inside a `style` declaration. */
export const STYLE_PROPS: readonly string[] = [
  'size',
  'weight',
  'color',
  'fontFamily',
  'letterSpacing',
  'lineHeight',
  'italic',
];
