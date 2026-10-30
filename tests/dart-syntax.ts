/**
 * A deliberately small structural checker for generated Dart.
 *
 * It is not a Dart parser. It catches the classes of mistake the generator can actually make:
 * unbalanced brackets, dangling commas, `await` inside a synchronous callback, and a `child:`
 * and `children:` argument on the same call.
 */

export function stripDartNoise(code: string): string {
  let out = '';
  let index = 0;
  while (index < code.length) {
    const ch = code[index]!;
    if (ch === '/' && code[index + 1] === '/') {
      const end = code.indexOf('\n', index);
      index = end < 0 ? code.length : end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      index += 1;
      while (index < code.length) {
        if (code[index] === '\\') {
          index += 2;
          continue;
        }
        if (code[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      out += '""';
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
}

export function checkDartStructure(code: string): string[] {
  const problems: string[] = [];
  const clean = stripDartNoise(code);

  const stack: { ch: string; index: number }[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, index: i });
    else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop();
      if (top === undefined) {
        problems.push(`unbalanced closing "${ch}" at offset ${i}`);
      } else if (top.ch !== pairs[ch]) {
        problems.push(`expected "${pairs[top.ch]}" to be closed before "${ch}" at offset ${i}`);
        stack.push(top);
      }
    }
  }
  for (const leftover of stack) problems.push(`unclosed "${leftover.ch}" at offset ${leftover.index}`);

  if (/,\s*,/.test(clean)) problems.push('double comma');
  if (/\(\s*,/.test(clean)) problems.push('argument list starts with a comma');
  if (/\(\s*\)\s*\)\s*;/.test(clean)) problems.push('suspicious empty call nesting');

  // await inside a setState callback (synchronous closure)
  const setState = /setState\(\(\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = setState.exec(clean)) !== null) {
    const start = match.index + match[0].length;
    const body = sliceBalanced(clean, start - 1);
    if (body.includes('await')) problems.push('await inside a setState callback');
  }

  // both child: and children: in the same call
  const callPattern = /(\w+(?:\.\w+)?)\(/g;
  while ((match = callPattern.exec(clean)) !== null) {
    const open = match.index + match[0].length - 1;
    const body = topLevel(clean, open);
    if (/\bchild:/.test(body) && /\bchildren:/.test(body)) {
      problems.push(`call "${match[1]}" passes both child: and children:`);
    }
  }

  return problems;
}

/** The argument text of a call with all nested bracket contents removed. */
function topLevel(text: string, openIndex: number): string {
  let depth = 0;
  let out = '';
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return out;
    }
    if (depth === 1) out += ch;
  }
  return out;
}

function sliceBalanced(text: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return text.slice(openIndex + 1);
}
