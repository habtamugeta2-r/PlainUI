/**
 * File watching for `plainui watch`.
 *
 * The first version polled every source file four times a second, which is fine for a handful of
 * screens and wrong for a real project: it re-stats every file whether anything changed or not,
 * and it adds up to a quarter second of latency to every save.
 *
 * This uses `fs.watch`, which is push-based. Windows and macOS support recursive watching
 * natively; on Linux Node supports it too (inotify under the hood). If the platform refuses,
 * the watcher degrades in two steps rather than failing:
 *
 *   recursive  →  one watcher per directory  →  polling
 *
 * The mode is reported so `plainui watch --verbose` can say which one is in use.
 */

import { type FSWatcher, readdirSync, statSync, watch as watchFs } from 'node:fs';
import { join } from 'node:path';

export type WatchMode = 'recursive' | 'per-directory' | 'polling';

export interface WatchOptions {
  /** Directories to watch. Missing directories are ignored rather than fatal. */
  readonly roots: readonly string[];
  /** Called once per debounced burst of changes, with the files that caused it. */
  readonly onChange: (changed: readonly string[]) => void;
  /** Which paths count as a change. Defaults to `.pui` files and `plainui.config.json`. */
  readonly isRelevant?: (path: string) => boolean;
  readonly debounceMs?: number;
  readonly pollIntervalMs?: number;
}

export interface Watcher {
  readonly mode: WatchMode;
  close(): void;
}

const DEFAULT_DEBOUNCE_MS = 60;
const DEFAULT_POLL_MS = 250;

function defaultRelevant(path: string): boolean {
  return path.endsWith('.pui') || path.endsWith('plainui.config.json');
}

/** Every directory under `root`, including `root` itself. Unreadable directories are skipped. */
function directories(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    found.push(dir);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) visit(full);
      } catch {
        // A directory that vanished between readdir and stat is not interesting.
      }
    }
  };
  visit(root);
  return found;
}

/**
 * Watches `roots` and reports changes. Returns a handle whose `mode` says which strategy was
 * actually possible — callers can log it instead of guessing.
 */
export function watchForChanges(options: WatchOptions): Watcher {
  const relevant = options.isRelevant ?? defaultRelevant;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;

  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const flush = (): void => {
    timer = undefined;
    if (closed || pending.size === 0) return;
    const changed = [...pending].sort();
    pending.clear();
    options.onChange(changed);
  };

  const record = (path: string): void => {
    if (closed || !relevant(path)) return;
    pending.add(path);
    // Coalesce the burst a single editor save produces: write, rename, attribute change.
    if (timer === undefined) timer = setTimeout(flush, debounceMs);
  };

  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  // 1. Recursive watching, if the platform allows it.
  const recursive: FSWatcher[] = [];
  let recursiveOk = false;
  try {
    for (const root of options.roots) {
      let stats;
      try {
        stats = statSync(root);
      } catch {
        continue;
      }
      if (!stats.isDirectory()) continue;
      recursive.push(watchFs(root, { recursive: true, persistent: true }, (_event, file) => {
        if (file !== null) record(join(root, file.toString()));
      }));
    }
    recursiveOk = recursive.length > 0;
  } catch {
    for (const watcher of recursive) watcher.close();
    recursive.length = 0;
    recursiveOk = false;
  }

  if (recursiveOk) {
    return {
      mode: 'recursive',
      close() {
        closed = true;
        stopTimer();
        for (const watcher of recursive) watcher.close();
      },
    };
  }

  // 2. One watcher per directory. New directories are attached as they appear.
  const perDirectory = new Map<string, FSWatcher>();
  const attach = (dir: string): void => {
    if (perDirectory.has(dir)) return;
    try {
      const watcher = watchFs(dir, { persistent: true }, (_event, file) => {
        if (file === null) return;
        const full = join(dir, file.toString());
        record(full);
        // A directory may have appeared; rescan so its own files are watched from now on.
        try {
          if (statSync(full).isDirectory()) for (const sub of directories(full)) attach(sub);
        } catch {
          // Removed or renamed: the watcher will be closed on the next rescan of its parent.
        }
      });
      perDirectory.set(dir, watcher);
    } catch {
      // Directory disappeared between listing and watching.
    }
  };

  try {
    for (const root of options.roots) {
      try {
        if (!statSync(root).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const dir of directories(root)) attach(dir);
    }
  } catch {
    for (const watcher of perDirectory.values()) watcher.close();
    perDirectory.clear();
  }

  if (perDirectory.size > 0) {
    return {
      mode: 'per-directory',
      close() {
        closed = true;
        stopTimer();
        for (const watcher of perDirectory.values()) watcher.close();
        perDirectory.clear();
      },
    };
  }

  // 3. Last resort: poll mtimes, as v1 did everywhere.
  const snapshot = (): Map<string, number> => {
    const map = new Map<string, number>();
    const visit = (dir: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        try {
          const stats = statSync(full);
          if (stats.isDirectory()) visit(full);
          else if (relevant(full)) map.set(full, stats.mtimeMs);
        } catch {
          // Ignore files that disappear mid-scan.
        }
      }
    };
    for (const root of options.roots) visit(root);
    return map;
  };

  let previous = snapshot();
  const interval = setInterval(() => {
    const next = snapshot();
    const changed: string[] = [];
    for (const [file, mtime] of next) {
      if (previous.get(file) !== mtime) changed.push(file);
    }
    for (const file of previous.keys()) {
      if (!next.has(file)) changed.push(file);
    }
    previous = next;
    if (changed.length > 0) for (const file of changed) pending.add(file);
    if (pending.size > 0) flush();
  }, pollMs);

  return {
    mode: 'polling',
    close() {
      closed = true;
      stopTimer();
      clearInterval(interval);
    },
  };
}
