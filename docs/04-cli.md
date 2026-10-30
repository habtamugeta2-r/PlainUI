# Command line reference

```
plainui <command> [paths...] [options]
```

`plainui` is a single file with no runtime dependencies (`dist/cli.js`, bundled with esbuild).
Install it with `npm i -D @plainui/compiler` or run it from a checkout with `npm run build`.

## Commands

### `plainui build`

Compiles `.pui` files to Dart.

```bash
plainui build                      # uses plainui.config.json
plainui build lib/ui               # a directory
plainui build lib/ui/home.pui      # a single file
plainui build lib/ui --out lib/dart
plainui build --check              # compare instead of writing
```

- Writes only files whose content changed, and reports
  `N compiled, M written, K unchanged`.
- A project that navigates also generates `plainui_routes.dart` in the output directory: every
  screen, by name, for host code that opens one from a deep link or a notification. It is counted,
  written and compared by `--check` like any other generated file, and it is not generated at all
  when nothing navigates.
- Prints diagnostics to **stderr**, summaries to **stdout**.
- With `--check` it compares the generated content with what is on disk, writes nothing, and
  exits `3` if anything is out of date — useful in CI and pre-commit hooks.
- Never writes when any file has an error.

### `plainui check`

Validates without writing. `--json` prints one JSON object per line:

```json
{"file":"lib/ui/home.pui","code":"PUI2001","severity":"error","message":"unknown element \"colum\"","hint":"did you mean \"column\"?","start":{"line":4,"column":5,"offset":42},"end":{"line":4,"column":10,"offset":47}}
```

Exit code `1` when there are errors, `0` otherwise (warnings included).

### `plainui watch`

Rebuilds when a `.pui` file — or `plainui.config.json` — is added, removed or changed.

Watching is push-based (`fs.watch`) and degrades instead of failing: recursive watching where the
platform allows it, then one watcher per directory, then polling every 250 ms. `--verbose` prints
which strategy is in use. Saves are debounced by 60 ms, so the three events an editor emits for one
keystroke produce one rebuild, and a save during a build queues exactly one follow-up rather than
stacking builds.

A new file in a directory that did not exist at startup is picked up: the recursive watcher sees
it, and in per-directory mode each new directory is attached as it appears. A directory event is
itself a reason to rebuild — `mkdir parts && echo … > parts/a.pui` gives the file no event of its
own — and the generated output directory is excluded, so a build never triggers the next one.

Watching starts *before* the first compile, so a save that lands while it runs is a change rather
than a miss: polling takes its baseline snapshot at startup, and anything written before that used
to be invisible.

`PLAINUI_WATCH_MODE=recursive|per-directory|polling` forces a strategy. It is there for network
filesystems, where `fs.watch` reports nothing, and for tests that need to exercise the fallbacks
deliberately instead of hoping the platform picks them.

Changes are incremental: the session keeps a per-file cache keyed by the file's text, its imports
and the project's declaration table, so saving one screen recompiles one screen. `--verbose` shows
what happened:

```
[2:37:43 PM] change detected — lib/ui/counter.pui
  cache: 0 reused, 1 recompiled (1 entries)
  wrote lib/generated/counter.pui.dart
```

### `plainui lsp`

A language server on stdin/stdout, for any editor that speaks LSP.

```jsonc
// Neovim: init.lua
vim.lsp.start({ name = 'plainui', cmd = { 'plainui', 'lsp' }, root_dir = vim.fs.dirname(vim.fs.find({ 'plainui.config.json' }, { upward = true })[1]) })
```

It provides three things, each small and complete rather than broad and half-working:

| Capability | Behaviour |
| --- | --- |
| `publishDiagnostics` | On open, change and save. Same codes, severities, spans and hints as `plainui check`, so the editor and CI agree. |
| `formatting` | Whole-document edit from the same formatter `plainui format` runs. |
| `hover` | Element and property documentation from the widget registry. |

Diagnostics are project-aware: the editor buffer replaces the file on disk, but its siblings are
read from disk, so `TaskRow(task)` imported from another `.pui` file resolves exactly as it does in
a build. Files outside the configured `srcDir` are compiled on their own.

Full sync only: the editor sends the whole document on each change. That is the honest choice for a
compiler that re-analyses a file in well under a millisecond — incremental sync would add bugs for
latency nobody can measure. Completion, go-to-definition and formatting-on-type are not implemented;
see [`06-roadmap.md`](06-roadmap.md).

### `plainui format`

Applies the canonical style: four-space indentation, normalised spacing, one blank line between
declarations, collapsed blank runs, a single trailing newline, comments preserved in place.

```bash
plainui format                 # rewrite in place
plainui format --check         # exit 3 if anything would change
plainui format --stdout        # print instead of writing
```

A file that does not lex is left untouched, with a note on stderr: the formatter never guesses.

### `plainui init`

Creates `plainui.config.json` and `lib/ui/home.pui` (a working counter screen) in the current
directory or the one given. Existing files are never overwritten.

### `plainui ast <file>` / `plainui tokens <file>`

Dump the parsed tree or the token stream. These exist because "what did the compiler see?" is
the first question in every bug report.

### `plainui explain <code>`

Prints the catalogue entry for a diagnostic code, including the fix. Without an argument it
lists every code and title.

### `plainui widgets`

Lists every built-in element with its arguments, properties and events, straight from the
registry — the same data `docs/07-reference.md` is generated from.

### `plainui next`

Prints the roadmap from inside the tool: the item being worked on, what "done" means for it, where
it lands, and how much of each phase is finished.

```bash
plainui next                     # the current item, plus unfinished work in every phase
plainui next --all               # include finished items
plainui next --phase adoption    # one phase (flutter-depth | architecture | adoption)
plainui next --json              # machine-readable, for a dashboard or a CI job
```

The table behind it lives in `src/tooling/todo.ts`, not in prose: `docs/11-todo.md` is rendered from
the same data by `npm run docs:ref`, and the test suite fails on an item with no acceptance
criterion or with two items marked `next`. An unknown `--phase` exits `2`.

## Configuration

`plainui.config.json`, found in the working directory or the nearest parent:

```json
{
  "srcDir": "lib/ui",
  "outDir": "lib/generated",
  "targets": ["flutter"],
  "exclude": ["legacy/"]
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `srcDir` | `lib/ui` | Where sources live when no path is given. |
| `outDir` | `lib/generated` | Where generated Dart goes (project-relative). |
| `targets` | `["flutter"]` | Targets every file must **port** to. Two entries makes the syntax a diet — see below. |
| `exclude` | `[]` | Path substrings to skip while discovering sources. |

The older single `"target": "flutter"` is still read, as a one-entry `targets`.

### `targets`, the portability promise

`plainui build` writes Flutter today. `targets` is a different question: which targets this project
promises every file will also be able to become. One entry (the default) is a Flutter project and
changes nothing. Two entries turn the config into a promise the compiler enforces per file:

```
error[PUI2502]: "effect" is not portable: HTML preview does not support effects
  hint: An effect runs after a frame; a static page has no frames. The initial state is what you see.
        Drop "html" from "targets", or keep this in a file the portable build skips
```

A construct a promised target delivers *partly* is an error too — `tasks`, `forms`, `navigation` and
`list-identity` are `partial` for a static page — because porting it would silently lose behaviour.
`PUI2501` is the other half: the construct the **build** target cannot express at all. An unknown
name in `targets` fails at load with the list of known targets, rather than as a diagnostic six
screens later. `examples/gallery` is the one example that names two targets and still builds.

### Which file is the project?

1. `--config <path>` if given.
2. Otherwise the nearest `plainui.config.json` at or above the working directory — and that
   directory becomes the project root, so running a command from `lib/ui/` still works.
3. With no configuration, the working directory is the root and `srcDir`/`outDir` fall back to
   the defaults.
4. A single explicit path that contains its own `plainui.config.json` is treated as its own
   project: `plainui build examples/counter` writes into
   `examples/counter/lib/generated`.

## Global options

| Option | Effect |
| --- | --- |
| `--json` | Machine-readable diagnostics (one JSON object per line). |
| `--quiet` | Suppress summaries; diagnostics still print. |
| `--verbose` | Also print `info` diagnostics and per-file writes. |
| `--no-color` | Disable ANSI colours (`NO_COLOR` and a non-TTY stdout also do this). |
| `--help`, `--version` | Usage, version. |

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Success. |
| `1` | Compilation errors, or nothing to compile. |
| `2` | Usage or configuration error. |
| `3` | Out of date — from `build --check` or `format --check`. |

## Editor and CI integration

```bash
# pre-commit
plainui check && plainui format --check && plainui build --check

# produce annotations in CI from JSON
plainui check . --json | while read -r line; do
  echo "::error file=$(echo "$line" | jq -r .file),line=$(echo "$line" | jq -r .start.line)::$(echo "$line" | jq -r .message)"
done
```

`plainui build --check` is the important one for review: it fails when a committed `.pui` file
and its generated Dart disagree, which is the only way generated code can drift.
