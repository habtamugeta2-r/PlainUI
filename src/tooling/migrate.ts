/**
 * Source-preserving codemod for PlainUI's deprecated Dart primitive type aliases.
 *
 * Rewrites only parser-recognised type annotation spans. Names in expressions, strings, comments,
 * widget properties and identifiers such as `TextStyle` are deliberately untouched.
 */

import type { Param, Program } from '../frontend/ast.ts';
import { parse } from '../frontend/parser.ts';
import { type Diagnostic } from '../analysis/diagnostics.ts';
import { type SourceFile, type Span } from '../frontend/source.ts';
import { walkNodes } from '../frontend/ast.ts';

const LEGACY_TO_PLAIN: Readonly<Record<string, string>> = {
  String: 'Text',
  int: 'Int',
  double: 'Float',
  bool: 'Bool',
};

export interface MigrationResult {
  readonly text: string;
  readonly changed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

function typeSpans(program: Program): Span[] {
  const spans: Span[] = [];
  const add = (typeText: string | undefined, typeSpan: Span | undefined): void => {
    if (typeText !== undefined && typeSpan !== undefined) spans.push(typeSpan);
  };
  const addParam = (param: Param): void => add(param.typeText, param.typeSpan);

  for (const imported of program.imports) {
    for (const declaration of imported.surface ?? []) {
      for (const param of declaration.params) addParam(param);
      if (declaration.kind === 'HostFn') add(declaration.typeText, declaration.typeSpan);
    }
  }

  for (const declaration of program.decls) {
    if (declaration.kind !== 'Screen' && declaration.kind !== 'Component') continue;
    for (const param of declaration.params) addParam(param);
    for (const typed of [...declaration.state, ...declaration.tasks, ...declaration.derived]) {
      add(typed.typeText, typed.typeSpan);
    }
    // Be robust to an invalid placement: `plainui migrate` can still fix types before `check`
    // reports that the declaration itself is misplaced.
    walkNodes(declaration.body, (node) => {
      if (node.kind === 'State' || node.kind === 'Task' || node.kind === 'Derived') {
        add(node.typeText, node.typeSpan);
      }
    });
  }
  return spans;
}

/** Convert legacy primitive names in type annotations, preserving every byte outside those names. */
export function migrateTypes(file: SourceFile): MigrationResult {
  const { program, bag } = parse(file);
  if (bag.hasErrors) return { text: file.text, changed: false, diagnostics: bag.sorted() };

  const edits: { start: number; end: number; text: string }[] = [];
  const seen = new Set<string>();
  for (const range of typeSpans(program)) {
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = file.text.slice(range.start, range.end);
    for (const match of source.matchAll(/\b(?:String|int|double|bool)\b/g)) {
      const oldName = match[0]!;
      const start = range.start + match.index!;
      edits.push({ start, end: start + oldName.length, text: LEGACY_TO_PLAIN[oldName]! });
    }
  }

  let text = file.text;
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
  return { text, changed: text !== file.text, diagnostics: bag.sorted() };
}
