/**
 * The roadmap, as data.
 *
 * Prose roadmaps rot: an item is quietly finished, another quietly stops mattering, and the page
 * keeps claiming both. This table is the source of truth instead — `plainui next` prints it,
 * `npm run docs:ref` renders it into `docs/11-todo.md`, and `tests/todo.test.ts` refuses an item
 * without an acceptance criterion, a size, or an owner-shaped `touches` list.
 *
 * Adding work means adding an entry here; finishing work means changing `status`. Nothing else.
 */

/** Which phase of the plan an item belongs to. The order of `PHASES` is the order of execution. */
export type PhaseId = 'flutter-depth' | 'architecture' | 'adoption';

export type TodoSize = 'S' | 'M' | 'L' | 'XL';

/**
 * `next` is the item being worked on, `todo` is queued, `done` is finished. There is exactly one
 * `next` per phase at most, and `plainui next` prints the first one it finds.
 */
export type TodoStatus = 'done' | 'next' | 'todo';

export interface Phase {
  readonly id: PhaseId;
  readonly title: string;
  /** What has to be true before the phase is finished. Empty for the last phase. */
  readonly gate?: string;
}

export interface TodoItem {
  /** Stable identifier, kebab-case. Never reused for a different item. */
  readonly id: string;
  readonly phase: PhaseId;
  readonly title: string;
  readonly size: TodoSize;
  readonly status: TodoStatus;
  /** How anyone can tell it is finished. Written before the work starts, not after. */
  readonly acceptance: string;
  /** The files or areas the work lands in, for whoever picks it up. */
  readonly touches: readonly string[];
}

export const PHASES: readonly Phase[] = [
  {
    id: 'flutter-depth',
    title: 'Flutter depth',
    gate:
      'A demo app — navigation, tokens, async, forms and keyed lists — written without dropping into Dart ' +
      'for anything routine.',
  },
  {
    id: 'architecture',
    title: 'v2.0 architecture',
    gate:
      'One `.pui` project compiles to Flutter and Jetpack Compose, both verified in CI, with a test that ' +
      'asserts which files port and which fail with a named code.',
  },
  {
    id: 'adoption',
    title: 'Adoption surface',
    gate: 'A stranger can install the compiler, add it to an existing app and be productive in ten minutes.',
  },
];

export const TODO: readonly TodoItem[] = [
  // ---------------------------------------------------------------- flutter depth
  {
    id: 'design-tokens',
    phase: 'flutter-depth',
    title: 'Design tokens',
    size: 'L',
    status: 'done',
    acceptance:
      'A `theme` block declares colours, spaces and radii; `padding=md` resolves at compile time; a token ' +
      'in the wrong slot is PUI2304; Flutter emits `AppTokens`/`AppTheme`, HTML emits `--pui-*`.',
    touches: ['src/frontend/parser.ts', 'src/analysis/check.ts', 'src/codegen/flutter.ts', 'src/codegen/html.ts'],
  },
  {
    id: 'task',
    phase: 'flutter-depth',
    title: '`task` — async values',
    size: 'L',
    status: 'done',
    acceptance:
      '`task items: List<Todo> = load()` exposes loading/error/value/retry; the generated loader resets ' +
      'before the await and checks `mounted` after it; `examples/async` is widget-tested in CI.',
    touches: ['src/frontend/ast.ts', 'src/analysis/check.ts', 'src/codegen/flutter.ts', 'examples/async'],
  },
  {
    id: 'list-identity',
    phase: 'flutter-depth',
    title: 'List identity',
    size: 'S',
    status: 'done',
    acceptance:
      '`for item in items key=item.id:` wraps the row in `KeyedSubtree(key: ValueKey(...))`; the key is ' +
      'checked in the loop scope; the todo example uses it.',
    touches: ['src/frontend/parser.ts', 'src/codegen/flutter.ts', 'examples/todo'],
  },
  {
    id: 'navigation',
    phase: 'flutter-depth',
    title: 'Navigation',
    size: 'L',
    status: 'done',
    acceptance:
      '`screen Detail(id: String)` takes parameters; `navigate Detail(id=x)` and `back()` are checked ' +
      'against the target screen; a project-level route table is generated; an example taps through and ' +
      'back in a widget test.',
    touches: ['src/frontend/parser.ts', 'src/project/project.ts', 'src/codegen/flutter.ts', 'examples/navigation'],
  },
  {
    id: 'task-cancellation',
    phase: 'flutter-depth',
    title: 'Latest-wins task cancellation',
    size: 'S',
    status: 'done',
    acceptance:
      'A retry during an in-flight load cannot be overwritten by the older result; a test with two ' +
      'differing delays proves the second result wins.',
    touches: ['src/codegen/flutter.ts', 'tests/task.test.ts'],
  },
  {
    id: 'forms',
    phase: 'flutter-depth',
    title: 'Forms and validation',
    size: 'L',
    status: 'done',
    acceptance:
      'Typed validators (required, min, max, pattern, email) on `input`; a `form` scope gates `submit`; ' +
      'an invalid submission is impossible to express, not merely discouraged.',
    touches: ['src/analysis/widgets/registry.ts', 'src/analysis/check.ts', 'src/codegen/flutter.ts'],
  },
  {
    id: 'typed-interop',
    phase: 'flutter-depth',
    title: 'Typed interop',
    size: 'M',
    status: 'done',
    acceptance:
      'Host components and imports are declared with signatures, and calls to them are type-checked ' +
      'rather than passed through.',
    touches: ['src/analysis/check.ts', 'src/project/project.ts'],
  },
  {
    id: 'derived',
    phase: 'flutter-depth',
    title: '`derived` values',
    size: 'M',
    status: 'done',
    acceptance:
      '`derived total = count * 2` recomputes when its inputs change and never stores state; a widget ' +
      'test shows the derived value updating while an unrelated state change leaves it alone.',
    touches: ['src/frontend/parser.ts', 'src/analysis/check.ts', 'src/codegen/flutter.ts'],
  },
  {
    id: 'effect',
    phase: 'flutter-depth',
    title: '`effect on <state>`',
    size: 'M',
    status: 'done',
    acceptance:
      'An effect runs on mount and after a change to the states it names, and not on an unrelated ' +
      'state change; the lowering compares a snapshot of those states in `build` and runs the body ' +
      'after the frame, which is the shape `useEffect` and `LaunchedEffect` share.',
    touches: ['src/frontend/parser.ts', 'src/analysis/check.ts', 'src/codegen/flutter.ts'],
  },
  {
    id: 'phase-gate-demo',
    phase: 'flutter-depth',
    title: 'Phase gate: the demo app',
    size: 'M',
    status: 'done',
    acceptance:
      'One app uses navigation, tokens, async, forms and keyed lists with no hand-written Dart beyond ' +
      '`main.dart`, and is verified in CI like the other examples.',

    touches: ['examples/demo', '.github/workflows/flutter-verify.yml'],
  },

  // ---------------------------------------------------------------- v2.0 architecture
  {
    id: 'target-contract',
    phase: 'architecture',
    title: 'The `Target` contract',
    size: 'L',
    status: 'done',
    acceptance:
      'Flutter and HTML knowledge (keywords, type names, enum maps, icon names, capabilities) lives behind ' +
      'one interface per target; the front end no longer names a framework.',
    touches: ['src/targets/', 'src/analysis/check.ts'],
  },
  {
    id: 'capability-matrix',
    phase: 'architecture',
    title: 'Capability matrix and its test',
    size: 'M',
    status: 'next',
    acceptance:
      'Every example is compiled for every target; the test asserts which files port and which fail with ' +
      'a code that names the alternative.',
    touches: ['tests/', 'src/targets/', 'src/project/workspace.ts'],
  },
  {
    id: 'plainui-types',
    phase: 'architecture',
    title: 'PlainUI type system',
    size: 'XL',
    status: 'todo',
    acceptance:
      '`Text`/`Int`/`Float`/`Bool`/`Optional` replace Dart spellings in `.pui`, each target maps them, and ' +
      '`plainui migrate` rewrites existing projects.',
    touches: ['src/frontend/ast.ts', 'src/analysis/check.ts', 'src/codegen/'],
  },
  {
    id: 'compose-target',
    phase: 'architecture',
    title: 'Jetpack Compose target',
    size: 'XL',
    status: 'todo',
    acceptance:
      'A `.pui` project generates Kotlin that compiles under Gradle in CI; `state`, `derived` and `task` ' +
      'lower to `remember`, `derivedStateOf` and `produceState` without special cases.',
    touches: ['src/codegen/kotlin.ts', '.github/workflows/'],
  },

  // ---------------------------------------------------------------- adoption surface
  {
    id: 'plainui-next',
    phase: 'adoption',
    title: '`plainui next` — the roadmap as a command',
    size: 'S',
    status: 'done',
    acceptance:
      'The roadmap is data in `src/tooling/todo.ts`; `plainui next [--json] [--all] [--phase]` prints it; ' +
      '`docs/11-todo.md` is generated from it and checked by `npm run docs:check`.',
    touches: ['src/tooling/todo.ts', 'src/tooling/cli.ts', 'scripts/gen-reference.ts'],
  },
  {
    id: 'existing-app-tutorial',
    phase: 'adoption',
    title: 'Add PlainUI to an existing Flutter app',
    size: 'S',
    status: 'todo',
    acceptance:
      'A ten-minute tutorial: install, one screen compiled next to hand-written widgets, one import, no ' +
      'project-wide rewrite.',
    touches: ['docs/', 'README.md'],
  },
  {
    id: 'release-pipeline',
    phase: 'adoption',
    title: 'Release pipeline',
    size: 'M',
    status: 'todo',
    acceptance:
      'Version lives in one place; CI packs the tarball, installs it into a scratch project and runs the ' +
      'smoke test before anything is published.',
    touches: ['package.json', '.github/workflows/ci.yml', 'scripts/'],
  },
];

/** Items of one phase, in declaration order. */
export function itemsOf(phase: PhaseId): TodoItem[] {
  return TODO.filter((item) => item.phase === phase);
}

/** How far a phase has got. */
export function progressOf(phase: PhaseId): { done: number; total: number } {
  const items = itemsOf(phase);
  return { done: items.filter((item) => item.status === 'done').length, total: items.length };
}

/** The item being worked on: the first `next`, else the first `todo`. */
export function currentItem(): TodoItem | undefined {
  return TODO.find((item) => item.status === 'next') ?? TODO.find((item) => item.status === 'todo');
}

/** The phase of the current item, which is the phase `plainui next` reports first. */
export function currentPhase(): Phase | undefined {
  const item = currentItem();
  return item === undefined ? undefined : PHASES.find((phase) => phase.id === item.phase);
}
