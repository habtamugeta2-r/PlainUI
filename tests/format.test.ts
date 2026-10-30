import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAst } from '../src/debug.ts';
import { formatText } from '../src/format.ts';
import { parse } from '../src/parser.ts';
import { sourceFile } from '../src/source.ts';

function format(text: string): string {
  return formatText('test.pui', text).text;
}

function shape(text: string): string {
  const { program, bag } = parse(sourceFile('test.pui', text));
  assert.equal(bag.hasErrors, false, `expected valid source:\n${text}`);
  return renderAst(program);
}

test('normalises indentation to four spaces per level', () => {
  const messy = ['screen Home:', '  column:', '     text "a"', ''].join('\n');
  assert.equal(format(messy), ['screen Home:', '    column:', '        text "a"', ''].join('\n'));
});

test('normalises spacing around properties, operators and commas', () => {
  const messy = ['screen Home:', '    column padding=24   gap = 16 :', '        text "a" style=heading', '        text count+1', ''].join('\n');
  assert.equal(
    format(messy),
    ['screen Home:', '    column padding=24 gap=16:', '        text "a" style=heading', '        text count + 1', ''].join('\n'),
  );
});

test('keeps spaces inside strings untouched', () => {
  const source = ['screen Home:', '    text "a    b  c"', ''].join('\n');
  assert.equal(format(source), source);
});

test('spaces = in state and set lines but keeps it tight in properties', () => {
  const messy = ['screen Counter:', '    state count:int=0', '    button "go":', '        on tap:', '            set count=count+1', ''].join('\n');
  assert.equal(
    format(messy),
    ['screen Counter:', '    state count: int = 0', '    button "go":', '        on tap:', '            set count = count + 1', ''].join('\n'),
  );
});

test('preserves comments and their position', () => {
  const source = ['// header', 'screen Home:', '    // about the column', '    column:', '        text "a"  // trailing', ''].join('\n');
  assert.equal(format(source), source);
});

test('collapses blank line runs and removes leading blanks', () => {
  const messy = ['', '', 'screen Home:', '', '', '', '    text "a"', '', '', ''].join('\n');
  assert.equal(format(messy), ['screen Home:', '', '    text "a"', ''].join('\n'));
});

test('is idempotent', () => {
  const source = [
    'import "package:a/b.dart"',
    '',
    'style  big :',
    '   size=32',
    '',
    'component  Card2 ( label:String , compact:bool=false ) :',
    '  card padding=8:',
    '     text label',
    '',
    'screen Home:',
    '   state items:List<String>=[]',
    '   if items.isEmpty:',
    '       text "none"',
    '   else:',
    '       for i,item in items:',
    '           text "${i}"',
    '',
  ].join('\n');
  const once = format(source);
  const twice = format(once);
  assert.equal(twice, once);
});

test('formatting never changes meaning', () => {
  const source = [
    'component Shell(title:String, children:List<Widget>):',
    '    column gap=8:',
    '        text title',
    '        slot',
    '',
    'screen Home:',
    '    state count:int=0',
    '    state items:List<String> =[]',
    '    Shell("hi"):',
    '        if count>0:',
    '            text "${count}"',
    '        for i,item in items:',
    '            text item',
    '    button "Add":',
    '        on tap:',
    '            set count=count+1',
    '',
  ].join('\n');
  assert.equal(shape(format(source)), shape(source));
});

test('alignment inside a continuation line is preserved', () => {
  const source = ['screen Home:', '    text format(', '        a,', '        b,', '    )', ''].join('\n');
  assert.equal(format(source), source);
});

test('a file that does not lex is returned untouched', () => {
  const broken = ['screen Home:', '    text "unterminated', ''].join('\n');
  const result = formatText('test.pui', broken);
  assert.equal(result.skipped, true);
  assert.equal(result.text, broken);
});

test('the space before an equals sign depends on the line, not the value', () => {
  // `state` lines keep the space even when the value is a list; node properties stay tight.
  assert.equal(format('screen Home:\n    state items: List<String> =["a"]\n'), 'screen Home:\n    state items: List<String> = ["a"]\n');
  assert.equal(format('screen Home:\n    column padding=[8,4]:\n        text "x"\n'), 'screen Home:\n    column padding=[8, 4]:\n        text "x"\n');
});
