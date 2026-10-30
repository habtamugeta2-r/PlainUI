/**
 * Recursive-descent parser for PlainUI.
 *
 * Input: a token stream with `indent`/`dedent`/`newline` markers (see lexer.ts).
 * Output: the framework-neutral AST (see ast.ts) plus diagnostics.
 *
 * The parser is deliberately *permissive about placement* and strict about *shape*: it will
 * happily build a `State` node inside a nested block or an `on tap` handler that is not inside
 * an element, and let the validator report those as semantic errors with better messages. What
 * it will not do is guess about indentation or accept ambiguous syntax.
 */

import type {
  Action,
  ActionBranch,
  ActionIf,
  Arg,
  CallAction,
  CallArg,
  ComponentDecl,
  Decl,
  ElementNode,
  EventHandler,
  Expr,
  ForNode,
  IfBranch,
  IfNode,
  ImportDecl,
  Interpolation,
  Node,
  Param,
  Program,
  Prop,
  ScreenDecl,
  SetAction,
  StateDecl,
  StyleDecl,
} from './ast.ts';
import { DiagnosticBag } from './diagnostics.ts';
import { type Token, tokenize } from './lexer.ts';
import { booleanPropNames } from './widgets/registry.ts';
import { type SourceFile, type Span, span, textOf } from './source.ts';

export interface ParseResult {
  readonly program: Program;
  readonly bag: DiagnosticBag;
}

const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
};

const RIGHT_ASSOCIATIVE = new Set(['??']);

const UNSUPPORTED_EXPR_OPS = new Set(['...', '..', '=>']);

class Parser {
  readonly file: SourceFile;
  readonly bag: DiagnosticBag;
  private readonly tokens: readonly Token[];
  private pos = 0;

  constructor(file: SourceFile, tokens: readonly Token[], bag: DiagnosticBag) {
    this.file = file;
    this.tokens = tokens;
    this.bag = bag;
  }

  // ------------------------------------------------------------------------------------------
  // Token helpers
  // ------------------------------------------------------------------------------------------

  private peek(offset = 0): Token {
    const index = Math.min(this.pos + offset, this.tokens.length - 1);
    return this.tokens[index]!;
  }

  private at(kind: Token['kind'], value?: string): boolean {
    const token = this.peek();
    return token.kind === kind && (value === undefined || token.value === value);
  }

  private atKeyword(keyword: string): boolean {
    return this.at('keyword', keyword);
  }

  private atOp(value: string): boolean {
    return this.at('op', value);
  }

  private advance(): Token {
    const token = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos += 1;
    return token;
  }

  private atEnd(): boolean {
    return this.at('eof');
  }

  private skipNewlines(): void {
    while (this.at('newline')) this.advance();
  }

  /** Skip everything up to and including the next newline (error recovery). */
  private skipLine(): void {
    while (!this.at('newline') && !this.atEnd() && !this.at('dedent')) this.advance();
    if (this.at('newline')) this.advance();
  }

  private error(code: string, message: string, at: Span, hint?: string): void {
    this.bag.error({ code, message, span: at, ...(hint === undefined ? {} : { hint }) });
  }

  private expectOp(value: string, context: string): boolean {
    if (this.atOp(value)) {
      this.advance();
      return true;
    }
    const token = this.peek();
    this.error('PUI1007', `expected "${value}" ${context}`, token.span, `found ${describeToken(token)}`);
    return false;
  }

  private expectNewline(context: string): void {
    if (this.at('newline')) {
      this.advance();
      return;
    }
    if (this.at('dedent') || this.atEnd()) return;
    const token = this.peek();
    this.error('PUI1006', `unexpected ${describeToken(token)} ${context}`, token.span, 'one statement per line');
    this.skipLine();
  }

  private expectIdent(context: string): Token {
    if (this.at('ident')) return this.advance();
    const token = this.peek();
    this.error('PUI1007', `expected a name ${context}`, token.span, `found ${describeToken(token)}`);
    if (!this.at('newline') && !this.atEnd()) this.advance();
    return token;
  }

  // ------------------------------------------------------------------------------------------
  // Program
  // ------------------------------------------------------------------------------------------

  parseProgram(): Program {
    const start = this.peek().span.start;
    const imports: ImportDecl[] = [];
    const decls: Decl[] = [];
    let sawDecl = false;

    this.skipNewlines();
    while (!this.atEnd()) {
      const before = this.pos;
      // Structural leftovers from error recovery inside a block: skip silently rather than
      // reporting a second, confusing error.
      if (this.at('dedent') || this.at('indent')) {
        this.advance();
        continue;
      }
      if (this.atKeyword('import')) {
        const decl = this.parseImport();
        if (sawDecl) {
          this.error('PUI1015', 'imports must appear before any declaration', decl.span, 'move this line to the top of the file');
        }
        imports.push(decl);
        this.skipNewlines();
        continue;
      }

      if (this.atKeyword('screen')) {
        sawDecl = true;
        decls.push(this.parseScreen());
      } else if (this.atKeyword('component')) {
        sawDecl = true;
        decls.push(this.parseComponent());
      } else if (this.at('ident') && this.peek().value === 'style') {
        sawDecl = true;
        decls.push(this.parseStyle());
      } else {
        const token = this.peek();
        this.error(
          'PUI1015',
          `unexpected ${describeToken(token)} at the top level`,
          token.span,
          'only import, screen, component and style may appear here',
        );
        this.skipLine();
      }
      if (this.pos === before) this.advance();
      this.skipNewlines();
    }

    return { kind: 'Program', span: span(start, this.peek().span.end), path: this.file.path, imports, decls };
  }

  private parseImport(): ImportDecl {
    const keyword = this.advance();
    if (!this.at('string')) {
      const token = this.peek();
      this.error('PUI1007', 'expected a quoted path after "import"', token.span, 'for example: import "package:my_app/app_logo.dart"');
      this.skipLine();
      return { kind: 'Import', span: span(keyword.span.start, token.span.end), path: '', pathSpan: token.span };
    }
    const pathToken = this.advance();
    const pathSpan = span(pathToken.span.start + 1, pathToken.span.end - 1);
    const path = this.file.text.slice(pathSpan.start, pathSpan.end);
    this.expectNewline('after import path');
    return { kind: 'Import', span: span(keyword.span.start, pathToken.span.end), path, pathSpan };
  }

  // ------------------------------------------------------------------------------------------
  // Declarations
  // ------------------------------------------------------------------------------------------

  private parseScreen(): ScreenDecl {
    const keyword = this.advance();
    const nameToken = this.expectIdent('for the screen');
    this.expectOp(':', 'to open the screen body');
    const body = this.parseNodeBody();
    const { state, rest } = splitState(body);
    return {
      kind: 'Screen',
      span: span(keyword.span.start, endOfBody(body, nameToken.span.end)),
      name: nameToken.value,
      nameSpan: nameToken.span,
      state,
      body: rest,
    };
  }

  private parseComponent(): ComponentDecl {
    const keyword = this.advance();
    const nameToken = this.expectIdent('for the component');
    const params: Param[] = [];
    if (this.atOp('(')) {
      params.push(...this.parseParams());
    }
    this.expectOp(':', 'to open the component body');
    const body = this.parseNodeBody();
    const { state, rest } = splitState(body);
    return {
      kind: 'Component',
      span: span(keyword.span.start, endOfBody(body, nameToken.span.end)),
      name: nameToken.value,
      nameSpan: nameToken.span,
      params,
      state,
      body: rest,
    };
  }

  private parseParams(): Param[] {
    this.advance(); // (
    const params: Param[] = [];
    while (!this.atOp(')') && !this.atEnd() && !this.at('newline')) {
      if (!this.at('ident')) {
        const token = this.peek();
        this.error('PUI1014', `expected a parameter name, found ${describeToken(token)}`, token.span);
        break;
      }
      const nameToken = this.advance();
      let typeText: string | undefined;
      let typeSpan: Span | undefined;
      if (this.atOp(':')) {
        this.advance();
        const collected = this.collectTypeText(new Set(['=', ',', ')']));
        typeText = collected.text;
        typeSpan = collected.span;
        if (typeText.length === 0) {
          this.error('PUI1014', `parameter "${nameToken.value}" has an empty type`, nameToken.span, 'write a type such as String, or remove the colon');
        }
      }
      let defaultValue: Expr | undefined;
      if (this.atOp('=')) {
        this.advance();
        defaultValue = this.parseExpression();
      }
      params.push({
        kind: 'Param',
        span: span(nameToken.span.start, defaultValue?.span.end ?? typeSpan?.end ?? nameToken.span.end),
        name: nameToken.value,
        nameSpan: nameToken.span,
        ...(typeText === undefined ? {} : { typeText }),
        ...(typeSpan === undefined ? {} : { typeSpan }),
        ...(defaultValue === undefined ? {} : { defaultValue }),
      });
      if (this.atOp(',')) this.advance();
      else break;
    }
    this.expectOp(')', 'to close the parameter list');
    return params;
  }

  private parseStyle(): StyleDecl {
    const keyword = this.advance(); // the contextual `style` name
    const nameToken = this.expectIdent('for the style');
    const props: Prop[] = [];
    if (this.atOp(':')) {
      const colon = this.advance();
      if (this.at('newline')) {
        this.advance();
        if (this.at('indent')) {
          this.advance();
          while (!this.at('dedent') && !this.atEnd()) {
            if (this.at('newline')) {
              this.advance();
              continue;
            }
            const before = this.pos;
            const prop = this.parseProp();
            if (prop !== undefined) props.push(prop);
            this.expectNewline('after style property');
            if (this.pos === before) this.advance();
          }
          if (this.at('dedent')) this.advance();
        } else {
          this.error('PUI1008', 'empty style block', colon.span, 'indent at least one property under this ":"');
        }
      } else {
        // Inline form: style heading: size=32 weight=bold
        while (!this.at('newline') && !this.atEnd()) {
          const before = this.pos;
          const prop = this.parseProp();
          if (prop === undefined) break;
          props.push(prop);
          if (this.pos === before) break;
        }
        this.expectNewline('after style properties');
      }
    } else {
      this.error('PUI1007', 'expected ":" to open the style body', this.peek().span);
      this.skipLine();
    }
    return {
      kind: 'Style',
      span: span(keyword.span.start, endOfBody(props.map(propAsNode), nameToken.span.end)),
      name: nameToken.value,
      nameSpan: nameToken.span,
      props,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Bodies
  // ------------------------------------------------------------------------------------------

  /** Parse `: <newline> <indent> nodes <dedent>`; the `:` has already been consumed. */
  private parseNodeBody(): Node[] {
    return this.parseIndentedBody<Node>(() => this.parseNodeStatement());
  }

  private parseActionBody(): Action[] {
    return this.parseIndentedBody<Action>(() => this.parseAction());
  }

  private parseIndentedBody<T>(parseStatement: () => T | undefined): T[] {
    const items: T[] = [];
    if (!this.at('newline')) {
      // Content on the same line as the colon: ambiguous, reject (research doc D5).
      const token = this.peek();
      this.error(
        'PUI1010',
        `"${token.value}" cannot follow ":" on the same line`,
        token.span,
        'put the content on its own indented line, or remove the ":"',
      );
      this.skipLine();
      return items;
    }

    const colonEnd = this.peek().span.end;
    this.advance(); // newline

    if (!this.at('indent')) {
      this.error('PUI1008', 'empty block', span(Math.max(0, colonEnd - 1), colonEnd), 'indent at least one line under this ":"');
      return items;
    }
    this.advance(); // indent

    while (!this.at('dedent') && !this.atEnd()) {
      if (this.at('newline')) {
        this.advance();
        continue;
      }
      if (this.at('indent')) {
        // Stray indent after an error: consume rather than cascade.
        this.advance();
        continue;
      }
      const before = this.pos;
      const item = parseStatement();
      if (item !== undefined) items.push(item);
      if (this.pos === before) this.advance();
    }
    if (this.at('dedent')) this.advance();
    return items;
  }

  private parseNodeStatement(): Node | undefined {
    const token = this.peek();

    if (token.kind === 'keyword') {
      switch (token.value) {
        case 'if':
          return this.parseIf();
        case 'for':
          return this.parseFor();
        case 'slot': {
          this.advance();
          this.expectNewline('after slot');
          return { kind: 'Slot', span: token.span };
        }
        case 'state':
          return this.parseState();
        case 'on':
          return this.parseEvent();
        case 'elif':
        case 'else':
          this.error('PUI1013', `"${token.value}" without a matching "if"`, token.span, 'indent it to align with an "if" block');
          this.skipLine();
          return undefined;
        case 'set':
          this.error('PUI1026', '"set" is only allowed inside an event handler', token.span, 'move it into an "on <event>:" block');
          this.skipLine();
          return undefined;
        case 'import':
        case 'screen':
        case 'component':
          this.error('PUI1027', `"${token.value}" cannot appear inside a block`, token.span, 'declarations live at the top level of the file');
          this.skipLine();
          return undefined;
        default:
          break;
      }
    }

    if (token.kind === 'ident' && token.value === 'style') {
      this.error('PUI1027', '"style" cannot appear inside a block', token.span, 'style declarations live at the top level of the file');
      this.skipLine();
      return undefined;
    }

    if (token.kind === 'ident') return this.parseElement();

    this.error('PUI1006', `unexpected ${describeToken(token)}`, token.span, 'expected an element, "if", "for", "state" or "on <event>"');
    this.skipLine();
    return undefined;
  }

  // ------------------------------------------------------------------------------------------
  // Elements
  // ------------------------------------------------------------------------------------------

  private parseElement(): ElementNode {
    const tagToken = this.advance();
    const callStyle = /^[A-Z]/.test(tagToken.value);
    const args: Arg[] = [];
    const props: Prop[] = [];

    if (callStyle) {
      if (this.atOp('(')) {
        for (const arg of this.parseCallArgs()) {
          args.push({ kind: 'Arg', span: arg.span, ...(arg.name === undefined ? {} : { name: arg.name }), value: arg.value });
        }
      }
      while (!this.atNodeEnd()) {
        if (this.isPropStart()) {
          const prop = this.parseProp();
          if (prop !== undefined) props.push(prop);
        } else {
          break;
        }
      }
    } else {
      if (this.atOp('(')) {
        const open = this.peek();
        this.error(
          'PUI1020',
          `built-in element "${tagToken.value}" does not take parentheses`,
          open.span,
          `write ${tagToken.value} "text" style=heading instead of ${tagToken.value}("text")`,
        );
        for (const arg of this.parseCallArgs()) {
          args.push({ kind: 'Arg', span: arg.span, ...(arg.name === undefined ? {} : { name: arg.name }), value: arg.value });
        }
      }
      const flags = booleanPropNames(tagToken.value);
      while (!this.atNodeEnd()) {
        if (this.isPropStart()) {
          const prop = this.parseProp();
          if (prop !== undefined) props.push(prop);
        } else if (this.at('ident') && flags.has(this.peek().value)) {
          // Flag syntax: `progress indeterminate`, `button "Save" disabled`.
          const nameToken = this.advance();
          props.push({
            kind: 'Prop',
            span: nameToken.span,
            name: nameToken.value,
            nameSpan: nameToken.span,
            value: { kind: 'Bool', span: nameToken.span, value: true },
          });
        } else {
          const before = this.pos;
          const value = this.parseExpression();
          args.push({ kind: 'Arg', span: value.span, value });
          if (this.pos === before) break;
        }
      }
    }

    let children: Node[] = [];
    const events: EventHandler[] = [];

    if (this.atOp(':')) {
      this.advance();
      const body = this.parseNodeBody();
      for (const node of body) {
        if (node.kind === 'Event') events.push(node);
        else children.push(node);
      }
    } else {
      this.expectNewline(`after element "${tagToken.value}"`);
    }

    const last = children[children.length - 1] ?? events[events.length - 1];
    return {
      kind: 'Element',
      span: span(tagToken.span.start, last?.span.end ?? props[props.length - 1]?.span.end ?? args[args.length - 1]?.span.end ?? tagToken.span.end),
      tag: tagToken.value,
      tagSpan: tagToken.span,
      args,
      props,
      events,
      children,
      callStyle,
    };
  }

  private atNodeEnd(): boolean {
    return this.at('newline') || this.at('dedent') || this.at('eof') || this.at('indent') || this.atOp(':');
  }

  /** `name=` — a property starts with a name (keyword names are allowed, see lexer note). */
  private isPropStart(): boolean {
    const token = this.peek();
    const next = this.peek(1);
    const nameLike = token.kind === 'ident' || token.kind === 'keyword';
    return nameLike && next.kind === 'op' && next.value === '=';
  }

  private parseProp(): Prop | undefined {
    if (!this.at('ident') && !this.at('keyword')) {
      this.error('PUI1007', 'expected a property name', this.peek().span);
      this.skipLine();
      return undefined;
    }
    const nameToken = this.advance();
    if (!this.atOp('=')) {
      this.error('PUI1007', `expected "=" after property "${nameToken.value}"`, this.peek().span, `write ${nameToken.value}=<value>`);
      return undefined;
    }
    this.advance();
    const value = this.parseExpression();
    return {
      kind: 'Prop',
      span: span(nameToken.span.start, value.span.end),
      name: nameToken.value,
      nameSpan: nameToken.span,
      value,
    };
  }

  private parseCallArgs(): CallArg[] {
    const args: CallArg[] = [];
    this.advance(); // (
    while (!this.atOp(')') && !this.atEnd()) {
      if ((this.at('ident') || this.at('keyword')) && (this.peek(1).value === ':' || this.peek(1).value === '=')) {
        const nameToken = this.advance();
        this.advance(); // : or =
        const value = this.parseExpression();
        args.push({ name: nameToken.value, value, span: span(nameToken.span.start, value.span.end) });
      } else {
        const value = this.parseExpression();
        args.push({ value, span: value.span });
      }
      if (this.atOp(',')) this.advance();
      else break;
    }
    this.expectOp(')', 'to close the argument list');
    return args;
  }

  // ------------------------------------------------------------------------------------------
  // Control flow
  // ------------------------------------------------------------------------------------------

  private parseIf(): IfNode {
    const keyword = this.advance();
    const branches: IfBranch[] = [];
    let elseBody: Node[] | undefined;
    let elseSpan: Span | undefined;

    const cond = this.parseExpression();
    this.expectOp(':', 'to open the "if" body');
    const body = this.parseNodeBody();
    branches.push({ cond, body, span: span(keyword.span.start, endOfBody(body, cond.span.end)) });

    for (;;) {
      if (this.atKeyword('elif')) {
        this.advance();
        const elifCond = this.parseExpression();
        this.expectOp(':', 'to open the "elif" body');
        const elifBody = this.parseNodeBody();
        branches.push({ cond: elifCond, body: elifBody, span: span(elifCond.span.start, endOfBody(elifBody, elifCond.span.end)) });
        continue;
      }
      if (this.atKeyword('else')) {
        const elseToken = this.advance();
        this.expectOp(':', 'to open the "else" body');
        const parsed = this.parseNodeBody();
        elseBody = parsed;
        elseSpan = span(elseToken.span.start, endOfBody(parsed, elseToken.span.end));
      }
      break;
    }

    const end = elseSpan?.end ?? branches[branches.length - 1]!.span.end;
    return { kind: 'If', span: span(keyword.span.start, end), branches, ...(elseBody === undefined ? {} : { elseBody }), ...(elseSpan === undefined ? {} : { elseSpan }) };
  }

  private parseFor(): ForNode {
    const keyword = this.advance();
    const first = this.expectIdent('after "for"');
    let itemName = first.value;
    let itemSpan = first.span;
    let indexName: string | undefined;
    let indexSpan: Span | undefined;

    if (this.atOp(',')) {
      this.advance();
      const second = this.expectIdent('after ","');
      indexName = first.value;
      indexSpan = first.span;
      itemName = second.value;
      itemSpan = second.span;
    }

    if (!this.atKeyword('in')) {
      this.error('PUI1007', 'expected "in" after the loop variable', this.peek().span, 'for example: for item in items:');
    } else {
      this.advance();
    }

    const iterable = this.parseExpression();
    this.expectOp(':', 'to open the loop body');
    const body = this.parseNodeBody();

    return {
      kind: 'For',
      span: span(keyword.span.start, endOfBody(body, iterable.span.end)),
      itemName,
      itemSpan,
      ...(indexName === undefined || indexSpan === undefined ? {} : { indexName, indexSpan }),
      iterable,
      body,
    };
  }

  // ------------------------------------------------------------------------------------------
  // State and events
  // ------------------------------------------------------------------------------------------

  private parseState(): StateDecl {
    const keyword = this.advance();
    const nameToken = this.expectIdent('for the state variable');
    let typeText: string | undefined;
    let typeSpan: Span | undefined;

    if (this.atOp(':')) {
      this.advance();
      const collected = this.collectTypeText(new Set(['=']));
      typeText = collected.text;
      typeSpan = collected.span;
      if (typeText.length === 0) {
        this.error('PUI1023', 'expected a type after ":"', nameToken.span, 'for example: state count: int = 0');
      }
    }

    if (!this.atOp('=')) {
      this.error('PUI1023', `state "${nameToken.value}" needs an initial value`, this.peek().span, 'for example: state count: int = 0');
      this.skipLine();
      return {
        kind: 'State',
        span: span(keyword.span.start, nameToken.span.end),
        name: nameToken.value,
        nameSpan: nameToken.span,
        ...(typeText === undefined ? {} : { typeText }),
        ...(typeSpan === undefined ? {} : { typeSpan }),
        init: { kind: 'Null', span: nameToken.span },
      };
    }
    this.advance();
    const init = this.parseExpression();
    this.expectNewline('after the state declaration');

    return {
      kind: 'State',
      span: span(keyword.span.start, init.span.end),
      name: nameToken.value,
      nameSpan: nameToken.span,
      ...(typeText === undefined ? {} : { typeText }),
      ...(typeSpan === undefined ? {} : { typeSpan }),
      init,
    };
  }

  private parseEvent(): EventHandler {
    const keyword = this.advance();
    if (!this.at('ident')) {
      const token = this.peek();
      this.error('PUI1022', `expected an event name after "on", found ${describeToken(token)}`, token.span, 'for example: on tap:');
      this.skipLine();
      return { kind: 'Event', span: keyword.span, name: '', nameSpan: token.span, actions: [] };
    }
    const nameToken = this.advance();
    this.expectOp(':', `after "on ${nameToken.value}"`);

    let actions: Action[];
    if (this.at('newline')) {
      actions = this.parseActionBody();
    } else {
      // One-line form: `on tap: retry()`
      const action = this.parseAction();
      actions = action === undefined ? [] : [action];
    }

    const end = actions[actions.length - 1]?.span.end ?? nameToken.span.end;
    return { kind: 'Event', span: span(keyword.span.start, end), name: nameToken.value, nameSpan: nameToken.span, actions };
  }

  private parseAction(): Action | undefined {
    const token = this.peek();

    if (token.kind === 'keyword' && token.value === 'set') {
      this.advance();
      const target = this.parseExpression();
      const opToken = this.peek();
      const compound = new Set(['=', '+=', '-=', '*=', '/=']);
      if (opToken.kind !== 'op' || !compound.has(opToken.value)) {
        this.error('PUI1007', 'expected "=" after the assignment target', opToken.span, 'for example: set count = count + 1');
        this.skipLine();
        return undefined;
      }
      this.advance();
      const value = this.parseExpression();
      this.expectNewline('after "set"');
      const action: SetAction = {
        kind: 'Set',
        span: span(token.span.start, value.span.end),
        target,
        op: opToken.value as SetAction['op'],
        value,
      };
      return action;
    }

    if (token.kind === 'keyword' && token.value === 'if') {
      return this.parseActionIf();
    }

    if (token.kind === 'keyword' && token.value !== 'await' && token.value !== 'true' && token.value !== 'false' && token.value !== 'null') {
      this.error(
        'PUI1026',
        `"${token.value}" is not allowed inside an event handler`,
        token.span,
        'event handler bodies accept "set", calls, and "if"',
      );
      this.skipLine();
      return undefined;
    }

    if (token.kind === 'newline') return undefined;

    const expr = this.parseExpression();
    const action: CallAction = { kind: 'Call', span: expr.span, expr };
    this.expectNewline('after the statement');
    return action;
  }

  private parseActionIf(): ActionIf {
    const keyword = this.advance();
    const branches: ActionBranch[] = [];
    let elseBody: Action[] | undefined;
    let elseSpan: Span | undefined;

    const cond = this.parseExpression();
    this.expectOp(':', 'to open the "if" body');
    const body = this.parseActionBody();
    branches.push({ cond, body, span: span(keyword.span.start, endOfBody(body, cond.span.end)) });

    for (;;) {
      if (this.atKeyword('elif')) {
        this.advance();
        const elifCond = this.parseExpression();
        this.expectOp(':', 'to open the "elif" body');
        const elifBody = this.parseActionBody();
        branches.push({ cond: elifCond, body: elifBody, span: span(elifCond.span.start, endOfBody(elifBody, elifCond.span.end)) });
        continue;
      }
      if (this.atKeyword('else')) {
        const elseToken = this.advance();
        this.expectOp(':', 'to open the "else" body');
        const parsed = this.parseActionBody();
        elseBody = parsed;
        elseSpan = span(elseToken.span.start, endOfBody(parsed, elseToken.span.end));
      }
      break;
    }

    const end = elseSpan?.end ?? branches[branches.length - 1]!.span.end;
    return {
      kind: 'ActionIf',
      span: span(keyword.span.start, end),
      branches,
      ...(elseBody === undefined ? {} : { elseBody }),
      ...(elseSpan === undefined ? {} : { elseSpan }),
    };
  }

  // ------------------------------------------------------------------------------------------
  // Expressions
  // ------------------------------------------------------------------------------------------

  private isExprBoundary(): boolean {
    const token = this.peek();
    if (token.kind === 'newline' || token.kind === 'dedent' || token.kind === 'eof' || token.kind === 'indent') return true;
    if (token.kind === 'op' && (token.value === ':' || token.value === ',' || token.value === ')')) return true;
    const next = this.peek(1);
    if ((token.kind === 'ident' || token.kind === 'keyword') && next.kind === 'op' && next.value === '=') return true;
    return false;
  }

  parseExpression(): Expr {
    const expr = this.parseBinary(0);
    if (this.atOp('?')) {
      this.advance();
      const then = this.parseExpression();
      if (this.atOp(':')) this.advance();
      else this.error('PUI1007', 'expected ":" in a conditional expression', this.peek().span);
      const otherwise = this.parseExpression();
      return { kind: 'Ternary', span: span(expr.span.start, otherwise.span.end), cond: expr, then, otherwise } satisfies Expr;
    }
    if (this.at('ident') && (this.peek().value === 'as' || this.peek().value === 'is')) {
      const token = this.advance();
      this.error('PUI1021', `"${token.value}" casts are not supported`, token.span, 'move the cast into a Dart function');
    }
    return expr;
  }

  private parseBinary(minPrecedence: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      if (this.isExprBoundary()) break;
      const token = this.peek();
      if (token.kind !== 'op') break;
      if (UNSUPPORTED_EXPR_OPS.has(token.value)) {
        this.error('PUI1021', `"${token.value}" is not supported in PlainUI expressions`, token.span, 'move this logic into a Dart function');
        this.advance();
        break;
      }
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      this.advance();
      const nextMin = RIGHT_ASSOCIATIVE.has(token.value) ? precedence : precedence + 1;
      const right = this.parseBinary(nextMin);
      left = { kind: 'Binary', span: span(left.span.start, right.span.end), op: token.value, left, right } satisfies Expr;
    }
    return left;
  }

  private parseUnary(): Expr {
    const token = this.peek();
    if (token.kind === 'keyword' && token.value === 'await') {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'Unary', span: span(token.span.start, operand.span.end), op: 'await', operand } satisfies Expr;
    }
    if (token.kind === 'op' && (token.value === '-' || token.value === '!')) {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'Unary', span: span(token.span.start, operand.span.end), op: token.value as '-' | '!', operand } satisfies Expr;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'op') break;
      if (token.value === '.') {
        this.advance();
        if (!this.at('ident')) {
          this.error('PUI1007', 'expected a member name after "."', this.peek().span);
          break;
        }
        const nameToken = this.advance();
        expr = { kind: 'Member', span: span(expr.span.start, nameToken.span.end), object: expr, name: nameToken.value, nameSpan: nameToken.span } satisfies Expr;
        continue;
      }
      if (token.value === '(') {
        const args = this.parseCallArgs();
        const closeEnd = this.tokens[this.pos - 1]?.span.end ?? expr.span.end;
        expr = { kind: 'Call', span: span(expr.span.start, closeEnd), callee: expr, args } satisfies Expr;
        continue;
      }
      if (token.value === '[') {
        this.advance();
        const index = this.parseExpression();
        const indexStart = this.peek().span.start;
        this.expectOp(']', 'to close the index');
        expr = { kind: 'Index', span: span(expr.span.start, this.tokens[this.pos - 1]?.span.end ?? indexStart), object: expr, index } satisfies Expr;
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const token = this.peek();

    if (token.kind === 'string') {
      this.advance();
      return this.stringLiteral(token);
    }
    if (token.kind === 'number') {
      this.advance();
      return { kind: 'Number', span: token.span, value: Number(token.value), raw: token.value };
    }
    if (token.kind === 'color') {
      this.advance();
      return { kind: 'Color', span: token.span, raw: token.value };
    }
    if (token.kind === 'keyword' && (token.value === 'true' || token.value === 'false')) {
      this.advance();
      return { kind: 'Bool', span: token.span, value: token.value === 'true' };
    }
    if (token.kind === 'keyword' && token.value === 'null') {
      this.advance();
      return { kind: 'Null', span: token.span };
    }
    if (token.kind === 'ident') {
      this.advance();
      return { kind: 'Ident', span: token.span, name: token.value };
    }
    if (token.kind === 'op' && token.value === '(') {
      this.advance();
      const inner = this.parseExpression();
      const close = this.peek();
      if (this.atOp(')')) this.advance();
      else this.error('PUI1007', 'expected ")"', close.span);
      return { kind: 'Paren', span: span(token.span.start, close.span.end), inner };
    }
    if (token.kind === 'op' && token.value === '[') {
      this.advance();
      const items: Expr[] = [];
      while (!this.atOp(']') && !this.atEnd() && !this.at('newline')) {
        items.push(this.parseExpression());
        if (this.atOp(',')) this.advance();
        else break;
      }
      const close = this.peek();
      if (this.atOp(']')) this.advance();
      else this.error('PUI1007', 'expected "]"', close.span);
      return { kind: 'List', span: span(token.span.start, close.span.end), items };
    }
    if (token.kind === 'op' && UNSUPPORTED_EXPR_OPS.has(token.value)) {
      this.error('PUI1021', `"${token.value}" is not supported in PlainUI expressions`, token.span);
      this.advance();
      return { kind: 'Null', span: token.span };
    }
    if (token.kind === 'op' && token.value === '{') {
      this.error('PUI1021', 'map literals are not supported', token.span, 'move the map into a Dart function or a state initialiser in Dart');
      this.skipBalanced('{', '}');
      return { kind: 'Null', span: token.span };
    }

    this.error('PUI1007', `expected an expression, found ${describeToken(token)}`, token.span);
    if (!this.at('newline') && !this.atEnd()) this.advance();
    return { kind: 'Null', span: token.span };
  }

  private skipBalanced(open: string, close: string): void {
    let depth = 0;
    while (!this.atEnd()) {
      if (this.atOp(open)) depth += 1;
      else if (this.atOp(close)) {
        depth -= 1;
        if (depth <= 0) {
          this.advance();
          return;
        }
      }
      this.advance();
    }
  }

  private stringLiteral(token: Token): Expr {
    const value = token.value.slice(1, -1);
    const interpolations: Interpolation[] = [];
    let index = 0;
    while (index < value.length) {
      const ch = value[index]!;
      if (ch === '\\') {
        index += 2;
        continue;
      }
      if (ch === '$' && value[index + 1] === '{') {
        const start = index + 2;
        let braces = 1;
        let i = start;
        while (i < value.length && braces > 0) {
          const c = value[i]!;
          if (c === '"') {
            i += 1;
            while (i < value.length && value[i] !== '"') {
              if (value[i] === '\\') i += 1;
              i += 1;
            }
          } else if (c === '{') braces += 1;
          else if (c === '}') braces -= 1;
          if (braces === 0) break;
          i += 1;
        }
        interpolations.push({
          text: value.slice(start, i),
          span: span(token.span.start + 1 + start, token.span.start + 1 + i),
        });
        index = i + 1;
        continue;
      }
      index += 1;
    }
    return { kind: 'String', span: token.span, value, raw: token.value, interpolations };
  }

  /**
   * Collect raw type text until one of `stops` at bracket depth 0. Types are host-language
   * text (`List<Product>`, `Map<String, int>`, `int?`), so they are captured verbatim rather
   * than re-parsed.
   */
  private collectTypeText(stops: ReadonlySet<string>): { text: string; span: Span } {
    const startToken = this.peek();
    let depth = 0;
    const start = this.pos;
    while (!this.atEnd()) {
      const token = this.peek();
      if (token.kind === 'newline' || token.kind === 'dedent') break;
      if (token.kind === 'op') {
        if (token.value === '>=' || token.value === '<=') {
          this.error(
            'PUI1023',
            `"${token.value}" is read as one operator, not as a closing ">" plus "="`,
            token.span,
            'put a space before "=" (for example: List<String> = [])',
          );
        }
        // Stops are only meaningful at the top level; inside brackets they are part of the type.
        if (depth === 0 && stops.has(token.value)) break;
        if (token.value === '<' || token.value === '[' || token.value === '(') depth += 1;
        else if ((token.value === '>' || token.value === ']' || token.value === ')') && depth > 0) depth -= 1;
      }
      this.advance();
    }
    const endToken = this.tokens[this.pos - 1] ?? startToken;
    if (this.pos === start) {
      return { text: '', span: startToken.span };
    }
    const typeSpan = span(startToken.span.start, endToken.span.end);
    return { text: textOf(this.file, typeSpan).trim(), span: typeSpan };
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function describeToken(token: Token): string {
  switch (token.kind) {
    case 'eof':
      return 'end of file';
    case 'newline':
      return 'end of line';
    case 'indent':
      return 'an indented block';
    case 'dedent':
      return 'a dedent';
    case 'string':
      return `string ${token.value}`;
    case 'ident':
      return `"${token.value}"`;
    case 'keyword':
      return `keyword "${token.value}"`;
    case 'op':
      return `"${token.value}"`;
    case 'number':
      return `number ${token.value}`;
    case 'color':
      return `colour ${token.value}`;
    default:
      return `"${token.value}"`;
  }
}

function endOfBody(items: readonly { span: Span }[], fallback: number): number {
  return items.length === 0 ? fallback : items[items.length - 1]!.span.end;
}

function splitState(body: readonly Node[]): { state: StateDecl[]; rest: Node[] } {
  const state: StateDecl[] = [];
  const rest: Node[] = [];
  for (const node of body) {
    if (node.kind === 'State') state.push(node);
    else rest.push(node);
  }
  return { state, rest };
}

function propAsNode(prop: Prop): { span: Span } {
  return { span: prop.span };
}

/** Parse a `.pui` source file. Lexing diagnostics are merged into the returned bag. */
export function parse(file: SourceFile): ParseResult {
  const bag = new DiagnosticBag(file);
  const { tokens } = tokenize(file, bag);
  const parser = new Parser(file, tokens, bag);
  const program = parser.parseProgram();
  return { program, bag };
}

export { Parser };
