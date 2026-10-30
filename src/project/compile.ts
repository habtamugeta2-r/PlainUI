/**
 * The compilation pipeline: source text in, target output out.
 *
 * Stages (docs/02-architecture.md):
 *   source -> lexer -> parser -> AST -> checker -> Analysis -> generator -> output
 *
 * The front end is the same for every target; only the last stage asks which one was selected. So
 * do the checker's name and type rules — it takes the target too, which is how a file can be legal
 * for one target and not for another.
 *
 * Generation only runs when the checker reported no errors, because a half-understood tree
 * produces misleading output.
 */

import type { Analysis } from '../analysis/check.ts';
import { check, type CheckOptions } from '../analysis/check.ts';
import { generateHtml } from '../codegen/html.ts';
import { generateFlutter, type FlutterGenOptions } from '../codegen/flutter.ts';
import type { Diagnostic } from '../analysis/diagnostics.ts';
import { DiagnosticBag } from '../analysis/diagnostics.ts';
import { parse } from '../frontend/parser.ts';
import { type Program } from '../frontend/ast.ts';
import { type SourceFile, sourceFile } from '../frontend/source.ts';
import { DEFAULT_TARGET } from '../targets/index.ts';

export const COMPILER_VERSION = '1.0.0';

export interface CompileOptions extends CheckOptions {
  /** Path used in diagnostics and the generated banner. */
  readonly path?: string;
  /** Where the generated file will be written; used to re-base relative imports. */
  readonly outputPath?: string;
  readonly resolvePlainuiImport?: FlutterGenOptions['resolvePlainuiImport'];
  readonly compilerVersion?: string;
}

export interface CompileResult {
  readonly file: SourceFile;
  readonly program: Program;
  readonly analysis: Analysis;
  readonly diagnostics: readonly Diagnostic[];
  readonly bag: DiagnosticBag;
  /** Generated output for the selected target, present only when there were no errors. */
  readonly code?: string;
  readonly imports?: readonly string[];
  readonly ok: boolean;
}

export function compileSource(text: string, options: CompileOptions = {}): CompileResult {
  const path = options.path ?? 'input.pui';
  const file = sourceFile(path, text);
  const { program, bag } = parse(file);
  const checked = check(file, program, options);
  bag.merge(checked.bag);

  const diagnostics = bag.sorted();
  const ok = !bag.hasErrors;

  if (!ok) {
    return { file, program, analysis: checked.analysis, diagnostics, bag, ok };
  }

  const target = options.target ?? DEFAULT_TARGET;
  if (target.id === 'html') {
    const page = generateHtml(checked.analysis);
    return { file, program, analysis: checked.analysis, diagnostics, bag, code: page.code, imports: [], ok };
  }

  const generated = generateFlutter(checked.analysis, file, {
    compilerVersion: options.compilerVersion ?? COMPILER_VERSION,
    sourcePath: path,
    ...(options.resolvePlainuiImport === undefined ? {} : { resolvePlainuiImport: options.resolvePlainuiImport }),
  });

  return {
    file,
    program,
    analysis: checked.analysis,
    diagnostics,
    bag,
    code: generated.code,
    imports: generated.imports,
    ok,
  };
}
