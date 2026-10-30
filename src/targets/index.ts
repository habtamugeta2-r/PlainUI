/**
 * The target registry. One entry per generator, and the entry the front end reads when it has to
 * decide whether a name is legal or a spelling is wrong.
 */

import { CAPABILITIES, type Capability, type Target, type TargetId, fullySupports, supports } from './contract.ts';
import { FLUTTER_TARGET } from './flutter.ts';
import { HTML_TARGET } from './html.ts';

export { CAPABILITIES, fullySupports, supports };
export type { Capability, Target, TargetId };
export { FLUTTER_TARGET, HTML_TARGET };

export const TARGETS: ReadonlyMap<TargetId, Target> = new Map<TargetId, Target>([
  [FLUTTER_TARGET.id, FLUTTER_TARGET],
  [HTML_TARGET.id, HTML_TARGET],
]);

/** The target a compilation uses when nothing selects one. Flutter is the product. */
export const DEFAULT_TARGET: Target = FLUTTER_TARGET;

/** Look a target up by id, or return undefined when the id is not one we emit. */
export function targetById(id: string): Target | undefined {
  return TARGETS.get(id as TargetId);
}

/** The ids, for error messages that have to list them. */
export function targetIds(): TargetId[] {
  return [...TARGETS.keys()];
}
