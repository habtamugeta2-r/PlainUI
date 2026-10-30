/**
 * The HTML target: a static preview of a screen.
 *
 * This is deliberately *not* a second app framework. It renders one screen into plain HTML and
 * CSS so that the playground can show what a layout looks like without a Flutter toolchain, and
 * so that the claim "the front end is host neutral" is backed by a second working generator.
 *
 * Everything that would need a running app is approximated:
 *   - state starts at its initial value and does not change;
 *   - event handlers are recorded as `data-on-*` attributes, not executed;
 *   - a `for` loop over a value we cannot evaluate renders a single placeholder iteration.
 *
 * The output is a self contained document: no external CSS, no JavaScript, no fonts to download.
 */

import type {
  ComponentDecl,
  Decl,
  Expr,
  IfNode,
  Node,
  Prop,
  ScreenDecl,
  ForNode,
  StateDecl,
} from '../ast.ts';
import type { Analysis } from '../check.ts';
import { describeExpr } from '../debug.ts';
import { widgetSpec } from '../widgets/registry.ts';

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

type Value =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'null' }
  | { readonly kind: 'list'; readonly items: readonly Value[] }
  | { readonly kind: 'color'; readonly css: string }
  | { readonly kind: 'unknown'; readonly text: string };

const UNKNOWN = (expr: Expr): Value => ({ kind: 'unknown', text: describeExpr(expr) });

interface Env {
  values: Map<string, Value>;
}

function lookup(env: Env, name: string): Value | undefined {
  return env.values.get(name);
}

function evaluate(expr: Expr, env: Env): Value {
  switch (expr.kind) {
    case 'String': {
      // `expr.value` keeps `${...}` intact; substitute the pieces we can evaluate.
      const text = expr.value.replace(/\$\{([^}]*)\}/g, (whole: string, inner: string) => {
        const name = inner.trim();
        const value = lookup(env, name);
        return value === undefined ? whole : asText(value);
      });
      return { kind: 'string', value: text };
    }
    case 'Number':
      return { kind: 'number', value: expr.value };
    case 'Bool':
      return { kind: 'bool', value: expr.value };
    case 'Null':
      return { kind: 'null' };
    case 'Color':
      return { kind: 'color', css: cssColor(expr.raw) };
    case 'Ident': {
      const value = lookup(env, expr.name);
      if (value !== undefined) return value;
      if (expr.name === 'true') return { kind: 'bool', value: true };
      if (expr.name === 'false') return { kind: 'bool', value: false };
      if (expr.name === 'null') return { kind: 'null' };
      // A bare identifier that is not in scope is usually a name (`main=between`, `style=price`).
      return UNKNOWN(expr);
    }
    case 'Paren':
      return evaluate(expr.inner, env);
    case 'Member': {
      const object = evaluate(expr.object, env);
      if (object.kind === 'unknown') return UNKNOWN(expr);
      return UNKNOWN(expr);
    }
    case 'Index': {
      const object = evaluate(expr.object, env);
      const index = evaluate(expr.index, env);
      if (object.kind === 'list' && index.kind === 'number') {
        return object.items[index.value] ?? { kind: 'null' };
      }
      return UNKNOWN(expr);
    }
    case 'Unary': {
      if (expr.op === 'await') return evaluate(expr.operand, env);
      const operand = evaluate(expr.operand, env);
      if (expr.op === '!') {
        if (operand.kind === 'bool') return { kind: 'bool', value: !operand.value };
        return UNKNOWN(expr);
      }
      if (operand.kind === 'number') return { kind: 'number', value: -operand.value };
      return UNKNOWN(expr);
    }
    case 'Binary': {
      const left = evaluate(expr.left, env);
      const right = evaluate(expr.right, env);
      const bothNumbers = left.kind === 'number' && right.kind === 'number';
      switch (expr.op) {
        case '+':
          if (bothNumbers) return { kind: 'number', value: left.value + right.value };
          if (left.kind !== 'unknown' && right.kind !== 'unknown') {
            return { kind: 'string', value: asText(left) + asText(right) };
          }
          return UNKNOWN(expr);
        case '-':
          return bothNumbers ? { kind: 'number', value: left.value - right.value } : UNKNOWN(expr);
        case '*':
          return bothNumbers ? { kind: 'number', value: left.value * right.value } : UNKNOWN(expr);
        case '/':
          return bothNumbers && right.value !== 0 ? { kind: 'number', value: left.value / right.value } : UNKNOWN(expr);
        case '==':
        case '!=': {
          if (left.kind === 'unknown' || right.kind === 'unknown') return UNKNOWN(expr);
          const equal = asText(left) === asText(right);
          return { kind: 'bool', value: expr.op === '==' ? equal : !equal };
        }
        case '<':
          return bothNumbers ? { kind: 'bool', value: left.value < right.value } : UNKNOWN(expr);
        case '>':
          return bothNumbers ? { kind: 'bool', value: left.value > right.value } : UNKNOWN(expr);
        case '<=':
          return bothNumbers ? { kind: 'bool', value: left.value <= right.value } : UNKNOWN(expr);
        case '>=':
          return bothNumbers ? { kind: 'bool', value: left.value >= right.value } : UNKNOWN(expr);
        default:
          return UNKNOWN(expr);
      }
    }
    case 'Ternary': {
      const cond = evaluate(expr.cond, env);
      if (cond.kind !== 'bool') return UNKNOWN(expr);
      return evaluate(cond.value ? expr.then : expr.otherwise, env);
    }
    case 'List':
      return { kind: 'list', items: expr.items.map((item) => evaluate(item, env)) };
    default:
      return UNKNOWN(expr);
  }
}

function asText(value: Value): string {
  switch (value.kind) {
    case 'string':
      return value.value;
    case 'number':
      return String(value.value);
    case 'bool':
      return value.value ? 'true' : 'false';
    case 'null':
      return '';
    case 'list':
      return value.items.map(asText).join(', ');
    case 'color':
      return value.css;
    case 'unknown':
      return value.text;
  }
}

function truthy(value: Value): boolean | undefined {
  if (value.kind === 'bool') return value.value;
  if (value.kind === 'null') return false;
  if (value.kind === 'string') return value.value.length > 0;
  if (value.kind === 'number') return value.value !== 0;
  if (value.kind === 'list') return value.items.length > 0;
  return undefined;
}

function cssColor(raw: string): string {
  const hex = raw.replace(/^#/, '');
  const expand = (part: string): number => parseInt(part, 16);
  if (hex.length === 6) return `#${hex}`;
  if (hex.length === 8) {
    const alpha = expand(hex.slice(0, 2)) / 255;
    return `rgba(${expand(hex.slice(2, 4))}, ${expand(hex.slice(4, 6))}, ${expand(hex.slice(6, 8))}, ${alpha.toFixed(3)})`;
  }
  if (hex.length === 3) return `#${hex}`;
  return raw;
}

// ---------------------------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------------------------

export interface HtmlOptions {
  /** Title for the generated document. Defaults to the screen name. */
  readonly title?: string;
}

export interface HtmlResult {
  readonly code: string;
  /** Name of the screen that was rendered. */
  readonly screen?: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/** Styles that come from a `style` declaration, resolved to CSS. */
interface TextStyle {
  readonly fontSize?: string;
  readonly fontWeight?: string;
  readonly color?: string;
  readonly italic?: string;
  readonly letterSpacing?: string;
  readonly lineHeight?: string;
  readonly align?: string;
  readonly decoration?: string;
  readonly family?: string;
}

// Mirrors the Material text theme entries the Flutter target uses for the same names.
const THEME_STYLES: Record<string, TextStyle> = {
  display: { fontSize: '36px', fontWeight: '400', lineHeight: '1.22' },
  heading: { fontSize: '24px', fontWeight: '400', lineHeight: '1.33' },
  subheading: { fontSize: '16px', fontWeight: '500', lineHeight: '1.5' },
  body: { fontSize: '14px', lineHeight: '1.43' },
  caption: { fontSize: '12px', lineHeight: '1.33' },
  label: { fontSize: '14px', fontWeight: '500', lineHeight: '1.43' },
  secondary: { fontSize: '14px', lineHeight: '1.43', color: '#475569' },
};

const WEIGHTS: Record<string, string> = { thin: '100', light: '300', normal: '400', medium: '500', semibold: '600', bold: '700', black: '900' };

const JUSTIFY: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceBetween: 'space-between',
  spaceAround: 'space-around',
  spaceEvenly: 'space-evenly',
};

const ALIGN: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const TEXT_ALIGN: Record<string, string> = { start: 'left', center: 'center', end: 'right', justify: 'justify' };

class HtmlEmitter {
  private readonly env: Env = { values: new Map() };
  private readonly components = new Map<string, ComponentDecl>();
  private readonly styles = new Map<string, TextStyle>();
  private depth = 0;
  private readonly out: string[] = [];
  /** Call-site children for each component call currently being expanded. */
  private readonly slotRenderers: (() => void)[] = [];

  private readonly analysis: Analysis;
  private readonly options: HtmlOptions;

  constructor(analysis: Analysis, options: HtmlOptions = {}) {
    this.analysis = analysis;
    this.options = options;
    for (const decl of analysis.program.decls) {
      if (decl.kind === 'Component') this.components.set(decl.name, decl);
      if (decl.kind === 'Style') this.styles.set(decl.name, propsToTextStyle(decl.props));
    }
  }

  render(): HtmlResult {
    const screen = this.analysis.program.decls.find((decl: Decl): decl is ScreenDecl => decl.kind === 'Screen');
    if (screen === undefined) {
      return { code: this.document(['<p class="pui-empty">This file has no screen to preview.</p>'], 'PlainUI preview') };
    }
    for (const state of screen.state) this.bindState(state);
    const body = this.renderNodes(screen.body, 'pui-screen');
    const title = this.options.title ?? screen.name;
    return { code: this.document(body, title), screen: screen.name };
  }

  // ---- output helpers ----------------------------------------------------------------------

  private line(text: string): void {
    this.out.push(`${'  '.repeat(this.depth)}${text}`);
  }

  /** Format an opening tag. Attributes come before `style`, which is how hand written HTML reads. */
  private tag(name: string, attributes: readonly [string, string | undefined][], styles: readonly string[]): string {
    const parts = [name];
    for (const [key, value] of attributes) {
      if (value === undefined || value === '') continue;
      parts.push(`${key}="${escapeHtml(value)}"`);
    }
    const style = styles.filter((entry) => entry.length > 0).join('; ');
    if (style.length > 0) parts.push(`style="${escapeHtml(style)}"`);
    return parts.join(' ');
  }

  private open(tag: string, attributes: readonly [string, string | undefined][], styles: readonly string[]): void {
    this.line(`<${this.tag(tag, attributes, styles)}>`);
    this.depth += 1;
  }

  /** An element whose only content is text, written on a single line. */
  private inline(tag: string, attributes: readonly [string, string | undefined][], styles: readonly string[], content: string): void {
    this.line(`<${this.tag(tag, attributes, styles)}>${escapeHtml(content)}</${tag}>`);
  }

  /** A void element: no closing tag, because HTML does not allow one. */
  private void_(tag: string, attributes: readonly [string, string | undefined][], styles: readonly string[]): void {
    this.line(`<${this.tag(tag, attributes, styles)}>`);
  }

  private close(tag: string): void {
    this.depth = Math.max(0, this.depth - 1);
    this.line(`</${tag}>`);
  }

  private single(tag: string, attributes: readonly [string, string | undefined][], styles: readonly string[]): void {
    if (VOID_TAGS.has(tag)) this.void_(tag, attributes, styles);
    else this.open(tag, attributes, styles), this.close(tag);
  }

  private textLine(text: string): void {
    if (text.length === 0) return;
    this.line(escapeHtml(text));
  }

  private document(body: string[], title: string): string {
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(title)}</title>`,
      '<style>',
      CSS,
      '</style>',
      '</head>',
      '<body>',
      `<main class="pui-root" data-screen="${escapeHtml(title)}">`,
      ...body.map((line) => `  ${line}`),
      '</main>',
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }

  // ---- state -------------------------------------------------------------------------------

  private bindState(state: StateDecl): void {
    this.env.values.set(state.name, evaluate(state.init, this.env));
  }

  // ---- nodes -------------------------------------------------------------------------------

  private renderNodes(nodes: readonly Node[], wrapperClass?: string): string[] {
    const previousOut = this.out.slice();
    const previousDepth = this.depth;
    this.out.length = 0;
    this.depth = 0;

    for (const node of nodes) this.renderNode(node);

    const body = this.out.map((line) => line);
    this.out.length = 0;
    this.out.push(...previousOut);
    this.depth = previousDepth;

    if (wrapperClass === undefined) return body;
    return [`<div class="${wrapperClass}">`, ...body.map((line) => `  ${line}`), '</div>'];
  }

  private renderNode(node: Node): void {
    switch (node.kind) {
      case 'Element':
        this.renderElement(node);
        return;
      case 'If':
        this.renderIf(node);
        return;
      case 'For':
        this.renderFor(node);
        return;
      case 'Slot': {
        const render = this.slotRenderers[this.slotRenderers.length - 1];
        if (render === undefined) this.line('<!-- slot: no children were passed -->');
        else render();
        return;
      }
      case 'State':
      case 'Event':
        // State is hoisted to the top of the screen; handlers are not executed in a preview.
        return;
    }
  }

  private renderIf(node: IfNode): void {
    for (const branch of node.branches) {
      const value = truthy(evaluate(branch.cond, this.env));
      if (value === true) {
        for (const child of branch.body) this.renderNode(child);
        return;
      }
      if (value === undefined) {
        // Unknown condition: show the branch, marked as conditional, rather than nothing.
        this.open('div', [['class', 'pui-conditional'], ['title', `if ${describeExpr(branch.cond)}`]], []);
        for (const child of branch.body) this.renderNode(child);
        this.close('div');
        return;
      }
    }
    for (const child of node.elseBody ?? []) this.renderNode(child);
  }

  private renderFor(node: ForNode): void {
    const iterable = evaluate(node.iterable, this.env);
    if (iterable.kind === 'list' && iterable.items.length > 0) {
      iterable.items.forEach((item, index) => {
        const saved = new Map(this.env.values);
        this.env.values.set(node.itemName, item);
        if (node.indexName !== undefined) this.env.values.set(node.indexName, { kind: 'number', value: index });
        for (const child of node.body) this.renderNode(child);
        this.env.values = new Map(saved);
      });
      return;
    }
    if (iterable.kind === 'list') return; // a literal empty list renders nothing

    // Unknown iterable: one iteration with a placeholder, clearly marked in the preview.
    const saved = new Map(this.env.values);
    this.env.values.set(node.itemName, { kind: 'string', value: `‹${node.itemName}›` });
    if (node.indexName !== undefined) this.env.values.set(node.indexName, { kind: 'number', value: 0 });
    this.open('div', [['class', 'pui-repeat'], ['title', `for ${node.itemName} in ${describeExpr(node.iterable)}`]], []);
    for (const child of node.body) this.renderNode(child);
    this.close('div');
    this.env.values = new Map(saved);
  }

  // ---- props -------------------------------------------------------------------------------

  private prop(element: { props: readonly Prop[] }, name: string): Expr | undefined {
    return element.props.find((prop) => prop.name === name)?.value;
  }

  private value(element: { props: readonly Prop[] }, name: string): Value | undefined {
    const expr = this.prop(element, name);
    return expr === undefined ? undefined : evaluate(expr, this.env);
  }

  private text(value: Value | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (value.kind === 'unknown') return undefined;
    return asText(value);
  }

  /**
   * The literal name a property refers to. `style=heading` and `main=between` are identifiers,
   * not expressions, so they must be read as names rather than evaluated as variables.
   */
  private name(element: { props: readonly Prop[] }, property: string): string | undefined {
    const expr = this.prop(element, property);
    if (expr === undefined) return undefined;
    if (expr.kind === 'Ident') return expr.name;
    const value = evaluate(expr, this.env);
    return value.kind === 'unknown' ? undefined : asText(value);
  }

  private number(element: { props: readonly Prop[] }, name: string): number | undefined {
    const value = this.value(element, name);
    if (value === undefined) return undefined;
    if (value.kind === 'number') return value.value;
    if (value.kind === 'string') return Number(value.value);
    return undefined;
  }

  private bool(element: { props: readonly Prop[] }, name: string): boolean {
    const value = this.value(element, name);
    return value !== undefined && truthy(value) === true;
  }

  private colour(element: { props: readonly Prop[] }, ...names: readonly string[]): string | undefined {
    for (const name of names) {
      const value = this.value(element, name);
      if (value !== undefined && value.kind === 'color') return value.css;
      if (value !== undefined && value.kind === 'string') return value.value;
    }
    return undefined;
  }

  /** Universal props, in the same order the Flutter generator wraps them. */
  private universalStyles(element: { props: readonly Prop[] }, extra: readonly string[] = [], skip: readonly string[] = []): string[] {
    const styles: string[] = [...extra];
    const padding = this.number(element, 'padding');
    if (padding !== undefined && !skip.includes('padding')) styles.push(`padding: ${padding}px`);
    const margin = this.number(element, 'margin');
    if (margin !== undefined) styles.push(`margin: ${margin}px`);
    const width = this.number(element, 'width');
    if (width !== undefined) styles.push(`width: ${width}px`, 'flex: none');
    const height = this.number(element, 'height');
    if (height !== undefined) styles.push(`height: ${height}px`);
    const size = this.number(element, 'size');
    if (size !== undefined) styles.push(`width: ${size}px`, `height: ${size}px`, 'flex: none');
    const opacity = this.number(element, 'opacity');
    if (opacity !== undefined) styles.push(`opacity: ${opacity}`);
    const background = this.colour(element, 'bg', 'background');
    if (background !== undefined) styles.push(`background: ${background}`);
    const radius = this.number(element, 'radius');
    if (radius !== undefined && !skip.includes('radius')) styles.push(`border-radius: ${radius}px`);
    const borderColor = this.colour(element, 'borderColor');
    const border = this.number(element, 'border');
    if (border !== undefined) styles.push(`border: ${border}px solid ${borderColor ?? 'currentColor'}`);
    const flex = this.number(element, 'flex');
    if (flex !== undefined) styles.push(`flex: ${flex}`);
    const align = this.name(element, 'align');
    if (align !== undefined && ALIGN[align] !== undefined) styles.push(`align-self: ${ALIGN[align]}`);
    return styles;
  }

  private gap(element: { props: readonly Prop[] }, fallback: string): string {
    const gap = this.number(element, 'gap');
    return gap === undefined ? fallback : `${gap}px`;
  }

  private justify(element: { props: readonly Prop[] }): string | undefined {
    const main = this.name(element, 'main');
    return main === undefined ? undefined : JUSTIFY[main];
  }

  private alignItems(element: { props: readonly Prop[] }): string | undefined {
    const cross = this.name(element, 'cross');
    return cross === undefined ? undefined : ALIGN[cross];
  }

  private textStyleFor(element: { props: readonly Prop[] }): string[] {
    const styles: string[] = ['white-space: pre-wrap'];
    const styleName = this.name(element, 'style');
    const base = styleName === undefined ? undefined : this.styles.get(styleName) ?? THEME_STYLES[styleName];
    if (base !== undefined) {
      if (base.fontSize !== undefined) styles.push(`font-size: ${base.fontSize}`);
      if (base.fontWeight !== undefined) styles.push(`font-weight: ${base.fontWeight}`);
      if (base.color !== undefined) styles.push(`color: ${base.color}`);
      if (base.italic !== undefined) styles.push('font-style: italic');
      if (base.letterSpacing !== undefined) styles.push(`letter-spacing: ${base.letterSpacing}`);
      if (base.lineHeight !== undefined) styles.push(`line-height: ${base.lineHeight}`);
      if (base.align !== undefined) styles.push(`text-align: ${base.align}`);
      if (base.decoration !== undefined) styles.push(`text-decoration: ${base.decoration}`);
      if (base.family !== undefined) styles.push(`font-family: ${base.family}`);
    }
    const size = this.number(element, 'size');
    if (size !== undefined) styles.push(`font-size: ${size}px`);
    const weight = this.name(element, 'weight');
    if (weight !== undefined) styles.push(`font-weight: ${WEIGHTS[weight] ?? weight}`);
    const color = this.colour(element, 'color');
    if (color !== undefined) styles.push(`color: ${color}`);
    if (this.bool(element, 'italic')) styles.push('font-style: italic');
    if (this.bool(element, 'underline')) styles.push('text-decoration: underline');
    const align = this.name(element, 'textAlign');
    if (align !== undefined && TEXT_ALIGN[align] !== undefined) styles.push(`text-align: ${TEXT_ALIGN[align]}`);
    const maxLines = this.number(element, 'maxLines');
    if (maxLines !== undefined) {
      styles.push('overflow: hidden', 'display: -webkit-box', `-webkit-line-clamp: ${maxLines}`, '-webkit-box-orient: vertical');
    }
    return styles;
  }

  private childContent(element: { children: readonly Node[] }): boolean {
    return element.children.length > 0;
  }

  private renderChildren(children: readonly Node[]): void {
    for (const child of children) this.renderNode(child);
  }

  // ---- elements ----------------------------------------------------------------------------

  private renderElement(element: import('../ast.ts').ElementNode): void {
    const spec = widgetSpec(element.tag);

    // Components declared in this file are inlined with their arguments bound.
    if (element.callStyle && this.components.has(element.tag)) {
      this.renderComponentCall(element);
      return;
    }

    const tag = element.tag;
    switch (tag) {
      case 'text': {
        const content = element.args[0] === undefined ? '' : this.text(evaluate(element.args[0].value, this.env)) ?? '';
        this.inline('span', [['class', 'pui-text']], [...this.textStyleFor(element), ...this.universalStyles(element)], content);
        return;
      }
      case 'heading': {
        const content = element.args[0] === undefined ? '' : this.text(evaluate(element.args[0].value, this.env)) ?? '';
        this.inline('h2', [['class', 'pui-heading']], [...this.textStyleFor(element), 'font-size: 28px', 'margin: 0'], content);
        return;
      }
      case 'label': {
        const content = element.args[0] === undefined ? '' : this.text(evaluate(element.args[0].value, this.env)) ?? '';
        this.inline('span', [['class', 'pui-label']], [...this.textStyleFor(element), 'font-size: 12px', 'opacity: 0.7'], content);
        return;
      }
      case 'column':
      case 'list': {
        this.open('div', [['class', `pui-${tag}`]], [
          'display: flex',
          'flex-direction: column',
          `gap: ${this.gap(element, '0')}`,
          ...(this.justify(element) === undefined ? [] : [`justify-content: ${this.justify(element)}`]),
          ...(this.alignItems(element) === undefined ? [] : [`align-items: ${this.alignItems(element)}`]),
          ...this.universalStyles(element),
        ]);
        this.renderChildren(element.children);
        this.close('div');
        return;
      }
      case 'row': {
        this.open('div', [['class', 'pui-row']], [
          'display: flex',
          'flex-direction: row',
          'align-items: center',
          `gap: ${this.gap(element, '8px')}`,
          ...(this.justify(element) === undefined ? [] : [`justify-content: ${this.justify(element)}`]),
          ...(this.alignItems(element) === undefined ? [] : [`align-items: ${this.alignItems(element)}`]),
          ...this.universalStyles(element),
        ]);
        this.renderChildren(element.children);
        this.close('div');
        return;
      }
      case 'wrap': {
        this.open('div', [['class', 'pui-wrap']], [
          'display: flex',
          'flex-wrap: wrap',
          `gap: ${this.gap(element, '8px')}`,
          ...this.universalStyles(element),
        ]);
        this.renderChildren(element.children);
        this.close('div');
        return;
      }
      case 'stack': {
        this.open('div', [['class', 'pui-stack']], [
          'display: grid',
          'grid-template-areas: "stack"',
          `gap: ${this.gap(element, '0')}`,
          ...this.universalStyles(element),
        ]);
        for (const child of element.children) {
          this.open('div', [['class', 'pui-stack-layer']], ['grid-area: stack']);
          this.renderNode(child);
          this.close('div');
        }
        this.close('div');
        return;
      }
      case 'grid': {
        const columns = this.number(element, 'columns') ?? 2;
        this.open('div', [['class', 'pui-grid']], [
          'display: grid',
          `grid-template-columns: repeat(${columns}, minmax(0, 1fr))`,
          `gap: ${this.gap(element, '8px')}`,
          ...this.universalStyles(element),
        ]);
        this.renderChildren(element.children);
        this.close('div');
        return;
      }
      case 'card': {
        this.open('div', [['class', 'pui-card']], [
          'background: #ffffff',
          `border-radius: ${this.number(element, 'radius') ?? 12}px`,
          `padding: ${this.number(element, 'padding') ?? 16}px`,
          'box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 4px 12px rgba(15, 23, 42, 0.06)',
          ...this.universalStyles(element, [], ['padding', 'radius']),
        ]);
        this.renderChildren(element.children);
        this.close('div');
        return;
      }
      case 'button': {
        const content = element.args[0] === undefined ? 'Button' : this.text(evaluate(element.args[0].value, this.env)) ?? 'Button';
        this.open('button', [['class', 'pui-button'], ['type', 'button'], ['data-event', this.eventNames(element)]], [
          'font: inherit',
          'border: 0',
          'border-radius: 10px',
          'padding: 10px 18px',
          'background: #2563eb',
          'color: #ffffff',
          'font-weight: 600',
          'cursor: pointer',
          ...this.universalStyles(element),
        ]);
        this.line(escapeHtml(content));
        this.close('button');
        return;
      }
      case 'iconButton': {
        const icon = element.args[0] === undefined ? 'star' : this.text(evaluate(element.args[0].value, this.env)) ?? 'star';
        this.open('button', [['class', 'pui-icon-button'], ['type', 'button'], ['title', icon]], [
          'font: inherit',
          'border: 0',
          'border-radius: 999px',
          'width: 40px',
          'height: 40px',
          'background: rgba(15, 23, 42, 0.06)',
          'cursor: pointer',
          ...this.universalStyles(element),
        ]);
        this.line(ICONS[icon] ?? '★');
        this.close('button');
        return;
      }
      case 'icon': {
        const icon = element.args[0] === undefined ? 'star' : this.text(evaluate(element.args[0].value, this.env)) ?? 'star';
        const size = this.number(element, 'size') ?? 24;
        this.single('span', [['class', 'pui-icon'], ['title', icon]], [
          `font-size: ${size}px`,
          'line-height: 1',
          ...(this.colour(element, 'color') === undefined ? [] : [`color: ${this.colour(element, 'color')}`]),
        ]);
        return;
      }
      case 'input': {
        const label = this.name(element, 'label');
        const value = element.args[0] === undefined ? '' : this.text(evaluate(element.args[0].value, this.env)) ?? '';
        const multiline = this.number(element, 'maxLines') !== undefined && (this.number(element, 'maxLines') ?? 1) > 1;
        this.open('label', [['class', 'pui-field']], ['display: flex', 'flex-direction: column', 'gap: 4px', ...this.universalStyles(element)]);
        if (label !== undefined) {
          this.inline('span', [['class', 'pui-field-label']], ['font-size: 12px', 'font-weight: 600', 'opacity: 0.7'], label);
        }
        const placeholder = this.name(element, 'hint') ?? this.name(element, 'placeholder') ?? '';
        if (multiline) {
          this.open('textarea', [['rows', String(this.number(element, 'maxLines') ?? 3)], ['placeholder', placeholder]], [
            'font: inherit',
            'padding: 10px 12px',
            'border: 1px solid rgba(15, 23, 42, 0.16)',
            'border-radius: 10px',
            'background: #ffffff',
          ]);
          this.textLine(value);
          this.close('textarea');
        } else {
          this.single('input', [['type', this.bool(element, 'secret') || this.bool(element, 'obscure') ? 'password' : 'text'], ['value', value], ['placeholder', placeholder]], [
            'font: inherit',
            'padding: 10px 12px',
            'border: 1px solid rgba(15, 23, 42, 0.16)',
            'border-radius: 10px',
            'background: #ffffff',
          ]);
        }
        this.close('label');
        return;
      }
      case 'checkbox':
      case 'switch': {
        const label = element.args[0] === undefined ? '' : this.text(evaluate(element.args[0].value, this.env)) ?? '';
        this.open('label', [['class', 'pui-check']], ['display: flex', 'align-items: center', 'gap: 8px', ...this.universalStyles(element)]);
        this.single('input', [['type', 'checkbox'], ['checked', this.bool(element, 'checked') || this.bool(element, 'value') ? '' : undefined]], []);
        this.textLine(label);
        this.close('label');
        return;
      }
      case 'image': {
        const src = this.name(element, 'src') ?? this.name(element, 'url') ?? '';
        const width = this.number(element, 'width');
        const height = this.number(element, 'height');
        this.single('img', [['class', 'pui-image'], ['src', src], ['alt', this.name(element, 'alt') ?? '']], [
          ...(width === undefined ? [] : [`width: ${width}px`]),
          ...(height === undefined ? [] : [`height: ${height}px`]),
          'object-fit: cover',
          'border-radius: 12px',
          ...this.universalStyles(element),
        ]);
        return;
      }
      case 'avatar': {
        const name = this.name(element, 'name') ?? this.name(element, 'label') ?? 'A';
        this.open('span', [['class', 'pui-avatar']], [
          'display: inline-flex',
          'align-items: center',
          'justify-content: center',
          'width: 40px',
          'height: 40px',
          'border-radius: 999px',
          'background: #2563eb',
          'color: #ffffff',
          'font-weight: 600',
          ...this.universalStyles(element),
        ]);
        this.line(escapeHtml(name.slice(0, 1).toUpperCase()));
        this.close('span');
        return;
      }
      case 'chip': {
        const label = element.args[0] === undefined ? '' : this.text(evaluate(element.args[0].value, this.env)) ?? '';
        this.open('span', [['class', 'pui-chip']], [
          'display: inline-flex',
          'align-items: center',
          'padding: 4px 10px',
          'border-radius: 999px',
          'background: rgba(37, 99, 235, 0.1)',
          'color: #1d4ed8',
          'font-size: 12px',
          'font-weight: 600',
          ...this.universalStyles(element),
        ]);
        this.line(escapeHtml(label));
        this.close('span');
        return;
      }
      case 'divider':
        this.single('hr', [['class', 'pui-divider']], ['border: 0', 'border-top: 1px solid rgba(15, 23, 42, 0.12)', 'margin: 8px 0']);
        return;
      case 'spacer':
        this.single('div', [['class', 'pui-spacer']], ['flex: 1']);
        return;
      case 'progress': {
        const value = this.number(element, 'value');
        this.open('div', [['class', 'pui-progress']], ['height: 6px', 'border-radius: 999px', 'background: rgba(15, 23, 42, 0.1)', 'overflow: hidden']);
        this.single('div', [['class', 'pui-progress-bar']], [
          `width: ${value === undefined ? 40 : Math.max(0, Math.min(100, value * (value <= 1 ? 100 : 1)))}%`,
          'height: 100%',
          'background: #2563eb',
        ]);
        this.close('div');
        return;
      }
      case 'scaffold': {
        const title = this.name(element, 'title') ?? '';
        const hasAppBar = this.bool(element, 'appBar') || title.length > 0;
        this.open('div', [['class', 'pui-scaffold']], ['display: flex', 'flex-direction: column', 'min-height: 100%', ...this.universalStyles(element)]);
        if (hasAppBar) {
          this.open('header', [['class', 'pui-appbar']], [
            'display: flex',
            'align-items: center',
            'gap: 12px',
            'padding: 12px 16px',
            'background: #2563eb',
            'color: #ffffff',
            'font-weight: 600',
          ]);
          this.textLine(title);
          this.close('header');
        }
        this.open('div', [['class', 'pui-scaffold-body']], ['padding: 16px', 'display: flex', 'flex-direction: column', 'gap: 12px']);
        this.renderChildren(element.children);
        this.close('div');
        this.close('div');
        return;
      }
      case 'slot':
        return;
      default: {
        // Host widgets and unknown tags become a labelled placeholder rather than nothing.
        if (element.callStyle) {
          const label = this.name(element, 'title') ?? this.name(element, 'label');
          this.open('div', [['class', 'pui-host'], ['title', `${element.tag} — host Dart widget`]], this.universalStyles(element));
          this.textLine(label ?? element.tag);
          this.renderChildren(element.children);
          this.close('div');
          return;
        }
        this.open('div', [['class', 'pui-unknown'], ['title', `${element.tag} has no HTML rendering`]], this.universalStyles(element));
        this.textLine(labelFor(element.tag));
        this.renderChildren(element.children);
        this.close('div');
        return;
      }
    }
  }

  private eventNames(element: { events: readonly import('../ast.ts').EventHandler[] }): string | undefined {
    if (element.events.length === 0) return undefined;
    return element.events.map((event) => event.name).join(' ');
  }

  private renderComponentCall(element: import('../ast.ts').ElementNode): void {
    const decl = this.components.get(element.tag)!;
    const saved = new Map(this.env.values);

    element.args.forEach((arg, index) => {
      const param = arg.name !== undefined ? decl.params.find((candidate) => candidate.name === arg.name) : decl.params[index];
      if (param === undefined) return;
      this.env.values.set(param.name, evaluate(arg.value, this.env));
    });

    for (const state of decl.state) this.bindState(state);

    if (element.children.length > 0) this.slotRenderers.push(() => this.renderChildren(element.children));
    this.open('div', [['class', 'pui-component'], ['data-component', decl.name]], ['display: flex', 'flex-direction: column', 'gap: 0']);
    this.renderChildren(decl.body);
    this.close('div');
    if (element.children.length > 0) this.slotRenderers.pop();

    this.env.values = new Map(saved);
  }
}

function labelFor(tag: string): string {
  const spec = widgetSpec(tag);
  return spec === undefined ? tag : spec.summary;
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'source']);

const ICONS: Record<string, string> = {
  star: '★',
  heart: '♥',
  home: '⌂',
  search: '⌕',
  settings: '⚙',
  person: '☺',
  add: '+',
  close: '×',
  check: '✓',
  menu: '☰',
  back: '←',
  forward: '→',
  favorite: '♥',
  delete: '⌫',
  edit: '✎',
  send: '→',
  share: '⤴',
  info: 'ⓘ',
  warning: '⚠',
  refresh: '↻',
};

/** Turn a `style` declaration into CSS. Only the properties `STYLE_PROPS` allows exist. */
function propsToTextStyle(props: readonly Prop[]): TextStyle {
  const values = new Map<string, string>();
  for (const prop of props) {
    const value = prop.value;
    if (value.kind === 'String') values.set(prop.name, value.value);
    else if (value.kind === 'Ident') values.set(prop.name, value.name);
    else if (value.kind === 'Number') values.set(prop.name, `${value.value}`);
    else if (value.kind === 'Color') values.set(prop.name, cssColor(value.raw));
    else if (value.kind === 'Bool') values.set(prop.name, value.value ? 'true' : 'false');
  }

  const size = values.get('size');
  const weight = values.get('weight');
  const color = values.get('color');
  const family = values.get('fontFamily');
  const letterSpacing = values.get('letterSpacing');
  const lineHeight = values.get('lineHeight');

  return {
    ...(size === undefined ? {} : { fontSize: `${size}px` }),
    ...(weight === undefined ? {} : { fontWeight: WEIGHTS[weight] ?? weight }),
    ...(color === undefined ? {} : { color }),
    ...(family === undefined ? {} : { family: family.replace(/_/g, ' ') }),
    ...(letterSpacing === undefined ? {} : { letterSpacing: `${letterSpacing}px` }),
    ...(lineHeight === undefined ? {} : { lineHeight }),
    ...(values.get('italic') === 'true' ? { italic: 'italic' } : {}),
  };
}

// ---------------------------------------------------------------------------------------------

/** Render one screen of a compiled program as a standalone HTML document. */
export function generateHtml(analysis: Analysis, options: HtmlOptions = {}): HtmlResult {
  return new HtmlEmitter(analysis, options).render();
}

/** Render only the fragment, for embedding in the playground's preview pane. */
export function generateHtmlFragment(analysis: Analysis): string {
  const result = generateHtml(analysis);
  const match = /<main class="pui-root"[^>]*>([\s\S]*)<\/main>/.exec(result.code);
  return match === null ? result.code : match[1]!.trimEnd();
}

const CSS = `:root {
  color-scheme: light;
  --pui-bg: #f8fafc;
  --pui-fg: #0f172a;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  padding: 24px;
  background: var(--pui-bg);
  color: var(--pui-fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.pui-root { max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
.pui-screen { display: flex; flex-direction: column; gap: 12px; }
.pui-conditional, .pui-repeat { display: contents; }
.pui-conditional { outline: 1px dashed rgba(37, 99, 235, 0.35); outline-offset: 4px; border-radius: 8px; }
.pui-repeat { outline: 1px dashed rgba(100, 116, 139, 0.35); outline-offset: 4px; border-radius: 8px; }
.pui-host, .pui-unknown, .pui-component {
  border: 1px dashed rgba(100, 116, 139, 0.5);
  border-radius: 10px;
  padding: 10px 12px;
  color: #475569;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pui-component { border-color: rgba(37, 99, 235, 0.4); }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.pui-empty { color: #64748b; font-style: italic; }
`;
