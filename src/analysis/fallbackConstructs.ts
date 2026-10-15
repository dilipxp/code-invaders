/**
 * Language-agnostic construct finder for languages without a dedicated parser (Python, Go, Rust,
 * Java, C#, Ruby, …). It works line by line on code with string literals and comments removed, and
 * uses indentation to understand nesting (nested loops, methods inside classes, recursion inside a
 * function body). Less precise than the JS/TS parser, but it never spawns an enemy from a word that
 * sits inside a string or comment.
 */
import { type Construct, type ConstructResult, type LanguageAdapter, truncateLabel } from './constructs';

const LABEL_MAX = 12;
const COMMENT_LINE_RE = /^(\/\/|\/\*|\*\/|\*(\s|$)|#(?!include|define|if|endif|pragma|region|endregion|!)|--|<!--|;;)/;
const STRING_RE = /(["'`])(?:\\.|(?!\1).)*\1/g;
const FIRST_WORD_RE = /^(?:}\s*)?([A-Za-z_]+)\b/;
const FUNCTION_RE = /\b(?:def|fn|func|fun|function|sub|proc)\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)?/;
const METHOD_RE =
  /^(?:(?:public|private|protected|internal|static|async|override|virtual|final|abstract|inline|unsafe|extern|synchronized)\s+)*(?:[A-Za-z_$][\w$<>,[\]\s*&?.]*\s+)?([A-Za-z_$][\w$]*)\s*\(([^;]*)\)\s*(?:[:\-]>?\s*[^{;]+)?(?:throws\s+[^{]+)?\{\s*$/;
const CLASS_RE = /\b(class|struct|record|object|impl|trait)\s+([A-Za-z_$][\w$]*)/;
const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'foreach', 'using', 'lock', 'elif', 'match']);

interface Open {
  idx: number;
  indent: number;
  kind: 'loop' | 'fn' | 'class' | 'if' | 'other';
  depth?: number;
  name?: string;
  firstLine?: number;
}

function indentOf(raw: string): number {
  let n = 0;
  for (const c of raw) {
    if (c === ' ') n++;
    else if (c === '\t') n += 4;
    else break;
  }
  return n;
}

function paramsOf(list: string | undefined): string[] {
  if (!list) {
    return [];
  }
  return list
    .split(',')
    .map((p) => p.trim().replace(/^(?:self|cls|this|&?mut\s+self|&self)$/, '').replace(/[:=].*$/, '').trim())
    .map((p) => p.split(/\s+/).pop() ?? '')
    .map((p) => p.replace(/^[*&]+/, ''))
    .filter((p) => /^[A-Za-z_$][\w$]*$/.test(p))
    .slice(0, 4);
}

function loopInfo(code: string, keyword: string): { loopVar?: string; signature: string } {
  const after = code.slice(code.indexOf(keyword) + keyword.length).trim();
  const inParens = /^\((.*)\)\s*[{:]?\s*$/.exec(after)?.[1] ?? after.replace(/[{:]\s*$/, '').trim();
  const parts = inParens.split(';');
  if (parts.length >= 3) {
    const v = /([A-Za-z_$][\w$]*)\s*(?::=|=)/.exec(parts[0])?.[1];
    return { loopVar: v, signature: `${parts[1].trim()}; ${parts[2].trim()}` };
  }
  const m = /^(?:\(?\s*(?:let|var|const|val|int|auto|my|mut|final)?\s*)?\$?([A-Za-z_][\w]*)/.exec(inParens);
  return { loopVar: m?.[1], signature: inParens.slice(0, 24) };
}

export function analyzeFallbackConstructs(lines: readonly string[], firstLine: number): ConstructResult {
  const out: Construct[] = [];
  const absorbed = new Set<number>();
  const open: Open[] = [];
  const fnBodies: Array<{ idx: number; name: string; from: number; to: number }> = [];
  let inBlockComment = false;

  const add = (c: Construct): number => {
    const top = open[open.length - 1];
    if (top) {
      c.parent = top.idx;
    }
    c.label = truncateLabel(c.label.replace(/\s+/g, ' ').trim(), LABEL_MAX);
    out.push(c);
    return out.length - 1;
  };
  const enclosing = (kind: Open['kind']): Open | undefined => {
    for (let k = open.length - 1; k >= 0; k--) {
      if (open[k].kind === kind) return open[k];
      if (open[k].kind === 'fn' || open[k].kind === 'class') return kind === open[k].kind ? open[k] : undefined;
    }
    return undefined;
  };
  const closeFn = (o: Open, lastLine: number): void => {
    if (o.kind === 'fn' && o.name && o.firstLine !== undefined) {
      fnBodies.push({ idx: o.idx, name: o.name, from: o.firstLine + 1, to: lastLine });
    }
  };

  let lastCodeLine = firstLine;
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    const lineNo = firstLine + k;
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
      inBlockComment = true;
      continue;
    }
    if (COMMENT_LINE_RE.test(trimmed)) {
      continue;
    }
    const code = trimmed.replace(STRING_RE, '""').replace(/\s(\/\/|#)\s.*$/, '');
    const indent = indentOf(raw);
    const closesOnly = /^[}\])]+[;,]?$/.test(code);
    // Close blocks we have left (by indentation). Lines made only of closers belong to the block.
    while (open.length > 0 && indent <= open[open.length - 1].indent && !(closesOnly && indent === open[open.length - 1].indent)) {
      closeFn(open.pop()!, lastCodeLine);
    }
    if (closesOnly) {
      lastCodeLine = lineNo;
      continue;
    }
    lastCodeLine = lineNo;
    const word = FIRST_WORD_RE.exec(code)?.[1];
    const opensBlock = /[{:]\s*$/.test(code) || /\b(do|then)\s*$/.test(code);
    let pushed: Open | undefined;

    const cls = CLASS_RE.exec(code);
    const fn = FUNCTION_RE.exec(code);
    const method = !fn ? METHOD_RE.exec(code) : null;

    if (cls && (word === cls[1] || /^(pub|public|private|export|abstract|final|data|sealed|open|internal)\b/.test(code))) {
      const idx = add({ archetype: 'class', line: lineNo, label: cls[2], name: cls[2], methods: [] });
      pushed = { idx, indent, kind: 'class' };
    } else if ((fn && fn[1]) || (method && !NOT_A_NAME.has(method[1]))) {
      const name = fn ? fn[1] : method![1];
      const params = paramsOf(fn ? fn[2] : method![2]);
      const isAsync = /\basync\b/.test(code);
      const owner = enclosing('class');
      if (owner && open[open.length - 1] === owner) {
        const c = out[owner.idx];
        c.methods ??= [];
        if (c.methods.length < 6 && !/^(__init__|constructor|new|init)$/.test(name)) c.methods.push(name);
      }
      const idx = add({
        archetype: isAsync ? 'async' : 'function',
        line: lineNo,
        label: isAsync ? `async ${name}()` : `${name}()`,
        name,
        params,
        signature: `(${params.join(', ')})`,
      });
      pushed = { idx, indent, kind: 'fn', name, firstLine: lineNo };
    } else if (word === 'for' || word === 'foreach') {
      const info = loopInfo(code, word);
      const outer = enclosing('loop');
      if (outer && out[outer.idx].archetype === 'for') {
        const root = out[outer.idx];
        const depth = (outer.depth ?? 1) + 1;
        root.nesting = Math.max(root.nesting ?? 1, depth);
        if (info.loopVar && info.loopVar !== root.loopVar) {
          root.innerVars ??= [];
          if (root.innerVars.length < 3 && !root.innerVars.includes(info.loopVar)) root.innerVars.push(info.loopVar);
        }
        absorbed.add(lineNo);
        pushed = { idx: outer.idx, indent, kind: 'loop', depth };
      } else {
        const idx = add({ archetype: 'for', line: lineNo, label: 'for', loopVar: info.loopVar, signature: info.signature, nesting: 1 });
        pushed = { idx, indent, kind: 'loop', depth: 1 };
      }
    } else if (word === 'while' || word === 'until' || word === 'loop' || word === 'do') {
      if (word === 'while' && /^}\s*while\b/.test(code)) {
        absorbed.add(lineNo); // do { … } while (…)
      } else {
        const cond = code.replace(/^}?\s*\w+\s*/, '').replace(/[{:]\s*$/, '').replace(/^\((.*)\)$/, '$1').trim();
        const idx = add({ archetype: 'while', line: lineNo, label: word === 'do' ? 'do…while' : `${word} ${cond}`, signature: cond });
        pushed = { idx, indent, kind: 'loop' };
      }
    } else if (word === 'if' || word === 'unless' || word === 'switch' || word === 'match' || word === 'select') {
      const cond = code.replace(/^}?\s*\w+\s*/, '').replace(/[{:]\s*$/, '').replace(/^\((.*)\)$/, '$1').trim();
      const idx = add({ archetype: 'if', line: lineNo, label: `${word} ${cond}`, signature: cond, count: 1 });
      pushed = { idx, indent, kind: 'if' };
    } else if (word === 'elif' || word === 'elsif' || word === 'else' || word === 'case' || word === 'when' || word === 'default') {
      // Part of the nearest conditional at this indentation (or the enclosing switch).
      const head = [...out.keys()].reverse().find((i) => out[i].archetype === 'if' && out[i].line < lineNo);
      if (head !== undefined) {
        out[head].count = (out[head].count ?? 1) + 1;
      }
      absorbed.add(lineNo);
    } else if (word === 'return' || word === 'yield') {
      const rest = code.replace(/^\w+\s*/, '').replace(/;$/, '');
      add({ archetype: 'return', line: lineNo, label: rest ? `return ${rest}` : 'return' });
    } else if (word === 'throw' || word === 'raise' || word === 'panic') {
      const err = /(?:new\s+)?([A-Z][\w.]*)/.exec(code.replace(/^\w+\s*/, ''))?.[1];
      add({ archetype: 'throw', line: lineNo, label: err ? `${word} ${err}` : word });
    } else if (word === 'try' || word === 'begin') {
      const idx = add({ archetype: 'try', line: lineNo, label: 'try/catch' });
      pushed = { idx, indent, kind: 'other' };
    } else if (word === 'catch' || word === 'except' || word === 'rescue' || word === 'finally' || word === 'ensure') {
      absorbed.add(lineNo);
    } else if (word === 'import' || word === 'from' || word === 'require' || word === 'using' || word === 'use' || word === 'include' || /^#include\b/.test(code)) {
      const mod = /([A-Za-z_][\w]*)\W*$/.exec(code.replace(/\bas\s+\w+/, '').replace(/[;"'<>]/g, ' ').trim())?.[1];
      add({ archetype: 'import', line: lineNo, label: `import ${mod ?? ''}`, name: mod });
    } else if (/^(const|val|final|let|var|my|mut)\b/.test(code) && /=/.test(code)) {
      const kw = /^(\w+)/.exec(code)![1];
      const name = /^\w+\s+(?:mut\s+)?([A-Za-z_$][\w$]*)/.exec(code)?.[1];
      if (/\blambda\b|=>|->/.test(code)) {
        add({ archetype: 'arrow', line: lineNo, label: name ? `${name} =>` : '=>', name });
      } else {
        const isConst = kw === 'const' || kw === 'val' || kw === 'final';
        add({ archetype: isConst ? 'const' : 'let', line: lineNo, label: `${isConst ? 'const' : 'let'} ${name ?? ''}`, name });
      }
    } else if (/\blambda\b|=>/.test(code)) {
      add({ archetype: 'arrow', line: lineNo, label: /\blambda\b/.test(code) ? 'lambda' : '=> …' });
    }

    // Extra constructs that can share a line with the main one.
    if (/\bawait\b/.test(code)) {
      const fnOpen = enclosing('fn');
      if (fnOpen) {
        const c = out[fnOpen.idx];
        c.count = (c.count ?? 0) + 1;
        if (c.archetype === 'function') {
          c.archetype = 'async';
          c.label = truncateLabel(`async ${c.name}()`, LABEL_MAX);
        }
      } else {
        add({ archetype: 'async', line: lineNo, label: 'await', count: 1 });
      }
    }
    if (/\b(Promise|Future|CompletableFuture|Deferred)\b|\.then\(/.test(code)) {
      add({ archetype: 'promise', line: lineNo, label: /\.then\(/.test(code) ? '.then()' : /\b(Promise|Future|CompletableFuture|Deferred)\b/.exec(code)![1] });
    }
    const ands = (code.match(/&&|\band\b/g) ?? []).length;
    const ors = (code.match(/\|\||\bor\b/g) ?? []).length;
    if (ands + ors > 0) {
      const op = ands >= ors ? '&&' : '||';
      add({ archetype: ands >= ors ? 'and' : 'or', line: lineNo, label: op, count: ands + ors, combo: ands > 0 && ors > 0 });
    }

    if (pushed && (opensBlock || pushed.kind === 'fn' || pushed.kind === 'class')) {
      open.push(pushed);
    }
  }
  while (open.length > 0) {
    closeFn(open.pop()!, lastCodeLine);
  }

  // Recursion: a function whose own body calls it.
  if (fnBodies.length > 0) {
    for (const body of fnBodies) {
      const callRe = new RegExp(`(^|[^\\w$.])${body.name.replace(/\$/g, '\\$')}\\s*\\(|\\b(self|this)\\.${body.name.replace(/\$/g, '\\$')}\\s*\\(`);
      for (let line = body.from; line <= body.to; line++) {
        const text = lines[line - firstLine];
        if (text !== undefined && callRe.test(text.replace(STRING_RE, '""'))) {
          out[body.idx].archetype = 'recursive';
          out[body.idx].label = truncateLabel(`${body.name}()`, LABEL_MAX);
          break;
        }
      }
    }
  }
  return { constructs: out, absorbedLines: absorbed };
}

export const fallbackAdapter: LanguageAdapter = {
  id: 'fallback',
  parser: 'fallback',
  analyze: analyzeFallbackConstructs,
};
