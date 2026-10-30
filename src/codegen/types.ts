/** Target-specific formatting for PlainUI's semantic and written type forms. */

import { DYNAMIC, STRING, type UiType } from '../frontend/ast.ts';
import type { TargetTypeMap, TargetTypeSyntax } from '../targets/contract.ts';

function apply(syntax: TargetTypeSyntax, args: readonly string[]): string {
  return `${syntax.prefix}${args.join(syntax.separator ?? ', ')}${syntax.suffix}`;
}

function applyOptional(inner: string, types: TargetTypeMap): string {
  const { prefix, suffix } = types.optional;
  // In the usual nullable representations (T? or T | null), nested absence has the same target
  // type as one Optional layer. Avoid invalid output such as Dart's `int??`.
  if (prefix === '' && suffix !== '' && inner.endsWith(suffix)) return inner;
  return apply(types.optional, [inner]);
}

/** Render the checker's semantic type using the selected target's own type map. */
export function typeToTargetText(type: UiType, types: TargetTypeMap): string {
  switch (type.kind) {
    case 'string':
      return types.names.Text;
    case 'int':
      return types.names.Int;
    case 'double':
      return types.names.Float;
    case 'num':
      return types.names.Num;
    case 'bool':
      return types.names.Bool;
    case 'dynamic':
      return types.names.Dynamic;
    case 'named':
      return types.names[type.name] ?? type.name;
    case 'nullable':
      return applyOptional(typeToTargetText(type.inner, types), types);
    case 'list': {
      return apply(types.generics.List, [typeToTargetText(type.element, types)]);
    }
    case 'map': {
      const args = [typeToTargetText(STRING, types), typeToTargetText(DYNAMIC, types)];
      return apply(types.generics.Map, args);
    }
    case 'task':
      return typeToTargetText(type.value, types);
  }
}

function genericEnd(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '<') depth += 1;
    else if (text[index] === '>') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function genericArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '<') depth += 1;
    else if (text[index] === '>') depth -= 1;
    else if (text[index] === ',' && depth === 0) {
      args.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

/**
 * Convert an annotation that must retain its written generic shape (notably host signatures) using
 * the target map. Unknown names pass through unchanged; the source language owns those names.
 */
export function typeTextForTarget(text: string, types: TargetTypeMap): string {
  const source = text.trim();
  if (source.endsWith('?')) {
    return applyOptional(typeTextForTarget(source.slice(0, -1), types), types);
  }

  const head = /^([A-Za-z_$][A-Za-z0-9_$.]*)\s*/.exec(source);
  if (head === null) return source;
  const originalName = head[1]!;
  const afterName = source.slice(head[0].length);
  if (afterName.startsWith('<')) {
    const end = genericEnd(afterName, 0);
    if (end >= 0 && afterName.slice(end + 1).trim() === '') {
      const args = genericArgs(afterName.slice(1, end)).map((arg) => typeTextForTarget(arg, types));
      if (originalName === 'Optional') {
        const inner = args[0] ?? types.names.Dynamic;
        return applyOptional(inner, types);
      }
      const syntax = originalName in types.generics
        ? types.generics[originalName as keyof typeof types.generics]
        : undefined;
      if (syntax !== undefined) return apply(syntax, args);
      return `${types.names[originalName] ?? originalName}<${args.join(', ')}>`;
    }
  }
  if (originalName === 'Optional') {
    return applyOptional(types.names.Dynamic, types);
  }
  return `${types.names[originalName] ?? originalName}${afterName}`;
}
