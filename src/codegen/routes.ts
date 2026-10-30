/**
 * The project route table: every screen, reachable by name.
 *
 * `navigate Detail(id: x)` compiles to a direct `Navigator.push` with the screen's own constructor,
 * which is the type-safe path and the one generated code uses. Host code has the opposite problem:
 * it has a *name* — from a deep link, a push notification, a menu built elsewhere — and no import
 * for the screen it names. `puiRoutes` is that mapping, generated once per project:
 *
 *     Navigator.pushNamed(context, 'Detail', arguments: {'id': '42'});
 *
 * It is generated only when a project navigates. A project that does not navigate gets no extra
 * file, and every example's generated directory stays exactly as small as its features.
 */

import { toDartTypeText, walkActions, walkNodes, type Param, type Program, type ScreenDecl } from '../frontend/ast.ts';
import { containsNavigation } from '../analysis/check.ts';
import { sanitizeName } from './dart.ts';

/** One screen, plus how the routes file imports the generated Dart that declares it. */
export interface RouteSource {
  /** Source path, for the banner and stable ordering. */
  readonly path: string;
  readonly screen: ScreenDecl;
  /** Import specifier from the routes file to this file's generated Dart. */
  readonly importSpecifier: string;
}

export const ROUTES_FILE = 'plainui_routes.dart';

/** The Dart map a host program reads: a screen name and its arguments to a widget. */
export const ROUTES_MAP = 'puiRoutes';

/**
 * Whether a project needs a route table.
 *
 * A screen with parameters is a destination; `navigate`/`back` is a project that moves between
 * screens. Either one makes the table worth generating, and neither is present in a single-screen
 * example, which is why those stay byte-for-byte unchanged.
 */
export function projectUsesNavigation(programs: readonly Program[]): boolean {
  for (const program of programs) {
    for (const decl of program.decls) {
      if (decl.kind === 'Screen' && decl.params.length > 0) return true;
      if (decl.kind !== 'Screen' && decl.kind !== 'Component') continue;
      let found = false;
      walkNodes(decl.body, (node) => {
        if (found || node.kind !== 'Element') return;
        for (const event of node.events) {
          walkActions(event.actions, (action) => {
            if (found) return;
            if (action.kind === 'Call' && containsNavigation(action.expr)) found = true;
            if (action.kind === 'Set' && containsNavigation(action.value)) found = true;
          });
        }
      });
      if (found) return true;
    }
  }
  return false;
}

/** The Dart expression a literal default renders to, or undefined when it is not a literal. */
function literalText(param: Param): string | undefined {
  const value = param.defaultValue;
  if (value === undefined) return undefined;
  switch (value.kind) {
    case 'String':
      return `"${value.value}"`;
    case 'Number':
      return value.raw;
    case 'Bool':
      return value.value ? 'true' : 'false';
    case 'Null':
      return 'null';
    case 'Color':
      return value.raw;
    default:
      return undefined;
  }
}

/**
 * The constructor arguments a route factory passes.
 *
 * A parameter with a literal default is passed only when the caller supplied it, so opening a
 * screen by name and opening it with `navigate` produce the same widget. A parameter with a
 * non-literal default is left to the constructor: it keeps its default, and the generated file says
 * so rather than silently casting.
 */
function routeArguments(screen: ScreenDecl): { arguments: string[]; notes: string[] } {
  const args: string[] = [];
  const notes: string[] = [];
  for (const param of screen.params) {
    if (param.name === 'children') continue;
    const type = param.typeText === undefined ? undefined : toDartTypeText(param.typeText);
    const read = `args['${param.name}']`;
    if (param.defaultValue === undefined) {
      args.push(type === undefined ? `${param.name}: ${read}!` : `${param.name}: ${read}! as ${type}`);
      continue;
    }
    const literal = literalText(param);
    if (literal === undefined) {
      notes.push(`// '${sanitizeName(screen.name)}' keeps its default for "${param.name}": the default is not a literal.`);
      continue;
    }
    if (type === undefined) {
      args.push(`${param.name}: ${read} ?? ${literal}`);
    } else {
      args.push(`${param.name}: ${read} as ${type}? ?? ${literal}`);
    }
  }
  return { arguments: args, notes };
}

/**
 * Render the routes file. Deterministic: screens are ordered by source path, then by name, so two
 * builds of the same project produce the same bytes.
 */
export function generateRoutes(
  routes: readonly RouteSource[],
  options: { readonly compilerVersion: string; readonly outputPath: string; readonly routesPath: string },
): string {
  const ordered = [...routes].sort(
    (left, right) =>
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0) ||
      (left.screen.name < right.screen.name ? -1 : left.screen.name > right.screen.name ? 1 : 0),
  );

  const imports = [...new Set(ordered.map((route) => route.importSpecifier))].sort();
  const entries: string[] = [];
  const notes: string[] = [];
  for (const route of ordered) {
    const { arguments: args, notes: kept } = routeArguments(route.screen);
    notes.push(...kept);
    const className = sanitizeName(route.screen.name);
    const call = args.length === 0 ? `const ${className}()` : `${className}(${args.join(', ')})`;
    entries.push(`  '${route.screen.name}': (args) => ${call},`);
  }

  const lines = [
    '// GENERATED FILE - DO NOT EDIT.',
    '//',
    `// Generated by PlainUI ${options.compilerVersion} for ${options.outputPath}.`,
    '// Every screen in the project, by name, for host code that opens one.',
    '// Any change made here is overwritten the next time `plainui build` runs.',
    '//',
    '// ignore_for_file: type=lint',
    '',
    "import 'package:flutter/material.dart';",
    '',
    ...imports.map((spec) => `import '${spec}';`),
    '',
    '/// The screens of this project, keyed by their PlainUI name.',
    '///',
    '/// Built for names that arrive from outside the source — a deep link, a notification, a menu in',
    '/// Dart — where there is no import to the screen being opened:',
    '///',
    "///     Navigator.pushNamed(context, 'Detail', arguments: {'id': '42'});",
    '///',
    '/// `navigate Detail(id: x)` in a `.pui` file does not go through this table; it constructs the',
    '/// screen directly, so the arguments are checked at compile time.',
    `final Map<String, Widget Function(Map<String, Object?>)> ${ROUTES_MAP} = <String, Widget Function(Map<String, Object?>)>{`,
    ...entries,
    '};',
  ];

  if (notes.length > 0) lines.push('', ...notes);
  return `${lines.join('\n')}\n`;
}
