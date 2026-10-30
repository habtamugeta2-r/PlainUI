/**
 * Human-readable renderings of the AST and the token stream, used by `plainui ast`,
 * `plainui tokens` and by tests that want to assert on tree *shape* rather than on spans.
 */

import type { Action, Decl, Expr, Node, Program } from '../frontend/ast.ts';

export function describeExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'String':
      return expr.raw;
    case 'Number':
      return expr.raw;
    case 'Bool':
      return String(expr.value);
    case 'Null':
      return 'null';
    case 'Color':
      return expr.raw;
    case 'Ident':
      return expr.name;
    case 'Member':
      return `${describeExpr(expr.object)}.${expr.name}`;
    case 'Call':
      return `${describeExpr(expr.callee)}(${expr.args
        .map((a) => (a.name === undefined ? describeExpr(a.value) : `${a.name}: ${describeExpr(a.value)}`))
        .join(', ')})`;
    case 'Index':
      return `${describeExpr(expr.object)}[${describeExpr(expr.index)}]`;
    case 'Unary':
      return expr.op === 'await' ? `await ${describeExpr(expr.operand)}` : `${expr.op}${describeExpr(expr.operand)}`;
    case 'Binary':
      return `(${describeExpr(expr.left)} ${expr.op} ${describeExpr(expr.right)})`;
    case 'Ternary':
      return `(${describeExpr(expr.cond)} ? ${describeExpr(expr.then)} : ${describeExpr(expr.otherwise)})`;
    case 'List':
      return `[${expr.items.map(describeExpr).join(', ')}]`;
    case 'Paren':
      return `(${describeExpr(expr.inner)})`;
  }
}

function describeActions(actions: readonly Action[], indent: string, lines: string[]): void {
  for (const action of actions) {
    if (action.kind === 'Set') {
      lines.push(`${indent}set ${describeExpr(action.target)} ${action.op} ${describeExpr(action.value)}`);
    } else if (action.kind === 'Call') {
      lines.push(`${indent}call ${describeExpr(action.expr)}`);
    } else {
      for (const branch of action.branches) {
        lines.push(`${indent}if ${describeExpr(branch.cond)}`);
        describeActions(branch.body, `${indent}  `, lines);
      }
      if (action.elseBody !== undefined) {
        lines.push(`${indent}else`);
        describeActions(action.elseBody, `${indent}  `, lines);
      }
    }
  }
}

function describeNode(node: Node, indent: string, lines: string[]): void {
  switch (node.kind) {
    case 'Element': {
      const parts = [node.tag];
      for (const arg of node.args) parts.push(arg.name === undefined ? describeExpr(arg.value) : `${arg.name}: ${describeExpr(arg.value)}`);
      for (const prop of node.props) parts.push(`${prop.name}=${describeExpr(prop.value)}`);
      lines.push(`${indent}${parts.join(' ')}`);
      for (const event of node.events) {
        lines.push(`${indent}  on ${event.name}`);
        describeActions(event.actions, `${indent}    `, lines);
      }
      for (const child of node.children) describeNode(child, `${indent}  `, lines);
      break;
    }
    case 'If': {
      node.branches.forEach((branch, index) => {
        lines.push(`${indent}${index === 0 ? 'if' : 'elif'} ${describeExpr(branch.cond)}`);
        for (const child of branch.body) describeNode(child, `${indent}  `, lines);
      });
      if (node.elseBody !== undefined) {
        lines.push(`${indent}else`);
        for (const child of node.elseBody) describeNode(child, `${indent}  `, lines);
      }
      break;
    }
    case 'For':
      lines.push(
        `${indent}for ${node.indexName === undefined ? '' : `${node.indexName}, `}${node.itemName} in ${describeExpr(node.iterable)}`,
      );
      for (const child of node.body) describeNode(child, `${indent}  `, lines);
      break;
    case 'Slot':
      lines.push(`${indent}slot`);
      break;
    case 'State':
      lines.push(`${indent}state ${node.name}${node.typeText === undefined ? '' : `: ${node.typeText}`} = ${describeExpr(node.init)}`);
      break;
    case 'Event':
      lines.push(`${indent}on ${node.name} (misplaced)`);
      describeActions(node.actions, `${indent}  `, lines);
      break;
  }
}

function describeDecl(decl: Decl, lines: string[]): void {
  switch (decl.kind) {
    case 'Screen':
      lines.push(`screen ${decl.name}`);
      for (const state of decl.state) describeNode(state, '  ', lines);
      for (const node of decl.body) describeNode(node, '  ', lines);
      break;
    case 'Component':
      lines.push(`component ${decl.name}(${decl.params.map((p) => `${p.name}${p.typeText === undefined ? '' : `: ${p.typeText}`}`).join(', ')})`);
      for (const state of decl.state) describeNode(state, '  ', lines);
      for (const node of decl.body) describeNode(node, '  ', lines);
      break;
    case 'Style':
      lines.push(`style ${decl.name}`);
      for (const prop of decl.props) lines.push(`  ${prop.name}=${describeExpr(prop.value)}`);
      break;
    case 'Theme':
      lines.push(`theme ${decl.name}`);
      for (const token of decl.tokens) {
        lines.push(`  ${token.categoryText} ${token.name} = ${describeExpr(token.value)}`);
      }
      break;
  }
}

/** A compact, indented tree rendering — the `plainui ast` output. */
export function renderAst(program: Program): string {
  const lines: string[] = [];
  for (const imp of program.imports) lines.push(`import "${imp.path}"`);
  if (program.imports.length > 0 && program.decls.length > 0) lines.push('');
  for (const decl of program.decls) describeDecl(decl, lines);
  return lines.join('\n') + '\n';
}
