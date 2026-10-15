/**
 * A small JavaScript / TypeScript tokenizer. It understands exactly enough of the language to find
 * constructs reliably: comments, string / template literals (including nested `${…}`), regular
 * expression literals and multi-character operators. Words inside strings or comments never become
 * tokens, so `"for (;;)"` or `// if this` can't spawn enemies.
 *
 * It never evaluates anything and is linear in the input size.
 */

export type TokenType = 'word' | 'punct' | 'string' | 'number' | 'regex';

export interface Token {
  type: TokenType;
  value: string;
  /** Absolute, zero-based source line. */
  line: number;
}

/** Longest operators first. */
const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '**', '<<', '>>',
];

/** After these words a `/` starts a regular expression rather than a division. */
const REGEX_AFTER_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else',
  'yield', 'await',
]);

const isIdentStart = (c: string): boolean => /[A-Za-z_$#À-￿]/.test(c);
const isIdentPart = (c: string): boolean => /[\w$À-￿]/.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/** Upper bound on tokens kept, so pathological input cannot blow up memory. */
export const MAX_TOKENS = 200_000;

export function tokenize(source: string, firstLine = 0): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;
  let line = firstLine;

  const push = (type: TokenType, value: string, at: number): void => {
    if (tokens.length < MAX_TOKENS) {
      tokens.push({ type, value, line: at });
    }
  };

  const regexAllowed = (): boolean => {
    const prev = tokens[tokens.length - 1];
    if (!prev) {
      return true;
    }
    if (prev.type === 'word') {
      return REGEX_AFTER_WORDS.has(prev.value);
    }
    if (prev.type === 'punct') {
      return !(prev.value === ')' || prev.value === ']' || prev.value === '}' || prev.value === '++' || prev.value === '--');
    }
    return false;
  };

  /** Skip a quoted string starting at the quote. Unterminated strings end at the line break. */
  const skipQuoted = (quote: string): void => {
    i++;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) {
        i++;
        return;
      }
      if (c === '\n') {
        return;
      }
      i++;
    }
  };

  /** Skip a template literal, recursing into `${ … }` expressions (which may contain more templates). */
  const skipTemplate = (): void => {
    i++; // opening backtick
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        return;
      }
      if (c === '\n') {
        line++;
      }
      if (c === '$' && source[i + 1] === '{') {
        i += 2;
        skipExpression();
        continue;
      }
      i++;
    }
  };

  /** Skip code up to (and including) the `}` that closes a template expression. */
  const skipExpression = (): void => {
    let depth = 1;
    while (i < n && depth > 0) {
      const c = source[i];
      if (c === '\n') {
        line++;
        i++;
      } else if (c === '{') {
        depth++;
        i++;
      } else if (c === '}') {
        depth--;
        i++;
      } else if (c === '"' || c === "'") {
        skipQuoted(c);
      } else if (c === '`') {
        skipTemplate();
      } else if (c === '/' && source[i + 1] === '/') {
        while (i < n && source[i] !== '\n') i++;
      } else if (c === '/' && source[i + 1] === '*') {
        i = skipBlockComment(i);
      } else {
        i++;
      }
    }
  };

  const skipBlockComment = (from: number): number => {
    let j = from + 2;
    while (j < n && !(source[j] === '*' && source[j + 1] === '/')) {
      if (source[j] === '\n') {
        line++;
      }
      j++;
    }
    return Math.min(n, j + 2);
  };

  while (i < n) {
    const c = source[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿') {
      i++;
      continue;
    }
    // Comments.
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i = skipBlockComment(i);
      continue;
    }
    if (c === '#' && source[i + 1] === '!' && i === 0) {
      while (i < n && source[i] !== '\n') i++; // shebang
      continue;
    }
    // Strings.
    if (c === '"' || c === "'") {
      const start = i;
      const at = line;
      skipQuoted(c);
      push('string', source.slice(start, Math.min(i, start + 80)), at);
      continue;
    }
    if (c === '`') {
      const start = i;
      const at = line;
      skipTemplate();
      push('string', source.slice(start, Math.min(i, start + 80)), at);
      continue;
    }
    // Words (identifiers and keywords; `#private` fields included).
    if (isIdentStart(c)) {
      const start = i;
      i++;
      while (i < n && isIdentPart(source[i])) i++;
      push('word', source.slice(start, i), line);
      continue;
    }
    // Numbers.
    if (isDigit(c) || (c === '.' && isDigit(source[i + 1] ?? ''))) {
      const start = i;
      i++;
      while (i < n && /[\w.]/.test(source[i])) i++;
      push('number', source.slice(start, i), line);
      continue;
    }
    // Regular expression literals.
    if (c === '/' && regexAllowed()) {
      const start = i;
      i++;
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        const r = source[i];
        if (r === '\\') {
          i += 2;
          continue;
        }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) {
          i++;
          break;
        }
        i++;
      }
      while (i < n && /[a-z]/i.test(source[i])) i++; // flags
      push('regex', source.slice(start, Math.min(i, start + 40)), line);
      continue;
    }
    // Punctuators.
    let matched = '';
    for (const p of PUNCTUATORS) {
      if (source.startsWith(p, i)) {
        matched = p;
        break;
      }
    }
    if (!matched) {
      matched = c;
    }
    push('punct', matched, line);
    i += matched.length;
  }
  return tokens;
}

/**
 * For every opening bracket, the index of its matching closer (and vice versa).
 * Unbalanced brackets match the end of the token list, so parsing degrades gracefully.
 */
export function matchBrackets(tokens: readonly Token[]): Int32Array {
  const match = new Int32Array(tokens.length).fill(-1);
  const stack: number[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'punct') {
      continue;
    }
    if (t.value === '(' || t.value === '[' || t.value === '{') {
      stack.push(i);
    } else if (t.value in pairs) {
      // Pop until the right kind of opener (tolerates stray closers).
      let k = stack.length - 1;
      while (k >= 0 && tokens[stack[k]].value !== pairs[t.value]) k--;
      if (k < 0) {
        continue;
      }
      for (let m = stack.length - 1; m > k; m--) {
        match[stack[m]] = i; // unclosed inner brackets end here
      }
      const open = stack[k];
      stack.length = k;
      match[open] = i;
      match[i] = open;
    }
  }
  for (const open of stack) {
    match[open] = tokens.length - 1;
  }
  return match;
}

const NO_SPACE_BEFORE = new Set([')', ']', '.', ',', ';', '?.', '++', '--', ':', '(', '[']);
const NO_SPACE_AFTER = new Set(['(', '[', '.', '!', '?.', '...', '~']);

/** Render a token range back to compact, readable source text (for labels and signatures). */
export function renderTokens(tokens: readonly Token[], from: number, to: number, maxChars = 40): string {
  let out = '';
  for (let i = from; i <= to && i < tokens.length; i++) {
    const t = tokens[i];
    const v = t.type === 'string' && t.value.length > 12 ? t.value.slice(0, 10) + '…' + t.value[0] : t.value;
    if (out) {
      const prev = tokens[i - 1];
      const callParen = (t.value === '(' || t.value === '[') && (prev.type === 'word' || prev.value === ')' || prev.value === ']');
      const tight =
        (t.type === 'punct' && NO_SPACE_BEFORE.has(t.value) && (t.value !== '(' && t.value !== '[' ? true : callParen)) ||
        (prev.type === 'punct' && NO_SPACE_AFTER.has(prev.value)) ||
        ((t.value === '++' || t.value === '--') && prev.type === 'word');
      if (!tight) {
        out += ' ';
      }
      if (t.value === ',' || t.value === ';') {
        out += v;
        continue;
      }
    }
    out += v;
    if (out.length > maxChars) {
      return out.slice(0, maxChars - 1) + '…';
    }
  }
  return out;
}
