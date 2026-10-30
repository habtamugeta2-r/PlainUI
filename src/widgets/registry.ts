/**
 * The widget registry.
 *
 * Everything that knows a widget's *name* lives here: its arguments, its properties, its events,
 * its child policy, and its documentation. The registry is framework-neutral on purpose — the
 * validator, the docs generator and the language server read it; only the code generators know
 * what a widget turns into.
 *
 * A consequence worth stating: adding a widget to PlainUI means adding a spec here and an
 * emitter in `codegen/flutter.ts`. A test fails if the two lists disagree.
 */

export type PropKind =
  | 'number'
  | 'string'
  | 'bool'
  | 'color'
  | 'edge' // number | [vertical, horizontal] | [top, right, bottom, left]
  | 'size' // number | [width, height]
  | 'enum'
  | 'styleName'
  | 'expr';

export interface PropSpec {
  readonly name: string;
  readonly kind: PropKind;
  /** For `enum` kinds: the closed set of accepted names. */
  readonly values?: readonly string[];
  readonly summary: string;
  /** Where the value ends up, for the docs. */
  readonly mapsTo?: string;
}

export interface ArgSpec {
  readonly name: string;
  readonly kind: PropKind;
  readonly required?: boolean;
  readonly summary: string;
}

export interface WidgetSpec {
  readonly tag: string;
  readonly summary: string;
  readonly group: 'layout' | 'content' | 'input' | 'display';
  /** How many children the element accepts. */
  readonly children: 'multi' | 'single' | 'none';
  readonly args: readonly ArgSpec[];
  readonly props: readonly PropSpec[];
  /** Native events, on top of the generic gesture events every element supports. */
  readonly events: readonly string[];
  /** One worked example, used by the docs generator (a test asserts it parses). */
  readonly example: string;
  readonly note?: string;
}

const ALIGNMENT = [
  'topLeft',
  'topCenter',
  'topRight',
  'centerLeft',
  'center',
  'centerRight',
  'bottomLeft',
  'bottomCenter',
  'bottomRight',
] as const;

const MAIN_AXIS = ['start', 'end', 'center', 'between', 'around', 'evenly'] as const;
const CROSS_AXIS = ['start', 'end', 'center', 'stretch', 'baseline'] as const;
const TEXT_ALIGN = ['start', 'end', 'center', 'justify'] as const;
const FONT_WEIGHT = ['thin', 'light', 'regular', 'medium', 'semiBold', 'bold', 'black'] as const;
const OVERFLOW = ['clip', 'fade', 'ellipsis', 'visible'] as const;
const FIT = ['contain', 'cover', 'fill', 'fitWidth', 'fitHeight', 'none', 'scaleDown'] as const;
const KEYBOARD = ['text', 'email', 'number', 'phone', 'url', 'multiline'] as const;
const AXIS = ['vertical', 'horizontal'] as const;

/**
 * Properties that work on **every** element, because the generator implements them by wrapping
 * the element rather than by passing them through. See docs/01-language-spec.md §4.1.
 */
export const UNIVERSAL_PROPS: readonly PropSpec[] = [
  { name: 'padding', kind: 'edge', summary: 'Inner spacing. 24, [vertical, horizontal], or [top, right, bottom, left].', mapsTo: 'Padding' },
  { name: 'margin', kind: 'edge', summary: 'Outer spacing.', mapsTo: 'Container.margin' },
  { name: 'width', kind: 'number', summary: 'Fixed width in logical pixels.' },
  { name: 'height', kind: 'number', summary: 'Fixed height in logical pixels.' },
  { name: 'size', kind: 'number', summary: 'Fixed width and height.' },
  { name: 'expand', kind: 'bool', summary: 'Fill the available space along the parent’s main axis.', mapsTo: 'Expanded' },
  { name: 'flex', kind: 'number', summary: 'Flex factor used with expand.', mapsTo: 'Expanded.flex' },
  { name: 'opacity', kind: 'number', summary: 'Transparency, 0 to 1.', mapsTo: 'Opacity' },
  { name: 'background', kind: 'color', summary: 'Background fill colour.', mapsTo: 'Container.color' },
  { name: 'bg', kind: 'color', summary: 'Alias of background.' },
  { name: 'radius', kind: 'number', summary: 'Corner radius in logical pixels.', mapsTo: 'BorderRadius.circular' },
  { name: 'border', kind: 'number', summary: 'Border width; needs borderColor.', mapsTo: 'Border.all' },
  { name: 'borderColor', kind: 'color', summary: 'Border colour.' },
  { name: 'align', kind: 'enum', values: ALIGNMENT, summary: 'Place the element within the space it is given.', mapsTo: 'Align' },
  { name: 'main', kind: 'enum', values: MAIN_AXIS, summary: 'Main-axis distribution (column, row, scroll, list, wrap).', mapsTo: 'MainAxisAlignment' },
  { name: 'cross', kind: 'enum', values: CROSS_AXIS, summary: 'Cross-axis alignment of children (column, row, wrap).', mapsTo: 'CrossAxisAlignment' },
  { name: 'gap', kind: 'number', summary: 'Space between children (column, row, wrap, list, scroll).' },
];

/** Gesture events every element supports through a wrapper. */
export const GENERIC_EVENTS: readonly string[] = ['tap', 'longTap', 'doubleTap', 'hover'];

const TEXT_PROPS: readonly PropSpec[] = [
  { name: 'style', kind: 'styleName', summary: 'Named text style: heading, display, body, caption, label, secondary, or one declared with "style".' },
  { name: 'color', kind: 'color', summary: 'Text colour.' },
  { name: 'size', kind: 'number', summary: 'Font size in logical pixels.' },
  { name: 'weight', kind: 'enum', values: FONT_WEIGHT, summary: 'Font weight.' },
  { name: 'textAlign', kind: 'enum', values: TEXT_ALIGN, summary: 'Horizontal alignment of the text itself.' },
  { name: 'maxLines', kind: 'number', summary: 'Maximum number of lines before overflowing.' },
  { name: 'overflow', kind: 'enum', values: OVERFLOW, summary: 'What to do with text that does not fit.' },
  { name: 'letterSpacing', kind: 'number', summary: 'Extra space between characters.' },
  { name: 'lineHeight', kind: 'number', summary: 'Line height multiplier.' },
  { name: 'fontFamily', kind: 'string', summary: 'Host font family name.' },
  { name: 'italic', kind: 'bool', summary: 'Render the text in italics.' },
];

const SPECS: readonly WidgetSpec[] = [
  // ---------------------------------------------------------------- layout
  {
    tag: 'column',
    summary: 'Stacks children vertically.',
    group: 'layout',
    children: 'multi',
    args: [],
    props: [
      { name: 'main', kind: 'enum', values: MAIN_AXIS, summary: 'Vertical distribution of children.', mapsTo: 'MainAxisAlignment' },
      { name: 'cross', kind: 'enum', values: CROSS_AXIS, summary: 'Horizontal alignment of children.', mapsTo: 'CrossAxisAlignment' },
      { name: 'gap', kind: 'number', summary: 'Vertical space between children.' },
    ],
    events: [],
    example: 'column padding=16 gap=12:\n    text "One"\n    text "Two"',
  },
  {
    tag: 'row',
    summary: 'Lays children out horizontally.',
    group: 'layout',
    children: 'multi',
    args: [],
    props: [
      { name: 'main', kind: 'enum', values: MAIN_AXIS, summary: 'Horizontal distribution of children.', mapsTo: 'MainAxisAlignment' },
      { name: 'cross', kind: 'enum', values: CROSS_AXIS, summary: 'Vertical alignment of children.', mapsTo: 'CrossAxisAlignment' },
      { name: 'gap', kind: 'number', summary: 'Horizontal space between children.' },
    ],
    events: [],
    example: 'row gap=8 cross=center:\n    image "logo.png" size=24\n    text "PlainUI"',
  },
  {
    tag: 'stack',
    summary: 'Paints children on top of each other.',
    group: 'layout',
    children: 'multi',
    args: [],
    props: [
      { name: 'fit', kind: 'enum', values: ['loose', 'expand'], summary: 'How non-positioned children are sized.' },
      { name: 'align', kind: 'enum', values: ALIGNMENT, summary: 'Where non-positioned children sit.' },
    ],
    events: [],
    example: 'stack:\n    image "cover.png" fit=cover\n    text "Overlay" color=#ffffff',
  },
  {
    tag: 'wrap',
    summary: 'Lays children out in lines that wrap at the edge.',
    group: 'layout',
    children: 'multi',
    args: [],
    props: [
      { name: 'gap', kind: 'number', summary: 'Space between children along a line.' },
      { name: 'runGap', kind: 'number', summary: 'Space between lines.' },
      { name: 'main', kind: 'enum', values: ['start', 'end', 'center', 'between', 'around', 'evenly'], summary: 'Alignment along each line.' },
    ],
    events: [],
    example: 'wrap gap=8 runGap=8:\n    text "one"\n    text "two"\n    text "three"',
  },
  {
    tag: 'scroll',
    summary: 'A scrollable column of children.',
    group: 'layout',
    children: 'multi',
    args: [],
    props: [
      { name: 'axis', kind: 'enum', values: AXIS, summary: 'Scroll direction.' },
      { name: 'gap', kind: 'number', summary: 'Space between children.' },
      { name: 'padding', kind: 'edge', summary: 'Inner spacing around the scrolling content.' },
    ],
    events: [],
    example: 'scroll padding=16 gap=8:\n    text "A"\n    text "B"',
  },
  {
    tag: 'list',
    summary: 'A ListView of children. Use a "for" node to repeat rows.',
    group: 'layout',
    children: 'multi',
    args: [],
    props: [
      { name: 'axis', kind: 'enum', values: AXIS, summary: 'Scroll direction.' },
      { name: 'gap', kind: 'number', summary: 'Space between rows.' },
    ],
    events: [],
    example: 'list gap=8:\n    for item in items:\n        text item',
  },
  {
    tag: 'grid',
    summary: 'A fixed-column grid of children.',
    group: 'layout',
    children: 'multi',
    args: [],
    props: [
      { name: 'columns', kind: 'number', summary: 'Number of columns.' },
      { name: 'gap', kind: 'number', summary: 'Space between cells.' },
    ],
    events: [],
    example: 'grid columns=2 gap=8:\n    text "a"\n    text "b"',
  },
  {
    tag: 'card',
    summary: 'A rounded surface with elevation.',
    group: 'layout',
    children: 'multi',
    args: [],
    props: [
      { name: 'elevation', kind: 'number', summary: 'Shadow depth.' },
      { name: 'radius', kind: 'number', summary: 'Corner radius.' },
      { name: 'padding', kind: 'edge', summary: 'Inner spacing.' },
      { name: 'background', kind: 'color', summary: 'Surface colour.' },
    ],
    events: [],
    example: 'card padding=16 radius=12 elevation=2:\n    text "Inside a card"',
  },
  {
    tag: 'scaffold',
    summary: 'A page shell with an optional app bar.',
    group: 'layout',
    children: 'multi',
    args: [],
    props: [
      { name: 'title', kind: 'string', summary: 'App bar title. Omit for no app bar.' },
      { name: 'background', kind: 'color', summary: 'Page background colour.' },
      { name: 'centerTitle', kind: 'bool', summary: 'Centre the app bar title.' },
    ],
    events: [],
    example: 'scaffold title="Home":\n    center:\n        text "Hello"',
  },
  {
    tag: 'center',
    summary: 'Centres a single child.',
    group: 'layout',
    children: 'single',
    args: [],
    props: [],
    events: [],
    example: 'center:\n    text "Centred"',
  },
  {
    tag: 'align',
    summary: 'Aligns a single child within the available space.',
    group: 'layout',
    children: 'single',
    args: [],
    props: [{ name: 'align', kind: 'enum', values: ALIGNMENT, summary: 'Alignment position.' }],
    events: [],
    example: 'align align=bottomRight:\n    text "corner"',
  },
  {
    tag: 'expanded',
    summary: 'Gives a child the remaining space in a row or column.',
    group: 'layout',
    children: 'single',
    args: [],
    props: [{ name: 'flex', kind: 'number', summary: 'Share of the remaining space (default 1).' }],
    events: [],
    example: 'row:\n    text "label"\n    expanded:\n        text "value"',
  },
  {
    tag: 'safeArea',
    summary: 'Keeps content clear of notches and system bars.',
    group: 'layout',
    children: 'single',
    args: [],
    props: [{ name: 'bottom', kind: 'bool', summary: 'Also avoid the bottom inset.' }],
    events: [],
    example: 'safeArea:\n    text "Not under the notch"',
  },
  {
    tag: 'spacer',
    summary: 'An empty flexible space.',
    group: 'layout',
    children: 'none',
    args: [],
    props: [{ name: 'flex', kind: 'number', summary: 'How much space to take (default 1).' }],
    events: [],
    example: 'row:\n    text "left"\n    spacer\n    text "right"',
  },

  // ---------------------------------------------------------------- content
  {
    tag: 'text',
    summary: 'Displays a string.',
    group: 'content',
    children: 'none',
    args: [{ name: 'content', kind: 'expr', required: true, summary: 'What to show. Any value; non-strings are rendered with toString().' }],
    props: TEXT_PROPS,
    events: [],
    example: 'text "Hello" style=heading',
  },
  {
    tag: 'image',
    summary: 'Displays an asset image or a network image.',
    group: 'content',
    children: 'none',
    args: [{ name: 'src', kind: 'expr', required: true, summary: 'A string literal is treated as an asset path; any other expression as a URL.' }],
    props: [
      { name: 'fit', kind: 'enum', values: FIT, summary: 'How the image fills its box.' },
      { name: 'radius', kind: 'number', summary: 'Clip the image to rounded corners.' },
      { name: 'semanticLabel', kind: 'string', summary: 'Accessibility description.' },
    ],
    events: [],
    example: 'image "assets/avatar.png" size=48 radius=24 fit=cover',
  },
  {
    tag: 'icon',
    summary: 'Displays a Material icon.',
    group: 'content',
    children: 'none',
    args: [{ name: 'name', kind: 'expr', required: true, summary: 'Icon name without the "Icons." prefix, e.g. search, add, close.' }],
    props: [
      { name: 'size', kind: 'number', summary: 'Icon size.' },
      { name: 'color', kind: 'color', summary: 'Icon colour.' },
    ],
    events: [],
    example: 'icon search size=20 color=#666666',
  },
  {
    tag: 'button',
    summary: 'A tappable action button.',
    group: 'input',
    children: 'none',
    args: [{ name: 'label', kind: 'expr', required: true, summary: 'Label text.' }],
    props: [
      { name: 'variant', kind: 'enum', values: ['filled', 'outlined', 'text'], summary: 'Visual style.' },
      { name: 'color', kind: 'color', summary: 'Accent colour.' },
      { name: 'disabled', kind: 'bool', summary: 'Render as disabled and ignore taps.' },
      { name: 'fullWidth', kind: 'bool', summary: 'Stretch to the available width.' },
      ...TEXT_PROPS.filter((p) => ['style', 'size', 'weight'].includes(p.name)),
    ],
    events: ['tap', 'longTap', 'doubleTap', 'hover', 'focus', 'blur'],
    example: 'button "Save" variant=outlined:\n    on tap:\n        save()',
  },
  {
    tag: 'input',
    summary: 'A text field. Bind it to state with bind=<name>.',
    group: 'input',
    children: 'none',
    args: [],
    props: [
      { name: 'bind', kind: 'expr', summary: 'State variable to read and write (two-way binding).' },
      { name: 'label', kind: 'string', summary: 'Floating label.' },
      { name: 'placeholder', kind: 'string', summary: 'Hint text shown when empty.' },
      { name: 'secret', kind: 'bool', summary: 'Obscure the text (passwords).' },
      { name: 'multiline', kind: 'bool', summary: 'Allow multiple lines.' },
      { name: 'maxLines', kind: 'number', summary: 'Maximum visible lines.' },
      { name: 'keyboard', kind: 'enum', values: KEYBOARD, summary: 'Which on-screen keyboard to show.' },
      { name: 'autofocus', kind: 'bool', summary: 'Focus this field when the screen opens.' },
      { name: 'helper', kind: 'string', summary: 'Helper text under the field.' },
      { name: 'counter', kind: 'bool', summary: 'Show a character counter.' },
    ],
    events: ['change', 'submit', 'focus', 'blur'],
    example: 'input bind=email label="Email" keyboard=email',
  },
  {
    tag: 'toggle',
    summary: 'An on/off switch.',
    group: 'input',
    children: 'none',
    args: [],
    props: [
      { name: 'bind', kind: 'expr', summary: 'State variable to read and write.' },
      { name: 'label', kind: 'string', summary: 'Label beside the switch.' },
    ],
    events: ['change'],
    example: 'toggle bind=notifications label="Notifications"',
  },
  {
    tag: 'checkbox',
    summary: 'A checkbox with an optional label.',
    group: 'input',
    children: 'none',
    args: [],
    props: [
      { name: 'bind', kind: 'expr', summary: 'State variable to read and write.' },
      { name: 'label', kind: 'string', summary: 'Label beside the box.' },
    ],
    events: ['change'],
    example: 'checkbox bind=remember label="Remember me"',
  },
  {
    tag: 'slider',
    summary: 'A continuous value selector.',
    group: 'input',
    children: 'none',
    args: [],
    props: [
      { name: 'bind', kind: 'expr', summary: 'State variable to read and write.' },
      { name: 'min', kind: 'number', summary: 'Minimum value (default 0).' },
      { name: 'max', kind: 'number', summary: 'Maximum value (default 1).' },
      { name: 'divisions', kind: 'number', summary: 'Number of discrete stops.' },
    ],
    events: ['change'],
    example: 'slider bind=volume min=0 max=100 divisions=10',
  },

  // ---------------------------------------------------------------- display
  {
    tag: 'divider',
    summary: 'A one-pixel separator line.',
    group: 'display',
    children: 'none',
    args: [],
    props: [
      { name: 'thickness', kind: 'number', summary: 'Line thickness.' },
      { name: 'color', kind: 'color', summary: 'Line colour.' },
    ],
    events: [],
    example: 'divider thickness=1 color=#e0e0e0',
  },
  {
    tag: 'progress',
    summary: 'A progress indicator, determinate or spinning.',
    group: 'display',
    children: 'none',
    args: [],
    props: [
      { name: 'value', kind: 'number', summary: 'Progress from 0 to 1. Omit for an indeterminate spinner.' },
      { name: 'indeterminate', kind: 'bool', summary: 'Force the spinning form.' },
      { name: 'color', kind: 'color', summary: 'Indicator colour.' },
    ],
    events: [],
    example: 'progress indeterminate',
  },
];

export const WIDGETS: ReadonlyMap<string, WidgetSpec> = new Map(SPECS.map((spec) => [spec.tag, spec]));

export const WIDGET_TAGS: readonly string[] = SPECS.map((spec) => spec.tag);

export function widgetSpec(tag: string): WidgetSpec | undefined {
  return WIDGETS.get(tag);
}

export function isBuiltinTag(tag: string): boolean {
  return WIDGETS.has(tag);
}

/** Universal props that this widget does not declare itself (declared ones win). */
export function inheritedProps(spec: WidgetSpec): readonly PropSpec[] {
  const own = new Set(spec.props.map((p) => p.name));
  return UNIVERSAL_PROPS.filter((p) => !own.has(p.name));
}

/** Every property name this element accepts: its own plus the inherited universal ones. */
export function propsFor(spec: WidgetSpec): readonly PropSpec[] {
  return [...spec.props, ...inheritedProps(spec)];
}

export function findProp(spec: WidgetSpec, name: string): PropSpec | undefined {
  return propsFor(spec).find((p) => p.name === name);
}

/** Events this element accepts: native plus the generic gesture set. */
export function eventsFor(spec: WidgetSpec): readonly string[] {
  return [...new Set([...spec.events, ...GENERIC_EVENTS])];
}

/** Grouped widget list, for docs and the playground reference panel. */
export function widgetsByGroup(): { group: WidgetSpec['group']; specs: WidgetSpec[] }[] {
  const groups: WidgetSpec['group'][] = ['layout', 'content', 'input', 'display'];
  return groups.map((group) => ({ group, specs: SPECS.filter((s) => s.group === group) }));
}
