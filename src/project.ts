/**
 * Project-level compilation.
 *
 * A `.pui` file is rarely alone: screens import host libraries and other `.pui` files, and the
 * generated Dart must have imports that are valid from *its* location, not from the source's.
 * This module owns that bookkeeping. It is pure: it takes file contents and returns file
 * contents, so the CLI can read from disk and the playground can read from `localStorage`.
 */

import type { ComponentDecl, Program } from './ast.ts';
import { check, type CheckOptions } from './check.ts';
import { generateFlutter } from './codegen/flutter.ts';
import type { Diagnostic } from './diagnostics.ts';
import { DiagnosticBag } from './diagnostics.ts';
import { parse } from './parser.ts';
import { basename, camelCase, dartImportSpecifier, dirname, extensionOf, joinPath, normalizePath } from './paths.ts';
import { sourceFile, type SourceFile } from './source.ts';
import { COMPILER_VERSION } from './compile.ts';

export interface SourceInput {
  readonly path: string;
  readonly text: string;
}

export interface ProjectOptions extends CheckOptions {
  /** Directory (project-relative) for generated files. */
  readonly outDir?: string;
  readonly compilerVersion?: string;
}

export interface FileResult {
  readonly source: SourceFile;
  readonly program: Program;
  /** Generated output path, absent when compilation failed. */
  readonly outputPath?: string;
  readonly code?: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ProjectResult {
  readonly ok: boolean;
  readonly files: readonly FileResult[];
  readonly diagnostics: readonly Diagnostic[];
}

const DEFAULT_OUT_DIR = 'lib/generated';

export function outputPathFor(sourcePath: string, outDir = DEFAULT_OUT_DIR): string {
  return joinPath(outDir, `${basename(sourcePath)}.dart`);
}

export function compileProject(inputs: readonly SourceInput[], options: ProjectOptions = {}): ProjectResult {
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const version = options.compilerVersion ?? COMPILER_VERSION;

  const sources = new Map<string, SourceFile>();
  for (const input of inputs) {
    const path = normalizePath(input.path);
    sources.set(path, sourceFile(path, input.text));
  }

  const parsed = new Map<string, { program: Program; bag: DiagnosticBag }>();
  for (const [path, source] of sources) {
    parsed.set(path, parse(source));
  }

  // Global declaration names, for duplicate detection across files.
  const declaredNames = new Map<string, string>();
  for (const [path, entry] of parsed) {
    for (const decl of entry.program.decls) {
      if (decl.kind === 'Style') continue;
      if (!declaredNames.has(decl.name)) declaredNames.set(decl.name, path);
    }
  }

  interface ImportResolution {
    readonly plainuiComponents: Map<string, ComponentDecl>;
    readonly plainuiEdges: Map<string, string>; // import path as written -> target source path
    readonly hostRoots: Set<string>;
  }

  const resolutions = new Map<string, ImportResolution>();

  for (const [path, entry] of parsed) {
    const components = new Map<string, ComponentDecl>();
    const edges = new Map<string, string>();
    const hostRoots = new Set<string>();

    for (const imp of entry.program.imports) {
      if (extensionOf(imp.path) === '.pui') {
        const target = normalizePath(joinPath(dirname(path), imp.path));
        edges.set(imp.path, target);
        const targetEntry = parsed.get(target);
        if (targetEntry === undefined) {
          entry.bag.error({
            code: 'PUI3001',
            message: `cannot find "${imp.path}"`,
            span: imp.pathSpan,
            hint: `resolved to ${target}, which is not part of this compilation`,
          });
          continue;
        }
        for (const decl of targetEntry.program.decls) {
          if (decl.kind === 'Component') components.set(decl.name, decl);
        }
      } else {
        const stem = basename(imp.path, true);
        hostRoots.add(stem);
        hostRoots.add(camelCase(stem));
      }
    }

    resolutions.set(path, { plainuiComponents: components, plainuiEdges: edges, hostRoots });
  }

  // ---- validate ---------------------------------------------------------------------------
  const checked = new Map<string, ReturnType<typeof check>>();
  for (const [path, entry] of parsed) {
    const source = sources.get(path)!;
    const resolution = resolutions.get(path)!;
    const result = check(source, entry.program, {
      externalComponents: resolution.plainuiComponents,
      hostRoots: resolution.hostRoots,
      externalNames: new Map([...declaredNames].filter(([name, file]) => file !== path)),
    });
    entry.bag.merge(result.bag);
    checked.set(path, result);
  }

  // Output path collisions across the project.
  const usedOutputs = new Map<string, string>();
  for (const path of parsed.keys()) {
    const output = outputPathFor(path, outDir);
    const previous = usedOutputs.get(output);
    if (previous !== undefined) {
      parsed.get(path)!.bag.error({
        code: 'PUI3101',
        message: `"${path}" and "${previous}" would both generate ${output}`,
        span: { start: 0, end: 0 },
        hint: 'give the source files different names, or set a different outDir',
      });
    }
    usedOutputs.set(output, path);
  }

  const allDiagnostics: Diagnostic[] = [];
  const files: FileResult[] = [];
  let ok = true;

  for (const [path, entry] of parsed) {
    const source = sources.get(path)!;
    const diagnostics = entry.bag.sorted();
    allDiagnostics.push(...diagnostics);
    if (entry.bag.hasErrors) ok = false;
    files.push({ source, program: entry.program, diagnostics });
  }

  if (!ok) {
    return { ok, files: files.map((file) => ({ ...file })), diagnostics: allDiagnostics };
  }

  // ---- generate ---------------------------------------------------------------------------
  const generated: FileResult[] = [];
  for (const [path, entry] of parsed) {
    const source = sources.get(path)!;
    const resolution = resolutions.get(path)!;
    const outputPath = outputPathFor(path, outDir);
    const analysis = checked.get(path)!.analysis;

    const code = generateFlutter(analysis, source, {
      compilerVersion: version,
      sourcePath: path,
      resolvePlainuiImport: (importPath: string): string => {
        const target = resolution.plainuiEdges.get(importPath);
        if (target === undefined) return importPath;
        return dartImportSpecifier(outputPath, outputPathFor(target, outDir));
      },
      rebaseImport: (importPath: string): string => {
        const target = normalizePath(joinPath(dirname(path), importPath));
        return dartImportSpecifier(outputPath, target);
      },
    }).code;

    generated.push({
      source,
      program: entry.program,
      outputPath,
      code,
      diagnostics: entry.bag.sorted(),
    });
  }

  return { ok, files: generated, diagnostics: allDiagnostics };
}

/** Convenience for single-file use in tests and the playground. */
export function compileOne(path: string, text: string, options: ProjectOptions = {}): FileResult {
  const result = compileProject([{ path, text }], options);
  const file = result.files[0];
  if (file === undefined) throw new Error('compileProject returned no files');
  return file;
}
