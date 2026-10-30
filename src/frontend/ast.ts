/**
 * The PlainUI AST.
 *
 * It is framework-neutral by construction: there is no `Column` here, only an element whose tag
 * happens to be `column`. Generators map tags to frameworks; the front end never does.
 *
 * Every node carries the span it was parsed from so that diagnostics and generated-code
 * comments can point back at the `.pui` source.
 */

import type { Span } from './source.ts';

// ---------------------------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------------------------

export interface ExprBase {
  readonly kind: string;
  readonly span: Span;
}

export interface StringLit extends ExprBase {
  readonly kind: 'String';
  /** Content between the quotes, escapes left intact. */
  readonly value: string;
  /** Raw source, including quotes. */
  readonly raw: string;
  /** `${...}` fragments, for identifier validation and preview rendering. */
  readonly interpolations: readonly Interpolation[];
}

export interface Interpolation {
  readonly text: string;
  readonly span: Span;
}

export interface NumberLit extends ExprBase {
  readonly kind: 'Number';
  readonly value: number;
  readonly raw: string;
}

export interface BoolLit extends ExprBase {
  readonly kind: 'Bool';
  readonly value: boolean;
}

export interface NullLit extends ExprBase {
  readonly kind: 'Null';
}

export interface ColorLit extends ExprBase {
  readonly kind: 'Color';
  /** e.g. `#80ff6b6b` (with the hash). */
  readonly raw: string;
}

export interface IdentExpr extends ExprBase {
  readonly kind: 'Ident';
  readonly name: string;
}

export interface MemberExpr extends ExprBase {
  readonly kind: 'Member';
  readonly object: Expr;
  readonly name: string;
  readonly nameSpan: Span;
}

export interface CallArg {
  readonly name?: string;
  readonly value: Expr;
  readonly span: Span;
}

export interface CallExpr extends ExprBase {
  readonly kind: 'Call';
  readonly callee: Expr;
  readonly args: readonly CallArg[];
}

export interface IndexExpr extends ExprBase {
  readonly kind: 'Index';
  readonly object: Expr;
  readonly index: Expr;
}

export interface UnaryExpr extends ExprBase {
  readonly kind: 'Unary';
  readonly op: '-' | '!' | 'await';
  readonly operand: Expr;
}

export interface BinaryExpr extends ExprBase {
  readonly kind: 'Binary';
  readonly op: string;
  readonly left: Expr;
  readonly right: Expr;
}

export interface TernaryExpr extends ExprBase {
  readonly kind: 'Ternary';
  readonly cond: Expr;
  readonly then: Expr;
  readonly otherwise: Expr;
}

export interface ListExpr extends ExprBase {
  readonly kind: 'List';
  readonly items: readonly Expr[];
}

export interface ParenExpr extends ExprBase {
  readonly kind: 'Paren';
  readonly inner: Expr;
}

export type Expr =
  | StringLit
  | NumberLit
  | BoolLit
  | NullLit
  | ColorLit
  | IdentExpr
  | MemberExpr
  | CallExpr
  | IndexExpr
  | UnaryExpr
  | BinaryExpr
  | TernaryExpr
  | ListExpr
  | ParenExpr;

// ---------------------------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------------------------

/**
 * One entry in a host surface: `loadTasks(filter: String) -> Future<List<String>>`.
 *
 * A lowercase name declares a function the file may call; a capitalised one declares a host widget
 * constructor it may use. The block exists because PlainUI will not guess: an unqualified call can
 * be passed through to the host forever, but a call to a declared name is checked against the
 * declaration, and a *qualified* call is checked against the module it names.
 */
export interface HostFn {
  readonly kind: 'HostFn';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly params: readonly Param[];
  /** Type text after `->`, if written. `Future<T>` also says the call is asynchronous. */
  readonly typeText?: string;
  readonly typeSpan?: Span;
}

/** `AppLogo(size: double = 24)` inside a host surface — a constructor the file may call. */
export interface HostWidget {
  readonly kind: 'HostWidget';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly params: readonly Param[];
}

export type HostDecl = HostFn | HostWidget;

export interface ImportDecl {
  readonly kind: 'Import';
  readonly span: Span;
  /** Path exactly as written, without quotes. */
  readonly path: string;
  readonly pathSpan: Span;
  /** `import "../data.dart" as data:` — the name a qualified call uses. */
  readonly alias?: string;
  readonly aliasSpan?: Span;
  /** The declarations written under the import, when the block was used. */
  readonly surface?: readonly HostDecl[];
  /** Span of the whole block, for diagnostics that talk about the surface. */
  readonly surfaceSpan?: Span;
}

export interface Param {
  readonly kind: 'Param';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  /** Host-language type text, e.g. `String`, `List<Product>`, `int?`. */
  readonly typeText?: string;
  readonly typeSpan?: Span;
  readonly defaultValue?: Expr;
}

export interface StateDecl {
  readonly kind: 'State';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly typeText?: string;
  readonly typeSpan?: Span;
  readonly init: Expr;
}

export interface Prop {
  readonly kind: 'Prop';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly value: Expr;
}

export interface Arg {
  readonly kind: 'Arg';
  readonly span: Span;
  readonly name?: string;
  readonly nameSpan?: Span;
  readonly value: Expr;
}

/**
 * `derived total = price * count` — a value computed from other values.
 *
 * A derived value is not storage: it is recomputed from what it reads, every time it is read. That
 * makes it impossible to be stale, impossible to assign, and impossible to forget to update — which
 * is the whole class of bug a "computed" field written by hand produces.
 */
export interface DerivedDecl {
  readonly kind: 'Derived';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  /** Optional: without it the type is inferred from the expression. */
  readonly typeText?: string;
  readonly typeSpan?: Span;
  readonly init: Expr;
}

/** One name in an `effect on a, b:` header. */
export interface WatchedState {
  readonly name: string;
  readonly span: Span;
}

/**
 * `effect on query:` — actions that run after the screen is mounted and again whenever one of the
 * named states changes, and at no other time.
 *
 * The names in the header are the whole dependency list. There is no "run after every change" and
 * no implicit tracking: both would be a re-render loop or a behaviour no target can reproduce.
 */
export interface EffectDecl {
  readonly kind: 'Effect';
  readonly span: Span;
  /** The states named in the header, in source order, without duplicates. */
  readonly watches: readonly WatchedState[];
  readonly body: readonly Action[];
}

/**
 * `task items: List<Todo> = loadTodos()` — an async value owned by the screen.
 *
 * A task is a value with three readable parts — `items.loading`, `items.error`, `items.value` — and
 * one action, `items.retry()`. The compiler owns the state machine, so no screen can forget to render
 * a failure or leave a load flag set.
 */
export interface TaskDecl {
  readonly kind: 'Task';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly typeText?: string;
  readonly typeSpan?: Span;
  /** The expression to await. Normally a call to a host function. */
  readonly init: Expr;
}

export interface EventHandler {
  readonly kind: 'Event';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly actions: readonly Action[];
}

export interface ElementNode {
  readonly kind: 'Element';
  readonly span: Span;
  readonly tag: string;
  readonly tagSpan: Span;
  /** Positional arguments first, then named ones (for components/host widgets). */
  readonly args: readonly Arg[];
  readonly props: readonly Prop[];
  /** `on <event>:` handlers written directly inside this element. */
  readonly events: readonly EventHandler[];
  readonly children: readonly Node[];
  /** True when the source used `Name(...)` call style (components/host widgets). */
  readonly callStyle: boolean;
}

export interface IfBranch {
  readonly cond: Expr;
  readonly body: readonly Node[];
  readonly span: Span;
}

export interface IfNode {
  readonly kind: 'If';
  readonly span: Span;
  readonly branches: readonly IfBranch[];
  readonly elseBody?: readonly Node[];
  readonly elseSpan?: Span;
}

export interface ForNode {
  readonly kind: 'For';
  readonly span: Span;
  readonly itemName: string;
  readonly itemSpan: Span;
  readonly indexName?: string;
  readonly indexSpan?: Span;
  readonly iterable: Expr;
  /**
   * `for item in items key=item.id:` — the identity of each row.
   *
   * Without a key, Flutter reuses widget state by position, so removing row 2 makes row 3 look like
   * row 2: the classic "the text field kept the wrong text" bug. Supplying a key is how a `.pui`
   * file says what a row *is*.
   */
  readonly key?: Expr;
  readonly body: readonly Node[];
}

export interface SlotNode {
  readonly kind: 'Slot';
  readonly span: Span;
}

/** Nodes may appear in a body. `State`/`Event` are only legal in specific positions and are
 *  checked by the validator rather than the parser, which keeps error messages semantic. */
export type Node =
  | ElementNode
  | IfNode
  | ForNode
  | SlotNode
  | StateDecl
  | TaskDecl
  | DerivedDecl
  | EffectDecl
  | EventHandler;

// ---------------------------------------------------------------------------------------------
// Actions (event bodies)
// ---------------------------------------------------------------------------------------------

export interface SetAction {
  readonly kind: 'Set';
  readonly span: Span;
  readonly target: Expr;
  readonly op: '=' | '+=' | '-=' | '*=' | '/=';
  readonly value: Expr;
}

export interface CallAction {
  readonly kind: 'Call';
  readonly span: Span;
  readonly expr: Expr;
}

export interface ActionBranch {
  readonly cond: Expr;
  readonly body: readonly Action[];
  readonly span: Span;
}

export interface ActionIf {
  readonly kind: 'ActionIf';
  readonly span: Span;
  readonly branches: readonly ActionBranch[];
  readonly elseBody?: readonly Action[];
  readonly elseSpan?: Span;
}

export type Action = SetAction | CallAction | ActionIf;

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

/**
 * `screen Detail(id: String):` — a screen that takes arguments.
 *
 * A parameter is what makes a screen a destination: `navigate Detail(id: x)` has something to pass,
 * and the compiler has something to check. Screens without parameters stay parameterless, so the
 * common case is written the common way.
 */
export interface ScreenDecl {
  readonly kind: 'Screen';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly params: readonly Param[];
  readonly state: readonly StateDecl[];
  readonly tasks: readonly TaskDecl[];
  /** Computed values, in declaration order. */
  readonly derived: readonly DerivedDecl[];
  /** Effects, in declaration order: the order they run in when several are due together. */
  readonly effects: readonly EffectDecl[];
  readonly body: readonly Node[];
}

export interface ComponentDecl {
  readonly kind: 'Component';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly params: readonly Param[];
  readonly state: readonly StateDecl[];
  readonly tasks: readonly TaskDecl[];
  /** Computed values, in declaration order. */
  readonly derived: readonly DerivedDecl[];
  /** Effects, in declaration order: the order they run in when several are due together. */
  readonly effects: readonly EffectDecl[];
  readonly body: readonly Node[];
}

export interface StyleDecl {
  readonly kind: 'Style';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly props: readonly Prop[];
}

/**
 * The three kinds of value a design token can hold. The category is what decides where the token
 * may be referenced: `color` where a colour is expected, `space` and `radius` where a number is.
 */
export type TokenCategory = 'color' | 'space' | 'radius';

export interface TokenDecl {
  readonly kind: 'Token';
  readonly span: Span;
  readonly category: TokenCategory;
  /** The word the source used (`space` and `spacing` are both accepted). */
  readonly categoryText: string;
  readonly categorySpan: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly value: Expr;
}

/**
 * `theme App:` — design tokens, declared once per file.
 *
 * Tokens are resolved by the compiler rather than at run time: a source-to-source compiler that
 * inlines `padding=md` to `16` keeps generated code const, keeps every target identical, and makes
 * a token impossible to misspell at run time. Runtime theming (dark mode) is a separate, later
 * step, and it arrives as a second token set rather than as a change to what a token is.
 */
export interface ThemeDecl {
  readonly kind: 'Theme';
  readonly span: Span;
  readonly name: string;
  readonly nameSpan: Span;
  readonly tokens: readonly TokenDecl[];
}

export type Decl = ScreenDecl | ComponentDecl | StyleDecl | ThemeDecl;

export interface Program {
  readonly kind: 'Program';
  readonly span: Span;
  readonly path: string;
  readonly imports: readonly ImportDecl[];
  readonly decls: readonly Decl[];
}

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type UiType =
  | { readonly kind: 'string' }
  | { readonly kind: 'int' }
  | { readonly kind: 'double' }
  | { readonly kind: 'num' }
  | { readonly kind: 'bool' }
  | { readonly kind: 'list'; readonly element: UiType }
  | { readonly kind: 'task'; readonly value: UiType }
  | { readonly kind: 'map' }
  | { readonly kind: 'dynamic' }
  | { readonly kind: 'named'; readonly name: string }
  | { readonly kind: 'nullable'; readonly inner: UiType };

export const STRING: UiType = { kind: 'string' };
export const INT: UiType = { kind: 'int' };
export const DOUBLE: UiType = { kind: 'double' };
export const NUM: UiType = { kind: 'num' };
export const BOOL: UiType = { kind: 'bool' };
export const DYNAMIC: UiType = { kind: 'dynamic' };

/** Parse a host type annotation into the small type model used for checking. */
export function typeFromText(text: string): UiType {
  const trimmed = text.trim();
  if (trimmed.endsWith('?')) return { kind: 'nullable', inner: typeFromText(trimmed.slice(0, -1)) };
  if (trimmed === 'String') return STRING;
  if (trimmed === 'int') return INT;
  if (trimmed === 'double') return DOUBLE;
  if (trimmed === 'num') return NUM;
  if (trimmed === 'bool') return BOOL;
  if (trimmed === 'dynamic' || trimmed === 'Object' || trimmed === 'var') return DYNAMIC;
  const listMatch = /^(?:List|Iterable|Set|IList)\s*<\s*(.+)\s*>$/.exec(trimmed);
  if (listMatch !== null) return { kind: 'list', element: typeFromText(listMatch[1]!) };
  const plainList = /^(?:List|Iterable|Set)$/.exec(trimmed);
  if (plainList !== null) return { kind: 'list', element: DYNAMIC };
  if (/^Map\s*</.test(trimmed)) return { kind: 'map' };
  return { kind: 'named', name: trimmed };
}

/**
 * A host return type, split into what the call yields and whether it yields it asynchronously.
 *
 * `-> Future<List<String>>` is a `List<String>` that arrives later; the difference matters at call
 * sites (an asynchronous call needs `await` or a `task`) and nowhere else, so the model keeps one
 * flag rather than a `Future` type that every generator would have to unwrap.
 */
export function returnTypeFromText(text: string): { readonly async: boolean; readonly type: UiType } {
  const trimmed = text.trim();
  const match = /^Future\s*<\s*(.+)\s*>$/.exec(trimmed);
  if (match !== null) return { async: true, type: typeFromText(match[1]!) };
  return { async: false, type: typeFromText(trimmed) };
}

export function typeToText(type: UiType): string {
  switch (type.kind) {
    case 'string':
      return 'String';
    case 'int':
      return 'int';
    case 'double':
      return 'double';
    case 'num':
      return 'num';
    case 'task':
      return typeToText(type.value);
    case 'bool':
      return 'bool';
    case 'list':
      return `List<${typeToText(type.element)}>`;
    case 'map':
      return 'Map<String, dynamic>';
    case 'named':
      return type.name;
    case 'nullable':
      return `${typeToText(type.inner)}?`;
    case 'dynamic':
      return 'dynamic';
  }
}

export function isStringType(type: UiType): boolean {
  return type.kind === 'string' || (type.kind === 'nullable' && isStringType(type.inner));
}

export function isNumericType(type: UiType): boolean {
  const base = type.kind === 'nullable' ? type.inner : type;
  return base.kind === 'int' || base.kind === 'double' || base.kind === 'num';
}

export function isBoolType(type: UiType): boolean {
  const base = type.kind === 'nullable' ? type.inner : type;
  return base.kind === 'bool';
}

export function isIterableType(type: UiType): boolean {
  const base = type.kind === 'nullable' ? type.inner : type;
  return base.kind === 'list' || base.kind === 'map' || base.kind === 'dynamic' || base.kind === 'named';
}

// ---------------------------------------------------------------------------------------------
// Traversal helpers
// ---------------------------------------------------------------------------------------------

export function isElement(node: Node): node is ElementNode {
  return node.kind === 'Element';
}

/** Direct children that are renderable (i.e. not event handlers). */
export function renderableChildren(element: ElementNode): readonly Node[] {
  return element.children;
}

/** Depth-first walk over a body. */
export function walkNodes(nodes: readonly Node[], visit: (node: Node) => void): void {
  for (const node of nodes) {
    visit(node);
    switch (node.kind) {
      case 'Element':
        walkNodes(node.children, visit);
        break;
      case 'If':
        for (const branch of node.branches) walkNodes(branch.body, visit);
        if (node.elseBody !== undefined) walkNodes(node.elseBody, visit);
        break;
      case 'For':
        walkNodes(node.body, visit);
        break;
      default:
        break;
    }
  }
}

export function walkActions(actions: readonly Action[], visit: (action: Action) => void): void {
  for (const action of actions) {
    visit(action);
    if (action.kind === 'ActionIf') {
      for (const branch of action.branches) walkActions(branch.body, visit);
      if (action.elseBody !== undefined) walkActions(action.elseBody, visit);
    }
  }
}

/** Every expression in a body or action list, in source order. */
export function walkExpressions(nodes: readonly Node[], visit: (expr: Expr) => void): void {
  walkNodes(nodes, (node) => {
    switch (node.kind) {
      case 'Element':
        for (const arg of node.args) visit(arg.value);
        for (const prop of node.props) visit(prop.value);
        for (const event of node.events) walkExpressionsInActions(event.actions, visit);
        break;
      case 'If':
        for (const branch of node.branches) visit(branch.cond);
        break;
      case 'For':
        visit(node.iterable);
        break;
      case 'State':
        visit(node.init);
        break;
      default:
        break;
    }
  });
}

export function walkExpressionsInActions(actions: readonly Action[], visit: (expr: Expr) => void): void {
  walkActions(actions, (action) => {
    switch (action.kind) {
      case 'Set':
        visit(action.target);
        visit(action.value);
        break;
      case 'Call':
        visit(action.expr);
        break;
      case 'ActionIf':
        for (const branch of action.branches) visit(branch.cond);
        break;
    }
  });
}

/** Every expression inside an expression, the argument included, in source order. */
export function walkExpr(expr: Expr, visit: (expr: Expr) => void): void {
  visit(expr);
  switch (expr.kind) {
    case 'Member':
      walkExpr(expr.object, visit);
      return;
    case 'Call':
      walkExpr(expr.callee, visit);
      for (const arg of expr.args) walkExpr(arg.value, visit);
      return;
    case 'Index':
      walkExpr(expr.object, visit);
      walkExpr(expr.index, visit);
      return;
    case 'Unary':
      walkExpr(expr.operand, visit);
      return;
    case 'Binary':
      walkExpr(expr.left, visit);
      walkExpr(expr.right, visit);
      return;
    case 'Ternary':
      walkExpr(expr.cond, visit);
      walkExpr(expr.then, visit);
      walkExpr(expr.otherwise, visit);
      return;
    case 'List':
      for (const item of expr.items) walkExpr(item, visit);
      return;
    case 'Paren':
      walkExpr(expr.inner, visit);
      return;
    default:
      return;
  }
}

/** Root identifiers used inside an expression (for scope checking). */
export function rootIdentifiers(expr: Expr): IdentExpr[] {
  const out: IdentExpr[] = [];
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case 'Ident':
        out.push(e);
        break;
      case 'Member':
        walk(e.object);
        break;
      case 'Call':
        walk(e.callee);
        for (const arg of e.args) walk(arg.value);
        break;
      case 'Index':
        walk(e.object);
        walk(e.index);
        break;
      case 'Unary':
        walk(e.operand);
        break;
      case 'Binary':
        walk(e.left);
        walk(e.right);
        break;
      case 'Ternary':
        walk(e.cond);
        walk(e.then);
        walk(e.otherwise);
        break;
      case 'List':
        for (const item of e.items) walk(item);
        break;
      case 'Paren':
        walk(e.inner);
        break;
      default:
        break;
    }
  };
  walk(expr);
  return out;
}
