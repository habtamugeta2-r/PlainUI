/**
 * Diagnostics: structured errors, warnings and notes with stable codes.
 *
 * Design rules (see docs/00-research.md §4):
 *   - every diagnostic has a stable code that survives rewording of the message;
 *   - every diagnostic points at a span in the source it is about;
 *   - every diagnostic that has an obvious fix carries a hint;
 *   - diagnostics are data, not strings, so the CLI, the playground and the JSON output all
 *     read the same objects.
 */

import { type Position, type SourceFile, type Span, lineText, positionAt } from '../frontend/source.ts';

export type Severity = 'error' | 'warning' | 'info';

export interface RelatedInfo {
  readonly span: Span;
  readonly message: string;
  /** Optional file when the related span lives in another file. */
  readonly file?: SourceFile;
}

export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly span: Span;
  readonly hint?: string;
  readonly related?: readonly RelatedInfo[];
  /** File the span belongs to. Filled by `DiagnosticBag.attach`. */
  readonly file?: SourceFile;
}

export interface CodeInfo {
  /** How the compiler reports this code. Severity belongs to the rule, not to the call site. */
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly fix?: string;
}

/**
 * The diagnostic catalogue. `code` values are stable; `plainui explain PUI2001` prints the
 * entry, and docs/05-diagnostics.md is generated from this table.
 */
export const CODES = {
  // ---------------------------------------------------------------- lexical / structural
  PUI1001: {
    severity: 'error',
    title: 'Invalid character',
    description: 'The lexer met a character that cannot start any token in PlainUI.',
    fix: 'Remove the character, or write it inside a string.',
  },
  PUI1002: {
    severity: 'error',
    title: 'Unterminated string',
    description: 'A string literal was opened but not closed before the end of the line. Strings cannot span lines.',
    fix: 'Add the closing double quote, or escape the quote with \\".',
  },
  PUI1003: {
    severity: 'error',
    title: 'Unexpected indentation',
    description: 'This line is indented deeper than the previous one, but the previous line does not open a block with ":".',
    fix: 'Either add a ":" to the line above, or reduce this line’s indentation.',
  },
  PUI1004: {
    severity: 'error',
    title: 'Inconsistent indentation',
    description: 'This line dedents to a column that no enclosing block uses, so the compiler cannot tell which block it belongs to.',
    fix: 'Indent this line to match its siblings.',
  },
  PUI1005: {
    severity: 'error',
    title: 'Mixed tabs and spaces',
    description: 'One indentation run mixes tab and space characters, so the same file can mean different things in different editors.',
    fix: 'Use only spaces (recommended) or only tabs for indentation.',
  },
  PUI1006: {
    severity: 'error',
    title: 'Unexpected token',
    description: 'The parser found a token that cannot appear here.',
    fix: 'Check the syntax of this line against the language reference.',
  },
  PUI1007: {
    severity: 'error',
    title: 'Expected token',
    description: 'The parser needed a specific token to continue and did not find it.',
    fix: 'See the hint for the token that was expected.',
  },
  PUI1008: {
    severity: 'error',
    title: 'Empty block',
    description: 'A line ends with ":" and opens a block, but nothing is indented under it.',
    fix: 'Indent at least one line under it, or remove the ":".',
  },
  PUI1010: {
    severity: 'error',
    title: 'Content and nested block on one line',
    description: 'An element line both supplies content and opens a nested block. This is ambiguous, so it is rejected.',
    fix: 'Move the content to its own line inside the block.',
  },
  PUI1011: {
    severity: 'error',
    title: 'Invalid number',
    description: 'A numeric literal could not be read.',
    fix: 'Write digits, optionally with one decimal point, for example 24 or 1.5.',
  },
  PUI1012: {
    severity: 'error',
    title: 'Invalid colour',
    description: 'A colour literal must be #RGB, #RRGGBB or #AARRGGBB.',
    fix: 'Use 3, 6 or 8 hexadecimal digits after "#".',
  },
  PUI1013: {
    severity: 'error',
    title: 'Orphan elif / else',
    description: 'An "elif" or "else" block does not follow an "if" block at the same indentation.',
    fix: 'Indent it to match its "if", or add the missing "if".',
  },
  PUI1014: {
    severity: 'error',
    title: 'Invalid component parameter',
    description: 'A component parameter must be written "name", "name: Type" or "name: Type = default".',
    fix: 'Check the parameter list.',
  },
  PUI1015: {
    severity: 'error',
    title: 'Unexpected top-level statement',
    description: 'Only "import", "screen", "component" and "style" declarations may appear at the top level of a file.',
    fix: 'Move this line inside a screen or component.',
  },
  PUI1016: {
    severity: 'error',
    title: 'Unbalanced brackets',
    description: 'A bracket was opened and not closed, or closed without being opened, on the same logical line.',
    fix: 'Balance the brackets.',
  },
  PUI1020: {
    severity: 'error',
    title: 'Call-style arguments on a built-in element',
    description: 'Built-in elements take space-separated arguments and properties, not a parenthesised argument list.',
    fix: 'Write text "Hello" instead of text("Hello").',
  },
  PUI1021: {
    severity: 'error',
    title: 'Unsupported expression syntax',
    description: 'PlainUI expressions are a checked subset of what the targets can express. This construct is outside that subset.',
    fix: 'Move the logic into a host function and call it from an event handler.',
  },
  PUI1022: {
    severity: 'error',
    title: 'Invalid event declaration',
    description: 'An event handler must be written "on <event>:" followed by an indented block, or a single action on the same line.',
    fix: 'For example: on tap:',
  },
  PUI1023: {
    severity: 'error',
    title: 'Invalid state declaration',
    description: 'A state declaration must be written "state <name>: <Type> = <initial value>".',
    fix: 'For example: state count: int = 0',
  },
  PUI1026: {
    severity: 'error',
    title: 'Statement not allowed here',
    description: 'This statement is only valid in a different position, for example "set" outside an event handler or a declaration inside a block.',
    fix: 'See the hint for where this statement belongs.',
  },
  PUI1027: {
    severity: 'error',
    title: 'Declaration inside a block',
    description: 'Screens, components, styles and imports live at the top level of a file, not inside a screen or component.',
    fix: 'Move the declaration to the top level.',
  },

  // ---------------------------------------------------------------- semantic
  PUI2001: {
    severity: 'error',
    title: 'Unknown element',
    description: 'The element name is not a built-in widget, not a component in scope, and is lowercase, so it cannot be a host widget constructor either.',
    fix: 'Use a built-in widget, declare the component, or capitalise the name to call a host Dart widget.',
  },
  PUI2002: {
    severity: 'error',
    title: 'Misplaced state declaration',
    description: 'State may only be declared at the top level of a screen or component, so that its lifetime is obvious.',
    fix: 'Move the state declaration to the top of the enclosing screen or component.',
  },
  PUI2003: {
    severity: 'error',
    title: 'Duplicate name',
    description: 'Two declarations in the same scope use the same name, which makes references ambiguous.',
    fix: 'Rename one of them.',
  },
  PUI2004: {
    severity: 'error',
    title: 'Children on an element that takes none',
    description: 'This element is a leaf: it renders content from its arguments and cannot contain children.',
    fix: 'Remove the nested block.',
  },
  PUI2005: {
    severity: 'error',
    title: 'Unknown identifier',
    description: 'The identifier is not a state variable, a component parameter, a loop variable or an imported value, so the compiler cannot know what it refers to.',
    fix: 'Declare it with "state", pass it as a component parameter, or call a host function instead.',
  },
  PUI2006: {
    severity: 'error',
    title: 'Duplicate declaration',
    description: 'A screen, component or style with this name is already declared in this file.',
    fix: 'Rename one of them.',
  },
  PUI2010: {
    severity: 'error',
    title: 'Empty screen or component',
    description: 'A screen or component must render at least one element.',
    fix: 'Add at least one element to the body.',
  },
  PUI2011: {
    severity: 'error',
    title: 'Name collides with a target type',
    description: 'The generated file imports its target’s library, so a screen, component or state variable with this name would shadow a type the generated code needs.',
    fix: 'Rename it, for example PostsScreen instead of ListView.',
  },
  PUI2012: {
    severity: 'error',
    title: 'Reserved word',
    description: 'This name is a PlainUI keyword, or a word the selected target reserves, and cannot be used as an identifier.',
    fix: 'Choose a different name.',
  },

  // ---------------------------------------------------------------- element usage
  PUI2101: {
    severity: 'error',
    title: 'Unsupported event',
    description: 'This element does not support that event.',
    fix: 'See the hint for the events this element supports.',
  },
  PUI2102: {
    severity: 'error',
    title: 'Unknown property',
    description: 'The property is not defined for this element, or not defined at all.',
    fix: 'See the hint for a near match, or the widget reference in docs/07-reference.md.',
  },
  PUI2103: {
    severity: 'error',
    title: 'Duplicate event handler',
    description: 'The same event is handled twice on one element, so one of the handlers would be silently dropped.',
    fix: 'Merge the two handler bodies into one.',
  },
  PUI2104: {
    severity: 'error',
    title: 'Unknown state variable',
    description: 'The name is not a state variable of the enclosing screen or component.',
    fix: 'Declare it with "state <name>: <Type> = <value>".',
  },
  PUI2105: {
    severity: 'error',
    title: 'Cannot assign to a component parameter',
    description: 'Component parameters are immutable; only state declared in the component can be assigned.',
    fix: 'Copy the parameter into state, or let the parent own the value.',
  },
  PUI2106: {
    severity: 'error',
    title: 'bind together with on change',
    description: 'A bound element already writes to its state variable; adding an "on change" handler would write it twice.',
    fix: 'Use bind, or use on change with an explicit set — not both.',
  },
  PUI2107: {
    severity: 'error',
    title: 'Missing required argument',
    description: 'A required positional argument or property is missing.',
    fix: 'Supply it, as shown in the hint.',
  },
  PUI2108: {
    severity: 'error',
    title: 'Unknown argument',
    description: 'The element or component does not accept an argument with this name.',
    fix: 'See the hint for the arguments it accepts.',
  },
  PUI2109: {
    severity: 'error',
    title: 'Too many arguments',
    description: 'More positional arguments were supplied than the element or component accepts.',
    fix: 'Remove the extra argument, or pass it by name.',
  },
  PUI2110: {
    severity: 'error',
    title: 'Invalid property value',
    description: 'The property exists but the value has the wrong shape, for example text where a number is required.',
    fix: 'See the hint for the expected value.',
  },
  PUI2111: {
    severity: 'error',
    title: 'Invalid enum value',
    description: 'The value is not one of the accepted names for this property.',
    fix: 'See the hint for the accepted values.',
  },

  // ---------------------------------------------------------------- components and styles
  PUI2112: {
    severity: 'error',
    title: 'await outside an event handler',
    description: 'Only event handlers can be asynchronous; a widget tree is built synchronously.',
    fix: 'Move the await into an event handler, or start the work in state initialisation.',
  },
  PUI2113: {
    severity: 'error',
    title: 'Statement does nothing',
    description: 'A statement in an event handler that is not a call has no effect.',
    fix: 'Call a host function, for example save().',
  },
  PUI2114: {
    severity: 'error',
    title: 'Assignment to a design token',
    description: 'Design tokens are compile-time values, not variables, so they cannot be assigned.',
    fix: 'Keep the mutable value in "state", or use a different token.',
  },
  PUI2206: {
    severity: 'error',
    title: 'Not a target type',
    description: 'A type annotation looks like a Dart type but Dart spells it differently, so the generated file would not compile.',
    fix: 'Use the lowercase Dart spelling.',
  },
  PUI2207: {
    severity: 'warning',
    title: 'Deprecated host type spelling',
    description: 'Dart primitive type spellings are accepted for compatibility, but PlainUI has its own target-independent type vocabulary.',
    fix: 'Replace String/int/double/bool with Text/Int/Float/Bool, respectively.',
  },
  PUI2365: {
    severity: 'error',
    title: 'Optional value needs handling',
    description: 'An Optional<T> may be absent and cannot be used as a T without an explicit fallback or presence test.',
    fix: 'Use value.orElse(fallback), or test value.exists before choosing a branch.',
  },
  PUI2366: {
    severity: 'error',
    title: 'Unsupported Optional operation',
    description: 'Optional<T> exposes only the exists property and the orElse(fallback) operation.',
    fix: 'Use .exists or .orElse(fallback).',
  },
  PUI2367: {
    severity: 'error',
    title: 'Invalid Optional fallback',
    description: 'orElse takes exactly one positional fallback whose type matches the Optional value.',
    fix: 'Write value.orElse(fallback) with one compatible fallback.',
  },
  PUI2368: {
    severity: 'error',
    title: 'Optional needs a type argument',
    description: 'Optional without a type argument has no statically known value type.',
    fix: 'Write Optional<T>, for example Optional<Text>.',
  },
  PUI2205: {
    severity: 'error',
    title: 'slot outside a component',
    description: '"slot" marks where a component renders the children its caller passes; a screen has no caller.',
    fix: 'Move the slot into a component, or remove it.',
  },
  PUI2201: {
    severity: 'error',
    title: 'Missing required parameter',
    description: 'This component parameter has no default and was not supplied at the call site.',
    fix: 'Pass the value at the call site, or give the parameter a default.',
  },
  PUI2203: {
    severity: 'error',
    title: 'Children supplied to a component without a slot',
    description: 'The component has no "slot", so there is nowhere to render the children you supplied.',
    fix: 'Add a "slot" to the component body, or remove the nested block at the call site.',
  },
  PUI2204: {
    severity: 'error',
    title: 'Slot without a children parameter',
    description: 'A component that uses "slot" must accept the children it renders.',
    fix: 'Add "children: List<Widget>" to the parameter list.',
  },
  PUI2301: {
    severity: 'error',
    title: 'Unknown style property',
    description: 'A style block only accepts text properties.',
    fix: 'Use size, weight, color, family, letterSpacing, lineHeight or italic.',
  },
  PUI2302: {
    severity: 'error',
    title: 'Unknown style',
    description: 'The style name is neither a built-in style nor declared in this file.',
    fix: 'Declare it with "style <name>:", or use one of the built-in names.',
  },

  PUI2304: {
    severity: 'error',
    title: 'Token used in the wrong slot',
    description:
      'Design tokens carry a category: a colour token belongs where a colour is expected, a space or radius token where a number is. This one was used in the other kind of slot.',
    fix: 'Use a token of the expected category, or write the literal value.',
  },
  PUI2305: {
    severity: 'error',
    title: 'Duplicate token',
    description: 'Two tokens in scope share a name, so a reference would be ambiguous.',
    fix: 'Rename one of them, here or in the imported theme.',
  },
  PUI2306: {
    severity: 'error',
    title: 'Token value has the wrong shape',
    description: 'A colour token needs a colour literal and a space or radius token needs a number.',
    fix: 'Write the token as #RRGGBB, or as a number such as 16.',
  },
  PUI2307: {
    severity: 'error',
    title: 'More than one theme in a file',
    description: 'A `.pui` file declares one theme; the tokens of that theme are in scope for the whole file.',
    fix: 'Move the extra theme into its own file and import it.',
  },
  PUI2310: {
    severity: 'error',
    title: 'Task does not await a call',
    description: 'A task is defined by the future it awaits, so its value must be a call that produces one.',
    fix: 'Write the task as a host call, for example: task items: List<Todo> = loadTodos()',
  },
  PUI2311: {
    severity: 'error',
    title: 'Assignment to a task',
    description: 'A task is driven by the compiler: it loads on creation and reloads through retry().',
    fix: 'Call retry() to load it again, or keep the mutable value in "state".',
  },
  PUI2312: {
    severity: 'error',
    title: 'Unknown task member',
    description: 'A task exposes loading, error, value and retry, and nothing else.',
    fix: 'Use one of loading, error, value or retry.',
  },
  PUI2330: {
    severity: 'error',
    title: 'Not a validator',
    description:
      'validate= takes validator names — required, email, min(n), max(n) and pattern("…") — and each one takes the arguments it declares.',
    fix: 'Write validate=required, or a list such as validate=[required, email].',
  },
  PUI2331: {
    severity: 'error',
    title: 'submit() outside a form',
    description:
      'submit() validates the form around it and then runs that form\'s handler, so it only means something inside one.',
    fix: 'Wrap the fields and the button in a form, and give the form an "on submit:" handler.',
  },
  PUI2332: {
    severity: 'error',
    title: 'validate= outside a form',
    description:
      'A validator runs when a form submits. A field that is not in a form has nothing to validate it, so the rule would be silently ignored.',
    fix: 'Put the field inside a form, or remove validate=.',
  },
  PUI2333: {
    severity: 'error',
    title: 'Form has no submit handler',
    description: 'Something inside the form calls submit(), but the form declares no "on submit:" body to run.',
    fix: 'Add "on submit:" under the form, or remove the submit() call.',
  },
  PUI2334: {
    severity: 'error',
    title: 'submit() inside its own handler',
    description: 'The form\'s submit handler cannot submit the form again: validating would re-enter the same body.',
    fix: 'Call submit() from a button inside the form instead.',
  },
  PUI2335: {
    severity: 'error',
    title: 'Form inside a form',
    description:
      'A nested form would own its own validation and its own submit handler, so "the form" would stop having one meaning.',
    fix: 'Flatten the two forms into one, or move the inner one into its own screen.',
  },
  PUI2336: {
    severity: 'error',
    title: 'submit() takes no arguments',
    description: 'submit() runs the form it is written in; there is nothing to pass it.',
    fix: 'Write submit() on its own.',
  },
  PUI2350: {
    severity: 'error',
    title: 'Derived value assigned',
    description:
      'A derived value is computed from the values it reads; it has no storage to assign to, so `set` on it would have nothing to change.',
    fix: 'Assign the state the derived value reads instead.',
  },
  PUI2351: {
    severity: 'error',
    title: 'Derived value depends on itself',
    description:
      'The value is defined in terms of its own result, directly or through other derived values, so computing it would never finish.',
    fix: 'Compute one of the values in the cycle from state instead.',
  },
  PUI2352: {
    severity: 'error',
    title: 'Derived value in the wrong place',
    description:
      'A derived value is computed for the whole screen or component, so it is declared at the top level next to the state it reads.',
    fix: 'Move it up to the top level of the screen or component.',
  },
  PUI2353: {
    severity: 'error',
    title: 'Derived type mismatch',
    description: 'The declared type of a derived value does not match the type of its expression.',
    fix: 'Correct the type, or the expression.',
  },
  PUI2360: {
    severity: 'error',
    title: 'Effect watches something that is not state',
    description:
      'An effect runs when one of the states it names changes. A task, a parameter or a derived value is not state, so its change is either invisible to the target or arrives at a moment the effect cannot name.',
    fix: 'Watch the state the value is computed from, or the state the task writes into.',
  },
  PUI2361: {
    severity: 'error',
    title: 'Effect has no actions',
    description: 'An effect with an empty body runs and does nothing, which is a declaration in progress rather than a behaviour.',
    fix: 'Add the action it should run, or remove the effect.',
  },
  PUI2362: {
    severity: 'error',
    title: 'Effect in the wrong place',
    description:
      'An effect belongs to the whole screen or component, so it is declared at the top level next to the state it watches.',
    fix: 'Move it up to the top level, or put the action in an event handler.',
  },
  PUI2363: {
    severity: 'error',
    title: 'Effect writes the state it watches',
    description:
      'The effect names a state and assigns it, so every run schedules the next one: the run that changes the value is also the run that reacts to it.',
    fix: 'Watch a different state, or assign a state the effect does not name.',
  },
  PUI2364: {
    severity: 'error',
    title: 'Effect watches an undeclared name',
    description: 'The header of an effect names the states it watches, and every one of them has to exist in this screen or component.',
    fix: 'Declare it with state, or correct the name.',
  },
  PUI2340: {
    severity: 'error',
    title: 'Host surface has no such name',
    description:
      'An import with a surface declares exactly the names the file may call through it, so a name that is not in the block is not in the module.',
    fix: 'Declare it under the import, or call one of the names that is declared there.',
  },
  PUI2341: {
    severity: 'error',
    title: 'Wrong arguments for a host declaration',
    description:
      'A declared host function or widget takes the parameters it declares: no more, no fewer, and each one once.',
    fix: 'Match the declaration, or change the declaration to match the host.',
  },
  PUI2342: {
    severity: 'error',
    title: 'Unknown argument name',
    description: 'The argument name is not one of the declared parameters, so the generated call would be a Dart error.',
    fix: 'Rename the argument to a declared parameter.',
  },
  PUI2343: {
    severity: 'error',
    title: 'Type mismatch at the host boundary',
    description:
      'The value passed to a declared host call — or the value a host call produces — does not have the declared type.',
    fix: 'Pass the declared type, or correct the declaration.',
  },
  PUI2344: {
    severity: 'error',
    title: 'Asynchronous host call used directly',
    description:
      'A host function declared as returning Future<T> produces its value later. Using it as a value without await would pass a future where a value is expected.',
    fix: 'Call it with await inside a handler, or give it a task.',
  },
  PUI2345: {
    severity: 'error',
    title: 'Host name declared by two modules',
    description:
      'Two imports declare the same host name, so an unqualified call does not say which one it means.',
    fix: 'Qualify the call with the module name.',
  },
  PUI2346: {
    severity: 'error',
    title: 'Malformed host surface',
    description:
      'A surface needs an import to belong to, a name to be called by, unique declaration names, and a type on every parameter.',
    fix: 'Fix the import line or the declaration the diagnostic points at.',
  },
  PUI2347: {
    severity: 'error',
    title: 'Qualified call on an import without a surface',
    description:
      '`data.loadTasks(…)` names a module, but the import has no name and no block, so the generated Dart would reference an undefined prefix.',
    fix: 'Write import "…" as data: with a block, or call the function without the prefix.',
  },
  PUI2320: {
    severity: 'error',
    title: 'Unknown screen in navigate',
    description:
      'The name after navigate is not a screen this file declares or imports. Navigation follows imports, because the generated screen needs an import of its own.',
    fix: 'Import the file that declares the screen, or navigate to a screen declared in this one.',
  },
  PUI2321: {
    severity: 'error',
    title: 'Navigation outside an event handler',
    description:
      'navigate and back run when something happens, not while a tree is being built, so they are only allowed inside an event handler.',
    fix: 'Move the navigation into the "on <event>:" body that triggers it.',
  },
  PUI2322: {
    severity: 'error',
    title: 'Wrong arguments for the target screen',
    description:
      'Every parameter a screen requires must be passed by name, and every name passed must be one the screen declares.',
    fix: 'Pass the parameters the screen declares, by name: navigate Detail(id: x).',
  },
  PUI2323: {
    severity: 'error',
    title: 'back() takes no arguments',
    description: 'back() closes the current screen; it needs no screen name and no arguments.',
    fix: 'Write back() on its own.',
  },
  PUI2309: {
    severity: 'error',
    title: 'State shadowing a token',
    description: 'A state variable with the same name as a design token would hide the token inside its screen.',
    fix: 'Rename the state variable, or rename the token.',
  },

  // ---------------------------------------------------------------- warnings
  PUI2402: {
    severity: 'error',
    title: 'Loop over a non-iterable',
    description: 'The value being iterated has a type that is not iterable, so the loop cannot run.',
    fix: 'Iterate over a list or another Iterable.',
  },
  PUI2403: {
    severity: 'warning',
    title: 'Multiple children in a single-child element',
    description: 'This element renders one child; extra children are wrapped in a column by the generator.',
    fix: 'Wrap the children in an explicit column so the layout is obvious.',
  },
  PUI2404: {
    severity: 'warning',
    title: 'Unused state',
    description: 'This state variable is declared but never read or written.',
    fix: 'Remove it, or use it.',
  },
  PUI2411: {
    severity: 'warning',
    title: 'Derived value never used',
    description: 'Nothing reads this computed value, so it costs a computation per build and produces nothing.',
    fix: 'Read it, or remove it.',
  },
  PUI2410: {
    severity: 'warning',
    title: 'Call to an undeclared host function',
    description:
      'The name is not declared in any host surface, but a declared one is spelled almost the same. Undeclared calls are passed through to the host, so the mistake only surfaces when Dart compiles the output.',
    fix: 'Fix the spelling, or declare the function under its import.',
  },
  PUI2408: {
    severity: 'warning',
    title: 'Submit handler never triggered',
    description:
      'The form declares an "on submit:" body, but nothing inside it calls submit(), so the body cannot run.',
    fix: 'Call submit() from a button inside the form.',
  },
  PUI2409: {
    severity: 'warning',
    title: 'Form validates nothing',
    description:
      'No field in this form declares validate=, so the validation gate always passes and submit() is an ordinary call.',
    fix: 'Add validate= to the fields that must be checked, or drop the form.',
  },
  PUI2405: {
    severity: 'warning',
    title: 'Unused component parameter',
    description: 'This parameter is declared but never used in the component body.',
    fix: 'Remove it, or use it.',
  },
  PUI2406: {
    severity: 'info',
    title: 'External host widget',
    description: 'The capitalised element is not a known component, so it is emitted as a host Dart constructor call.',
    fix: 'Make sure the constructor is imported and its arguments exist in Dart.',
  },
  PUI2407: {
    severity: 'warning',
    title: 'Anonymous use of a screen',
    description: 'A screen is an entry point and is normally used as a route, not nested inside another screen.',
    fix: 'Use a component for reusable pieces of UI.',
  },

  // ---------------------------------------------------------------- targets
  PUI2501: {
    severity: 'error',
    title: 'Construct not supported by this target',
    description:
      'This construct is part of PlainUI, but the selected target has no way to express it. Compiling it anyway would produce output that looks finished and silently does nothing.',
    fix: 'Compile for a target that supports it, or remove the construct.',
  },

  PUI2502: {
    severity: 'error',
    title: 'Not portable to a target the project promises',
    description:
      '"targets" in plainui.config.json is a promise that every file ports. This construct is delivered only partly (or not at all) by one of those targets, so the file would compile today and quietly lose behaviour there.',
    fix: 'Drop the target from "targets", or move the construct into a file that is not part of the portable set.',
  },

  // ---------------------------------------------------------------- project / codegen
  PUI3001: {
    severity: 'error',
    title: 'Import not found',
    description: 'A relative import points at a file that does not exist relative to this source file.',
    fix: 'Check the path. Relative imports are resolved from the .pui file’s directory.',
  },
  PUI3003: {
    severity: 'error',
    title: 'Write failed',
    description: 'The generated file could not be written.',
    fix: 'Check directory permissions.',
  },
  PUI3101: {
    severity: 'error',
    title: 'Duplicate declaration across the project',
    description: 'Two .pui files declare a screen or component with the same name, so the generated Dart classes would collide.',
    fix: 'Rename one of them, or move the shared piece into a component.',
  },
  PUI3102: {
    severity: 'error',
    title: 'Generated file collision',
    description: 'Two .pui files would be written to the same generated path, because generated files are named after their source file.',
    fix: 'Rename one of the source files, or give the project a different outDir.',
  },

  // ---------------------------------------------------------------- CLI
  PUI4001: {
    severity: 'error',
    title: 'No sources found',
    description: 'The command did not find any .pui files at the given paths.',
    fix: 'Pass a directory containing .pui files, or a .pui file.',
  },
  PUI4002: {
    severity: 'error',
    title: 'Invalid configuration',
    description: 'plainui.config.json could not be parsed or has an invalid setting.',
    fix: 'See docs/04-cli.md for the accepted keys.',
  },
  PUI4003: {
    severity: 'error',
    title: 'Formatting required',
    description: '--check was passed and at least one file is not formatted.',
    fix: 'Run plainui format.',
  },
  PUI4004: {
    severity: 'error',
    title: 'Generated output out of date',
    description: '--check was passed and the Dart in the output directory no longer matches what the source compiles to.',
    fix: 'Run plainui build, and commit the result.',
  },
} as const satisfies Record<string, CodeInfo>;

export type DiagnosticCode = keyof typeof CODES;

export function codeInfo(code: string): CodeInfo | undefined {
  return (CODES as Record<string, CodeInfo>)[code];
}

export interface DiagnosticInit {
  readonly code: DiagnosticCode | string;
  readonly message: string;
  readonly span: Span;
  readonly hint?: string;
  readonly related?: readonly RelatedInfo[];
}

export class DiagnosticBag {
  readonly diagnostics: Diagnostic[] = [];
  private readonly seen = new Set<string>();
  /** File that spans in this bag belong to. */
  readonly file: SourceFile | undefined;

  constructor(file?: SourceFile) {
    this.file = file;
  }

  private add(severity: Severity, init: DiagnosticInit, file?: SourceFile): void {
    const key = `${init.code}:${init.span.start}:${init.span.end}:${init.message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const diagnostic: Diagnostic = {
      code: init.code,
      severity,
      message: init.message,
      span: init.span,
      ...(init.hint === undefined ? {} : { hint: init.hint }),
      ...(init.related === undefined ? {} : { related: init.related }),
      ...((file ?? this.file) === undefined ? {} : { file: file ?? this.file }),
    };
    this.diagnostics.push(diagnostic);
  }

  error(init: DiagnosticInit, file?: SourceFile): void {
    this.add('error', init, file);
  }

  warning(init: DiagnosticInit, file?: SourceFile): void {
    this.add('warning', init, file);
  }

  info(init: DiagnosticInit, file?: SourceFile): void {
    this.add('info', init, file);
  }

  get hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === 'error');
  }

  get errorCount(): number {
    return this.diagnostics.filter((d) => d.severity === 'error').length;
  }

  get warningCount(): number {
    return this.diagnostics.filter((d) => d.severity === 'warning').length;
  }

  sorted(): Diagnostic[] {
    return [...this.diagnostics].sort((a, b) => a.span.start - b.span.start || a.code.localeCompare(b.code));
  }

  merge(other: DiagnosticBag): void {
    for (const d of other.diagnostics) {
      const key = `${d.code}:${d.span.start}:${d.span.end}:${d.message}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.diagnostics.push(d);
    }
  }

  /** Copy with no attached file (validator sub-bags). */
  static fork(file: SourceFile): DiagnosticBag {
    return new DiagnosticBag(file);
  }
}

// --------------------------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------------------------

export interface RenderOptions {
  readonly color?: boolean;
  /** Show the `--> file:line:col` location line. Default true. */
  readonly location?: boolean;
}

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
} as const;

function paint(text: string, color: string | undefined, enabled: boolean): string {
  return enabled && color ? `${color}${text}${ANSI.reset}` : text;
}

function severityColor(severity: Severity): string {
  return severity === 'error' ? ANSI.red : severity === 'warning' ? ANSI.yellow : ANSI.blue;
}

export interface JsonDiagnostic {
  readonly file: string;
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly hint?: string;
  readonly start: Position;
  readonly end: Position;
  readonly related?: readonly { file?: string; message: string; start: Position; end: Position }[];
}

export function toJsonDiagnostic(d: Diagnostic, file: SourceFile): JsonDiagnostic {
  const target = d.file ?? file;
  return {
    file: target.path,
    code: d.code,
    severity: d.severity,
    message: d.message,
    ...(d.hint === undefined ? {} : { hint: d.hint }),
    start: positionAt(target, d.span.start),
    end: positionAt(target, d.span.end),
    ...(d.related === undefined
      ? {}
      : {
          related: d.related.map((r) => ({
            ...(r.file === undefined ? {} : { file: r.file.path }),
            message: r.message,
            start: positionAt(r.file ?? target, r.span.start),
            end: positionAt(r.file ?? target, r.span.end),
          })),
        }),
  };
}

/**
 * Render one diagnostic in the Elm/Rust idiom:
 *
 *   error[PUI2001]: unknown element `colum`
 *    --> lib/ui/home.pui:5:9
 *     |
 *   5 |         colum gap=8:
 *     |         ^^^^^
 *     |
 *     = hint: did you mean `column`?
 */
export function formatDiagnostic(d: Diagnostic, file: SourceFile, options: RenderOptions = {}): string {
  const color = options.color ?? false;
  const target = d.file ?? file;
  const start = positionAt(target, d.span.start);
  const end = positionAt(target, d.span.end);
  const lines: string[] = [];

  const severity = paint(d.severity, severityColor(d.severity), color);
  const code = paint(`[${d.code}]`, ANSI.dim, color);
  lines.push(`${paint(severity, ANSI.bold, color)}${code}: ${paint(d.message, ANSI.bold, color)}`);

  const showLocation = options.location ?? true;
  if (showLocation) {
    lines.push(` ${paint('-->', ANSI.dim, color)} ${target.path}:${start.line}:${start.col}`);
  }

  const startLine = start.line;
  const endLine = Math.min(end.line, startLine + 2);
  const gutter = String(endLine).length;
  const pad = ' '.repeat(gutter);
  const empty = `${pad} ${paint('|', ANSI.dim, color)}`;
  lines.push(empty);

  for (let line = startLine; line <= endLine; line++) {
    const text = lineText(target, line);
    lines.push(`${String(line).padStart(gutter)} ${paint('|', ANSI.dim, color)} ${text}`);
    const from = line === startLine ? start.col - 1 : 0;
    const to =
      line === end.line
        ? Math.max(from + 1, end.col - 1)
        : line === endLine
          ? text.length
          : Math.max(from + 1, text.length);
    const carets = '^'.repeat(Math.max(1, Math.min(to, Math.max(text.length, to)) - from) || 1);
    lines.push(`${pad} ${paint('|', ANSI.dim, color)} ${' '.repeat(from)}${paint(carets, severityColor(d.severity), color)}`);
  }
  if (end.line > endLine) {
    lines.push(`${pad} ${paint('|', ANSI.dim, color)} ${paint(`... ${end.line - endLine} more line(s)`, ANSI.dim, color)}`);
  }
  lines.push(empty);

  if (d.hint !== undefined) {
    lines.push(`  ${paint('=', ANSI.cyan, color)} ${paint('hint:', ANSI.cyan, color)} ${d.hint}`);
  }
  for (const related of d.related ?? []) {
    const relFile = related.file ?? target;
    const relPos = positionAt(relFile, related.span.start);
    lines.push(
      `  ${paint('=', ANSI.cyan, color)} ${paint('note:', ANSI.cyan, color)} ${related.message} (${relFile.path}:${relPos.line}:${relPos.col})`,
    );
  }

  return lines.join('\n');
}

export function summarize(diagnostics: readonly Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  if (errors === 0 && warnings === 0) return 'no problems';
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
}
