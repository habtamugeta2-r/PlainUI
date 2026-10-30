/**
 * The roadmap is data, so it can be tested like data.
 *
 * A roadmap that lives in prose is wrong within a month: something gets finished and nobody updates
 * the page, or an item has no way to be recognised as finished. These tests make the table
 * self-checking, and `plainui next` prints it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { renderTodo } from '../scripts/gen-reference.ts';
import { main } from '../src/tooling/cli.ts';
import type { PhaseId } from '../src/tooling/todo.ts';
import { PHASES, TODO, currentItem, currentPhase, itemsOf, progressOf } from '../src/tooling/todo.ts';

const SIZES = new Set(['S', 'M', 'L', 'XL']);
const STATUSES = new Set(['done', 'next', 'todo']);

test('every item has everything needed to act on it', () => {
  for (const item of TODO) {
    assert.match(item.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${item.id} is not kebab-case`);
    assert.ok(item.title.trim().length > 0, `${item.id} has no title`);
    assert.ok(SIZES.has(item.size), `${item.id} has size ${item.size}`);
    assert.ok(STATUSES.has(item.status), `${item.id} has status ${item.status}`);
    // The acceptance criterion is the point: without one, "done" is an opinion.
    assert.ok(item.acceptance.length > 20, `${item.id} needs an acceptance criterion`);
    assert.ok(item.touches.length > 0, `${item.id} says nothing about where it lands`);
  }
});

test('identifiers are unique and phases exist', () => {
  const ids = TODO.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(', ')}`);
  const phaseIds = new Set(PHASES.map((phase) => phase.id));
  for (const item of TODO) assert.ok(phaseIds.has(item.phase), `${item.id} is in unknown phase ${item.phase}`);
});

test('exactly one item is "next", and it is the earliest unfinished one', () => {
  const upcoming = TODO.filter((item) => item.status === 'next');
  assert.ok(upcoming.length <= 1, `more than one item is marked next: ${upcoming.map((i) => i.id).join(', ')}`);
  const now = currentItem();
  assert.ok(now !== undefined);
  if (upcoming.length === 1) assert.equal(now!.status, 'next');
  // Nothing unfinished may be scheduled before the current item.
  const index = TODO.indexOf(now!);
  assert.equal(
    TODO.slice(0, index).filter((item) => item.status !== 'done').length,
    0,
    'an unfinished item is ordered before the current one',
  );
});

test('the current item belongs to the first phase that is not finished', () => {
  const phase = currentPhase();
  assert.ok(phase !== undefined);
  const firstOpen = PHASES.find((candidate) => progressOf(candidate.id).done < progressOf(candidate.id).total);
  assert.equal(phase!.id, firstOpen?.id ?? phase!.id);
});

test('progress counts what it says it counts', () => {
  let done = 0;
  for (const phase of PHASES) {
    const progress = progressOf(phase.id);
    assert.equal(progress.total, itemsOf(phase.id).length);
    assert.equal(progress.done, itemsOf(phase.id).filter((item) => item.status === 'done').length);
    done += progress.done;
  }
  assert.equal(done, TODO.filter((item) => item.status === 'done').length);
});

test('the generated todo page is up to date', () => {
  assert.equal(
    readFileSync('docs/11-todo.md', 'utf8'),
    renderTodo(),
    'docs/11-todo.md is stale — run npm run docs:ref',
  );
});

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(args: readonly string[]): Promise<Run> {
  let out = '';
  let err = '';
  type Write = typeof process.stdout.write;
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as Write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    err += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as Write;
  try {
    const code = await main(args);
    return { code, out, err };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

test('plainui next names the current item and hides finished work by default', async () => {
  const result = await run(['next']);
  assert.equal(result.code, 0);
  const now = currentItem()!;
  assert.match(result.out, new RegExp(now.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.out, /Flutter depth|v2\.0 architecture|Adoption surface/);
  assert.doesNotMatch(result.out, /✔/, 'finished items only appear with --all');
});

test('plainui next --all shows finished items, --phase narrows the output', async () => {
  const all = await run(['next', '--all']);
  assert.match(all.out, /✔/);
  // When the earlier phases are finished, --phase is the only way to see their history.
  const finishedPhase = PHASES.find((phase) => progressOf(phase.id).done > 0)!.id;
  const phase = await run(['next', '--phase', finishedPhase, '--all']);
  assert.equal(phase.code, 0);
  assert.doesNotMatch(phase.out, new RegExp(PHASES.find((p) => p.id !== finishedPhase)!.title));
});

test('plainui next --json is machine readable and matches the table', async () => {
  const result = await run(['next', '--json']);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.out) as {
    now: { id: string } | null;
    phases: { id: PhaseId; done: number; total: number; items: { id: string; status: string }[] }[];
    total: number;
    done: number;
  };
  assert.equal(payload.now?.id, currentItem()!.id);
  assert.equal(payload.total, TODO.length);
  assert.equal(payload.done, TODO.filter((item) => item.status === 'done').length);
  assert.equal(payload.phases.length, PHASES.length);
  for (const phase of payload.phases) {
    assert.equal(phase.items.length, progressOf(phase.id).total - phase.done);
  }
});

test('an unknown phase is a usage error, not a silent empty list', async () => {
  const result = await run(['next', '--phase', 'nope']);
  assert.equal(result.code, 2);
  assert.match(result.err, /unknown phase/);
});
