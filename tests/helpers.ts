import assert from 'node:assert/strict';
import { DiagnosticBag, type Diagnostic } from '../src/analysis/diagnostics.ts';
import { type SourceFile, sourceFile } from '../src/frontend/source.ts';

export function parseSource(text: string, path = 'test.pui'): SourceFile {
  return sourceFile(path, text);
}

export interface Lexed {
  readonly file: SourceFile;
  readonly bag: DiagnosticBag;
  readonly diagnostics: Diagnostic[];
}

export function codes(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

export function assertNoErrors(bag: DiagnosticBag, label = ''): void {
  const errors = bag.diagnostics.filter((d) => d.severity === 'error');
  assert.equal(
    errors.length,
    0,
    `${label}expected no errors, got:\n${errors.map((d) => `${d.code} ${d.message}`).join('\n')}`,
  );
}

export function hasError(bag: DiagnosticBag, code: string): boolean {
  return bag.diagnostics.some((d) => d.code === code && d.severity === 'error');
}

/** Deterministic snapshot helper: uses JSON with sorted keys for AST comparisons. */
export function stableJson(value: unknown): string {
  const seen = new Set<unknown>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      const coerced = (v as Record<string, unknown>)[key];
      if (coerced === undefined) continue;
      out[key] = walk(coerced);
    }
    return out;
  };
  return JSON.stringify(walk(value), null, 2);
}

export function indentAll(text: string, prefix = '  '): string {
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : prefix + line))
    .join('\n');
}
