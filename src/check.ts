/**
 * Semantic validation.
 *
 * The parser accepts shapes; this pass decides whether those shapes mean anything. It resolves
 * every element to a built-in widget, a component, or a host constructor; checks arguments,
 * properties, events and bindings against the registry; checks that identifiers resolve; and
 * checks the structural rules that the parser deliberately does not enforce (state placement,
 * slot usage, single-child containers).
 *
 * It also returns an `Analysis` that the generators use, so the expensive work (resolution,
 * type inference) is done once.
 */

import {
  BOOL,
  DYNAMIC,
  DOUBLE,
  INT,
  STRING,
  type Action,
  type ComponentDecl,
  type ElementNode,
  type EventHandler,
  type Expr,
  type ForNode,
  type Node,
  type Param,
  type Program,
  type Prop,
  type ScreenDecl,
  type StateDecl,
  type StyleDecl,
  type UiType,
  isBoolType,
  isNumericType,
  isStringType,
  typeFromText,
  walkNodes,
} from './ast.ts';
import { DiagnosticBag } from './diagnostics.ts';
import { VALUE_PARAM_NAME, eventValueType } from './events.ts';
import { type SourceFile, type Span } from './source.ts';
import { didYouMean, listOf, suggest } from './suggest.ts';
import { BUILTIN_STYLES, DART_RESERVED_WORDS, FLUTTER_TYPE_NAMES, STYLE_PROPS } from './targets.ts';
import {
  GENERIC_EVENTS,
  UNIVERSAL_PROPS,
  WIDGET_TAGS,
  type ArgSpec,
  type PropSpec,
  type WidgetSpec,
  eventsFor,
  findProp,
  propsFor,
  widgetSpec,
} from './widgets/registry.ts';

/** Dart core types that people write in another language's capitalisation by mistake. */
const CASE_MISTAKES: Record<string, string> = {
  Int: 'int',
  Integer: 'int',
  Double: 'double',
  Float: 'double',
  Bool: 'bool',
  Boolean: 'bool',
  Num: 'num',
  Number: 'num',
  Dynamic: 'dynamic',
  Object: 'Object',
};

export type ResolvedTag =
  | { readonly kind: 'builtin'; readonly spec: WidgetSpec }
  | { readonly kind: 'component'; readonly decl: ComponentDecl; readonly external: boolean }
  | { readonly kind: 'host' };

export interface VarInfo {
  readonly name: string;
  readonly type: UiType;
  readonly kind: 'state' | 'param' | 'loop';
  readonly nameSpan: Span;
  used: boolean;
}

export interface Analysis {
  readonly bag: DiagnosticBag;
  readonly program: Program;
  readonly components: ReadonlyMap<string, ComponentDecl>;
  readonly screens: ReadonlyMap<string, ScreenDecl>;
  readonly styles: ReadonlyMap<string, StyleDecl>;
  readonly resolvedTags: ReadonlyMap<ElementNode, ResolvedTag>;
  /** state variable types, per screen/component name */
  readonly stateTypes: ReadonlyMap<string, ReadonlyMap<string, UiType>>;
  /** parameter types, per component name */
  readonly paramTypes: ReadonlyMap<string, ReadonlyMap<string, UiType>>;
  readonly componentHasSlot: ReadonlyMap<string, boolean>;
  /** Loop variable types, per `for` node (used by the generator for text conversion). */
  readonly loopTypes: ReadonlyMap<ForNode, ReadonlyMap<string, UiType>>;
}

export interface CheckOptions {
  /** Components declared in other `.pui` files that this file imports. */
  readonly externalComponents?: ReadonlyMap<string, ComponentDecl>;
  /** Which file each external component came from, for "declared here" notes. */
  readonly externalComponentFiles?: ReadonlyMap<string, SourceFile>;
  /** Roots that are imported host values, e.g. `appState` from `app_state.dart`. */
  readonly hostRoots?: ReadonlySet<string>;
  /** Names declared in other files of the project, to detect collisions. */
  readonly externalNames?: ReadonlyMap<string, string>;
}

interface Scope {
  readonly vars: Map<string, VarInfo>;
  readonly parent?: Scope;
}

interface DeclContext {
  readonly decl: ScreenDecl | ComponentDecl;
  readonly scope: Scope;
  /** Component that owns this body, when the body is a component body. */
  readonly component?: ComponentDecl;
  readonly hasSlotRef: { value: boolean };
}

/** Infer a type from a literal initialiser; anything else is dynamic. */
export function inferType(expr: Expr): UiType {
  switch (expr.kind) {
    case 'String':
      return STRING;
    case 'Number':
      return expr.raw.includes('.') ? DOUBLE : INT;
    case 'Bool':
      return BOOL;
    case 'List': {
      if (expr.items.length === 0) return { kind: 'list', element: DYNAMIC };
      const element = inferType(expr.items[0]!);
      return { kind: 'list', element };
    }
    case 'Color':
      return { kind: 'named', name: 'Color' };
    case 'Paren':
      return inferType(expr.inner);
    case 'Unary':
      return expr.op === '-' ? inferType(expr.operand) : DYNAMIC;
    case 'Binary':
      if (['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(expr.op)) return BOOL;
      if (['+', '-', '*', '/', '%'].includes(expr.op)) {
        const left = inferType(expr.left);
        const right = inferType(expr.right);
        if (isStringType(left) || isStringType(right)) return STRING;
        if (left.kind === 'double' || right.kind === 'double') return DOUBLE;
        if (left.kind === 'int' && right.kind === 'int') return INT;
      }
      return DYNAMIC;
    default:
      return DYNAMIC;
  }
}

class Checker {
  readonly file: SourceFile;
  readonly program: Program;
  readonly options: CheckOptions;
  readonly bag: DiagnosticBag;

  readonly components = new Map<string, ComponentDecl>();
  readonly screens = new Map<string, ScreenDecl>();
  readonly styles = new Map<string, StyleDecl>();
  readonly resolvedTags = new Map<ElementNode, ResolvedTag>();
  readonly stateTypes = new Map<string, Map<string, UiType>>();
  readonly paramTypes = new Map<string, Map<string, UiType>>();
  readonly componentHasSlot = new Map<string, boolean>();
  readonly loopTypes = new Map<ForNode, Map<string, UiType>>();

  constructor(file: SourceFile, program: Program, options: CheckOptions, bag: DiagnosticBag) {
    this.file = file;
    this.program = program;
    this.options = options;
    this.bag = bag;
  }

  // ------------------------------------------------------------------------------------------
  // Entry point
  // ------------------------------------------------------------------------------------------

  run(): Analysis {
    this.indexDeclarations();
    this.validateStyles();

    for (const decl of this.program.decls) {
      if (decl.kind === 'Screen') this.checkScreenOrComponent(decl);
      if (decl.kind === 'Component') this.checkScreenOrComponent(decl);
    }

    return {
      bag: this.bag,
      program: this.program,
      components: this.components,
      screens: this.screens,
      styles: this.styles,
      resolvedTags: this.resolvedTags,
      stateTypes: this.stateTypes,
      paramTypes: this.paramTypes,
      componentHasSlot: this.componentHasSlot,
      loopTypes: this.loopTypes,
    };
  }

  private error(code: string, message: string, span: Span, hint?: string): void {
    this.bag.error({ code, message, span, ...(hint === undefined ? {} : { hint }) });
  }

  private warning(code: string, message: string, span: Span, hint?: string): void {
    this.bag.warning({ code, message, span, ...(hint === undefined ? {} : { hint }) });
  }

  private info(code: string, message: string, span: Span, hint?: string): void {
    this.bag.info({ code, message, span, ...(hint === undefined ? {} : { hint }) });
  }

  // ------------------------------------------------------------------------------------------
  // Declarations
  // ------------------------------------------------------------------------------------------

  /**
   * Dart spells its core types in lower case, so `count: Int` would generate `Int count` and fail
   * to compile. Catching it here keeps the mistake in the .pui file instead of in the output.
   */
  private checkTypeSpelling(typeText: string, span: Span): void {
    const base = typeText.replace(/<.*$/s, '').trim();
    const suggestion = CASE_MISTAKES[base];
    if (suggestion !== undefined && suggestion !== base) {
      this.error('PUI2206', `"${base}" is not a Dart type`, span, `write "${suggestion}" instead`);
    }
  }

  private indexDeclarations(): void {
    for (const decl of this.program.decls) {
      if (decl.kind === 'Style') {
        const existing = this.styles.get(decl.name);
        if (existing !== undefined) {
          this.error('PUI2006', `duplicate style "${decl.name}"`, decl.nameSpan, 'rename one of them');
        } else {
          this.styles.set(decl.name, decl);
        }
        continue;
      }

      const duplicate =
        decl.kind === 'Screen' ? this.screens.has(decl.name) : this.components.has(decl.name);
      if (duplicate) {
        this.error('PUI2006', `duplicate ${decl.kind.toLowerCase()} "${decl.name}"`, decl.nameSpan, 'rename one of them');
      } else if (decl.kind === 'Screen') {
        this.screens.set(decl.name, decl);
      } else {
        this.components.set(decl.name, decl);
      }

      // Names become Dart class names in the generated file.
      if (!/^[A-Z]/.test(decl.name)) {
        this.error(
          'PUI2014',
          `${decl.kind.toLowerCase()} names must start with an uppercase letter`,
          decl.nameSpan,
          `rename it to ${decl.name.charAt(0).toUpperCase()}${decl.name.slice(1)}`,
        );
      }
      if (DART_RESERVED_WORDS.has(decl.name)) {
        this.error('PUI2012', `"${decl.name}" is a reserved word in Dart`, decl.nameSpan, 'choose a different name');
      } else if (FLUTTER_TYPE_NAMES.has(decl.name)) {
        this.error(
          'PUI2011',
          `"${decl.name}" would shadow the Flutter type of the same name`,
          decl.nameSpan,
          `rename it, for example ${decl.name}Screen`,
        );
      }
      if (WIDGET_TAGS.includes(decl.name.toLowerCase())) {
        this.error(
          'PUI2012',
          `"${decl.name}" is too close to the built-in element "${decl.name.toLowerCase()}"`,
          decl.nameSpan,
          'pick a name that cannot be confused with a built-in',
        );
      }
      const external = this.options.externalNames?.get(decl.name);
      if (external !== undefined && external !== this.file.path) {
        this.error('PUI3101', `"${decl.name}" is already declared in ${external}`, decl.nameSpan, 'rename one of them');
      }

      const stateMap = new Map<string, UiType>();
      for (const state of decl.state) {
        if (stateMap.has(state.name)) {
          this.error('PUI2003', `duplicate state "${state.name}"`, state.nameSpan, 'rename one of them');
          continue;
        }
        if (state.typeText !== undefined) this.checkTypeSpelling(state.typeText, state.typeSpan ?? state.nameSpan);
        const type = state.typeText === undefined ? inferType(state.init) : typeFromText(state.typeText);
        stateMap.set(state.name, type);
        if (DART_RESERVED_WORDS.has(state.name)) {
          this.error('PUI2012', `"${state.name}" is a reserved word in Dart`, state.nameSpan, 'choose a different name');
        }
        if (FLUTTER_TYPE_NAMES.has(state.name)) {
          this.error('PUI2011', `state "${state.name}" would shadow the Flutter type of the same name`, state.nameSpan, 'rename it');
        }
      }
      this.stateTypes.set(decl.name, stateMap);

      if (decl.kind === 'Component') {
        const params = new Map<string, UiType>();
        for (const param of decl.params) {
          if (params.has(param.name)) {
            this.error('PUI2003', `duplicate parameter "${param.name}"`, param.nameSpan, 'rename one of them');
            continue;
          }
          if (param.typeText !== undefined) this.checkTypeSpelling(param.typeText, param.typeSpan ?? param.nameSpan);
          params.set(param.name, param.typeText === undefined ? DYNAMIC : typeFromText(param.typeText));
        }
        this.paramTypes.set(decl.name, params);
        this.componentHasSlot.set(decl.name, componentUsesSlot(decl));
      }

      if (decl.body.length === 0) {
        this.error('PUI2010', `${decl.kind.toLowerCase()} "${decl.name}" renders nothing`, decl.span, 'add at least one element');
      }
    }

    for (const [name, decl] of this.options.externalComponents ?? []) {
      if (!this.componentHasSlot.has(name)) this.componentHasSlot.set(name, componentUsesSlot(decl));
    }
  }

  private validateStyles(): void {
    const known = new Set([...BUILTIN_STYLES, ...this.styles.keys()]);
    for (const style of this.styles.values()) {
      for (const prop of style.props) {
        if (!STYLE_PROPS.includes(prop.name)) {
          this.error(
            'PUI2301',
            `"${prop.name}" is not a text style property`,
            prop.nameSpan,
            didYouMean(prop.name, STYLE_PROPS) ?? `use one of: ${STYLE_PROPS.join(', ')}`,
          );
        }
      }
    }
    // Style references from any prop named `style`.
    walkNodes(
      this.program.decls.flatMap((decl) => (decl.kind === 'Style' ? [] : decl.body)),
      (node) => {
        if (node.kind !== 'Element') return;
        for (const prop of node.props) {
          if (prop.name !== 'style') continue;
          const value = literalName(prop.value);
          if (value === undefined) continue;
          if (!known.has(value)) {
            this.error(
              'PUI2302',
              `unknown style "${value}"`,
              prop.value.span,
              didYouMean(value, known) ?? `declare it with "style ${value}:" or use one of: ${BUILTIN_STYLES.join(', ')}`,
            );
          }
        }
      },
    );
  }

  // ------------------------------------------------------------------------------------------
  // Screens and components
  // ------------------------------------------------------------------------------------------

  private checkScreenOrComponent(decl: ScreenDecl | ComponentDecl): void {
    const scope: Scope = { vars: new Map() };
    for (const state of decl.state) {
      const type = this.stateTypes.get(decl.name)?.get(state.name) ?? DYNAMIC;
      const varInfo: VarInfo = { name: state.name, type, kind: 'state', nameSpan: state.nameSpan, used: false };
      scope.vars.set(state.name, varInfo);
    }
    for (const param of decl.kind === 'Component' ? decl.params : []) {
      const type = this.paramTypes.get(decl.name)?.get(param.name) ?? DYNAMIC;
      scope.vars.set(param.name, { name: param.name, type, kind: 'param', nameSpan: param.nameSpan, used: false });
    }

    const ctx: DeclContext = {
      decl,
      scope,
      ...(decl.kind === 'Component' ? { component: decl } : {}),
      hasSlotRef: { value: false },
    };

    this.checkBody(decl.body, scope, ctx);

    // A component that renders `slot` necessarily uses its `children` parameter.
    if (decl.kind === 'Component' && ctx.hasSlotRef.value) {
      const childrenParam = scope.vars.get('children');
      if (childrenParam !== undefined) childrenParam.used = true;
    }

    // Unused declarations.
    for (const varInfo of scope.vars.values()) {
      if (varInfo.used) continue;
      if (varInfo.kind === 'state') {
        this.warning('PUI2404', `state "${varInfo.name}" is never used`, varInfo.nameSpan, 'remove it, or use it');
      } else if (varInfo.kind === 'param') {
        this.warning('PUI2405', `parameter "${varInfo.name}" is never used`, varInfo.nameSpan, 'remove it, or use it');
      }
    }

    if (decl.kind === 'Component') {
      if (ctx.hasSlotRef.value && !decl.params.some((p) => p.name === 'children')) {
        // Reported at the slot itself in checkBody; nothing more to do here.
      }
    }
  }

  private checkBody(nodes: readonly Node[], scope: Scope, ctx: DeclContext): void {
    for (const node of nodes) {
      switch (node.kind) {
        case 'State':
          this.error(
            'PUI2002',
            'state may only be declared at the top level of a screen or component',
            node.span,
            'move it up, or turn it into a component parameter',
          );
          break;
        case 'Event':
          this.error('PUI1026', `"on ${node.name}" must be written directly inside an element`, node.span, 'move it into the block of the element it belongs to');
          break;
        case 'Slot':
          this.checkSlot(node.span, ctx);
          break;
        case 'Element':
          this.checkElement(node, scope, ctx);
          break;
        case 'If':
          for (const branch of node.branches) {
            this.checkExpr(branch.cond, scope, 'value', false);
            this.checkBody(branch.body, scope, ctx);
          }
          if (node.elseBody !== undefined) this.checkBody(node.elseBody, scope, ctx);
          break;
        case 'For': {
          this.checkExpr(node.iterable, scope, 'value', false);
          const iterableType = this.typeOfExpression(node.iterable, scope);
          const elementType =
            iterableType.kind === 'list' ? iterableType.element : iterableType.kind === 'map' ? DYNAMIC : DYNAMIC;
          if (
            iterableType.kind === 'string' ||
            isNumericType(iterableType) ||
            isBoolType(iterableType)
          ) {
            this.error(
              'PUI2402',
              `cannot loop over a ${iterableType.kind === 'string' ? 'String' : typeName(iterableType)}`,
              node.iterable.span,
              'iterate over a List, or a value the compiler cannot prove is not iterable',
            );
          }
          const loopScope: Scope = { vars: new Map(), parent: scope };
          const types = new Map<string, UiType>();
          if (node.indexName !== undefined) {
            loopScope.vars.set(node.indexName, {
              name: node.indexName,
              type: INT,
              kind: 'loop',
              nameSpan: node.indexSpan ?? node.itemSpan,
              used: false,
            });
            types.set(node.indexName, INT);
          }
          loopScope.vars.set(node.itemName, {
            name: node.itemName,
            type: elementType,
            kind: 'loop',
            nameSpan: node.itemSpan,
            used: false,
          });
          types.set(node.itemName, elementType);
          this.loopTypes.set(node, types);
          this.checkBody(node.body, loopScope, ctx);
          break;
        }
      }
    }
  }

  private checkSlot(span: Span, ctx: DeclContext): void {
    if (ctx.component === undefined) {
      this.error('PUI2205', '"slot" is only allowed inside a component', span, 'remove it from the screen');
      return;
    }
    ctx.hasSlotRef.value = true;
    if (!ctx.component.params.some((p) => p.name === 'children')) {
      const hint =
        ctx.component.params.length === 0
          ? 'add a parameter: component Name(children: List<Widget>):'
          : `add "children: List<Widget>" to the parameter list of ${ctx.component.name}`;
      this.error('PUI2204', `component "${ctx.component.name}" uses "slot" but has no "children" parameter`, span, hint);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Elements
  // ------------------------------------------------------------------------------------------

  private checkElement(el: ElementNode, scope: Scope, ctx: DeclContext): void {
    const resolved = this.resolveTag(el);
    this.resolvedTags.set(el, resolved);

    for (const prop of el.props) this.checkPropValue(prop, resolved, scope, false);

    switch (resolved.kind) {
      case 'builtin':
        this.checkBuiltinArgs(el, resolved.spec, scope);
        this.checkChildrenPolicy(el, resolved.spec.children.length === 0 ? 'none' : resolved.spec.children);
        this.checkEvents(el, eventsFor(resolved.spec), scope, resolved.spec, false);
        this.checkBinding(el, resolved.spec, scope);
        break;
      case 'component':
        this.checkComponentCall(el, resolved.decl, scope, resolved.external);
        this.checkEvents(el, GENERIC_EVENTS, scope, undefined, true);
        break;
      case 'host':
        this.info(
          'PUI2406',
          `"${el.tag}" is not a component in this file, so it is emitted as a Dart constructor call`,
          el.tagSpan,
          'make sure the constructor is imported and its arguments exist in Dart',
        );
        for (const arg of el.args) this.checkExpr(arg.value, scope, 'value', false);
        this.checkEvents(el, GENERIC_EVENTS, scope, undefined, true);
        break;
    }

    // Children: any element may contain control flow and nested elements.
    const childScope = scope;
    for (const child of el.children) {
      if (child.kind === 'State') {
        this.error('PUI2002', 'state may only be declared at the top level of a screen or component', child.span);
        continue;
      }
      if (child.kind === 'Event') {
        this.error('PUI1026', `"on ${child.name}" must be written directly inside an element`, child.span);
        continue;
      }
      if (child.kind === 'Slot') {
        this.checkSlot(child.span, ctx);
        continue;
      }
      if (child.kind === 'Element') this.checkElement(child, childScope, ctx);
      else if (child.kind === 'If') {
        for (const branch of child.branches) {
          this.checkExpr(branch.cond, childScope, 'value', false);
          this.checkBody(branch.body, childScope, ctx);
        }
        if (child.elseBody !== undefined) this.checkBody(child.elseBody, childScope, ctx);
      } else if (child.kind === 'For') {
        this.checkBody([child], childScope, ctx);
      }
    }
  }

  private resolveTag(el: ElementNode): ResolvedTag {
    if (!el.callStyle) {
      const spec = widgetSpec(el.tag);
      if (spec !== undefined) return { kind: 'builtin', spec };
      const suggestion = didYouMean(el.tag, WIDGET_TAGS);
      const componentMatch = [...this.components.keys()].find((name) => name.toLowerCase() === el.tag.toLowerCase());
      this.error(
        'PUI2001',
        `unknown element "${el.tag}"`,
        el.tagSpan,
        componentMatch !== undefined
          ? `components are called with an uppercase name: ${componentMatch}(...)`
          : suggestion ?? 'built-in elements are lowercase; host widgets and components are uppercase',
      );
      return { kind: 'host' };
    }

    const local = this.components.get(el.tag);
    if (local !== undefined) return { kind: 'component', decl: local, external: false };
    const external = this.options.externalComponents?.get(el.tag);
    if (external !== undefined) return { kind: 'component', decl: external, external: true };

    const screen = this.screens.get(el.tag);
    if (screen !== undefined) {
      this.warning('PUI2407', `"${el.tag}" is a screen, not a component`, el.tagSpan, 'use a component for a reusable piece of UI');
    }
    return { kind: 'host' };
  }

  private checkChildrenPolicy(el: ElementNode, policy: 'multi' | 'single' | 'none'): void {
    if (policy === 'none' && el.children.length > 0) {
      this.error(
        'PUI2004',
        `"${el.tag}" cannot have children`,
        el.children[0]!.span,
        `"${el.tag}" renders from its arguments; remove the nested block`,
      );
    }
    if (policy === 'single' && el.children.length > 1) {
      this.warning(
        'PUI2403',
        `"${el.tag}" takes a single child but ${el.children.length} were given`,
        el.children[1]!.span,
        'wrap them in a column so the layout is explicit',
      );
    }
  }

  // ------------------------------------------------------------------------------------------
  // Arguments, properties, events, bindings
  // ------------------------------------------------------------------------------------------

  private checkBuiltinArgs(el: ElementNode, spec: WidgetSpec, scope: Scope): void {
    const provided = new Set<string>();
    let positionalIndex = 0;

    for (const arg of el.args) {
      const spec_ = arg.name === undefined ? spec.args[positionalIndex] : spec.args.find((a) => a.name === arg.name);
      if (arg.name === undefined) positionalIndex += 1;

      if (spec_ === undefined) {
        if (arg.name !== undefined) {
          this.error(
            'PUI2108',
            `"${el.tag}" has no argument "${arg.name}"`,
            arg.span,
            didYouMean(arg.name, spec.args.map((a) => a.name)) ?? acceptedArgs(spec),
          );
        } else if (spec.args.length === 0) {
          this.error('PUI2109', `"${el.tag}" takes no arguments`, arg.span, acceptedArgs(spec));
        } else {
          this.error('PUI2109', `too many arguments for "${el.tag}"`, arg.span, acceptedArgs(spec));
        }
        this.checkExpr(arg.value, scope, 'value', false);
        continue;
      }

      if (provided.has(spec_.name)) {
        this.error('PUI2003', `argument "${spec_.name}" was supplied twice`, arg.span, 'remove one of them');
      }
      provided.add(spec_.name);
      this.checkValueShape(spec_, arg.value);
      const namesSomething = spec_.kind === 'enum' || spec_.kind === 'iconName' || spec_.kind === 'styleName';
      if (!namesSomething) this.checkExpr(arg.value, scope, 'value', false);
    }

    for (const argSpec of spec.args) {
      if (argSpec.required === true && !provided.has(argSpec.name)) {
        this.error(
          'PUI2107',
          `"${el.tag}" needs ${argSpec.name === 'content' ? 'content' : `"${argSpec.name}"`}`,
          el.tagSpan,
          `for example: ${spec.example.split('\n')[0]}`,
        );
      }
    }
  }

  private checkComponentCall(el: ElementNode, decl: ComponentDecl, scope: Scope, external: boolean): void {
    const paramNames = decl.params.map((p) => p.name);
    const provided = new Set<string>();
    let positionalIndex = 0;

    for (const arg of el.args) {
      let param: Param | undefined;
      if (arg.name !== undefined) {
        param = decl.params.find((p) => p.name === arg.name);
        if (param === undefined) {
          this.error(
            'PUI2108',
            `component "${decl.name}" has no parameter "${arg.name}"`,
            arg.span,
            didYouMean(arg.name, paramNames) ?? `accepted parameters: ${listOf(paramNames)}`,
          );
          this.checkExpr(arg.value, scope, 'value', false);
          continue;
        }
      } else {
        param = decl.params[positionalIndex];
        positionalIndex += 1;
        if (param === undefined) {
          this.error('PUI2109', `too many arguments for "${decl.name}"`, arg.span, `accepted parameters: ${listOf(paramNames)}`);
          this.checkExpr(arg.value, scope, 'value', false);
          continue;
        }
      }

      if (provided.has(param.name)) {
        this.error('PUI2108', `argument "${param.name}" was supplied twice`, arg.span);
      }
      provided.add(param.name);
      this.checkParamType(param, arg.value);
      this.checkExpr(arg.value, scope, 'value', false);
    }

    if (!external) {
      const missing = decl.params.filter((p) => p.defaultValue === undefined && p.name !== 'children' && !provided.has(p.name));
      for (const param of missing) {
        this.error(
          'PUI2201',
          `component "${decl.name}" needs parameter "${param.name}"`,
          el.tagSpan,
          `${decl.name}(${decl.params.map((p) => p.name).join(', ')})`,
        );
      }
    }

    if (el.children.length > 0 && this.componentHasSlot.get(decl.name) !== true) {
      this.error(
        'PUI2203',
        `component "${decl.name}" has no slot for children`,
        el.children[0]!.span,
        `add a "slot" to ${decl.name}, or remove the nested block`,
      );
    }
  }

  private checkParamType(param: Param, value: Expr): void {
    if (param.typeText === undefined) return;
    const expected = typeFromText(param.typeText);
    const actual = inferType(value);
    if (actual.kind === 'dynamic') return;
    if (isStringType(expected) && !isStringType(actual)) {
      this.error('PUI2110', `"${param.name}" expects a String`, value.span, `got ${typeName(actual)}`);
    } else if (isBoolType(expected) && !isBoolType(actual)) {
      this.error('PUI2110', `"${param.name}" expects a bool`, value.span, `got ${typeName(actual)}`);
    } else if (isNumericType(expected) && !isNumericType(actual)) {
      this.error('PUI2110', `"${param.name}" expects a number`, value.span, `got ${typeName(actual)}`);
    }
  }

  private checkPropValue(prop: Prop, resolved: ResolvedTag, scope: Scope, inEvent: boolean): void {
    void inEvent;
    if (resolved.kind === 'builtin') {
      const spec = findProp(resolved.spec, prop.name);
      if (spec === undefined) {
        this.error(
          'PUI2102',
          `"${prop.name}" is not a property of "${resolved.spec.tag}"`,
          prop.nameSpan,
          didYouMean(prop.name, propsFor(resolved.spec).map((p) => p.name)) ??
            `accepted properties: ${listOf(propsFor(resolved.spec).map((p) => p.name), 10)}`,
        );
      } else {
        this.checkValueShape(spec, prop.value, prop.name);
        // `style=heading`, enum values and `bind=email` name things, they do not reference them.
        const namesSomething = spec.kind === 'enum' || spec.kind === 'styleName' || prop.name === 'bind';
        if (namesSomething) return;
      }
    } else if (resolved.kind === 'component') {
      // Components accept the universal layout properties (they wrap the call), everything else
      // must be passed as an argument so it lands in a real parameter.
      const universal = UNIVERSAL_PROPS.find((p) => p.name === prop.name);
      if (universal !== undefined) {
        this.checkValueShape(universal, prop.value, prop.name);
      } else {
        this.error(
          'PUI2102',
          `"${prop.name}" cannot be passed as a property; pass it as an argument`,
          prop.nameSpan,
          `${resolved.decl.name}(${resolved.decl.params.map((p) => p.name).join(', ')})  ·  universal layout properties such as padding and expand work everywhere`,
        );
      }
    }
    this.checkExpr(prop.value, scope, 'value', false);
  }

  /** Structural checks on a property/argument value, driven by the registry's kind. */
  private checkValueShape(spec: PropSpec | ArgSpec, value: Expr, label?: string): void {
    const name = label ?? spec.name;
    switch (spec.kind) {
      case 'number': {
        if (value.kind === 'String' || value.kind === 'Bool' || value.kind === 'List' || value.kind === 'Color') {
          this.error('PUI2110', `"${name}" expects a number`, value.span, `got ${exprKindName(value)}`);
        }
        break;
      }
      case 'string': {
        if (value.kind === 'Number' || value.kind === 'Bool' || value.kind === 'List' || value.kind === 'Color') {
          this.error('PUI2110', `"${name}" expects a string`, value.span, `got ${exprKindName(value)} — wrap it in quotes`);
        }
        break;
      }
      case 'bool': {
        if (value.kind === 'String' || value.kind === 'Number' || value.kind === 'List' || value.kind === 'Color') {
          this.error('PUI2110', `"${name}" expects true or false`, value.span, `got ${exprKindName(value)}`);
        }
        break;
      }
      case 'color': {
        if (value.kind === 'String' || value.kind === 'Number' || value.kind === 'Bool' || value.kind === 'List') {
          this.error('PUI2110', `"${name}" expects a colour`, value.span, 'write it as #RRGGBB or use a colour value');
        }
        break;
      }
      case 'edge': {
        if (value.kind === 'List') {
          if (value.items.length !== 2 && value.items.length !== 4) {
            this.error(
              'PUI2110',
              `"${name}" takes 1, 2 or 4 values`,
              value.span,
              'use 24, [vertical, horizontal], or [top, right, bottom, left]',
            );
          } else if (!value.items.every(isNumericLiteral)) {
            this.error('PUI2110', `"${name}" values must be numbers`, value.span);
          }
        } else if (!isNumericLiteral(value)) {
          this.error('PUI2110', `"${name}" expects a number`, value.span, 'for example padding=16');
        }
        break;
      }
      case 'size': {
        if (value.kind === 'List' && value.items.length !== 2) {
          this.error('PUI2110', `"${name}" takes a number or [width, height]`, value.span);
        }
        break;
      }
      case 'enum': {
        const values = 'values' in spec && spec.values !== undefined ? spec.values : [];
        const literal = literalName(value);
        if (literal === undefined) {
          this.error('PUI2110', `"${name}" expects one of: ${values.join(', ')}`, value.span, 'enum properties must be written as a bare name');
          break;
        }
        if (!values.includes(literal)) {
          const match = suggest(literal, values, { caseSensitive: false });
          this.error(
            'PUI2111',
            `"${literal}" is not a valid value for "${name}"`,
            value.span,
            match !== undefined ? `did you mean \`${match}\`?` : `accepted values: ${values.join(', ')}`,
          );
        }
        break;
      }
      case 'styleName':
      case 'iconName':
      case 'expr':
        break;
    }
  }

  private checkEvents(
    el: ElementNode,
    allowed: readonly string[],
    scope: Scope,
    spec: WidgetSpec | undefined,
    allowGenericOnly: boolean,
  ): void {
    const seen = new Set<string>();
    for (const event of el.events) {
      if (seen.has(event.name)) {
        this.error('PUI2103', `"${event.name}" is handled twice on this element`, event.nameSpan, 'merge the two bodies into one handler');
      }
      seen.add(event.name);

      if (!allowed.includes(event.name)) {
        const hint = didYouMean(event.name, allowed) ?? `accepted events: ${listOf(allowed, 10)}`;
        this.error(
          'PUI2101',
          `"${el.tag}" has no "${event.name}" event`,
          event.nameSpan,
          allowGenericOnly ? `${hint} (host widgets only support the gesture events)` : hint,
        );
      }
      const valueType = spec === undefined ? undefined : eventValueType(spec.tag, event.name);
      const actionScope: Scope =
        valueType === undefined
          ? scope
          : {
              vars: new Map([
                [
                  VALUE_PARAM_NAME,
                  { name: VALUE_PARAM_NAME, type: valueType, kind: 'loop' as const, nameSpan: event.nameSpan, used: false },
                ],
              ]),
              parent: scope,
            };
      this.checkActions(event.actions, actionScope);
    }
    void spec;
  }

  private checkBinding(el: ElementNode, spec: WidgetSpec, scope: Scope): void {
    const bind = el.props.find((p) => p.name === 'bind');
    if (bind === undefined) return;

    if (el.events.some((e) => e.name === 'change')) {
      this.error(
        'PUI2106',
        'this element is bound and also has an "on change" handler',
        bind.nameSpan,
        'keep bind=<state> and remove the handler, or drop bind and set the state in the handler',
      );
    }

    if (bind.value.kind !== 'Ident') {
      this.error('PUI2110', 'bind expects the name of a state variable', bind.value.span, 'for example: bind=email');
      return;
    }
    const varInfo = this.resolve(bind.value.name, scope);
    if (varInfo === undefined) {
      this.error(
        'PUI2104',
        `unknown state variable "${bind.value.name}"`,
        bind.value.span,
        didYouMean(bind.value.name, this.visibleNames(scope)) ?? 'declare it with "state <name>: <Type> = <value>"',
      );
      return;
    }
    varInfo.used = true;
    if (varInfo.kind !== 'state') {
      this.error('PUI2105', `"${bind.value.name}" is a ${varInfo.kind === 'param' ? 'component parameter' : 'loop variable'}, not state`, bind.value.span, 'bind requires a state variable');
      return;
    }

    const expected = el.tag === 'input' ? STRING : el.tag === 'slider' ? { kind: 'num' as const } : BOOL;
    if (el.tag === 'input' && !isStringType(varInfo.type)) {
      this.error('PUI2110', `input binds to a ${typeName(varInfo.type)}`, bind.value.span, 'text fields bind to String state');
    } else if (el.tag !== 'input' && el.tag !== 'slider' && !isBoolType(varInfo.type)) {
      this.error('PUI2110', `${el.tag} binds to a ${typeName(varInfo.type)}`, bind.value.span, 'use a bool state variable');
    } else if (el.tag === 'slider' && !isNumericType(varInfo.type)) {
      this.error('PUI2110', `slider binds to a ${typeName(varInfo.type)}`, bind.value.span, 'use a num state variable');
    }
    void expected;
  }

  // ------------------------------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------------------------------

  private checkActions(actions: readonly Action[], scope: Scope): void {
    for (const action of actions) {
      switch (action.kind) {
        case 'Set': {
          if (action.target.kind !== 'Ident') {
            this.error('PUI2104', 'set can only assign to a state variable', action.target.span, 'for example: set count = count + 1');
            this.checkExpr(action.value, scope, 'value', true);
            break;
          }
          const varInfo = this.resolve(action.target.name, scope);
          if (varInfo === undefined) {
            this.error(
              'PUI2104',
              `unknown state variable "${action.target.name}"`,
              action.target.span,
              didYouMean(action.target.name, this.visibleNames(scope)) ?? 'declare it with "state <name>: <Type> = <value>"',
            );
          } else if (varInfo.kind === 'param') {
            this.error(
              'PUI2105',
              `"${action.target.name}" is a component parameter and cannot be assigned`,
              action.target.span,
              'copy it into state first: state local: <Type> = ' + action.target.name,
            );
          } else if (varInfo.kind === 'loop') {
            this.error('PUI2105', `"${action.target.name}" is a loop variable and cannot be assigned`, action.target.span, 'assign to state instead');
          } else {
            varInfo.used = true;
          }
          this.checkExpr(action.value, scope, 'value', true);
          break;
        }
        case 'Call':
          if (!isCallExpression(action.expr)) {
            this.error('PUI2113', 'this statement is not a call and does nothing', action.expr.span, 'call a host function instead, for example save()');
          }
          this.checkExpr(action.expr, scope, 'value', true);
          break;
        case 'ActionIf':
          for (const branch of action.branches) {
            this.checkExpr(branch.cond, scope, 'value', true);
            this.checkActions(branch.body, scope);
          }
          if (action.elseBody !== undefined) this.checkActions(action.elseBody, scope);
          break;
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Expressions and scope
  // ------------------------------------------------------------------------------------------

  private resolve(name: string, scope: Scope): VarInfo | undefined {
    let current: Scope | undefined = scope;
    while (current !== undefined) {
      const found = current.vars.get(name);
      if (found !== undefined) return found;
      current = current.parent;
    }
    return undefined;
  }

  private visibleNames(scope: Scope): string[] {
    const names: string[] = [];
    let current: Scope | undefined = scope;
    while (current !== undefined) {
      names.push(...current.vars.keys());
      current = current.parent;
    }
    return names;
  }

  /**
   * `position` is what the identifier is doing: a *call target* may be a host function
   * (`signIn(...)`), which is the seam where application logic stays in Dart. A *value* must
   * resolve to something the compiler knows about.
   */
  private checkExpr(expr: Expr, scope: Scope, position: 'value' | 'callee', allowAwait: boolean): void {
    switch (expr.kind) {
      case 'Ident': {
        const varInfo = this.resolve(expr.name, scope);
        if (varInfo !== undefined) {
          varInfo.used = true;
          return;
        }
        if (position === 'callee') return;
        if (isHostReference(expr.name, this.options.hostRoots)) return;
        this.error(
          'PUI2005',
          `unknown identifier "${expr.name}"`,
          expr.span,
          didYouMean(expr.name, this.visibleNames(scope)) ??
            'declare it with "state", pass it as a parameter, or call a host function',
        );
        return;
      }
      case 'Member':
        this.checkExpr(expr.object, scope, position, allowAwait);
        return;
      case 'Call':
        this.checkExpr(expr.callee, scope, 'callee', allowAwait);
        for (const arg of expr.args) this.checkExpr(arg.value, scope, 'value', allowAwait);
        return;
      case 'Index':
        this.checkExpr(expr.object, scope, 'value', allowAwait);
        this.checkExpr(expr.index, scope, 'value', allowAwait);
        return;
      case 'Unary':
        if (expr.op === 'await' && !allowAwait) {
          this.error(
            'PUI2112',
            '"await" is only allowed inside an event handler',
            expr.span,
            'a widget tree is built synchronously; move the async work into an event handler',
          );
        }
        this.checkExpr(expr.operand, scope, 'value', allowAwait);
        return;
      case 'Binary':
        this.checkExpr(expr.left, scope, 'value', allowAwait);
        this.checkExpr(expr.right, scope, 'value', allowAwait);
        return;
      case 'Ternary':
        this.checkExpr(expr.cond, scope, 'value', allowAwait);
        this.checkExpr(expr.then, scope, 'value', allowAwait);
        this.checkExpr(expr.otherwise, scope, 'value', allowAwait);
        return;
      case 'List':
        for (const item of expr.items) this.checkExpr(item, scope, 'value', allowAwait);
        return;
      case 'Paren':
        this.checkExpr(expr.inner, scope, 'value', allowAwait);
        return;
      case 'String':
        for (const interpolation of expr.interpolations) this.checkInterpolation(interpolation.text, interpolation.span, scope);
        return;
      default:
        return;
    }
  }

  /** Identifier checking inside `${...}` without re-parsing the whole fragment. */
  private checkInterpolation(text: string, span: Span, scope: Scope): void {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\S?)/.exec(text);
    if (match === null) return;
    const root = match[1]!;
    const next = match[2] ?? '';
    if (next === '(') return; // a call: assumed to be a host function
    const varInfo = this.resolve(root, scope);
    if (varInfo !== undefined) {
      varInfo.used = true;
      return;
    }
    if (isHostReference(root, this.options.hostRoots)) return;
    this.error('PUI2005', `unknown identifier "${root}" in string interpolation`, span, 'declare it with "state", or pass it as a parameter');
  }

  private typeOfExpression(expr: Expr, scope: Scope): UiType {
    if (expr.kind === 'Ident') {
      const varInfo = this.resolve(expr.name, scope);
      if (varInfo !== undefined) return varInfo.type;
    }
    return inferType(expr);
  }
}

// --------------------------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------------------------

/** `foo()`, `await foo()`, `(foo())` all count as calls for "this statement does nothing". */
function isCallExpression(expr: Expr): boolean {
  if (expr.kind === 'Call') return true;
  if (expr.kind === 'Paren') return isCallExpression(expr.inner);
  if (expr.kind === 'Unary' && expr.op === 'await') return isCallExpression(expr.operand);
  return false;
}

function componentUsesSlot(decl: ComponentDecl): boolean {
  let found = false;
  walkNodes(decl.body, (node) => {
    if (node.kind === 'Slot') found = true;
  });
  return found;
}

/** A property value written as a bare name or a string, e.g. `center` or `"center"`. */
function literalName(expr: Expr): string | undefined {
  if (expr.kind === 'Ident') return expr.name;
  if (expr.kind === 'String') return expr.value;
  return undefined;
}

function isNumericLiteral(expr: Expr): boolean {
  if (expr.kind === 'Number') return true;
  if (expr.kind === 'Unary' && expr.op === '-' && expr.operand.kind === 'Number') return true;
  return false;
}

/**
 * Uppercase-initial names, imported roots and `context` are references to the host program;
 * lowercase unknown names are almost certainly typos and are reported.
 */
function isHostReference(name: string, hostRoots: ReadonlySet<string> | undefined): boolean {
  if (name === 'context' || name === 'this') return true;
  if (/^[A-Z]/.test(name)) return true;
  return hostRoots?.has(name) === true;
}

function exprKindName(expr: Expr): string {
  switch (expr.kind) {
    case 'String':
      return 'a string';
    case 'Number':
      return 'a number';
    case 'Bool':
      return 'a bool';
    case 'List':
      return 'a list';
    case 'Color':
      return 'a colour';
    default:
      return 'an expression';
  }
}

function typeName(type: UiType): string {
  switch (type.kind) {
    case 'string':
      return 'String';
    case 'int':
      return 'int';
    case 'double':
      return 'double';
    case 'num':
      return 'num';
    case 'bool':
      return 'bool';
    case 'list':
      return `List<${typeName(type.element)}>`;
    case 'map':
      return 'Map';
    case 'named':
      return type.name;
    case 'nullable':
      return `${typeName(type.inner)}?`;
    case 'dynamic':
      return 'dynamic';
  }
}

function acceptedArgs(spec: WidgetSpec): string {
  if (spec.args.length === 0) return 'this element takes no arguments';
  return `accepted arguments: ${spec.args.map((a) => a.name).join(', ')}`;
}

export interface CheckResult {
  readonly analysis: Analysis;
  readonly bag: DiagnosticBag;
}

/** Validate one parsed program and return the analysis generators need. */
export function check(file: SourceFile, program: Program, options: CheckOptions = {}): CheckResult {
  const bag = new DiagnosticBag(file);
  const checker = new Checker(file, program, options, bag);
  const analysis = checker.run();
  return { analysis, bag };
}

export { isStringType, isBoolType, isNumericType };
