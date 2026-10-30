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
it, and in per-directory mode each new directory is attached as it appears.

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

## Configuration

`plainui.config.json`, found in the working directory or the nearest parent:

```json
{
  "srcDir": "lib/ui",
  "outDir": "lib/generated",
  "target": "flutter",
  "exclude": ["legacy/"]
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `srcDir` | `lib/ui` | Where sources live when no path is given. |
| `outDir` | `lib/generated` | Where generated Dart goes (project-relative). |
| `target` | `flutter` | Code generator to use. Only `flutter` is implemented. |
| `exclude` | `[]` | Path substrings to skip while discovering sources. |

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
