/**
 * Flutter/Dart code generator.
 *
 * Input: the `Analysis` produced by check.ts (which already resolved every element and inferred
 * every state type). Output: a single self-contained Dart library.
 *
 * Contract (docs/01-language-spec.md §7): ordinary Dart, no runtime package, deterministic
 * bytes, idiomatic Flutter structures, and diagnostics never reach this file — if the analysis
 * has errors, the caller must not generate.
 */

import {
  BOOL,
  DOUBLE,
  DYNAMIC,
  INT,
  NUM,
  STRING,
  type Action,
  type ComponentDecl,
  type Decl,
  type ElementNode,
  type EventHandler,
  type Expr,
  type ForNode,
  type IfNode,
  type Node,
  type Param,
  type Program,
  type Prop,
  type ScreenDecl,
  type SetAction,
  type StateDecl,
  type StyleDecl,
  type UiType,
  isNumericType,
  isStringType,
  rootIdentifiers,
  walkExpr,
  walkNodes,
  typeToText,
  walkExpressions,
} from '../frontend/ast.ts';
import { isSubmitCall, type Analysis } from '../analysis/check.ts';
import { VALUE_PARAM_NAME, eventValueType } from '../analysis/events.ts';
import { type SourceFile, positionAt } from '../frontend/source.ts';
import { BUILTIN_STYLES } from '../analysis/targets.ts';
import type { TaskDecl, ThemeDecl, TokenDecl } from '../frontend/ast.ts';
import type { WidgetSpec } from '../analysis/widgets/registry.ts';
import {
  arg,
  capitalize,
  dartCall,
  indentAll,
  indentCode,
  listArgument,
  paren,
  sanitizeName,
} from './dart.ts';

export interface FlutterGenOptions {
  readonly compilerVersion: string;
  /** Path of the `.pui` source (for the banner and source markers). */
  readonly sourcePath: string;
  /** Map a `.pui` import path to the Dart import specifier of its generated file. */
  readonly resolvePlainuiImport?: (path: string) => string;
  /** Re-base a relative host import so it stays valid from the generated file. */
  readonly rebaseImport?: (path: string) => string;
}

export interface GeneratedDart {
  readonly code: string;
  readonly imports: readonly string[];
}

const MAIN_AXIS: Record<string, string> = {
  start: 'MainAxisAlignment.start',
  end: 'MainAxisAlignment.end',
  center: 'MainAxisAlignment.center',
  between: 'MainAxisAlignment.spaceBetween',
  around: 'MainAxisAlignment.spaceAround',
  evenly: 'MainAxisAlignment.spaceEvenly',
};

const CROSS_AXIS: Record<string, string> = {
  start: 'CrossAxisAlignment.start',
  end: 'CrossAxisAlignment.end',
  center: 'CrossAxisAlignment.center',
  stretch: 'CrossAxisAlignment.stretch',
  baseline: 'CrossAxisAlignment.baseline',
};

const WRAP_ALIGN: Record<string, string> = {
  start: 'WrapAlignment.start',
  end: 'WrapAlignment.end',
  center: 'WrapAlignment.center',
  between: 'WrapAlignment.spaceBetween',
  around: 'WrapAlignment.spaceAround',
  evenly: 'WrapAlignment.spaceEvenly',
};

const ALIGNMENT: Record<string, string> = {
  topLeft: 'Alignment.topLeft',
  topCenter: 'Alignment.topCenter',
  topRight: 'Alignment.topRight',
  centerLeft: 'Alignment.centerLeft',
  center: 'Alignment.center',
  centerRight: 'Alignment.centerRight',
  bottomLeft: 'Alignment.bottomLeft',
  bottomCenter: 'Alignment.bottomCenter',
  bottomRight: 'Alignment.bottomRight',
};

const TEXT_ALIGN: Record<string, string> = {
  start: 'TextAlign.start',
  end: 'TextAlign.end',
  center: 'TextAlign.center',
  justify: 'TextAlign.justify',
};

const FONT_WEIGHT: Record<string, string> = {
  thin: 'FontWeight.w100',
  light: 'FontWeight.w300',
  regular: 'FontWeight.w400',
  medium: 'FontWeight.w500',
  semiBold: 'FontWeight.w600',
  bold: 'FontWeight.w700',
  black: 'FontWeight.w900',
};

const OVERFLOW: Record<string, string> = {
  clip: 'TextOverflow.clip',
  fade: 'TextOverflow.fade',
  ellipsis: 'TextOverflow.ellipsis',
  visible: 'TextOverflow.visible',
};

const FIT: Record<string, string> = {
  contain: 'BoxFit.contain',
  cover: 'BoxFit.cover',
  fill: 'BoxFit.fill',
  fitWidth: 'BoxFit.fitWidth',
  fitHeight: 'BoxFit.fitHeight',
  none: 'BoxFit.none',
  scaleDown: 'BoxFit.scaleDown',
};

const KEYBOARD: Record<string, string> = {
  text: 'TextInputType.text',
  email: 'TextInputType.emailAddress',
  number: 'TextInputType.number',
  phone: 'TextInputType.phone',
  url: 'TextInputType.url',
  multiline: 'TextInputType.multiline',
};

/**
 * Friendly icon names that Material does not spell the same way. PlainUI's vocabulary is meant to
 * be guessable, and `heart` is guessable where `favorite` is not. Anything not listed here is a
 * Material name already (`search`, `menu`, `settings`), so it passes through untouched.
 */
const ICON_ALIASES: Readonly<Record<string, string>> = {
  heart: 'favorite',
  trash: 'delete',
  pencil: 'edit',
  plus: 'add',
  minus: 'remove',
  user: 'person',
  users: 'people',
  bell: 'notifications',
  mail: 'email',
  clock: 'schedule',
  camera: 'photo_camera',
  eye: 'visibility',
  play: 'play_arrow',
  more: 'more_horiz',
  back: 'arrow_back',
  forward: 'arrow_forward',
  info: 'info_outline',
  warning: 'warning_amber',
  error: 'error_outline',
  help: 'help_outline',
  refresh: 'refresh',
  send: 'send',
  share: 'share',
  lock: 'lock',
};

/** The Dart expression for an icon name, honouring the aliases above. */
export function iconName(name: string): string {
  return ICON_ALIASES[name] ?? name;
}

const AXIS: Record<string, string> = { vertical: 'Axis.vertical', horizontal: 'Axis.horizontal' };

const STACK_FIT: Record<string, string> = { loose: 'StackFit.loose', expand: 'StackFit.expand' };

/** Theme text styles used by the built-in style names. */
const THEME_STYLES: Record<string, { style: string; extra?: string }> = {
  display: { style: 'displaySmall' },
  heading: { style: 'headlineSmall' },
  subheading: { style: 'titleMedium' },
  body: { style: 'bodyMedium' },
  caption: { style: 'bodySmall' },
  label: { style: 'labelLarge' },
  secondary: { style: 'bodyMedium', extra: 'color: Theme.of(context).colorScheme.onSurfaceVariant' },
};

interface ScopeEntry {
  readonly emittedName: string;
  readonly type: UiType;
}

export function generateFlutter(analysis: Analysis, file: SourceFile, options: FlutterGenOptions): GeneratedDart {
  const generator = new FlutterGenerator(analysis, file, options);
  return generator.generate();
}

class FlutterGenerator {
  private readonly analysis: Analysis;
  private readonly file: SourceFile;
  private readonly options: FlutterGenOptions;

  private scope = new Map<string, ScopeEntry>();
  private uid = 0;

  /** Controllers needed by the declaration currently being emitted. */
  private controllers = new Map<string, string>();
  /** `GlobalKey<FormState>` fields needed by the declaration currently being emitted. */
  private formKeys: string[] = [];
  /** Forms enclosing the handler currently being emitted, innermost last. */
  private formStack: { readonly key: string; readonly actions: readonly Action[] }[] = [];
  /** Whether any generated validator uses the email pattern, which is emitted once per file. */
  private usesEmailPattern = false;
  private readonly styleIds = new Map<string, string>();
  private readonly usedStyles = new Set<string>();

  constructor(analysis: Analysis, file: SourceFile, options: FlutterGenOptions) {
    this.analysis = analysis;
    this.file = file;
    this.options = options;
    for (const [name] of analysis.styles) {
      this.styleIds.set(name, `_puiStyle${capitalize(sanitizeName(name))}`);
    }
  }

  generate(): GeneratedDart {
    const sections: string[] = [];

    // Declaration sections are built first so that only the styles actually referenced are
    // emitted (an unused private const would be an `unused_element` warning in Dart).
    const declSections: string[] = [];
    for (const decl of this.analysis.program.decls) {
      if (decl.kind === 'Style' || decl.kind === 'Theme') continue;
      declSections.push(this.emitDecl(decl));
    }

    const themeSection = this.emitTheme();
    if (themeSection.length > 0) sections.push(themeSection);
    if (this.usesEmailPattern) {
      sections.push(
        '/// The email check used by generated form validators.\n' +
          "final RegExp _puiEmailPattern = RegExp(r'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$');",
      );
    }
    const styleSection = this.emitStyles();
    if (styleSection.length > 0) sections.push(styleSection);
    sections.push(...declSections);

    const entries = this.importEntries();
    const imports = [...new Set(entries.map((entry) => entry.spec))];
    const banner = [
      '// GENERATED FILE - DO NOT EDIT.',
      '//',
      `// Generated by PlainUI ${this.options.compilerVersion} from ${this.options.sourcePath}.`,
      '// Target: Flutter 3.10+ / Dart 3. No deprecated APIs are emitted.',
      '// Any change made here is overwritten the next time `plainui build` runs.',
      '// Edit the .pui source instead.',
      '//',
      '// ignore_for_file: type=lint, unused_import',
      '',
      ...entries.map((entry) => `import '${entry.spec}'${entry.alias === undefined ? '' : ` as ${entry.alias}`};`),
      '',
    ].join('\n');

    return { code: `${banner}\n${sections.join('\n\n')}\n`, imports };
  }

  // ------------------------------------------------------------------------------------------
  // Design tokens
  // ------------------------------------------------------------------------------------------

  /**
   * `theme App:` becomes two classes:
   *
   *   - `AppTokens` — every token as a `static const`, so host code can reach the palette without
   *     copying hex strings around;
   *   - `AppTheme` — that palette applied to Flutter's own widgets, so `ElevatedButton` and friends
   *     match the design instead of Material's defaults.
   *
   * Use sites are still inlined as literals (`padding=md` → `16`), which keeps generated trees
   * `const` and makes the same source produce the same values in every target.
   */
  private emitTheme(): string {
    const theme = this.analysis.theme;
    if (theme === undefined) return '';
    const base = sanitizeName(theme.name);

    const fields: string[] = [];
    for (const token of theme.tokens) {
      const field = sanitizeName(token.name);
      const comment = `  /// \`${token.categoryText} ${token.name}\``;
      const declaration =
        token.category === 'color'
          ? `  static const Color ${field} = ${this.color(token.value)};`
          : `  static const double ${field} = ${this.num(token.value)};`;
      fields.push(`${comment}\n${declaration}`);
    }
    if (fields.length === 0) return '';

    const parts = [
      `/// Design tokens from \`theme ${theme.name}\` — generated, do not edit.\nabstract final class ${base}Tokens {\n${fields.join('\n\n')}\n}`,
    ];

    const scheme = this.themeColorScheme(theme, base);
    if (scheme !== undefined) {
      parts.push(
        [
          `/// The palette above, applied to Flutter's own widgets.`,
          `///`,
          `///     MaterialApp(theme: ${base}Theme.light, home: ...)`,
          `abstract final class ${base}Theme {`,
          `  static ColorScheme get colorScheme => ${scheme};`,
          ``,
          `  static ThemeData get light => ThemeData(colorScheme: colorScheme);`,
          `}`,
        ].join('\n'),
      );
    }

    return parts.join('\n\n');
  }

  /**
   * Material names its scheme slots after the role, a design system names its tokens after the
   * brand. The mapping is a small, documented convention rather than a guess about semantics:
   * `brand`/`primary` fills `primary`, `surface`/`background` fills `surface`, and so on. When no
   * token matches, the first colour seeds the scheme.
   */
  private themeColorScheme(theme: ThemeDecl, base: string): string | undefined {
    const colors = theme.tokens.filter((token) => token.category === 'color');
    if (colors.length === 0) return undefined;
    const pick = (...names: readonly string[]): TokenDecl | undefined =>
      colors.find((token) => names.includes(token.name));
    const args: string[] = [];
    const slot = (slotName: string, ...names: readonly string[]): void => {
      const token = pick(...names);
      if (token !== undefined) args.push(`${slotName}: ${base}Tokens.${sanitizeName(token.name)}`);
    };
    slot('primary', 'brand', 'primary');
    slot('surface', 'surface', 'background');
    slot('onSurface', 'ink', 'text', 'onSurface');
    slot('error', 'danger', 'error');
    if (args.length === 0) {
      args.push(`seedColor: ${base}Tokens.${sanitizeName(colors[0]!.name)}`);
    }
    return `ColorScheme.light(${args.join(', ')})`;
  }

  /** A token used where a value belongs (`padding=md`, `color=brand`), or nothing. */
  private tokenOf(expr: Expr): TokenDecl | undefined {
    if (expr.kind !== 'Ident' || this.scope.has(expr.name)) return undefined;
    return this.analysis.tokens.get(expr.name);
  }

  // ------------------------------------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------------------------------------

  private emitStyles(): string {
    const lines: string[] = [];
    for (const [name, decl] of this.analysis.styles) {
      if (!this.usedStyles.has(name)) continue;
      const id = this.styleIds.get(name)!;
      const args = this.textStyleArgsForStyleDecl(decl);
      lines.push(`const TextStyle ${id} = ${dartCall('TextStyle', args)};`);
    }
    return lines.join('\n');
  }

  private textStyleArgsForStyleDecl(decl: StyleDecl): string[] {
    const args: string[] = [];
    for (const prop of decl.props) {
      const code = this.styleArg(prop.name, prop.value);
      if (code !== undefined) args.push(code);
    }
    return args;
  }

  private styleArg(name: string, value: Expr): string | undefined {
    switch (name) {
      case 'size':
        return `fontSize: ${this.num(value)}`;
      case 'weight':
        return `fontWeight: ${this.enumOf(value, FONT_WEIGHT, 'FontWeight.w400')}`;
      case 'color':
        return `color: ${this.color(value)}`;
      case 'fontFamily':
        return `fontFamily: ${this.str(value)}`;
      case 'letterSpacing':
        return `letterSpacing: ${this.num(value)}`;
      case 'lineHeight':
        return `height: ${this.num(value)}`;
      case 'italic': {
        const flag = this.boolOf(value) ?? 'true';
        return `fontStyle: (${flag}) ? FontStyle.italic : FontStyle.normal`;
      }
      default:
        return undefined;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Declarations
  // ------------------------------------------------------------------------------------------

  private emitDecl(decl: ScreenDecl | ComponentDecl): string {
    const savedScope = this.scope;
    const savedControllers = this.controllers;
    this.scope = new Map();
    this.controllers = new Map();

    this.declName = decl.name;
    const isComponent = decl.kind === 'Component';
    // A form owns a `GlobalKey<FormState>`, which is state: a screen that contains one is built as a
    // StatefulWidget even when it declares no `state` of its own.
    const hasState = decl.state.length > 0 || decl.tasks.length > 0 || containsForm(decl);
    const stateClassName = `_${decl.name}State`;

    // Parameters are fields on the widget; inside a State they are reached through `widget.`.
    // A screen with parameters is a destination: `navigate Detail(id: x)` constructs it with named
    // arguments, so the constructor is the same shape a component's is.
    for (const param of decl.params) {
      const type = this.analysis.paramTypes.get(decl.name)?.get(param.name) ?? DYNAMIC;
      this.scope.set(param.name, { emittedName: hasState ? `widget.${param.name}` : param.name, type });
    }
    for (const state of decl.state) {
      const type = this.analysis.stateTypes.get(decl.name)?.get(state.name) ?? DYNAMIC;
      this.scope.set(state.name, { emittedName: state.name, type });
    }
    for (const task of decl.tasks) {
      const value = this.analysis.taskTypes.get(decl.name)?.get(task.name) ?? DYNAMIC;
      this.scope.set(task.name, { emittedName: this.taskField(task.name, 'value'), type: { kind: 'task', value } });
    }
    for (const item of decl.derived) {
      const type = this.analysis.derivedTypes.get(decl.name)?.get(item.name) ?? DYNAMIC;
      this.scope.set(item.name, { emittedName: item.name, type });
    }

    // Build the tree first: emitting it records controller and form-key requirements.
    const body = this.emitBody(decl.body);
    const controllers = [...this.controllers.entries()];
    const formKeys = [...this.formKeys];

    const sourceLine = positionAt(this.file, decl.span.start).line;
    const marker = `// ${decl.kind.toLowerCase()} ${decl.name} — ${this.options.sourcePath}:${sourceLine}`;

    const classLines: string[] = [marker];
    if (hasState) {
      classLines.push(...this.widgetClassWithState(decl, stateClassName));
      classLines.push('');
      classLines.push(...this.stateClass(decl, stateClassName, controllers, formKeys, body));
    } else {
      classLines.push(...this.statelessClass(decl, body));
    }

    this.scope = savedScope;
    this.controllers = savedControllers;
    this.formKeys = [];
    this.formStack = [];
    return classLines.join('\n');
  }

  private constructorParams(decl: ScreenDecl | ComponentDecl): string[] {
    const params: string[] = ['super.key'];
    for (const param of decl.params) {
      const hasDefault = param.defaultValue !== undefined;
      if (!hasDefault) params.push(`required this.${param.name}`);
      else if (isConstExpr(param.defaultValue)) params.push(`this.${param.name} = ${this.expr(param.defaultValue)}`);
      else params.push(`this.${param.name}`);
    }
    return params;
  }

  /** A constructor can be const when no default value needs to be computed. */
  private canBeConst(decl: ScreenDecl | ComponentDecl): boolean {
    return decl.params.every((param) => param.defaultValue === undefined || isConstExpr(param.defaultValue));
  }

  private fields(decl: ScreenDecl | ComponentDecl): string[] {
    return decl.params.map((param) => {
      const type = param.typeText ?? 'dynamic';
      const needsInitializer = param.defaultValue !== undefined && !isConstExpr(param.defaultValue);
      return needsInitializer
        ? `final ${type} ${param.name} = ${this.expr(param.defaultValue!)};`
        : `final ${type} ${param.name};`;
    });
  }

  private statelessClass(decl: ScreenDecl | ComponentDecl, body: string): string[] {
    const lines: string[] = [];
    const params = this.constructorParams(decl);
    const constKw = this.canBeConst(decl) ? 'const ' : '';
    lines.push(`class ${decl.name} extends StatelessWidget {`);
    lines.push(`  ${constKw}${decl.name}({${params.join(', ')}});`);
    if (decl.params.length > 0) {
      lines.push('');
      for (const field of this.fields(decl)) lines.push(`  ${field}`);
    }
    lines.push(...this.derivedGetters(decl));
    lines.push('');
    lines.push('  @override');
    lines.push('  Widget build(BuildContext context) {');
    lines.push(`    return ${indentCode(body, 4)};`);
    lines.push('  }');
    lines.push('}');
    return lines;
  }

  private widgetClassWithState(decl: ScreenDecl | ComponentDecl, stateClassName: string): string[] {
    const lines: string[] = [];
    const params = this.constructorParams(decl);
    const constKw = this.canBeConst(decl) ? 'const ' : '';
    lines.push(`class ${decl.name} extends StatefulWidget {`);
    lines.push(`  ${constKw}${decl.name}({${params.join(', ')}});`);
    if (decl.params.length > 0) {
      lines.push('');
      for (const field of this.fields(decl)) lines.push(`  ${field}`);
    }
    lines.push('');
    lines.push('  @override');
    lines.push(`  State<${decl.name}> createState() => ${stateClassName}();`);
    lines.push('}');
    return lines;
  }

  private stateClass(
    decl: ScreenDecl | ComponentDecl,
    stateClassName: string,
    controllers: readonly (readonly [string, string])[],
    formKeys: readonly string[],
    body: string,
  ): string[] {
    const lines: string[] = [];
    lines.push(`class ${stateClassName} extends State<${decl.name}> {`);

    for (const state of decl.state) {
      lines.push(`  ${this.stateField(state)}`);
    }
    for (const field of this.effectFields(decl)) lines.push(field);
    for (const field of this.taskFields(decl)) lines.push(field);
    for (const [stateName, controllerName] of controllers) {
      lines.push(`  late final TextEditingController ${controllerName} = TextEditingController(text: ${stateName});`);
    }
    for (const key of formKeys) {
      lines.push(`  /// The validation state of one form in this screen.\n  final GlobalKey<FormState> ${key} = GlobalKey<FormState>();`);
    }
    lines.push(...this.derivedGetters(decl));
    lines.push('');

    if (decl.tasks.length > 0) {
      // Tasks start when the screen does. This is the whole point of the construct: nobody has to
      // remember to kick off the load, and nobody can forget to handle its failure.
      lines.push('  @override');
      lines.push('  void initState() {');
      lines.push('    super.initState();');
      if (controllers.length > 0) lines.push('    _syncControllers();');
      for (const task of decl.tasks) lines.push(`    ${this.taskLoader(task.name)}();`);
      lines.push('  }');
      lines.push('');
    }

    if (controllers.length > 0) {
      lines.push('  @override');
      lines.push('  void dispose() {');
      for (const [, controllerName] of controllers) lines.push(`    ${controllerName}.dispose();`);
      lines.push('    super.dispose();');
      lines.push('  }');
      lines.push('');
      lines.push('  void _syncControllers() {');
      for (const [stateName, controllerName] of controllers) {
        lines.push(`    if (${controllerName}.text != ${stateName}) {`);
        lines.push(`      ${controllerName}.text = ${stateName};`);
        lines.push('    }');
      }
      lines.push('  }');
      lines.push('');
    }

    for (const task of decl.tasks) {
      lines.push(...this.taskLoaderMethod(task));
      lines.push('');
    }

    for (const effect of this.effectMethods(decl)) {
      lines.push(...effect);
      lines.push('');
    }

    lines.push('  @override');
    lines.push('  Widget build(BuildContext context) {');
    if (controllers.length > 0) lines.push('    _syncControllers();');
    lines.push(...this.effectScheduling(decl));
    lines.push(`    return ${indentCode(body, 4)};`);
    lines.push('  }');
    lines.push('}');
    return lines;
  }

  /**
   * `derived` compiles to a getter, so the value is computed when it is read and stored nowhere.
   *
   * A stored field would have to be recomputed at exactly the right moments — every write to every
   * value it reads — which is the bug this construct exists to remove. A getter cannot be stale,
   * because there is nothing to go stale. The cost is one computation per read, which is the trade
   * `docs/10-decisions.md` B1 records, and the reason memoisation is a later, per-target step.
   */
  private derivedGetters(decl: ScreenDecl | ComponentDecl): string[] {
    const lines: string[] = [];
    if (decl.derived.length === 0) return lines;
    for (const item of decl.derived) {
      const type = item.typeText ?? typeToText(this.analysis.derivedTypes.get(decl.name)?.get(item.name) ?? DYNAMIC);
      lines.push('');
      lines.push(`  /// \`derived ${item.name}\` — computed on every read, never stored.`);
      lines.push(`  ${type} get ${item.name} => ${this.expr(item.init)};`);
    }
    return lines;
  }

  // ------------------------------------------------------------------------------------------
  // Effects
  // ------------------------------------------------------------------------------------------

  /** `_puiEffect0` — the method name for the nth effect of a declaration. */
  private effectMethod(index: number): string {
    return `_puiEffect${index}`;
  }

  /** `_puiEffect0Count` — the value `count` had the last time effect 0 ran. */
  private effectSnapshot(index: number, stateName: string): string {
    return `_puiEffect${index}${stateName.charAt(0).toUpperCase()}${sanitizeName(stateName).slice(1)}`;
  }

  /**
   * One nullable field per watched state, holding the value the effect saw last time.
   *
   * Nullable so the first build counts as a change: `useEffect` and `LaunchedEffect` both run on
   * mount, and an effect that only ran on *later* changes would be a different construct. The
   * comparison happens in `build`, because a `setState` on local state never reaches
   * `didUpdateWidget` — that is the hook for a new *widget*, not for new state.
   */
  private effectFields(decl: ScreenDecl | ComponentDecl): string[] {
    const lines: string[] = decl.effects.length === 0 ? [] : [''];
    for (const [index, effect] of decl.effects.entries()) {
      for (const watch of effect.watches) {
        const type = this.stateTypeText(decl, watch.name);
        if (lines.length > 1) lines.push('');
        lines.push(`  /// \`${watch.name}\` as effect ${index} last saw it; null means it has not run yet.`);
        lines.push(`  ${type}? ${this.effectSnapshot(index, watch.name)};`);
      }
    }
    return lines;
  }

  /** The declared or inferred type of a state, as Dart text. */
  private stateTypeText(decl: ScreenDecl | ComponentDecl, name: string): string {
    const state = decl.state.find((item) => item.name === name);
    if (state?.typeText !== undefined) return state.typeText;
    const inferred = this.analysis.stateTypes.get(decl.name)?.get(name);
    return inferred === undefined ? 'dynamic' : typeToText(inferred);
  }

  private effectMethods(decl: ScreenDecl | ComponentDecl): string[][] {
    const methods: string[][] = [];
    for (const [index, effect] of decl.effects.entries()) {
      const names = effect.watches.map((watch) => watch.name).join(', ');
      const isAsync = actionsContainAwait(effect.body);
      const lines: string[] = [];
      lines.push(`  /// \`effect on ${names}\` — runs on mount and whenever ${names} changes, never otherwise.`);
      lines.push(`  void ${this.effectMethod(index)}()${isAsync ? ' async' : ''} {`);
      for (const line of this.emitActions(effect.body)) lines.push(indentAll(line, 4));
      lines.push('  }');
      methods.push(lines);
    }
    return methods;
  }

  /**
   * The statements that decide whether an effect is due, written at the top of `build`.
   *
   * The check is a comparison against the snapshot, not a flag set by the setter: state can change
   * from a handler, a controller, a task that finished or a form submit, and a comparison covers
   * all of them. The body runs in a post-frame callback, so it never mutates state while the tree is
   * being built, and `mounted` guards the case where the screen is gone by then.
   */
  private effectScheduling(decl: ScreenDecl | ComponentDecl): string[] {
    const lines: string[] = [];
    for (const [index, effect] of decl.effects.entries()) {
      const conditions = effect.watches.map(
        (watch) => `${this.effectSnapshot(index, watch.name)} != ${this.expr({ kind: 'Ident', name: watch.name, span: watch.span })}`,
      );
      const due = conditions.length === 0 ? 'false' : conditions.join(' || ');
      lines.push(`    final puiEffect${index}Due = ${due};`);
      for (const watch of effect.watches) {
        const field = this.effectSnapshot(index, watch.name);
        lines.push(`    ${field} = ${this.expr({ kind: 'Ident', name: watch.name, span: watch.span })};`);
      }
      lines.push(`    if (puiEffect${index}Due) {`);
      lines.push('      WidgetsBinding.instance.addPostFrameCallback((_) {');
      lines.push(`        if (mounted) ${this.effectMethod(index)}();`);
      lines.push('      });');
      lines.push('    }');
    }
    return lines;
  }

  // ------------------------------------------------------------------------------------------
  // Tasks
  // ------------------------------------------------------------------------------------------

  /** The three fields a task owns, plus its loader. Names are private to the generated State. */
  private taskField(name: string, part: 'value' | 'error' | 'loading'): string {
    const base = `_${sanitizeName(name)}`;
    if (part === 'value') return base;
    return `${base}${part === 'error' ? 'Error' : 'Loading'}`;
  }

  private taskLoader(name: string): string {
    return `_load${capitalize(sanitizeName(name))}`;
  }

  /** The sequence number of a task's current attempt: the newest load wins. */
  private taskRequestField(name: string): string {
    return `_${sanitizeName(name)}Request`;
  }

  /** The declarations of every task: value, error and loading flag. */
  private taskFields(decl: ScreenDecl | ComponentDecl): string[] {
    const lines: string[] = [];
    for (const task of decl.tasks) {
      const value = this.analysis.taskTypes.get(decl.name)?.get(task.name) ?? DYNAMIC;
      const valueText = task.typeText ?? typeToText(value);
      lines.push(`  ${valueText}? ${this.taskField(task.name, 'value')};`);
      lines.push(`  String? ${this.taskField(task.name, 'error')};`);
      lines.push(`  bool ${this.taskField(task.name, 'loading')} = true;`);
      lines.push(`  int ${this.taskRequestField(task.name)} = 0;`);
    }
    return lines;
  }

  /**
   * The loader for one task. Four details matter more than they look:
   *
   *   - the flag and the error are reset on every run, so a retry shows loading rather than the
   *     previous failure;
   *   - `mounted` is checked after the await, because a screen can be popped while a load is in
   *     flight and `setState` after that throws;
   *   - each run takes a sequence number, and a result whose number is no longer the current one is
   *     dropped. Without it the most natural user action — retrying a slow load — lets the slow
   *     result overwrite the fresh one, intermittently, which is the worst kind of bug;
   *   - the error is captured as text, so the tree can render it without a nullable-object dance.
   */
  private taskLoaderMethod(task: TaskDecl): string[] {
    const field = (part: 'value' | 'error' | 'loading'): string => this.taskField(task.name, part);
    const lines: string[] = [];
    const request = this.taskRequestField(task.name);
    lines.push(`  Future<void> ${this.taskLoader(task.name)}() async {`);
    lines.push(`    final request = ++${request};`);
    lines.push('    setState(() {');
    lines.push(`      ${field('loading')} = true;`);
    lines.push(`      ${field('error')} = null;`);
    lines.push('    });');
    lines.push('    try {');
    lines.push(`      final result = await ${this.expr(task.init)};`);
    lines.push(`      if (!mounted || request != ${request}) return;`);
    lines.push('      setState(() {');
    lines.push(`        ${field('value')} = result;`);
    lines.push(`        ${field('loading')} = false;`);
    lines.push('      });');
    lines.push('    } catch (error) {');
    lines.push(`      if (!mounted || request != ${request}) return;`);
    lines.push('      setState(() {');
    lines.push(`        ${field('error')} = error.toString();`);
    lines.push(`        ${field('loading')} = false;`);
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
    return lines;
  }

  /** A task member used as a value: `items.loading`, `items.error`, `items.value`, `items.retry`. */
  private taskMember(expr: Extract<Expr, { kind: 'Member' }>): string | undefined {
    if (expr.object.kind !== 'Ident') return undefined;
    const entry = this.scope.get(expr.object.name);
    if (entry === undefined || entry.type.kind !== 'task') return undefined;
    switch (expr.name) {
      case 'value': {
        // A list-valued task reads as an empty list until its load completes, so `items.value` can
        // be iterated and asked `.isEmpty` without a null dance in every screen. Other value types
        // stay nullable, and `items.value != null` is the gate for those.
        const field = this.taskField(expr.object.name, 'value');
        const value = entry.type.value;
        if (value.kind === 'list') return `(${field} ?? const <${typeToText(value.element)}>[])`;
        return field;
      }
      case 'error':
        return this.taskField(expr.object.name, 'error');
      case 'loading':
        return this.taskField(expr.object.name, 'loading');
      case 'retry':
        return this.taskLoader(expr.object.name);
      default:
        return undefined;
    }
  }

  private stateField(state: StateDecl): string {
    const type = this.analysis.stateTypes.get(this.currentDeclName())?.get(state.name) ?? DYNAMIC;
    const typeText = state.typeText ?? typeToText(type);
    return `${typeText} ${state.name} = ${this.expr(state.init)};`;
  }

  private currentDeclName(): string {
    // The state map is per declaration; `emitDecl` sets the scope, and state types are looked up
    // by name in `stateField` through this helper's caller.
    return this.declName;
  }

  private declName = '';

  // ------------------------------------------------------------------------------------------
  // Bodies
  // ------------------------------------------------------------------------------------------

  private emitBody(nodes: readonly Node[]): string {
    if (nodes.length === 0) return 'const SizedBox.shrink()';
    const items = this.emitNodes(nodes);
    if (items.length === 1) return items[0]!;
    return dartCall('Column', [], { key: 'children', items });
  }

  private emitNodes(nodes: readonly Node[]): string[] {
    const items: string[] = [];
    for (const node of nodes) {
      switch (node.kind) {
        case 'Element':
          items.push(this.emitElement(node));
          break;
        case 'If':
          items.push(this.emitIfItem(node));
          break;
        case 'For':
          items.push(this.emitForItem(node));
          break;
        case 'Slot':
          items.push('...children');
          break;
        default:
          break;
      }
    }
    return items;
  }

  private emitIfItem(node: IfNode): string {
    const lines: string[] = [];
    node.branches.forEach((branch, index) => {
      const keyword = index === 0 ? 'if' : 'else if';
      lines.push(`${keyword} (${this.expr(branch.cond)})`);
      lines.push(indentAll(this.emitBodySingle(branch.body), 2));
    });
    if (node.elseBody !== undefined) {
      lines.push('else');
      lines.push(indentAll(this.emitBodySingle(node.elseBody), 2));
    }
    return lines.join('\n');
  }

  private emitForItem(node: ForNode): string {
    const raw = this.expr(node.iterable);
    // `items.value` is nullable until the task finishes, so iterate it defensively rather than
    // emitting a loop over `List<T>?`, which does not compile. The element type keeps the loop
    // variable typed, so `text item` still knows it is showing a String.
    const iterableType = this.typeOf(node.iterable);
    const iterable =
      iterableType.kind === 'nullable'
        ? `(${raw} ?? const <${iterableType.inner.kind === 'list' ? typeToText(iterableType.inner.element) : 'dynamic'}>[])`
        : raw;
    const types = this.analysis.loopTypes.get(node);
    const savedScope = this.scope;
    this.scope = new Map(savedScope);
    const indexUnused = node.indexName !== undefined && !nameUsedInBody(node.indexName, node.body);
    const itemUnused = !nameUsedInBody(node.itemName, node.body);
    const itemBinding = itemUnused ? '_' : node.itemName;
    const header =
      node.indexName === undefined
        ? `for (final ${itemBinding} in ${iterable})`
        : `for (final (${indexUnused ? '_' : node.indexName}, ${itemBinding}) in ${paren(iterable)}.indexed)`;
    if (node.indexName !== undefined && !indexUnused) {
      this.scope.set(node.indexName, { emittedName: node.indexName, type: types?.get(node.indexName) ?? INT });
    }
    this.scope.set(node.itemName, { emittedName: node.itemName, type: types?.get(node.itemName) ?? DYNAMIC });
    const key = node.key === undefined ? undefined : this.expr(node.key);
    const emitted = this.emitBodySingle(node.body);
    // A key wraps the row rather than decorating whatever widget happens to be first inside it, so
    // `for … key=item.id:` works the same whether the row is one element or five.
    const body = key === undefined ? emitted : dartCall('KeyedSubtree', [`key: ValueKey(${key})`, `child: ${emitted}`]);
    this.scope = savedScope;
    return `${header}\n${indentAll(body, 2)}`;
  }

  /** A branch of a collection-if/for must be exactly one element. */
  private emitBodySingle(nodes: readonly Node[]): string {
    const items = this.emitNodes(nodes);
    if (items.length === 0) return 'const SizedBox.shrink()';
    if (items.length === 1) return items[0]!;
    return dartCall('Column', ['crossAxisAlignment: CrossAxisAlignment.start'], { key: 'children', items });
  }

  // ------------------------------------------------------------------------------------------
  // Elements
  // ------------------------------------------------------------------------------------------

  private emitElement(el: ElementNode): string {
    const resolved = this.analysis.resolvedTags.get(el);
    if (resolved === undefined) return 'const SizedBox.shrink()';

    if (resolved.kind === 'builtin') {
      const base = this.emitBuiltin(el, resolved.spec);
      return this.applyDecorators(el, base, new Set(resolved.spec.props.map((prop) => prop.name)), resolved.spec);
    }
    if (resolved.kind === 'component') {
      const call = this.emitComponentCall(el, resolved.decl);
      return this.applyDecorators(el, call, new Set());
    }
    const call = this.emitHostCall(el);
    return this.wrapGestures(el, undefined)(call);
  }

  private emitBuiltin(el: ElementNode, spec: WidgetSpec): string {
    switch (spec.tag) {
      case 'column':
        return this.emitColumn(el, 'vertical');
      case 'row':
        return this.emitColumn(el, 'horizontal');
      case 'stack':
        return this.emitStack(el);
      case 'wrap':
        return this.emitWrap(el);
      case 'scroll':
        return this.emitScroll(el);
      case 'list':
        return this.emitList(el);
      case 'grid':
        return this.emitGrid(el);
      case 'card':
        return this.emitCard(el);
      case 'scaffold':
        return this.emitScaffold(el);
      case 'center':
        return dartCall('Center', [`child: ${this.emitBodySingle(el.children)}`]);
      case 'align':
        return dartCall('Align', [
          `alignment: ${this.enumProp(el, 'align', ALIGNMENT) ?? 'Alignment.center'}`,
          `child: ${this.emitBodySingle(el.children)}`,
        ]);
      case 'expanded':
        return dartCall('Expanded', [...arg('flex', this.numProp(el, 'flex')), `child: ${this.emitBodySingle(el.children)}`]);
      case 'safeArea':
        return dartCall('SafeArea', [...arg('bottom', this.boolProp(el, 'bottom')), `child: ${this.emitBodySingle(el.children)}`]);
      case 'spacer':
        return dartCall('Spacer', arg('flex', this.numProp(el, 'flex')));
      case 'text':
        return this.emitText(el);
      case 'image':
        return this.emitImage(el);
      case 'icon':
        return this.emitIcon(el);
      case 'button':
        return this.emitButton(el);
      case 'input':
        return this.emitInput(el);
      case 'form':
        return this.emitForm(el);
      case 'toggle':
        return this.emitToggle(el);
      case 'checkbox':
        return this.emitCheckbox(el);
      case 'slider':
        return this.emitSlider(el);
      case 'divider':
        return this.emitDivider(el);
      case 'progress':
        return this.emitProgress(el);
      default:
        return dartCall(spec.tag, []);
    }
  }

  // ---- layout ------------------------------------------------------------------------------

  private emitColumn(el: ElementNode, direction: 'vertical' | 'horizontal'): string {
    const isColumn = direction === 'vertical';
    const gap = this.numProp(el, 'gap');
    const items = this.withGaps(this.emitChildren(el.children), gap, isColumn);
    return dartCall(
      isColumn ? 'Column' : 'Row',
      [
        ...arg('mainAxisAlignment', this.enumProp(el, 'main', MAIN_AXIS)),
        ...arg('crossAxisAlignment', this.enumProp(el, 'cross', CROSS_AXIS)),
      ],
      { key: 'children', items },
    );
  }

  private emitStack(el: ElementNode): string {
    return dartCall(
      'Stack',
      [...arg('alignment', this.enumProp(el, 'align', ALIGNMENT)), ...arg('fit', this.enumProp(el, 'fit', STACK_FIT))],
      { key: 'children', items: this.emitChildren(el.children) },
    );
  }

  private emitWrap(el: ElementNode): string {
    return dartCall(
      'Wrap',
      [
        ...arg('spacing', this.numProp(el, 'gap')),
        ...arg('runSpacing', this.numProp(el, 'runGap')),
        ...arg('alignment', this.enumProp(el, 'main', WRAP_ALIGN)),
      ],
      { key: 'children', items: this.emitChildren(el.children) },
    );
  }

  private emitScroll(el: ElementNode): string {
    const axis = this.enumProp(el, 'axis', AXIS) ?? 'Axis.vertical';
    const horizontal = axis === 'Axis.horizontal';
    const gap = this.numProp(el, 'gap');
    const items = this.withGaps(this.emitChildren(el.children), gap, !horizontal);
    const inner = dartCall(horizontal ? 'Row' : 'Column', [], { key: 'children', items });
    return dartCall('SingleChildScrollView', [
      `scrollDirection: ${axis}`,
      ...arg('padding', this.insetsProp(el, 'padding')),
      `child: ${inner}`,
    ]);
  }

  private emitList(el: ElementNode): string {
    const gap = this.numProp(el, 'gap');
    const items = this.withGaps(this.emitChildren(el.children), gap, true);
    return dartCall('ListView', [...arg('scrollDirection', this.enumProp(el, 'axis', AXIS))], { key: 'children', items });
  }

  private emitGrid(el: ElementNode): string {
    const gap = this.numProp(el, 'gap');
    return dartCall(
      'GridView.count',
      [
        `crossAxisCount: ${this.numProp(el, 'columns') ?? '2'}`,
        ...arg('mainAxisSpacing', gap),
        ...arg('crossAxisSpacing', gap),
        'shrinkWrap: true',
      ],
      { key: 'children', items: this.emitChildren(el.children) },
    );
  }

  private emitCard(el: ElementNode): string {
    const radius = this.numProp(el, 'radius') ?? '12';
    const inner = dartCall('Padding', [
      `padding: ${this.insetsProp(el, 'padding') ?? 'const EdgeInsets.all(16)'}`,
      `child: ${this.emitBodySingle(el.children)}`,
    ]);
    return dartCall('Card', [
      ...arg('elevation', this.numProp(el, 'elevation')),
      ...arg('color', this.colorProp(el, 'background')),
      `shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(${radius}))`,
      `child: ${inner}`,
    ]);
  }

  private emitScaffold(el: ElementNode): string {
    const title = this.prop(el, 'title');
    const appBar =
      title === undefined
        ? undefined
        : dartCall('AppBar', [
            `title: ${dartCall('Text', [this.textContent(title)])}`,
            ...arg('centerTitle', this.boolProp(el, 'centerTitle')),
          ]);
    return dartCall('Scaffold', [
      ...arg('backgroundColor', this.colorProp(el, 'background')),
      ...arg('appBar', appBar),
      `body: ${this.emitBodySingle(el.children)}`,
    ]);
  }

  // ---- content -----------------------------------------------------------------------------

  private emitText(el: ElementNode): string {
    const content = this.argAt(el, 0);
    const text = content === undefined ? "' '" : this.textContent(content);
    const style = this.textStyle(el);
    return dartCall('Text', [
      text,
      ...arg('style', style),
      ...arg('textAlign', this.enumProp(el, 'textAlign', TEXT_ALIGN)),
      ...arg('maxLines', this.numProp(el, 'maxLines')),
      ...arg('overflow', this.enumProp(el, 'overflow', OVERFLOW)),
    ]);
  }

  private emitImage(el: ElementNode): string {
    const src = this.argAt(el, 0);
    const sizeArgs = [
      ...arg('fit', this.enumProp(el, 'fit', FIT)),
      ...arg('semanticLabel', this.stringProp(el, 'semanticLabel')),
    ];
    let image: string;
    if (src === undefined) {
      image = dartCall('SizedBox', sizeArgs);
    } else if (src.kind === 'String') {
      const isUrl = /^https?:/i.test(src.value);
      image = dartCall(isUrl ? 'Image.network' : 'Image.asset', [src.raw, ...sizeArgs]);
    } else {
      image = dartCall('Image.network', [this.expr(src), ...sizeArgs]);
    }
    const radius = this.numProp(el, 'radius');
    if (radius === undefined) return image;
    return dartCall('ClipRRect', [`borderRadius: BorderRadius.circular(${radius})`, `child: ${image}`]);
  }

  private emitIcon(el: ElementNode): string {
    const nameExpr = this.argAt(el, 0);
    let icon: string;
    if (nameExpr === undefined) icon = 'Icons.help_outline';
    else if (nameExpr.kind === 'Ident') icon = `Icons.${iconName(nameExpr.name)}`;
    else if (nameExpr.kind === 'String') icon = `Icons.${iconName(nameExpr.value)}`;
    else icon = this.expr(nameExpr);
    return dartCall('Icon', [
      icon,
      ...arg('size', this.numProp(el, 'size')),
      ...arg('color', this.colorProp(el, 'color')),
    ]);
  }

  private emitButton(el: ElementNode): string {
    const label = this.argAt(el, 0);
    const variant = this.literalName(el, 'variant') ?? 'filled';
    const labelWidget = dartCall('Text', [
      label === undefined ? "''" : this.textContent(label),
      ...arg('style', this.textStyle(el, false)),
    ]);
    const disabled = this.boolProp(el, 'disabled');
    const tap = this.eventClosure(el, 'tap');
    const onPressed = disabled === 'true' ? 'null' : (tap ?? 'null');
    const color = this.colorProp(el, 'color');

    let code: string;
    if (variant === 'outlined') {
      code = dartCall('OutlinedButton', [
        `onPressed: ${onPressed}`,
        ...arg('style', color === undefined ? undefined : `OutlinedButton.styleFrom(foregroundColor: ${color})`),
        `child: ${labelWidget}`,
      ]);
    } else if (variant === 'text') {
      code = dartCall('TextButton', [
        `onPressed: ${onPressed}`,
        ...arg('style', color === undefined ? undefined : `TextButton.styleFrom(foregroundColor: ${color})`),
        `child: ${labelWidget}`,
      ]);
    } else {
      code = dartCall('ElevatedButton', [
        `onPressed: ${onPressed}`,
        ...arg('style', color === undefined ? undefined : `ElevatedButton.styleFrom(backgroundColor: ${color})`),
        `child: ${labelWidget}`,
      ]);
    }

    if (this.boolProp(el, 'fullWidth') === 'true') {
      code = dartCall('SizedBox', ['width: double.infinity', `child: ${code}`]);
    }
    return code;
  }

  /**
   * `form:` becomes a `Form` with one generated key, and the key is the whole point: `submit()`
   * calls `validate()` on it, so the gate is Flutter's own and the handler cannot be reached while
   * a field is invalid.
   *
   * The `on submit:` body is not emitted here — it is inlined at each `submit()` call site, because
   * a `Form` has no submit callback to give it to.
   */
  private emitForm(el: ElementNode): string {
    const key = this.formKeys.length === 0 ? '_puiFormKey' : `_puiFormKey${this.formKeys.length + 1}`;
    this.formKeys.push(key);
    const handler = el.events.find((event) => event.name === 'submit');
    this.formStack.push({ key, actions: handler?.actions ?? [] });
    const child = this.emitBodySingle(el.children);
    this.formStack.pop();
    return dartCall('Form', [`key: ${key}`, `child: ${child}`]);
  }

  /**
   * The `validator:` closure for an input inside a form, or nothing.
   *
   * Two rules make the generated validator behave like a hand-written one: an empty value stops at
   * `required` (or passes, when the field is optional) so `min(8)` never rejects an untouched
   * field, and every message is a sentence the design can read.
   */
  private validatorFor(el: ElementNode): string | undefined {
    if (this.formStack.length === 0) return undefined;
    const prop = el.props.find((candidate) => candidate.name === 'validate');
    if (prop === undefined) return undefined;
    const items = prop.value.kind === 'List' ? prop.value.items : [prop.value];

    const validators = items.map((item) => {
      const name = item.kind === 'Ident' ? item.name : item.kind === 'Call' && item.callee.kind === 'Ident' ? item.callee.name : undefined;
      if (name === undefined) return undefined;
      // Arguments are kept as AST nodes: a number validator renders its argument as Dart, but a
      // pattern needs the *text* of the string, not the Dart literal that spells it.
      return { name, args: item.kind === 'Call' ? item.args : [] };
    });
    const required = validators.some((validator) => validator?.name === 'required');

    const lines: string[] = [];
    lines.push('(value) {');
    lines.push("  final text = (value ?? '').trim();");
    lines.push('  if (text.isEmpty) {');
    lines.push(required ? "    return 'This field is required';" : '    return null;');
    lines.push('  }');
    for (const validator of validators) {
      if (validator === undefined) continue;
      const { name, args } = validator;
      if (name === 'required') continue;
      if (name === 'email') {
        this.usesEmailPattern = true;
        lines.push("  if (!_puiEmailPattern.hasMatch(text)) {\n    return 'Enter a valid email address';\n  }");
      } else if (name === 'min') {
        const bound = args[0] === undefined ? '0' : this.expr(args[0].value);
        lines.push(`  if (text.length < ${bound}) {\n    return 'Use at least ${bound} characters';\n  }`);
      } else if (name === 'max') {
        const bound = args[0] === undefined ? '0' : this.expr(args[0].value);
        lines.push(`  if (text.length > ${bound}) {\n    return 'Use at most ${bound} characters';\n  }`);
      } else if (name === 'pattern') {
        const argument = args[0]?.value;
        const text = argument?.kind === 'String' ? argument.value : argument === undefined ? '' : this.expr(argument).replace(/^["']|["']$/g, '');
        lines.push(`  if (!RegExp(${this.patternLiteral(text)}).hasMatch(text)) {\n    return 'Enter a value in the expected format';\n  }`);
      }
    }
    lines.push('  return null;');
    lines.push('}');
    return lines.join('\n');
  }

  /**
   * A validator pattern as a Dart raw string, escaped for whichever quote it needs. Raw strings keep
   * the regular expression readable; the quote is chosen so a pattern can contain the other one.
   */
  private patternLiteral(expr: string | undefined): string {
    const text = expr ?? '';
    if (!text.includes("'")) return `r'${text}'`;
    if (!text.includes('"')) return `r"${text}"`;
    return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }

  private emitInput(el: ElementNode): string {
    const bind = this.prop(el, 'bind');
    const bindName = bind !== undefined && bind.kind === 'Ident' ? bind.name : undefined;
    const controllerName = bindName === undefined ? undefined : this.controllerFor(bindName);

    const decoration: string[] = [
      ...arg('labelText', this.stringProp(el, 'label')),
      ...arg('hintText', this.stringProp(el, 'placeholder')),
      ...arg('helperText', this.stringProp(el, 'helper')),
      ...arg('counterText', this.boolProp(el, 'counter') === 'true' ? "''" : undefined),
    ];

    const keyboard = this.enumProp(el, 'keyboard', KEYBOARD);

    const handlers: string[] = [];
    if (bindName !== undefined) {
      handlers.push(`onChanged: (value) {\n  setState(() {\n    ${bindName} = value;\n  });\n}`);
    } else {
      const change = this.eventClosure(el, 'change');
      if (change !== undefined) handlers.push(`onChanged: ${change}`);
    }
    const submit = this.eventClosure(el, 'submit');
    if (submit !== undefined) handlers.push(`onSubmitted: ${submit}`);

    const multiline = this.boolProp(el, 'multiline') === 'true';
    const maxLines = this.numProp(el, 'maxLines') ?? (multiline ? 'null' : '1');

    const validator = this.validatorFor(el);
    return dartCall(validator === undefined ? 'TextField' : 'TextFormField', [
      ...arg('controller', controllerName),
      ...(decoration.length > 0 ? [`decoration: ${dartCall('InputDecoration', decoration)}`] : []),
      ...arg('obscureText', this.boolProp(el, 'secret')),
      `maxLines: ${maxLines}`,
      ...arg('keyboardType', keyboard),
      ...arg('autofocus', this.boolProp(el, 'autofocus')),
      ...handlers,
      ...(validator === undefined ? [] : [`validator: ${validator}`]),
    ]);
  }

  private emitToggle(el: ElementNode): string {
    const bind = this.bindName(el);
    const onChanged =
      this.eventClosure(el, 'change') ??
      (bind === undefined ? 'null' : `(value) {\n  setState(() {\n    ${bind} = value;\n  });\n}`);
    const label = this.stringProp(el, 'label');
    if (label !== undefined) {
      return dartCall('SwitchListTile', [`title: ${dartCall('Text', [this.strLiteral(el, 'label')!])}`, `value: ${bind ?? 'false'}`, `onChanged: ${onChanged}`]);
    }
    return dartCall('Switch', [`value: ${bind ?? 'false'}`, `onChanged: ${onChanged}`]);
  }

  private emitCheckbox(el: ElementNode): string {
    const bind = this.bindName(el);
    const onChanged =
      this.eventClosure(el, 'change') ??
      (bind === undefined ? 'null' : `(value) {\n  setState(() {\n    ${bind} = value ?? false;\n  });\n}`);
    const label = this.stringProp(el, 'label');
    if (label !== undefined) {
      return dartCall('CheckboxListTile', [
        `title: ${dartCall('Text', [this.strLiteral(el, 'label')!])}`,
        `value: ${bind ?? 'false'}`,
        `onChanged: ${onChanged}`,
      ]);
    }
    return dartCall('Checkbox', [`value: ${bind ?? 'false'}`, `onChanged: ${onChanged}`]);
  }

  private emitSlider(el: ElementNode): string {
    const bind = this.bindName(el);
    const onChanged =
      this.eventClosure(el, 'change') ??
      (bind === undefined ? 'null' : `(value) {\n  setState(() {\n    ${bind} = value;\n  });\n}`);
    return dartCall('Slider', [
      `value: ${bind === undefined ? '0' : `${paren(bind)}.toDouble()`}`,
      `min: ${this.numProp(el, 'min') ?? '0'}`,
      `max: ${this.numProp(el, 'max') ?? '1'}`,
      ...arg('divisions', this.numProp(el, 'divisions')),
      `onChanged: ${onChanged}`,
    ]);
  }

  private emitDivider(el: ElementNode): string {
    return dartCall('Divider', [
      ...arg('thickness', this.numProp(el, 'thickness')),
      ...arg('color', this.colorProp(el, 'color')),
    ]);
  }

  private emitProgress(el: ElementNode): string {
    const value = this.numProp(el, 'value');
    const indeterminate = this.boolProp(el, 'indeterminate') === 'true' || value === undefined;
    const color = this.colorProp(el, 'color');
    if (indeterminate) return dartCall('CircularProgressIndicator', arg('color', color));
    return dartCall('LinearProgressIndicator', [`value: ${value}`, ...arg('color', color)]);
  }

  // ---- components and host widgets ---------------------------------------------------------

  private emitComponentCall(el: ElementNode, decl: ComponentDecl): string {
    // Generated constructors use named parameters, so positional arguments at the call site are
    // mapped to their parameter names here. This keeps `Card2("x")` and `Card2(label: "x")`
    // equally valid in PlainUI.
    const named: string[] = [];
    let positionalIndex = 0;

    for (const arg of el.args) {
      if (arg.name !== undefined) {
        named.push(`${arg.name}: ${this.expr(arg.value)}`);
        continue;
      }
      const param = decl.params[positionalIndex];
      positionalIndex += 1;
      if (param !== undefined) named.push(`${param.name}: ${this.expr(arg.value)}`);
    }

    if (el.children.length > 0) {
      named.push(listArgument('children', this.emitChildren(el.children)));
    }

    return dartCall(decl.name, named);
  }

  private emitHostCall(el: ElementNode): string {
    const args: string[] = [];
    for (const arg of el.args) {
      args.push(arg.name === undefined ? this.expr(arg.value) : `${arg.name}: ${this.expr(arg.value)}`);
    }
    for (const prop of el.props) {
      args.push(`${prop.name}: ${this.expr(prop.value)}`);
    }
    if (el.children.length > 0) {
      const items = this.emitChildren(el.children);
      if (items.length === 1) args.push(`child: ${items[0]!}`);
      else args.push(listArgument('children', items));
    }
    return dartCall(el.tag, args);
  }

  /** Children of an element, mapping `slot` to a spread of the `children` field. */
  private emitChildren(nodes: readonly Node[]): string[] {
    return this.emitNodes(nodes);
  }

  // ------------------------------------------------------------------------------------------
  // Universal decorations and event wrappers
  // ------------------------------------------------------------------------------------------

  private applyDecorators(el: ElementNode, base: string, declared: ReadonlySet<string>, spec?: WidgetSpec): string {
    const own = (name: string): Expr | undefined => (declared.has(name) ? undefined : this.prop(el, name));
    let code = base;

    const padding = this.insetsOf(own('padding'));
    if (padding !== undefined) code = dartCall('Padding', [`padding: ${padding}`, `child: ${code}`]);

    const size = this.numOf(own('size'));
    const width = this.numOf(own('width')) ?? (size === undefined ? undefined : size);
    const height = this.numOf(own('height')) ?? (size === undefined ? undefined : size);
    if (width !== undefined || height !== undefined) {
      code = dartCall('SizedBox', [...arg('width', width), ...arg('height', height), `child: ${code}`]);
    }

    const background = this.colorOf(own('background') ?? own('bg'));
    const radius = this.numOf(own('radius'));
    const border = this.numOf(own('border'));
    const borderColor = this.colorOf(own('borderColor'));
    const margin = this.insetsOf(own('margin'));
    if (background !== undefined || radius !== undefined || border !== undefined || margin !== undefined) {
      const args: string[] = [];
      if (radius !== undefined || border !== undefined) {
        const decoration: string[] = [];
        if (background !== undefined) decoration.push(`color: ${background}`);
        if (radius !== undefined) decoration.push(`borderRadius: BorderRadius.circular(${radius})`);
        if (border !== undefined) {
          decoration.push(
            `border: Border.all(width: ${border}${borderColor === undefined ? '' : `, color: ${borderColor}`})`,
          );
        }
        args.push(`decoration: ${dartCall('BoxDecoration', decoration)}`);
      } else if (background !== undefined) {
        args.push(`color: ${background}`);
      }
      if (margin !== undefined) args.push(`margin: ${margin}`);
      args.push(`child: ${code}`);
      code = dartCall('Container', args);
    }

    const opacity = this.numOf(own('opacity'));
    if (opacity !== undefined) code = dartCall('Opacity', [`opacity: ${opacity}`, `child: ${code}`]);

    const expand = this.boolOf(own('expand'));
    const flex = this.numOf(own('flex'));
    if (expand === 'true') {
      code = dartCall('Expanded', [...arg('flex', flex === '1' ? undefined : flex), `child: ${code}`]);
    } else if (flex !== undefined) {
      code = dartCall('Flexible', [...arg('flex', flex === '1' ? undefined : flex), `child: ${code}`]);
    }

    const align = this.enumOf(own('align'), ALIGNMENT);
    if (align !== undefined) code = dartCall('Align', [`alignment: ${align}`, `child: ${code}`]);

    code = this.wrapGestures(el, spec)(code);
    return code;
  }

  /** Wraps tap/longTap/doubleTap/hover/focus/blur events the widget does not handle natively. */
  private wrapGestures(el: ElementNode, spec: WidgetSpec | undefined): (code: string) => string {
    const native = new Set(spec?.events ?? []);
    const handlers: string[] = [];
    if (!native.has('tap')) handlers.push(...arg('onTap', this.eventClosure(el, 'tap')));
    if (!native.has('longTap')) handlers.push(...arg('onLongPress', this.eventClosure(el, 'longTap')));
    if (!native.has('doubleTap')) handlers.push(...arg('onDoubleTap', this.eventClosure(el, 'doubleTap')));

    const hover = native.has('hover') ? undefined : this.eventClosure(el, 'hover');
    const focus = this.eventClosure(el, 'focus');
    const blur = this.eventClosure(el, 'blur');

    return (code: string): string => {
      let result = code;
      if (focus !== undefined || blur !== undefined) {
        const branches: string[] = [];
        if (focus !== undefined) branches.push(`if (hasFocus) {\n${indentAll(this.blockBody(focus), 2)}\n}`);
        if (blur !== undefined) {
          branches.push(
            focus === undefined
              ? `if (!hasFocus) {\n${indentAll(this.blockBody(blur), 2)}\n}`
              : `else {\n${indentAll(this.blockBody(blur), 2)}\n}`,
          );
        }
        result = dartCall('Focus', [`onFocusChange: (hasFocus) {\n${indentAll(branches.join('\n'), 2)}\n}`, `child: ${result}`]);
      }
      if (handlers.length > 0) result = dartCall('GestureDetector', [...handlers, `child: ${result}`]);
      if (hover !== undefined) result = dartCall('MouseRegion', [`onEnter: ${hover}`, `child: ${result}`]);
      return result;
    };
  }

  /** Turn a closure back into indented statements (used when nesting one inside another). */
  private blockBody(closure: string): string {
    const open = closure.indexOf('{');
    const close = closure.lastIndexOf('}');
    return closure.slice(open + 1, close).trim();
  }

  // ------------------------------------------------------------------------------------------
  // Events and actions
  // ------------------------------------------------------------------------------------------

  private eventClosure(el: ElementNode, name: string): string | undefined {
    const event = el.events.find((handler) => handler.name === name);
    if (event === undefined) return undefined;
    return this.emitClosure(el, event);
  }

  private emitClosure(el: ElementNode, event: EventHandler): string {
    const valueType = eventValueType(el.tag, event.name);
    const isAsync = actionsContainAwait(event.actions) || this.submitBodyIsAsync(event.actions);
    const body = this.emitActions(event.actions);
    const header = `(${valueType === undefined ? '' : VALUE_PARAM_NAME})${isAsync ? ' async' : ''} {`;
    if (body.length === 0) return `${header}\n}`;
    return `${header}\n${body.map((line) => indentAll(line, 2)).join('\n')}\n}`;
  }

  private emitActions(actions: readonly Action[]): string[] {
    const lines: string[] = [];
    let index = 0;
    while (index < actions.length) {
      const action = actions[index]!;

      // `await` cannot appear inside setState's synchronous callback, so any awaited value is
      // evaluated first and handed to setState through a temporary.
      if (action.kind === 'Set' && actionsContainAwait([action])) {
        const set = action;
        const temp = `puiValue${this.uid++}`;
        lines.push(`final ${temp} = ${this.expr(set.value)};`);
        lines.push(`setState(() {\n${indentAll(`${this.expr(set.target)} = ${temp};`, 2)}\n});`);
        index += 1;
        continue;
      }

      // Consecutive state changes share one setState, so `set a = 1` followed by `set b = 2`
      // rebuilds once. Method calls on state (`tasks.add(x)`) count as state changes too.
      const group: string[] = [];
      while (index < actions.length) {
        const next = actions[index]!;
        if (next.kind === 'Set' && !actionsContainAwait([next])) {
          group.push(`${this.expr(next.target)} ${next.op} ${this.expr(next.value)};`);
          index += 1;
          continue;
        }
        if (next.kind === 'Call' && this.mutatesState(next.expr) && !actionsContainAwait([next])) {
          group.push(`${this.expr(next.expr)};`);
          index += 1;
          continue;
        }
        break;
      }
      if (group.length > 0) {
        lines.push(`setState(() {\n${group.map((line) => indentAll(line, 2)).join('\n')}\n});`);
        continue;
      }

      if (action.kind === 'Call') {
        const submit = isSubmitCall(action.expr) ? this.submitStatement() : undefined;
        if (submit !== undefined) {
          lines.push(submit);
          index += 1;
          continue;
        }
        const navigation = this.navigationStatement(action.expr);
        if (navigation !== undefined) {
          lines.push(navigation);
          index += 1;
          continue;
        }
        // Calls on anything but state (host services, parameters) are plain statements: wrapping
        // them in setState would be wrong and would hide their side effects.
        lines.push(`${this.expr(action.expr)};`);
        index += 1;
        continue;
      }
      if (action.kind === 'ActionIf') lines.push(this.emitActionIf(action));
      index += 1;
    }
    return lines;
  }

  /** Whether a call statement mutates a state variable of the current screen or component. */
  private mutatesState(expr: Expr): boolean {
    if (expr.kind !== 'Call') return false;
    let callee: Expr = expr.callee;
    if (callee.kind !== 'Member') return false;
    let receiver: Expr = callee.object;
    while (receiver.kind === 'Member') receiver = receiver.object;
    if (receiver.kind !== 'Ident') return false;
    const states = this.analysis.stateTypes.get(this.currentDeclName());
    return states !== undefined && states.has(receiver.name);
  }

  /**
   * A handler that calls `submit()` inlines the form's body, so an `await` in that body belongs to
   * the handler's closure and the closure has to be `async`. Without this the generated Dart says
   * `await` inside a non-async function — legal in `.pui`, rejected by the analyzer.
   */
  private submitBodyIsAsync(actions: readonly Action[]): boolean {
    const form = this.formStack[this.formStack.length - 1];
    if (form === undefined) return false;
    const submits = actions.some((action) => action.kind === 'Call' && isSubmitCall(action.expr));
    return submits && actionsContainAwait(form.actions);
  }

  /**
   * `submit()` expands to "validate this form, then run its `on submit:` body".
   *
   * The body is inlined rather than delegated, because the gate has to wrap it: generating a method
   * and calling it after `validate()` would let a future edit call the method directly.
   */
  private submitStatement(): string | undefined {
    const form = this.formStack[this.formStack.length - 1];
    if (form === undefined) return undefined;
    const body = this.emitActions(form.actions);
    const gate = `if (${form.key}.currentState!.validate()) {`;
    if (body.length === 0) return `${gate}\n}`;
    return `${gate}\n${body.map((line) => indentAll(line, 2)).join('\n')}\n}`;
  }

  /**
   * `navigate Detail(id: x)` becomes a real push, and `back()` a pop that tolerates being on the
   * first screen. The route is a `MaterialPageRoute` built from the screen's own constructor, so
   * the arguments are type-checked by Dart exactly as the `.pui` checker checked them.
   *
   * Returns undefined for anything that is not navigation, so ordinary host calls keep their
   * existing path through the generator.
   */
  private navigationStatement(expr: Expr): string | undefined {
    if (expr.kind !== 'Call') return undefined;
    const callee = expr.callee.kind === 'Paren' ? expr.callee.inner : expr.callee;
    if (callee.kind !== 'Ident') return undefined;

    if (callee.name === 'back') return 'Navigator.maybePop(context);';
    if (callee.name !== 'navigate') return undefined;

    const target = expr.args.find((arg) => arg.name === undefined);
    if (target === undefined || target.value.kind !== 'Ident') return undefined;
    const screen = this.screenName(target.value.name);
    const args = expr.args
      .filter((arg) => arg.name !== undefined)
      .map((arg) => `${arg.name}: ${this.expr(arg.value)}`);
    return `Navigator.push(\n  context,\n  MaterialPageRoute<void>(\n    builder: (_) => ${screen}(${args.join(', ')}),\n  ),\n);`;
  }

  /** The Dart class a navigation target resolves to, sanitised like every other declaration. */
  private screenName(name: string): string {
    return sanitizeName(name);
  }

  private emitActionIf(action: Extract<Action, { kind: 'ActionIf' }>): string {
    const parts: string[] = [];
    action.branches.forEach((branch, index) => {
      const keyword = index === 0 ? 'if' : 'else if';
      const body = this.emitActions(branch.body);
      parts.push(`${keyword} (${this.expr(branch.cond)}) {\n${body.map((line) => indentAll(line, 2)).join('\n')}\n}`);
    });
    if (action.elseBody !== undefined && action.elseBody.length > 0) {
      const body = this.emitActions(action.elseBody);
      parts.push(`else {\n${body.map((line) => indentAll(line, 2)).join('\n')}\n}`);
    }
    return parts.join(' ');
  }

  // ------------------------------------------------------------------------------------------
  // Property access helpers
  // ------------------------------------------------------------------------------------------

  private prop(el: ElementNode, name: string): Expr | undefined {
    return el.props.find((prop) => prop.name === name)?.value;
  }

  private argAt(el: ElementNode, index: number): Expr | undefined {
    return el.args.filter((arg) => arg.name === undefined)[index]?.value;
  }

  private literalName(el: ElementNode, name: string): string | undefined {
    const value = this.prop(el, name);
    if (value === undefined) return undefined;
    if (value.kind === 'Ident') return value.name;
    if (value.kind === 'String') return value.value;
    return undefined;
  }

  private stringProp(el: ElementNode, name: string): string | undefined {
    const value = this.prop(el, name);
    return value === undefined ? undefined : this.str(value);
  }

  private strLiteral(el: ElementNode, name: string): string | undefined {
    const value = this.prop(el, name);
    if (value === undefined) return undefined;
    return value.kind === 'String' ? value.raw : this.str(value);
  }

  private numProp(el: ElementNode, name: string): string | undefined {
    return this.numOf(this.prop(el, name));
  }

  private numOf(value: Expr | undefined): string | undefined {
    if (value === undefined) return undefined;
    return this.num(value);
  }

  private boolProp(el: ElementNode, name: string): string | undefined {
    return this.boolOf(this.prop(el, name));
  }

  private boolOf(value: Expr | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (value.kind === 'Bool') return String(value.value);
    return this.expr(value);
  }

  private colorProp(el: ElementNode, name: string): string | undefined {
    return this.colorOf(this.prop(el, name));
  }

  private colorOf(value: Expr | undefined): string | undefined {
    if (value === undefined) return undefined;
    return this.color(value);
  }

  private insetsProp(el: ElementNode, name: string): string | undefined {
    return this.insetsOf(this.prop(el, name));
  }

  private insetsOf(value: Expr | undefined): string | undefined {
    if (value === undefined) return undefined;
    return this.insets(value);
  }

  private enumProp(el: ElementNode, name: string, map: Record<string, string>): string | undefined {
    const value = this.prop(el, name);
    if (value === undefined) return undefined;
    return this.enumOf(value, map);
  }

  private enumOf(value: Expr | undefined, map: Record<string, string>, fallback?: string): string | undefined {
    if (value === undefined) return fallback;
    const name = value.kind === 'Ident' ? value.name : value.kind === 'String' ? value.value : undefined;
    if (name === undefined) return fallback;
    return map[name] ?? fallback;
  }

  private bindName(el: ElementNode): string | undefined {
    const bind = this.prop(el, 'bind');
    return bind !== undefined && bind.kind === 'Ident' ? bind.name : undefined;
  }

  private controllerFor(stateName: string): string {
    const existing = this.controllers.get(stateName);
    if (existing !== undefined) return existing;
    const name = `_${sanitizeName(stateName)}Controller`;
    this.controllers.set(stateName, name);
    return name;
  }

  // ------------------------------------------------------------------------------------------
  // Text styles and values
  // ------------------------------------------------------------------------------------------

  private textStyle(el: ElementNode, includeColor = true): string | undefined {
    const styleName = this.literalName(el, 'style');
    const overrides: string[] = [];
    const textProps = ['style', 'size', 'weight', 'letterSpacing', 'lineHeight', 'fontFamily', 'italic'];
    if (includeColor) textProps.push('color');
    for (const prop of el.props) {
      if (textProps.includes(prop.name)) {
        const code = this.styleArg(prop.name, prop.value);
        if (code !== undefined) overrides.push(code);
      }
    }

    let base: string | undefined;
    let nullable = false;
    if (styleName !== undefined) {
      const custom = this.styleIds.get(styleName);
      if (custom !== undefined) {
        this.usedStyles.add(styleName);
        base = custom;
      } else if (BUILTIN_STYLES.includes(styleName)) {
        const theme = THEME_STYLES[styleName] ?? { style: 'bodyMedium' };
        base = `Theme.of(context).textTheme.${theme.style}`;
        nullable = true;
        if (theme.extra !== undefined) overrides.unshift(theme.extra);
      }
    }

    if (base === undefined) {
      return overrides.length === 0 ? undefined : dartCall('TextStyle', overrides);
    }
    if (overrides.length === 0) return base;
    return `${base}${nullable ? '?' : ''}.copyWith(${overrides.join(', ')})`;
  }

  /** Text shown inside a Text widget, converting non-strings. */
  private textContent(expr: Expr): string {
    const code = this.expr(expr);
    const type = this.typeOf(expr);
    // Nullable first: `isStringType` looks through `?`, and a nullable value passed to `Text` is a
    // compile error in Dart rather than a blank line. A task's `error` is exactly that case.
    if (type.kind === 'nullable') {
      if (isStringType(type.inner)) return `(${code} ?? '')`;
      if (type.inner.kind === 'list') return `${paren(code)}?.join(', ') ?? ''`;
      return `${paren(code)}?.toString() ?? ''`;
    }
    if (isStringType(type)) return code;
    if (type.kind === 'list') return `${paren(code)}.join(', ')`;
    return `${paren(code)}.toString()`;
  }

  private typeOf(expr: Expr): UiType {
    if (expr.kind === 'Ident') {
      return this.scope.get(expr.name)?.type ?? DYNAMIC;
    }
    if (expr.kind === 'Member' && expr.object.kind === 'Ident') {
      const owner = this.scope.get(expr.object.name);
      if (owner !== undefined && owner.type.kind === 'task') {
        if (expr.name === 'value') {
          return owner.type.value.kind === 'list' ? owner.type.value : { kind: 'nullable', inner: owner.type.value };
        }
        if (expr.name === 'error') return { kind: 'nullable', inner: STRING };
        if (expr.name === 'loading') return BOOL;
      }
    }
    if (expr.kind === 'Paren') return this.typeOf(expr.inner);
    if (expr.kind === 'String') return STRING;
    if (expr.kind === 'Number') return expr.raw.includes('.') ? { kind: 'double' } : INT;
    if (expr.kind === 'Bool') return { kind: 'bool' };
    if (expr.kind === 'Binary') {
      if (['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(expr.op)) return BOOL;
      const left = this.typeOf(expr.left);
      const right = this.typeOf(expr.right);
      if (isStringType(left) || isStringType(right)) return STRING;
      if (left.kind === 'double' || right.kind === 'double') return DOUBLE;
      if (left.kind === 'int' && right.kind === 'int') return INT;
    }
    if (expr.kind === 'Ternary') {
      // A conditional is only as specific as its two branches: `busy ? "a" : "b"` is a String,
      // so it can be shown in a Text widget without a defensive `.toString()`.
      const a = this.typeOf(expr.then);
      const b = this.typeOf(expr.otherwise);
      if (a.kind === b.kind) return a;
      if (isStringType(a) || isStringType(b)) return STRING;
      if (isNumericType(a) && isNumericType(b)) return NUM;
      return DYNAMIC;
    }
    if (expr.kind === 'Unary') {
      if (expr.op === '!') return BOOL;
      if (expr.op === 'await') return this.typeOf(expr.operand);
      return this.typeOf(expr.operand);
    }
    if (expr.kind === 'List') return { kind: 'list', element: DYNAMIC };
    if (expr.kind === 'Null') return { kind: 'nullable', inner: DYNAMIC };
    return DYNAMIC;
  }

  // ------------------------------------------------------------------------------------------
  // Expression emission
  // ------------------------------------------------------------------------------------------

  private expr(expr: Expr): string {
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
        return this.color(expr);
      case 'Ident': {
        const entry = this.scope.get(expr.name);
        if (entry !== undefined) return entry.emittedName;
        const token = this.analysis.tokens.get(expr.name);
        if (token !== undefined) return token.category === 'color' ? this.color(token.value) : this.num(token.value);
        return expr.name;
      }
      case 'Member': {
        const task = this.taskMember(expr);
        if (task !== undefined) return task;
        return `${this.expr(expr.object)}.${expr.name}`;
      }
      case 'Call': {
        const args = expr.args.map((a) => (a.name === undefined ? this.expr(a.value) : `${a.name}: ${this.expr(a.value)}`));
        return `${this.expr(expr.callee)}(${args.join(', ')})`;
      }
      case 'Index':
        return `${this.expr(expr.object)}[${this.expr(expr.index)}]`;
      case 'Unary':
        if (expr.op === 'await') return `await ${this.expr(expr.operand)}`;
        return `${expr.op}${paren(this.expr(expr.operand))}`;
      case 'Binary':
        return `${this.expr(expr.left)} ${expr.op} ${this.expr(expr.right)}`;
      case 'Ternary':
        return `${this.expr(expr.cond)} ? ${this.expr(expr.then)} : ${this.expr(expr.otherwise)}`;
      case 'List':
        return `[${expr.items.map((item) => this.expr(item)).join(', ')}]`;
      case 'Paren':
        return `(${this.expr(expr.inner)})`;
    }
  }

  private num(expr: Expr): string {
    const token = this.tokenOf(expr);
    if (token !== undefined) return this.num(token.value);
    if (expr.kind === 'Number') return expr.raw;
    if (expr.kind === 'Unary' && expr.op === '-' && expr.operand.kind === 'Number') return `-${expr.operand.raw}`;
    return paren(this.expr(expr));
  }

  private str(expr: Expr): string {
    // String-valued properties may be written as bare words (`fontFamily=monospace`), which are
    // identifiers in the AST but must become Dart strings.
    if (expr.kind === 'Ident') return `"${expr.name}"`;
    return this.expr(expr);
  }

  private color(expr: Expr): string {
    const token = this.tokenOf(expr);
    if (token !== undefined) return this.color(token.value);
    if (expr.kind === 'Color') {
      const hex = expr.raw.slice(1);
      if (hex.length === 3) {
        const expanded = hex
          .split('')
          .map((c) => c + c)
          .join('');
        return `Color(0xFF${expanded.toUpperCase()})`;
      }
      if (hex.length === 4) {
        const expanded = hex
          .split('')
          .map((c) => c + c)
          .join('');
        return `Color(0x${expanded.toUpperCase()})`;
      }
      if (hex.length === 6) return `Color(0xFF${hex.toUpperCase()})`;
      return `Color(0x${hex.toUpperCase()})`;
    }
    return this.expr(expr);
  }

  private insets(expr: Expr): string {
    const token = this.tokenOf(expr);
    if (token !== undefined) return this.insets(token.value);
    if (expr.kind === 'Number') return `const EdgeInsets.all(${expr.raw})`;
    if (expr.kind === 'List') {
      const nums = expr.items.map((item) => (item.kind === 'Number' ? item.raw : this.expr(item)));
      if (nums.length === 2) return `EdgeInsets.symmetric(vertical: ${nums[0]}, horizontal: ${nums[1]})`;
      if (nums.length === 4) {
        // source order is [top, right, bottom, left]
        return `EdgeInsets.fromLTRB(${nums[3]}, ${nums[0]}, ${nums[1]}, ${nums[2]})`;
      }
      return `const EdgeInsets.all(${nums[0] ?? '0'})`;
    }
    return this.expr(expr);
  }

  // ------------------------------------------------------------------------------------------
  // Names and imports
  // ------------------------------------------------------------------------------------------

  private withGaps(items: readonly string[], gap: string | undefined, vertical: boolean): string[] {
    if (gap === undefined || items.length < 2) return [...items];
    const spacer = vertical ? `SizedBox(height: ${gap})` : `SizedBox(width: ${gap})`;
    const out: string[] = [];
    items.forEach((item, index) => {
      if (index > 0) out.push(spacer);
      out.push(item);
    });
    return out;
  }

  /**
   * The import directives this file needs, in the order they are written.
   *
   * A host surface does not change the imports by itself: a file that writes `loadTasks("")` keeps a
   * plain import, and only a file that writes `data.loadTasks("")` gets the prefixed one as well.
   * Both forms of the same URI are legal in Dart, and emitting a prefix nothing uses would hide the
   * module's other names from the generated file.
   */
  private importEntries(): { readonly spec: string; readonly alias?: string }[] {
    const entries = new Map<string, { spec: string; alias?: string }>();
    const add = (spec: string, alias?: string): void => {
      const key = alias === undefined ? spec : `${spec} as ${alias}`;
      if (!entries.has(key)) entries.set(key, alias === undefined ? { spec } : { spec, alias });
    };

    add('package:flutter/material.dart');
    const aliases = usedHostAliases(this.analysis.program);
    for (const imp of this.analysis.program.imports) {
      if (imp.path.startsWith('package:') || imp.path.startsWith('dart:')) {
        add(imp.path);
      } else if (imp.path.endsWith('.pui')) {
        add(this.options.resolvePlainuiImport?.(imp.path) ?? imp.path);
      } else {
        const spec = this.options.rebaseImport?.(imp.path) ?? imp.path;
        add(spec);
        if (imp.alias !== undefined && aliases.has(imp.alias)) add(spec, imp.alias);
      }
    }

    const rank = (spec: string): number => (spec.startsWith('dart:') ? 0 : spec.startsWith('package:flutter/') ? 1 : spec.startsWith('package:') ? 2 : 3);
    return [...entries.values()].sort(
      (a, b) => rank(a.spec) - rank(b.spec) || a.spec.localeCompare(b.spec) || (a.alias ?? '').localeCompare(b.alias ?? ''),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/**
 * The import names this file actually qualifies a call with.
 *
 * Declaring a surface does not by itself change the generated imports: a file that writes
 * `loadTasks("")` keeps a plain import, and only a file that writes `data.loadTasks("")` gets the
 * prefixed one. Emitting a prefix that nothing uses would hide the module's other names from Dart.
 */
function usedHostAliases(program: Program): Set<string> {
  const aliases = new Set<string>();
  for (const imp of program.imports) {
    if (imp.alias !== undefined) aliases.add(imp.alias);
  }
  const used = new Set<string>();
  if (aliases.size === 0) return used;

  const visit = (expr: Expr): void => {
    walkExpr(expr, (inner) => {
      if (inner.kind === 'Member' && inner.object.kind === 'Ident' && aliases.has(inner.object.name)) {
        used.add(inner.object.name);
      }
    });
  };

  for (const decl of program.decls) {
    if (decl.kind === 'Style' || decl.kind === 'Theme') continue;
    for (const state of decl.state) visit(state.init);
    for (const task of decl.tasks) visit(task.init);
    for (const param of decl.params) {
      if (param.defaultValue !== undefined) visit(param.defaultValue);
    }
    walkExpressions(decl.body, visit);
  }
  return used;
}

/** Whether a loop variable is referenced anywhere in a loop body. */
/**
 * Whether a loop variable is read anywhere in the body — including inside a nested string
 * interpolation such as `navigate Detail(id: "${index}")`. Missing that case emitted `_` for a
 * variable the body used, and the generated Dart then referenced a name that did not exist.
 */
/** Whether a screen or component contains a `form`, which needs a `GlobalKey<FormState>` field. */
function containsForm(decl: ScreenDecl | ComponentDecl): boolean {
  let found = false;
  walkNodes(decl.body, (node) => {
    if (node.kind === 'Element' && node.tag === 'form' && !node.callStyle) found = true;
  });
  return found;
}

function nameUsedInBody(name: string, nodes: readonly Node[]): boolean {
  let used = false;
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`);
  const checkExpr = (expr: Expr): void => {
    if (used) return;
    walkExpr(expr, (inner) => {
      if (used || inner.kind !== 'String') return;
      for (const interpolation of inner.interpolations) {
        if (pattern.test(interpolation.text)) used = true;
      }
    });
    for (const ident of rootIdentifiers(expr)) {
      if (ident.name === name) {
        used = true;
        return;
      }
    }
  };
  walkExpressions(nodes, checkExpr);
  return used;
}

function actionsContainAwait(actions: readonly Action[]): boolean {
  let found = false;
  const walkExpr = (expr: Expr): void => {
    if (found) return;
    switch (expr.kind) {
      case 'Unary':
        if (expr.op === 'await') found = true;
        walkExpr(expr.operand);
        break;
      case 'Member':
        walkExpr(expr.object);
        break;
      case 'Call':
        walkExpr(expr.callee);
        for (const a of expr.args) walkExpr(a.value);
        break;
      case 'Index':
        walkExpr(expr.object);
        walkExpr(expr.index);
        break;
      case 'Binary':
        walkExpr(expr.left);
        walkExpr(expr.right);
        break;
      case 'Ternary':
        walkExpr(expr.cond);
        walkExpr(expr.then);
        walkExpr(expr.otherwise);
        break;
      case 'List':
        for (const item of expr.items) walkExpr(item);
        break;
      case 'Paren':
        walkExpr(expr.inner);
        break;
      default:
        break;
    }
  };
  const walk = (list: readonly Action[]): void => {
    for (const action of list) {
      if (action.kind === 'Set') walkExpr(action.value);
      else if (action.kind === 'Call') walkExpr(action.expr);
      else {
        for (const branch of action.branches) {
          walkExpr(branch.cond);
          walk(branch.body);
        }
        if (action.elseBody !== undefined) walk(action.elseBody);
      }
    }
  };
  walk(actions);
  return found;
}

/** Const-ness of a default parameter value, which decides whether the constructor can be const. */
function isConstExpr(expr: Expr | undefined): boolean {
  if (expr === undefined) return true;
  switch (expr.kind) {
    case 'String':
    case 'Number':
    case 'Bool':
    case 'Null':
    case 'Color':
      return true;
    case 'List':
      return expr.items.every(isConstExpr);
    case 'Unary':
      return isConstExpr(expr.operand);
    case 'Paren':
      return isConstExpr(expr.inner);
    default:
      return false;
  }
}

