/**
 * "Did you mean" support.
 *
 * Every suggestion in the compiler is computed from the set of names that would actually be
 * legal at that position, so the suggestion can never be wrong — it can only be absent.
 * See docs/00-research.md §4.
 */

/** Levenshtein distance with an early exit when the distance cannot beat `limit`. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      rowMin = Math.min(rowMin, current[j]!);
    }
    if (rowMin > limit) return limit + 1;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length]!;
}

export interface SuggestOptions {
  /** Maximum edit distance to accept. Defaults to a length-aware threshold. */
  readonly maxDistance?: number;
  readonly caseSensitive?: boolean;
}

/** Closest candidate, or undefined when nothing is close enough to be worth suggesting. */
export function suggest(name: string, candidates: Iterable<string>, options: SuggestOptions = {}): string | undefined {
  const caseSensitive = options.caseSensitive ?? true;
  const needle = caseSensitive ? name : name.toLowerCase();
  const limit = options.maxDistance ?? (name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3);

  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const haystack = caseSensitive ? candidate : candidate.toLowerCase();
    const distance = editDistance(needle, haystack, limit);
    if (distance < bestDistance && distance <= limit) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Convenience: the phrase used in hints. */
export function didYouMean(name: string, candidates: Iterable<string>, options: SuggestOptions = {}): string | undefined {
  const match = suggest(name, candidates, options);
  return match === undefined ? undefined : `did you mean \`${match}\`?`;
}

/** Comma-separated list with a cap, for "expected one of ..." hints. */
export function listOf(names: Iterable<string>, max = 8): string {
  const all = [...names];
  if (all.length <= max) return all.join(', ');
  return `${all.slice(0, max).join(', ')}, … (${all.length - max} more)`;
}
