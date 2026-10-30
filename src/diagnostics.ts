/**
 * Diagnostics: structured errors, warnings and notes with stable codes.
 *
 * Design rules (see docs/00-research.md §4):
 *   - every diagnostic has a stable code that survives rewording of the message;
 *   - every diagnostic points at a span in the source it is about;
 *   - every diagnostic that has an obvious fix carries a hint;
 *   - diagnostics are data, not strings, so the CLI, the playground and the JSON output all
 *     read the same objects.
 */

import { type Position, type SourceFile, type Span, lineText, positionAt } from './source.ts';

export type Severity = 'error' | 'warning' | 'info';

export interface RelatedInfo {
  readonly span: Span;
  readonly message: string;
  /** Optional file when the related span lives in another file. */
  readonly file?: SourceFile;
}

export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly span: Span;
  readonly hint?: string;
  readonly related?: readonly RelatedInfo[];
  /** File the span belongs to. Filled by `DiagnosticBag.attach`. */
  readonly file?: SourceFile;
}

export interface CodeInfo {
  readonly title: string;
  readonly description: string;
  readonly fix?: string;
}

/**
 * The diagnostic catalogue. `code` values are stable; `plainui explain PUI2001` prints the
 * entry, and docs/05-diagnostics.md is generated from this table.
 */
export const CODES = {
  // ---------------------------------------------------------------- lexical / structural
  PUI1001: {
    title: 'Invalid character',
    description: 'The lexer met a character that cannot start any token in PlainUI.',
    fix: 'Remove the character, or write it inside a string.',
  },
  PUI1002: {
    title: 'Unterminated string',
    description: 'A string literal was opened but not closed before the end of the line. Strings cannot span lines.',
    fix: 'Add the closing double quote, or escape the quote with \\".',
  },
  PUI1003: {
    title: 'Unexpected indentation',
    description: 'This line is indented deeper than the previous one, but the previous line does not open a block with ":".',
    fix: 'Either add a ":" to the line above, or reduce this line’s indentation.',
  },
  PUI1004: {
    title: 'Inconsistent indentation',
    description: 'This line dedents to a column that no enclosing block uses, so the compiler cannot tell which block it belongs to.',
    fix: 'Indent this line to match its siblings.',
  },
  PUI1005: {
    title: 'Mixed tabs and spaces',
    description: 'One indentation run mixes tab and space characters, so the same file can mean different things in different editors.',
    fix: 'Use only spaces (recommended) or only tabs for indentation.',
  },
  PUI1006: {
    title: 'Unexpected token',
    description: 'The parser found a token that cannot appear here.',
    fix: 'Check the syntax of this line against the language reference.',
  },
  PUI1007: {
    title: 'Expected token',
    description: 'The parser needed a specific token to continue and did not find it.',
    fix: 'See the hint for the token that was expected.',
  },
  PUI1008: {
    title: 'Empty block',
    description: 'A line ends with ":" and opens a block, but nothing is indented under it.',
    fix: 'Indent at least one line under it, or remove the ":".',
  },
  PUI1010: {
    title: 'Content and nested block on one line',
    description: 'An element line both supplies content and opens a nested block. This is ambiguous, so it is rejected.',
    fix: 'Move the content to its own line inside the block.',
  },
  PUI1011: {
    title: 'Invalid number',
    description: 'A numeric literal could not be read.',
    fix: 'Write digits, optionally with one decimal point, for example 24 or 1.5.',
  },
  PUI1012: {
    title: 'Invalid colour',
    description: 'A colour literal must be #RGB, #RRGGBB or #AARRGGBB.',
    fix: 'Use 3, 6 or 8 hexadecimal digits after "#".',
  },
  PUI1013: {
    title: 'Orphan elif / else',
    description: 'An "elif" or "else" block does not follow an "if" block at the same indentation.',
    fix: 'Indent it to match its "if", or add the missing "if".',
  },
  PUI1014: {
    title: 'Invalid component parameter',
    description: 'A component parameter must be written "name", "name: Type" or "name: Type = default".',
    fix: 'Check the parameter list.',
  },
  PUI1015: {
    title: 'Unexpected top-level statement',
    description: 'Only "import", "screen", "component" and "style" declarations may appear at the top level of a file.',
    fix: 'Move this line inside a screen or component.',
  },
  PUI1016: {
    title: 'Unbalanced brackets',
    description: 'A bracket was opened and not closed, or closed without being opened, on the same logical line.',
    fix: 'Balance the brackets.',
  },
  PUI1020: {
    title: 'Call-style arguments on a built-in element',
    description: 'Built-in elements take space-separated arguments and properties, not a parenthesised argument list.',
    fix: 'Write text "Hello" instead of text("Hello").',
  },
  PUI1021: {
    title: 'Unsupported expression syntax',
    description: 'PlainUI expressions are a checked subset of Dart. This construct is outside that subset.',
    fix: 'Move the logic into a Dart function and call it from an event handler.',
  },
  PUI1022: {
    title: 'Invalid event declaration',
    description: 'An event handler must be written "on <event>:" followed by an indented block, or a single action on the same line.',
    fix: 'For example: on tap:',
  },
  PUI1023: {
    title: 'Invalid state declaration',
    description: 'A state declaration must be written "state <name>: <Type> = <initial value>".',
    fix: 'For example: state count: int = 0',
  },
  PUI1026: {
    title: 'Statement not allowed here',
    description: 'This statement is only valid in a different position, for example "set" outside an event handler or a declaration inside a block.',
    fix: 'See the hint for where this statement belongs.',
  },
  PUI1027: {
    title: 'Declaration inside a block',
    description: 'Screens, components, styles and imports live at the top level of a file, not inside a screen or component.',
    fix: 'Move the declaration to the top level.',
  },
  PUI1024: {
    title: 'Missing block',
    description: 'A construct that requires an indented block is missing one.',
    fix: 'Indent the body of this construct.',
  },

  // ---------------------------------------------------------------- semantic
  PUI2001: {
    title: 'Unknown element',
    description: 'The element name is not a built-in widget, not a component in scope, and is lowercase, so it cannot be a host widget constructor either.',
    fix: 'Use a built-in widget, declare the component, or capitalise the name to call a host Dart widget.',
  },
  PUI2002: {
    title: 'Misplaced state declaration',
    description: 'State may only be declared at the top level of a screen or component, so that its lifetime is obvious.',
    fix: 'Move the state declaration to the top of the enclosing screen or component.',
  },
  PUI2003: {
    title: 'Duplicate name',
    description: 'Two declarations in the same scope use the same name, which makes references ambiguous.',
    fix: 'Rename one of them.',
  },
  PUI2004: {
    title: 'Children on an element that takes none',
    description: 'This element is a leaf: it renders content from its arguments and cannot contain children.',
    fix: 'Remove the nested block.',
  },
  PUI2005: {
    title: 'Unknown identifier',
    description: 'The identifier is not a state variable, a component parameter, a loop variable or an imported value, so the compiler cannot know what it refers to.',
    fix: 'Declare it with "state", pass it as a component parameter, or call a host function instead.',
  },
  PUI2006: {
    title: 'Duplicate declaration',
    description: 'A screen, component or style with this name is already declared in this file.',
    fix: 'Rename one of them.',
  },
  PUI2010: {
    title: 'Empty screen or component',
    description: 'A screen or component must render at least one element.',
    fix: 'Add at least one element to the body.',
  },
  PUI2011: {
    title: 'Name collides with a Flutter type',
    description: 'The generated file imports Flutter, so a screen, component or state variable with this name would shadow a Flutter type that the generated code needs.',
    fix: 'Rename it, for example PostsScreen instead of ListView.',
  },
  PUI2012: {
    title: 'Reserved word',
    description: 'This name is a PlainUI keyword or a Dart reserved word and cannot be used as an identifier.',
    fix: 'Choose a different name.',
  },

  // ---------------------------------------------------------------- element usage
  PUI2101: {
    title: 'Unsupported event',
    description: 'This element does not support that event.',
    fix: 'See the hint for the events this element supports.',
  },
  PUI2102: {
    title: 'Unknown property',
    description: 'The property is not defined for this element, or not defined at all.',
    fix: 'See the hint for a near match, or the widget reference in docs/07-reference.md.',
  },
  PUI2103: {
    title: 'Duplicate event handler',
    description: 'The same event is handled twice on one element, so one of the handlers would be silently dropped.',
    fix: 'Merge the two handler bodies into one.',
  },
  PUI2104: {
    title: 'Unknown state variable',
    description: 'The name is not a state variable of the enclosing screen or component.',
    fix: 'Declare it with "state <name>: <Type> = <value>".',
  },
  PUI2105: {
    title: 'Cannot assign to a component parameter',
    description: 'Component parameters are immutable; only state declared in the component can be assigned.',
    fix: 'Copy the parameter into state, or let the parent own the value.',
  },
  PUI2106: {
    title: 'bind together with on change',
    description: 'A bound element already writes to its state variable; adding an "on change" handler would write it twice.',
    fix: 'Use bind, or use on change with an explicit set — not both.',
  },
  PUI2107: {
    title: 'Missing required argument',
    description: 'A required positional argument or property is missing.',
    fix: 'Supply it, as shown in the hint.',
  },
  PUI2108: {
    title: 'Unknown argument',
    description: 'The element or component does not accept an argument with this name.',
    fix: 'See the hint for the arguments it accepts.',
  },
  PUI2109: {
    title: 'Too many arguments',
    description: 'More positional arguments were supplied than the element or component accepts.',
    fix: 'Remove the extra argument, or pass it by name.',
  },
  PUI2110: {
    title: 'Invalid property value',
    description: 'The property exists but the value has the wrong shape, for example text where a number is required.',
    fix: 'See the hint for the expected value.',
  },
  PUI2111: {
    title: 'Invalid enum value',
    description: 'The value is not one of the accepted names for this property.',
    fix: 'See the hint for the accepted values.',
  },

  // ---------------------------------------------------------------- components and styles
  PUI2112: {
    title: 'await outside an event handler',
    description: 'Only event handlers can be asynchronous; a widget tree is built synchronously.',
    fix: 'Move the await into an event handler, or start the work in state initialisation.',
  },
  PUI2113: {
    title: 'Statement does nothing',
    description: 'A statement in an event handler that is not a call has no effect.',
    fix: 'Call a host function, for example save().',
  },
  PUI2205: {
    title: 'slot outside a component',
    description: '"slot" marks where a component renders the children its caller passes; a screen has no caller.',
    fix: 'Move the slot into a component, or remove it.',
  },
  PUI2201: {
    title: 'Missing required parameter',
    description: 'This component parameter has no default and was not supplied at the call site.',
    fix: 'Pass the value at the call site, or give the parameter a default.',
  },
  PUI2203: {
    title: 'Children supplied to a component without a slot',
    description: 'The component has no "slot", so there is nowhere to render the children you supplied.',
    fix: 'Add a "slot" to the component body, or remove the nested block at the call site.',
  },
  PUI2204: {
    title: 'Slot without a children parameter',
    description: 'A component that uses "slot" must accept the children it renders.',
    fix: 'Add "children: List<Widget>" to the parameter list.',
  },
  PUI2301: {
    title: 'Unknown style property',
    description: 'A style block only accepts text properties.',
    fix: 'Use size, weight, color, family, letterSpacing, lineHeight or italic.',
  },
  PUI2302: {
    title: 'Unknown style',
    description: 'The style name is neither a built-in style nor declared in this file.',
    fix: 'Declare it with "style <name>:", or use one of the built-in names.',
  },

  // ---------------------------------------------------------------- warnings
  PUI2402: {
    title: 'Loop over a non-iterable',
    description: 'The value being iterated has a type that is not iterable, so the loop cannot run.',
    fix: 'Iterate over a list or another Iterable.',
  },
  PUI2403: {
    title: 'Multiple children in a single-child element',
    description: 'This element renders one child; extra children are wrapped in a column by the generator.',
    fix: 'Wrap the children in an explicit column so the layout is obvious.',
  },
  PUI2404: {
    title: 'Unused state',
    description: 'This state variable is declared but never read or written.',
    fix: 'Remove it, or use it.',
  },
  PUI2405: {
    title: 'Unused component parameter',
    description: 'This parameter is declared but never used in the component body.',
    fix: 'Remove it, or use it.',
  },
  PUI2406: {
    title: 'External host widget',
    description: 'The capitalised element is not a known component, so it is emitted as a host Dart constructor call.',
    fix: 'Make sure the constructor is imported and its arguments exist in Dart.',
  },
  PUI2407: {
    title: 'Anonymous use of a screen',
    description: 'A screen is an entry point and is normally used as a route, not nested inside another screen.',
    fix: 'Use a component for reusable pieces of UI.',
  },

  // ---------------------------------------------------------------- project / codegen
  PUI3001: {
    title: 'Import not found',
    description: 'A relative import points at a file that does not exist relative to this source file.',
    fix: 'Check the path. Relative imports are resolved from the .pui file’s directory.',
  },
  PUI3002: {
    title: 'Component not found in imported file',
    description: 'The imported PlainUI file does not declare a component with this name.',
    fix: 'Check the component name, or the import.',
  },
  PUI3003: {
    title: 'Write failed',
    description: 'The generated file could not be written.',
    fix: 'Check directory permissions.',
  },
  PUI3101: {
    title: 'Duplicate screen across the project',
    description: 'Two .pui files declare a screen or component with the same name, so the generated Dart classes would collide.',
    fix: 'Rename one of them.',
  },

  // ---------------------------------------------------------------- CLI
  PUI4001: {
    title: 'No sources found',
    description: 'The command did not find any .pui files at the given paths.',
    fix: 'Pass a directory containing .pui files, or a .pui file.',
  },
  PUI4002: {
    title: 'Invalid configuration',
    description: 'plainui.config.json could not be parsed or has an invalid setting.',
    fix: 'See docs/04-cli.md for the accepted keys.',
  },
  PUI4003: {
    title: 'Formatting required',
    description: '--check was passed and at least one file is not formatted.',
    fix: 'Run plainui format --write.',
  },
} as const satisfies Record<string, CodeInfo>;

export type DiagnosticCode = keyof typeof CODES;

export function codeInfo(code: string): CodeInfo | undefined {
  return (CODES as Record<string, CodeInfo>)[code];
}

export interface DiagnosticInit {
  readonly code: DiagnosticCode | string;
  readonly message: string;
  readonly span: Span;
  readonly hint?: string;
  readonly related?: readonly RelatedInfo[];
}

export class DiagnosticBag {
  readonly diagnostics: Diagnostic[] = [];
  private readonly seen = new Set<string>();
  /** File that spans in this bag belong to. */
  readonly file: SourceFile | undefined;

  constructor(file?: SourceFile) {
    this.file = file;
  }

  private add(severity: Severity, init: DiagnosticInit, file?: SourceFile): void {
    const key = `${init.code}:${init.span.start}:${init.span.end}:${init.message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const diagnostic: Diagnostic = {
      code: init.code,
      severity,
      message: init.message,
      span: init.span,
      ...(init.hint === undefined ? {} : { hint: init.hint }),
      ...(init.related === undefined ? {} : { related: init.related }),
      ...((file ?? this.file) === undefined ? {} : { file: file ?? this.file }),
    };
    this.diagnostics.push(diagnostic);
  }

  error(init: DiagnosticInit, file?: SourceFile): void {
    this.add('error', init, file);
  }

  warning(init: DiagnosticInit, file?: SourceFile): void {
    this.add('warning', init, file);
  }

  info(init: DiagnosticInit, file?: SourceFile): void {
    this.add('info', init, file);
  }

  get hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === 'error');
  }

  get errorCount(): number {
    return this.diagnostics.filter((d) => d.severity === 'error').length;
  }

  get warningCount(): number {
    return this.diagnostics.filter((d) => d.severity === 'warning').length;
  }

  sorted(): Diagnostic[] {
    return [...this.diagnostics].sort((a, b) => a.span.start - b.span.start || a.code.localeCompare(b.code));
  }

  merge(other: DiagnosticBag): void {
    for (const d of other.diagnostics) {
      const key = `${d.code}:${d.span.start}:${d.span.end}:${d.message}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.diagnostics.push(d);
    }
  }

  /** Copy with no attached file (validator sub-bags). */
  static fork(file: SourceFile): DiagnosticBag {
    return new DiagnosticBag(file);
  }
}

// --------------------------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------------------------

export interface RenderOptions {
  readonly color?: boolean;
  /** Show the `--> file:line:col` location line. Default true. */
  readonly location?: boolean;
}

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
} as const;

function paint(text: string, color: string | undefined, enabled: boolean): string {
  return enabled && color ? `${color}${text}${ANSI.reset}` : text;
}

function severityColor(severity: Severity): string {
  return severity === 'error' ? ANSI.red : severity === 'warning' ? ANSI.yellow : ANSI.blue;
}

export interface JsonDiagnostic {
  readonly file: string;
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly hint?: string;
  readonly start: Position;
  readonly end: Position;
  readonly related?: readonly { file?: string; message: string; start: Position; end: Position }[];
}

export function toJsonDiagnostic(d: Diagnostic, file: SourceFile): JsonDiagnostic {
  const target = d.file ?? file;
  return {
    file: target.path,
    code: d.code,
    severity: d.severity,
    message: d.message,
    ...(d.hint === undefined ? {} : { hint: d.hint }),
    start: positionAt(target, d.span.start),
    end: positionAt(target, d.span.end),
    ...(d.related === undefined
      ? {}
      : {
          related: d.related.map((r) => ({
            ...(r.file === undefined ? {} : { file: r.file.path }),
            message: r.message,
            start: positionAt(r.file ?? target, r.span.start),
            end: positionAt(r.file ?? target, r.span.end),
          })),
        }),
  };
}

/**
 * Render one diagnostic in the Elm/Rust idiom:
 *
 *   error[PUI2001]: unknown element `colum`
 *    --> lib/ui/home.pui:5:9
 *     |
 *   5 |         colum gap=8:
 *     |         ^^^^^
 *     |
 *     = hint: did you mean `column`?
 */
export function formatDiagnostic(d: Diagnostic, file: SourceFile, options: RenderOptions = {}): string {
  const color = options.color ?? false;
  const target = d.file ?? file;
  const start = positionAt(target, d.span.start);
  const end = positionAt(target, d.span.end);
  const lines: string[] = [];

  const severity = paint(d.severity, severityColor(d.severity), color);
  const code = paint(`[${d.code}]`, ANSI.dim, color);
  lines.push(`${paint(severity, ANSI.bold, color)}${code}: ${paint(d.message, ANSI.bold, color)}`);

  const showLocation = options.location ?? true;
  if (showLocation) {
    lines.push(` ${paint('-->', ANSI.dim, color)} ${target.path}:${start.line}:${start.col}`);
  }

  const startLine = start.line;
  const endLine = Math.min(end.line, startLine + 2);
  const gutter = String(endLine).length;
  const pad = ' '.repeat(gutter);
  const empty = `${pad} ${paint('|', ANSI.dim, color)}`;
  lines.push(empty);

  for (let line = startLine; line <= endLine; line++) {
    const text = lineText(target, line);
    lines.push(`${String(line).padStart(gutter)} ${paint('|', ANSI.dim, color)} ${text}`);
    const from = line === startLine ? start.col - 1 : 0;
    const to =
      line === end.line
        ? Math.max(from + 1, end.col - 1)
        : line === endLine
          ? text.length
          : Math.max(from + 1, text.length);
    const carets = '^'.repeat(Math.max(1, Math.min(to, Math.max(text.length, to)) - from) || 1);
    lines.push(`${pad} ${paint('|', ANSI.dim, color)} ${' '.repeat(from)}${paint(carets, severityColor(d.severity), color)}`);
  }
  if (end.line > endLine) {
    lines.push(`${pad} ${paint('|', ANSI.dim, color)} ${paint(`... ${end.line - endLine} more line(s)`, ANSI.dim, color)}`);
  }
  lines.push(empty);

  if (d.hint !== undefined) {
    lines.push(`  ${paint('=', ANSI.cyan, color)} ${paint('hint:', ANSI.cyan, color)} ${d.hint}`);
  }
  for (const related of d.related ?? []) {
    const relFile = related.file ?? target;
    const relPos = positionAt(relFile, related.span.start);
    lines.push(
      `  ${paint('=', ANSI.cyan, color)} ${paint('note:', ANSI.cyan, color)} ${related.message} (${relFile.path}:${relPos.line}:${relPos.col})`,
    );
  }

  return lines.join('\n');
}

export function summarize(diagnostics: readonly Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  if (errors === 0 && warnings === 0) return 'no problems';
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
}
