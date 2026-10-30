/**
 * The `Target` contract.
 *
 * A target is everything about the output that the *language* has to know before it can say
 * whether a program is legal: the words the generated code reserves, the type names it would
 * shadow, the spellings its type system uses, and the constructs it can express at all.
 *
 * Two rules make this an interface rather than a bag of constants:
 *
 * 1. **The front end asks the target, and names no framework.** `check.ts` never says "Dart"; it
 *    says `target.reservedWords` and `target.label`. That is what makes a second target a data
 *    change instead of a search-and-replace.
 * 2. **A capability is declared, not inferred.** `CAPABILITIES` is the whole list, every target
 *    answers for every entry, and a construct that a target cannot express is a diagnostic rather
 *    than output that quietly means something else. A target that cannot do `effect` says so; it
 *    does not emit a comment and move on.
 *
 * What is deliberately *not* here: widget constructor names, property-to-argument maps and the
 * element vocabulary. Those are the language's own vocabulary — `column`, `padding=`, `text` mean
 * the same thing in every target — and they live in `analysis/widgets/registry.ts`, where the
 * front end can check them once for all targets.
 */

/** The targets this compiler can emit. Adding one is a file in `src/targets/` plus a generator. */
export type TargetId = 'flutter' | 'html';

/**
 * The constructs a target may or may not be able to express, in the order the roadmap introduces
 * them. Every target answers for all of them: an absent capability is a statement, not an
 * oversight, and `tests/targets.test.ts` fails if a new one is added without an answer.
 */
export const CAPABILITIES = [
  'state',
  'derived',
  'effects',
  'tasks',
  'forms',
  'navigation',
  'host-surfaces',
  'themes',
  'styles',
  'list-identity',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** What a target does with a capability it does not fully support. */
export interface CapabilityNote {
  /**
   * `full` — the construct does what the specification says.
   * `partial` — it is rendered or emitted, but something a real host would do is missing.
   * `none` — the target cannot express it.
   */
  readonly level: 'full' | 'partial' | 'none';
  /** One sentence, written for someone deciding whether this target is enough. */
  readonly note: string;
}

export interface TargetTypeSyntax {
  /** Text placed before a mapped type or generic arguments. */
  readonly prefix: string;
  /** Text placed after a mapped type or generic arguments. */
  readonly suffix: string;
  /** Separator between generic arguments; defaults to `, `. */
  readonly separator?: string;
}

/** Target-owned spellings for PlainUI's semantic types and generic constructors. */
export interface TargetTypeNames {
  readonly Text: string;
  readonly Int: string;
  readonly Float: string;
  readonly Bool: string;
  readonly Num: string;
  readonly Dynamic: string;
  readonly Color: string;
  readonly Duration: string;
  readonly [alias: string]: string;
}

export interface TargetTypeMap {
  /** PlainUI names and recognized legacy/host aliases mapped to output-language names. */
  readonly names: TargetTypeNames;
  /** How this target represents `Optional<T>`. */
  readonly optional: TargetTypeSyntax;
  /** Output syntax for core and host generic constructors. */
  readonly generics: Readonly<{
    List: TargetTypeSyntax;
    Iterable: TargetTypeSyntax;
    Set: TargetTypeSyntax;
    Map: TargetTypeSyntax;
    Future: TargetTypeSyntax;
  }>;
}

export interface Target {
  readonly id: TargetId;
  /** The name to use in diagnostics: `Flutter`, `HTML preview`. */
  readonly label: string;
  /** The language the output is written in, for hints: `Dart`, `HTML`. */
  readonly language: string;
  /** Extension of a generated file, including the dot. */
  readonly outputExtension: string;
  /** Extensions a host module may have when a `.pui` file imports it. */
  readonly hostExtensions: readonly string[];

  /** Words the target language reserves; a `.pui` name may not be one of them. */
  readonly reservedWords: ReadonlySet<string>;
  /** Type names the target's library provides. A generated class with one of these names shadows it. */
  readonly shadowedTypes: ReadonlySet<string>;
  /** Spellings people write by mistake, mapped to the spelling the target uses. */
  readonly typeSpellings: Readonly<Record<string, string>>;
  /** How PlainUI semantic types lower into this target's output language. */
  readonly types: TargetTypeMap;
  /** Enum names from the target's own API, mapped to the PlainUI spelling. */
  readonly enumAliases: Readonly<Record<string, string>>;

  /** One entry per entry of `CAPABILITIES`. */
  readonly capabilities: Readonly<Record<Capability, CapabilityNote>>;
}

/** True when the target can express the construct at all (`full` or `partial`). */
export function supports(target: Target, capability: Capability): boolean {
  return target.capabilities[capability].level !== 'none';
}

/** True when the construct means exactly what the specification says on this target. */
export function fullySupports(target: Target, capability: Capability): boolean {
  return target.capabilities[capability].level === 'full';
}
