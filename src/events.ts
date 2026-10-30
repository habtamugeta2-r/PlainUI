/**
 * Event payloads.
 *
 * Some events deliver a value to the handler (`on change` on a text field gets the new text).
 * The name is always `value`, its type depends on the element, and both the checker (which puts
 * it in scope) and the generator (which declares the closure parameter) read this table.
 */

import { BOOL, DOUBLE, STRING, type UiType } from './ast.ts';

export const EVENT_VALUE_TYPES: Readonly<Record<string, Readonly<Record<string, UiType>>>> = {
  input: { change: STRING, submit: STRING },
  toggle: { change: BOOL },
  checkbox: { change: BOOL },
  slider: { change: DOUBLE },
};

export function eventValueType(tag: string, event: string): UiType | undefined {
  return EVENT_VALUE_TYPES[tag]?.[event];
}

export const VALUE_PARAM_NAME = 'value';
