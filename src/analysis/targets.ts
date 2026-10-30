/**
 * Target-framework knowledge that the *front end* needs: names that the generated code would
 * shadow, and the vocabulary of built-in text styles.
 */

/** Dart keywords and reserved words that cannot be used as screen/component/state names. */
export const DART_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'abstract', 'as', 'assert', 'async', 'await', 'base', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export',
  'extends', 'extension', 'external', 'factory', 'false', 'final', 'finally', 'for', 'Function',
  'get', 'hide', 'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library', 'mixin',
  'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow', 'return', 'sealed', 'set', 'show',
  'static', 'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'type', 'typedef', 'var',
  'void', 'when', 'while', 'with', 'yield',
]);

/**
 * Flutter types the generated code may reference. A screen or component with one of these names
 * would shadow the type inside the generated library and silently change the meaning of the
 * output, so they are rejected.
 */
export const FLUTTER_TYPE_NAMES: ReadonlySet<string> = new Set([
  'Align', 'Alignment', 'AppBar', 'Border', 'BorderRadius', 'BoxDecoration', 'BoxFit', 'BuildContext',
  'Card', 'Center', 'Checkbox', 'ClipRRect', 'Color', 'Colors', 'Column', 'Container',
  'CrossAxisAlignment', 'Divider', 'EdgeInsets', 'ElevatedButton', 'Expanded', 'Flexible', 'FontWeight',
  'Form', 'GestureDetector', 'GridView', 'Icon', 'Icons', 'Image', 'InputDecoration', 'LinearProgressIndicator',
  'ListTile', 'ListView', 'MainAxisAlignment', 'MaterialApp', 'MouseRegion', 'Navigator', 'Opacity',
  'OutlinedButton', 'Padding', 'ProgressIndicator', 'Row', 'SafeArea', 'Scaffold', 'Scrollbar', 'SingleChildScrollView',
  'SizedBox', 'Slider', 'Spacer', 'Stack', 'StatelessWidget', 'State', 'StatefulWidget', 'Switch',
  'Text', 'TextAlign', 'TextButton', 'TextEditingController', 'TextField', 'TextOverflow', 'TextStyle',
  'Theme', 'Visibility', 'Widget', 'Wrap', 'CircularProgressIndicator',
]);

/** Text styles that exist without being declared. */
export const BUILTIN_STYLES: readonly string[] = ['display', 'heading', 'subheading', 'body', 'caption', 'label', 'secondary'];

/** Properties allowed inside a `style` declaration. */
export const STYLE_PROPS: readonly string[] = [
  'size',
  'weight',
  'color',
  'fontFamily',
  'letterSpacing',
  'lineHeight',
  'italic',
];
