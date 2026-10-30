/**
 * The public API.
 *
 * Everything the CLI, the language server and the playground do is available as a function here,
 * so PlainUI can be embedded: a `build_runner`-style step, a docs generator, a test fixture, or a
 * design tool that shows the Dart next to the source.
 *
 * The surface is deliberately narrow — compile, check, format, parse, and the catalogues that
 * describe the language. Internals (scopes, the token stream's shape, emitter details) stay
 * unexported so they can change.
 *
 * ```ts
 * import { compileOne } from '@plainui/compiler';
 *
 * const result = compileOne('lib/ui/home.pui', 'screen Home:\n    text "hi"\n');
 * console.log(result.code);
 * ```
 */

export { COMPILER_VERSION, compileSource } from './project/compile.ts';
export type { CompileOptions, CompileResult } from './project/compile.ts';

export {
  ProjectCache,
  compileOne,
  compileProject,
  outputPathFor,
} from './project/project.ts';
export type {
  CachedResult,
  FileResult,
  ProjectOptions,
  ProjectResult,
  SourceInput,
} from './project/project.ts';

export { formatText } from './tooling/format.ts';
export type { FormatResult } from './tooling/format.ts';

export { parse } from './frontend/parser.ts';
export type { ParseResult } from './frontend/parser.ts';

export { tokenize } from './frontend/lexer.ts';
export { sourceFile } from './frontend/source.ts';
export type { Position, SourceFile, Span } from './frontend/source.ts';
export type { ElementNode, Program, ScreenDecl, ComponentDecl } from './frontend/ast.ts';

export { check } from './analysis/check.ts';
export type { Analysis, CheckOptions } from './analysis/check.ts';

export { CODES, formatDiagnostic, toJsonDiagnostic } from './analysis/diagnostics.ts';
export type { Diagnostic, DiagnosticCode, Severity } from './analysis/diagnostics.ts';

export { UNIVERSAL_PROPS, WIDGETS, WIDGET_TAGS, widgetSpec, widgetsByGroup } from './analysis/widgets/registry.ts';
export type { PropSpec, WidgetSpec } from './analysis/widgets/registry.ts';

export { generateHtml } from './codegen/html.ts';
export { generateFlutter } from './codegen/flutter.ts';
