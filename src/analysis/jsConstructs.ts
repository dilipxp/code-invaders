/**
 * Syntax-aware construct finder for JavaScript and TypeScript (including JSX/TSX).
 *
 * Works on the token stream from `lexer.ts` with bracket matching, so it knows where every block,
 * header and body starts and ends. That lets it group related syntax into one meaningful enemy:
 *   - a `for` header (`let i = 0; i < n; i++`) is one Loop Commander, and loops nested inside it
 *     become extra escorts of that commander instead of commanders of their own;
 *   - an `if / else if / else` chain is one conditional enemy;
 *   - all `&&` / `||` operators in one expression are one logic enemy;
 *   - `await`s are folded into their async function;
 *   - functions that call themselves are recursive; methods are attached to their class.
 */
import type { Archetype } from '../shared/protocol';
import { type Construct, type ConstructResult, type LanguageAdapter, truncateLabel } from './constructs';
import { matchBrackets, renderTokens, tokenize, type Token } from './lexer';

const LABEL_MAX = 12;
const MAX_INNER_VARS = 3;
const MAX_METHODS = 6;

type BlockKind = 'for' | 'while' | 'if' | 'switch' | 'fn' | 'class' | 'try';

interface StackEntry {
  /** Construct index that owns this block (for nested loops: the root commander). */
  idx: number;
  /** Last token index of the block. */
  end: number;
  kind: BlockKind;
  /** Token range of a control-statement header `( … )`. */
  header?: [number, number];
  /** Loop depth (for `for` entries). */
  depth?: number;
  /** First token of the body (for class / function entries). */
  bodyStart?: number;
}

interface FnMeta {
  name?: string;
  isAsync: boolean;
  style: 'function' | 'arrow' | 'method';
  bodyStart: number;
  bodyEnd: number;
}

/** Words that look like calls but are not method declarations. */
const NOT_METHODS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'super', 'import', 'require',
  'await', 'yield', 'throw', 'with', 'do', 'else', 'case', 'delete', 'void', 'in', 'of', 'instanceof', 'this',
]);
const METHOD_MODIFIERS = new Set([
  'async', 'static', 'get', 'set', 'public', 'private', 'protected', 'readonly', 'override', 'abstract', 'declare',
]);
const PARAM_MODIFIERS = new Set(['public', 'private', 'protected', 'readonly', 'override']);

export function analyzeJsConstructs(lines: readonly string[], firstLine: number): ConstructResult {
  return new JsConstructParser(tokenize(lines.join('\n'), firstLine)).run();
}

export const jsAdapter: LanguageAdapter = {
  id: 'javascript',
  parser: 'syntax',
  analyze: analyzeJsConstructs,
};

class JsConstructParser {
  private readonly match: Int32Array;
  private readonly out: Construct[] = [];
  private readonly absorbed = new Set<number>();
  private readonly stack: StackEntry[] = [];
  private readonly fnMeta = new Map<number, FnMeta>();
  private readonly loopDepth = new Map<number, number>();
  private readonly logicCounts = new Map<number, { and: number; or: number }>();
  private readonly logicGroups = new Map<string, number>();
  private readonly promiseGroups = new Map<number, number>();
  private readonly awaitGroups = new Map<number, number>();
  /** Body-end token → head of the if/else-if chain it belongs to. */
  private readonly ifChains = new Map<number, number>();
  /** `}` tokens that close a `do { … }` body. */
  private readonly doEnds = new Set<number>();
  /** Positions of `name(` for recursion detection. */
  private readonly calls = new Map<string, number[]>();
  private stmtStart = 0;

  constructor(private readonly tk: Token[]) {
    this.match = matchBrackets(tk);
  }

  run(): ConstructResult {
    const tk = this.tk;
    for (let i = 0; i < tk.length - 1; i++) {
      if (tk[i].type === 'word' && tk[i + 1].value === '(') {
        let list = this.calls.get(tk[i].value);
        if (!list) {
          list = [];
          this.calls.set(tk[i].value, list);
        }
        list.push(i);
      }
    }

    for (let i = 0; i < tk.length; i++) {
      while (this.stack.length > 0 && i > this.stack[this.stack.length - 1].end) {
        this.stack.pop();
      }
      const t = tk[i];
      if (t.type === 'punct') {
        if (t.value === ';' || t.value === '{' || t.value === '}') {
          this.stmtStart = i + 1;
        } else if (t.value === '&&' || t.value === '||') {
          this.logic(i);
        } else if (t.value === '=>') {
          this.arrow(i);
        }
        continue;
      }
      if (t.type !== 'word') {
        continue;
      }
      const prev = tk[i - 1];
      if (prev && prev.type === 'punct' && (prev.value === '.' || prev.value === '?.')) {
        // Property access: `obj.for` is not a loop. `.then(` is a promise chain.
        if (t.value === 'then' && this.v(i + 1) === '(') {
          this.promise(i, '.then()');
        }
        continue;
      }
      switch (t.value) {
        case 'for':
          this.forLoop(i);
          break;
        case 'while':
          this.whileLoop(i);
          break;
        case 'do':
          this.doWhile(i);
          break;
        case 'if':
          this.ifStatement(i);
          break;
        case 'else':
          this.elseBranch(i);
          break;
        case 'switch':
          this.switchStatement(i);
          break;
        case 'case':
        case 'default':
          this.caseLabel(i);
          break;
        case 'function':
          this.functionKeyword(i);
          break;
        case 'class':
          this.classDecl(i);
          break;
        case 'try':
          this.tryStatement(i);
          break;
        case 'import':
          this.importStatement(i);
          break;
        case 'export':
          this.reExport(i);
          break;
        case 'require':
          this.requireCall(i);
          break;
        case 'return':
        case 'throw':
          this.exitStatement(i, t.value);
          break;
        case 'const':
        case 'let':
        case 'var':
          this.declaration(i);
          break;
        case 'await':
          this.awaitExpr(i);
          break;
        case 'new':
          if (this.v(i + 1) === 'Promise') {
            this.promise(i, 'new Promise');
          }
          break;
        case 'Promise':
          if (this.v(i + 1) === '.' && this.v(i - 1) !== 'new' && this.tk[i + 2]?.type === 'word') {
            this.promise(i, `Promise.${this.v(i + 2)}`);
          }
          break;
        default:
          this.maybeMethod(i);
      }
    }
    return this.finish();
  }

  // ---------------------------------------------------------------- helpers

  private v(i: number): string {
    return this.tk[i]?.value ?? '';
  }

  private isWord(i: number): boolean {
    return this.tk[i]?.type === 'word';
  }

  private render(from: number, to: number, max = 40): string {
    return from > to ? '' : renderTokens(this.tk, from, to, max);
  }

  private closeOf(open: number): number {
    const m = this.match[open];
    return m < 0 ? this.tk.length - 1 : m;
  }

  /** Record a construct; `block` constructs own the token range up to `end` (for nesting). */
  private add(c: Construct, _start: number, end: number, block?: Omit<StackEntry, 'idx' | 'end'>): number {
    const top = this.stack[this.stack.length - 1];
    if (top) {
      c.parent = top.idx;
    }
    const idx = this.out.length;
    this.out.push(c);
    if (block) {
      this.stack.push({ idx, end, ...block });
    }
    return idx;
  }

  /** Nearest enclosing block of one of the kinds, without crossing a function or class boundary. */
  private enclosing(kinds: BlockKind[], crossFunctions = false): StackEntry | undefined {
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const e = this.stack[k];
      if (kinds.includes(e.kind)) {
        return e;
      }
      if (!crossFunctions && (e.kind === 'fn' || e.kind === 'class')) {
        return undefined;
      }
    }
    return undefined;
  }

  private inControlHeader(i: number): StackEntry | undefined {
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const e = this.stack[k];
      if (e.header && i > e.header[0] && i < e.header[1]) {
        return e;
      }
      if (e.kind === 'fn' || e.kind === 'class') {
        return undefined;
      }
    }
    return undefined;
  }

  /** Last token index of the statement starting at `from` (block, control statement, or up to `;`). */
  private statementEnd(from: number, depth = 0): number {
    const tk = this.tk;
    const n = tk.length;
    if (from >= n) {
      return n - 1;
    }
    const first = tk[from];
    if (first.value === '{') {
      return this.closeOf(from);
    }
    if (depth < 30 && first.type === 'word' && this.v(from + 1) === '(' && /^(for|while|if|switch)$/.test(first.value)) {
      let end = this.statementEnd(this.closeOf(from + 1) + 1, depth + 1);
      if (first.value === 'if' && this.v(end + 1) === 'else') {
        end = this.statementEnd(end + 2, depth + 1);
      }
      return end;
    }
    return this.expressionEnd(from, false);
  }

  /** End of an expression / simple statement: `;`, an unmatched closer, or a line break (ASI). */
  private expressionEnd(from: number, stopAtComma: boolean): number {
    const tk = this.tk;
    const n = tk.length;
    let i = from;
    while (i < n) {
      const x = tk[i];
      if (x.type === 'punct') {
        if (x.value === ';' || (stopAtComma && x.value === ',')) {
          return stopAtComma ? i - 1 : i;
        }
        if (x.value === '(' || x.value === '[' || x.value === '{') {
          i = Math.max(i, this.closeOf(i)) + 1;
          continue;
        }
        if (x.value === ')' || x.value === ']' || x.value === '}') {
          return Math.max(from, i - 1);
        }
      }
      if (i > from && x.line > tk[i - 1].line) {
        const p = tk[i - 1];
        const continues = p.type === 'punct' && !/^(\)|\]|\}|\+\+|--)$/.test(p.value);
        if (!continues && !(x.type === 'punct' && /^(\.|\?\.|\?|:|&&|\|\||\+|-|\*|\/)$/.test(x.value))) {
          return i - 1;
        }
      }
      i++;
    }
    return n - 1;
  }

  /** Split a token range at top-level separators. */
  private splitTopLevel(from: number, to: number, sep: string): Array<[number, number]> {
    const parts: Array<[number, number]> = [];
    let start = from;
    for (let i = from; i <= to; i++) {
      const x = this.tk[i];
      if (x.type === 'punct' && (x.value === '(' || x.value === '[' || x.value === '{')) {
        i = Math.max(i, Math.min(to, this.closeOf(i)));
        continue;
      }
      if (x.type === 'punct' && x.value === sep) {
        parts.push([start, i - 1]);
        start = i + 1;
      }
    }
    parts.push([start, to]);
    return parts;
  }

  /** First declared name in `let x = …`, `const [a, b]`, `{ key }` … */
  private firstName(from: number, to: number): string | undefined {
    for (let i = from; i <= to; i++) {
      const x = this.tk[i];
      if (x.type === 'word' && !/^(let|const|var|await|of|in)$/.test(x.value)) {
        return x.value;
      }
    }
    return undefined;
  }

  private params(open: number, close: number): string[] {
    if (close <= open + 1) {
      return [];
    }
    const names: string[] = [];
    for (const [s, e] of this.splitTopLevel(open + 1, close - 1, ',')) {
      let k = s;
      while (k <= e && (PARAM_MODIFIERS.has(this.v(k)) || this.v(k) === '...')) k++;
      if (k > e) {
        continue;
      }
      const v = this.v(k);
      if (v === '{') names.push('{}');
      else if (v === '[') names.push('[]');
      else if (this.isWord(k) && v !== 'this') names.push(v);
    }
    return names;
  }

  /** Skip a TypeScript return-type annotation; returns the index of the body `{`, or -1. */
  private skipReturnType(from: number): number {
    let i = from;
    const limit = Math.min(this.tk.length, from + 60);
    if (this.v(i) === '{') {
      i = this.closeOf(i) + 1; // object type literal
    }
    while (i < limit) {
      const v = this.v(i);
      if (v === '{') {
        return i;
      }
      if (v === ';' || v === '=>' || v === '}') {
        return -1;
      }
      if (v === '(' || v === '[') {
        i = this.closeOf(i) + 1;
        continue;
      }
      i++;
    }
    return -1;
  }

  /** Name of a function value from its context: `name = …`, `name: …`. Records `const` declarators. */
  private assignedName(head: number): string | undefined {
    const p = this.v(head - 1);
    if ((p === '=' || p === ':') && this.isWord(head - 2)) {
      return this.v(head - 2);
    }
    return undefined;
  }

  // ---------------------------------------------------------------- loops

  private forLoop(i: number): void {
    let h = i + 1;
    if (this.v(h) === 'await') {
      h++;
    }
    if (this.v(h) !== '(') {
      return;
    }
    const close = this.closeOf(h);
    const bodyEnd = this.statementEnd(close + 1);
    const parts = this.splitTopLevel(h + 1, close - 1, ';');
    let loopVar: string | undefined;
    let signature: string;
    if (parts.length >= 3) {
      const [init, cond, update] = parts;
      loopVar = this.firstName(init[0], init[1]);
      const c = this.render(cond[0], cond[1], 18);
      const u = this.render(update[0], update[1], 12);
      signature = c || u ? `${c}; ${u}` : ';;';
    } else {
      let k = h + 1;
      while (k < close && !(this.isWord(k) && (this.v(k) === 'of' || this.v(k) === 'in'))) k++;
      loopVar = this.firstName(h + 1, k - 1);
      signature = k < close ? `${loopVar ?? '…'} ${this.v(k)} ${this.render(k + 1, close - 1, 14)}` : this.render(h + 1, close - 1, 24);
    }

    const outer = this.enclosing(['for']);
    if (outer) {
      // Nested loop: fold into the outer Loop Commander as another escort.
      const root = this.out[outer.idx];
      const depth = (outer.depth ?? 1) + 1;
      this.loopDepth.set(outer.idx, Math.max(this.loopDepth.get(outer.idx) ?? 1, depth));
      if (loopVar) {
        root.innerVars ??= [];
        if (root.innerVars.length < MAX_INNER_VARS && !root.innerVars.includes(loopVar) && loopVar !== root.loopVar) {
          root.innerVars.push(loopVar);
        }
      }
      this.absorbed.add(this.tk[i].line);
      this.stack.push({ idx: outer.idx, end: bodyEnd, kind: 'for', header: [h, close], depth });
      return;
    }
    const idx = this.add({ archetype: 'for', line: this.tk[i].line, label: 'for', loopVar, signature, nesting: 1 }, i, bodyEnd, {
      kind: 'for',
      header: [h, close],
      depth: 1,
    });
    this.loopDepth.set(idx, 1);
  }

  private whileLoop(i: number): void {
    if (this.v(i - 1) === '}' && this.doEnds.has(i - 1)) {
      this.absorbed.add(this.tk[i].line); // the tail of a do…while
      return;
    }
    if (this.v(i + 1) !== '(') {
      return;
    }
    const close = this.closeOf(i + 1);
    const cond = this.render(i + 2, close - 1, 20);
    const bodyEnd = this.statementEnd(close + 1);
    this.add({ archetype: 'while', line: this.tk[i].line, label: `while ${cond}`, signature: cond }, i, bodyEnd, {
      kind: 'while',
      header: [i + 1, close],
    });
  }

  private doWhile(i: number): void {
    if (this.v(i + 1) !== '{') {
      return;
    }
    const bodyEnd = this.closeOf(i + 1);
    this.doEnds.add(bodyEnd);
    let end = bodyEnd;
    let cond = '';
    if (this.v(bodyEnd + 1) === 'while' && this.v(bodyEnd + 2) === '(') {
      end = this.closeOf(bodyEnd + 2);
      cond = this.render(bodyEnd + 3, end - 1, 20);
    }
    this.add({ archetype: 'while', line: this.tk[i].line, label: 'do…while', signature: cond }, i, end, { kind: 'while' });
  }

  // ---------------------------------------------------------------- branching

  private ifStatement(i: number): void {
    if (this.v(i + 1) !== '(') {
      return;
    }
    const close = this.closeOf(i + 1);
    const bodyEnd = this.statementEnd(close + 1);
    if (this.v(i - 1) === 'else') {
      const head = this.ifChains.get(i - 2);
      if (head !== undefined) {
        this.out[head].count = (this.out[head].count ?? 1) + 1;
        this.absorbed.add(this.tk[i].line);
        this.ifChains.set(bodyEnd, head);
        this.stack.push({ idx: head, end: bodyEnd, kind: 'if', header: [i + 1, close] });
        return;
      }
    }
    const cond = this.render(i + 2, close - 1, 20);
    const idx = this.add({ archetype: 'if', line: this.tk[i].line, label: `if ${cond}`, signature: cond, count: 1 }, i, bodyEnd, {
      kind: 'if',
      header: [i + 1, close],
    });
    this.ifChains.set(bodyEnd, idx);
  }

  private elseBranch(i: number): void {
    const head = this.ifChains.get(i - 1);
    if (head === undefined) {
      return;
    }
    this.absorbed.add(this.tk[i].line);
    if (this.v(i + 1) !== 'if') {
      this.out[head].count = (this.out[head].count ?? 1) + 1;
      const end = this.statementEnd(i + 1);
      this.stack.push({ idx: head, end, kind: 'if' });
    }
  }

  private switchStatement(i: number): void {
    if (this.v(i + 1) !== '(') {
      return;
    }
    const close = this.closeOf(i + 1);
    const subject = this.render(i + 2, close - 1, 16);
    const end = this.v(close + 1) === '{' ? this.closeOf(close + 1) : close;
    this.add({ archetype: 'if', line: this.tk[i].line, label: `switch ${subject}`, signature: subject, count: 0 }, i, end, {
      kind: 'switch',
      header: [i + 1, close],
    });
  }

  private caseLabel(i: number): void {
    const sw = this.enclosing(['switch']);
    const top = this.stack[this.stack.length - 1];
    if (!sw || top !== sw) {
      return;
    }
    if (this.tk[i].value === 'default' && this.v(i + 1) !== ':') {
      return;
    }
    this.out[sw.idx].count = (this.out[sw.idx].count ?? 0) + 1;
    this.absorbed.add(this.tk[i].line);
  }

  private logic(i: number): void {
    const header = this.inControlHeader(i);
    const key = header?.header ? `h${header.header[0]}` : `s${this.stmtStart}`;
    const op = this.v(i);
    let idx = this.logicGroups.get(key);
    if (idx === undefined) {
      // `left && right`, using the nearest names on each side of the first operator.
      let l = i - 1;
      while (l > this.stmtStart && l > i - 6 && !this.isWord(l)) l--;
      let r = i + 1;
      while (r < i + 6 && r < this.tk.length - 1 && !this.isWord(r)) r++;
      const label = `${this.v(l)} ${op} ${this.v(r)}`;
      idx = this.add({ archetype: op === '&&' ? 'and' : 'or', line: this.tk[i].line, label, count: 0 }, i, i);
      this.logicGroups.set(key, idx);
      this.logicCounts.set(idx, { and: 0, or: 0 });
    }
    const counts = this.logicCounts.get(idx)!;
    if (op === '&&') counts.and++;
    else counts.or++;
    this.out[idx].count = (this.out[idx].count ?? 0) + 1;
  }

  // ---------------------------------------------------------------- functions & classes

  private functionKeyword(i: number): void {
    let j = i + 1;
    if (this.v(j) === '*') {
      j++;
    }
    let name: string | undefined;
    if (this.isWord(j) && this.v(j + 1) === '(') {
      name = this.v(j);
      j++;
    } else if (this.isWord(j) && this.v(j + 1) === '<') {
      name = this.v(j); // generic function: skip `<T>`
      j++;
      while (j < this.tk.length && this.v(j) !== '(') j++;
    }
    if (this.v(j) !== '(') {
      return;
    }
    const close = this.closeOf(j);
    const body = this.v(close + 1) === '{' ? close + 1 : this.v(close + 1) === ':' ? this.skipReturnType(close + 2) : -1;
    if (body < 0) {
      return; // overload signature / declaration without a body
    }
    const isAsync = this.v(i - 1) === 'async';
    const head = isAsync ? i - 1 : i;
    name ??= this.assignedName(head);
    this.addFunction(head, name, this.params(j, close), isAsync, body, this.closeOf(body), 'function');
  }

  private arrow(i: number): void {
    let p = i - 1;
    // `(a): Type =>` — step back over a simple return-type annotation.
    if (this.isWord(p) && this.v(p - 1) === ':' && this.v(p - 2) === ')') {
      p -= 2;
    }
    let paramStart: number;
    let params: string[];
    if (this.v(p) === ')') {
      paramStart = this.match[p];
      if (paramStart < 0) {
        return;
      }
      params = this.params(paramStart, p);
    } else if (this.isWord(p)) {
      paramStart = p;
      params = [this.v(p)];
    } else {
      return;
    }
    const isAsync = this.v(paramStart - 1) === 'async';
    const head = isAsync ? paramStart - 1 : paramStart;
    const name = this.assignedName(head);
    const bodyStart = i + 1;
    const bodyEnd = this.v(bodyStart) === '{' ? this.closeOf(bodyStart) : this.expressionEnd(bodyStart, true);
    let callee: string | undefined;
    if (!name) {
      // An inline callback: label it after the call it's passed to, e.g. `map(=>)`.
      let depth = 0;
      for (let k = head - 1; k >= Math.max(0, head - 200); k--) {
        const v = this.v(k);
        if (v === ')' || v === ']' || v === '}') depth++;
        else if (v === '(' || v === '[' || v === '{') {
          if (depth === 0) {
            if (v === '(' && this.isWord(k - 1)) {
              callee = this.v(k - 1);
            }
            break;
          }
          depth--;
        }
      }
    }
    this.addFunction(head, name, params, isAsync, bodyStart, bodyEnd, 'arrow', callee);
  }

  private maybeMethod(i: number): void {
    const name = this.v(i);
    if (NOT_METHODS.has(name) || this.v(i + 1) !== '(') {
      return;
    }
    // Walk back over modifiers: `static async *name(`.
    let m = i - 1;
    let isAsync = false;
    while (m >= 0 && (METHOD_MODIFIERS.has(this.v(m)) || this.v(m) === '*')) {
      if (this.v(m) === 'async') isAsync = true;
      m--;
    }
    const before = this.tk[m];
    const atMemberStart =
      !before ||
      (before.type === 'punct' && (before.value === '{' || before.value === '}' || before.value === ';' || before.value === ',')) ||
      before.line < this.tk[m + 1].line;
    if (!atMemberStart) {
      return;
    }
    const close = this.closeOf(i + 1);
    const body = this.v(close + 1) === '{' ? close + 1 : this.v(close + 1) === ':' ? this.skipReturnType(close + 2) : -1;
    if (body < 0) {
      return;
    }
    this.addFunction(m + 1, name, this.params(i + 1, close), isAsync, body, this.closeOf(body), 'method');
  }

  private addFunction(
    head: number,
    name: string | undefined,
    params: string[],
    isAsync: boolean,
    bodyStart: number,
    bodyEnd: number,
    style: FnMeta['style'],
    callee?: string,
  ): void {
    const owner = this.stack[this.stack.length - 1];
    if (name && owner?.kind === 'class' && owner.bodyStart !== undefined && head > owner.bodyStart) {
      const cls = this.out[owner.idx];
      cls.methods ??= [];
      if (cls.methods.length < MAX_METHODS && name !== 'constructor') {
        cls.methods.push(name);
      }
    }
    const label = name ? `${name}()` : callee ? `${callee}(=>)` : style === 'arrow' ? `${params[0] ?? ''} => …` : 'ƒ()';
    const idx = this.add(
      {
        archetype: style === 'arrow' ? 'arrow' : 'function',
        line: this.tk[head].line,
        label,
        name,
        params: params.slice(0, 4),
        signature: `(${params.join(', ')})`,
      },
      head,
      bodyEnd,
      { kind: 'fn', bodyStart },
    );
    this.fnMeta.set(idx, { name, isAsync, style, bodyStart, bodyEnd });
  }

  private classDecl(i: number): void {
    let name: string | undefined;
    let j = i + 1;
    if (this.isWord(j) && this.v(j) !== 'extends' && this.v(j) !== 'implements') {
      name = this.v(j);
      j++;
    }
    name ??= this.assignedName(i);
    let extendsName: string | undefined;
    const limit = Math.min(this.tk.length, j + 80);
    while (j < limit && this.v(j) !== '{') {
      if (this.v(j) === 'extends' && this.isWord(j + 1)) {
        extendsName = this.v(j + 1);
      }
      if (this.v(j) === '(' || this.v(j) === '[') {
        j = this.closeOf(j);
      }
      if (this.v(j) === ';') {
        return;
      }
      j++;
    }
    if (this.v(j) !== '{') {
      return;
    }
    const end = this.closeOf(j);
    this.add(
      {
        archetype: 'class',
        line: this.tk[i].line,
        label: name ?? 'class',
        name,
        methods: [],
        signature: extendsName ? `extends ${extendsName}` : undefined,
      },
      i,
      end,
      { kind: 'class', bodyStart: j },
    );
  }

  // ---------------------------------------------------------------- statements

  private tryStatement(i: number): void {
    if (this.v(i + 1) !== '{') {
      return;
    }
    let end = this.closeOf(i + 1);
    let label = 'try';
    let k = end + 1;
    if (this.v(k) === 'catch') {
      label = 'try/catch';
      this.absorbed.add(this.tk[k].line);
      let c = k + 1;
      if (this.v(c) === '(') {
        c = this.closeOf(c) + 1;
      }
      if (this.v(c) === '{') {
        end = this.closeOf(c);
      }
      k = end + 1;
    }
    if (this.v(k) === 'finally' && this.v(k + 1) === '{') {
      if (label === 'try') label = 'try/finally';
      this.absorbed.add(this.tk[k].line);
      end = this.closeOf(k + 1);
    }
    this.add({ archetype: 'try', line: this.tk[i].line, label }, i, end, { kind: 'try' });
  }

  private moduleName(from: number, to: number): string | undefined {
    for (let k = from; k <= to && k < this.tk.length; k++) {
      if (this.tk[k].type === 'string') {
        const raw = this.tk[k].value.replace(/^["'`]|["'`]$/g, '');
        const base = raw.split('/').filter(Boolean).pop() ?? raw;
        return base.replace(/\.(m?[jt]sx?|c[jt]s|json)$/, '') || raw;
      }
    }
    return undefined;
  }

  private importStatement(i: number): void {
    const next = this.v(i + 1);
    if (next === '.') {
      return; // import.meta
    }
    const end = next === '(' ? this.closeOf(i + 1) : this.expressionEnd(i + 1, false);
    const mod = this.moduleName(i + 1, end);
    if (next !== '(' && mod === undefined && this.v(i + 1) !== '{' && !this.isWord(i + 1) && this.v(i + 1) !== '*') {
      return;
    }
    this.add({ archetype: 'import', line: this.tk[i].line, label: `import ${mod ?? '…'}`, name: mod }, i, i);
  }

  private reExport(i: number): void {
    const end = this.expressionEnd(i + 1, false);
    for (let k = i + 1; k <= end; k++) {
      if (this.v(k) === 'from') {
        const mod = this.moduleName(k + 1, end);
        this.add({ archetype: 'import', line: this.tk[i].line, label: `import ${mod ?? '…'}`, name: mod }, i, i);
        return;
      }
    }
  }

  private requireCall(i: number): void {
    if (this.v(i + 1) !== '(' || this.tk[i + 2]?.type !== 'string') {
      return;
    }
    const mod = this.moduleName(i + 2, i + 2);
    this.add({ archetype: 'import', line: this.tk[i].line, label: `require ${mod ?? '…'}`, name: mod }, i, i);
  }

  private exitStatement(i: number, kw: 'return' | 'throw'): void {
    const end = this.expressionEnd(i + 1, false);
    let label: string = kw;
    if (end > i && this.tk[i + 1].line === this.tk[i].line && this.v(i + 1) !== ';' && this.v(i + 1) !== '}') {
      if (kw === 'throw' && this.v(i + 1) === 'new' && this.isWord(i + 2)) {
        label = `throw ${this.v(i + 2)}`;
      } else {
        const last = this.v(end) === ';' ? end - 1 : end;
        label = `${kw} ${this.render(i + 1, Math.min(last, i + 4), 10)}`;
      }
    }
    this.add({ archetype: kw, line: this.tk[i].line, label }, i, i);
  }

  private declaration(i: number): void {
    const kw = this.v(i);
    const nextTok = this.tk[i + 1];
    if (!nextTok || !(nextTok.type === 'word' || nextTok.value === '{' || nextTok.value === '[')) {
      return; // `let` used as a plain identifier
    }
    if (kw === 'const' && this.v(i + 1) === 'enum') {
      return;
    }
    if (this.inControlHeader(i)) {
      return; // `for (let i = 0; …)` belongs to the loop
    }
    const name = nextTok.type === 'word' ? nextTok.value : this.firstName(i + 2, this.closeOf(i + 1));
    // Find the initializer.
    let k = nextTok.type === 'word' ? i + 2 : this.closeOf(i + 1) + 1;
    const limit = Math.min(this.tk.length, k + 40);
    while (k < limit && this.v(k) !== '=' && this.v(k) !== ';' && this.tk[k].line === nextTok.line) {
      if (this.v(k) === '(' || this.v(k) === '[' || this.v(k) === '{') {
        k = this.closeOf(k);
      }
      k++;
    }
    if (this.v(k) === '=' && this.isFunctionValue(k + 1)) {
      return; // `const f = () => …` is a function enemy, not a const
    }
    const value = this.v(k + 1);
    if (this.v(k) === '=' && (value === 'require' || value === 'class' || (value === 'await' && this.v(k + 2) === 'import'))) {
      return;
    }
    this.add({ archetype: kw === 'const' ? 'const' : 'let', line: this.tk[i].line, label: `${kw} ${name ?? '…'}`, name }, i, i);
  }

  private isFunctionValue(p: number): boolean {
    if (this.v(p) === 'async') {
      p++;
    }
    if (this.v(p) === 'function') {
      return true;
    }
    if (this.v(p) === '(') {
      let q = this.closeOf(p) + 1;
      if (this.v(q) === ':') {
        const limit = q + 20;
        while (q < limit && q < this.tk.length && this.v(q) !== '=>') q++;
      }
      return this.v(q) === '=>';
    }
    return this.isWord(p) && this.v(p + 1) === '=>';
  }

  private awaitExpr(i: number): void {
    const fn = this.enclosing(['fn'], true);
    if (fn) {
      const meta = this.fnMeta.get(fn.idx);
      if (meta) {
        const c = this.out[fn.idx];
        c.count = (c.count ?? 0) + 1;
        meta.isAsync = true;
      }
      return;
    }
    const existing = this.awaitGroups.get(this.stmtStart);
    if (existing !== undefined) {
      this.out[existing].count = (this.out[existing].count ?? 1) + 1;
      return;
    }
    const target = this.render(i + 1, Math.min(i + 3, this.expressionEnd(i + 1, false)), 10);
    const idx = this.add({ archetype: 'async', line: this.tk[i].line, label: `await ${target}`, count: 1 }, i, i);
    this.awaitGroups.set(this.stmtStart, idx);
  }

  private promise(i: number, label: string): void {
    const existing = this.promiseGroups.get(this.stmtStart);
    if (existing !== undefined) {
      this.out[existing].count = (this.out[existing].count ?? 1) + 1;
      return;
    }
    const idx = this.add({ archetype: 'promise', line: this.tk[i].line, label, count: 1 }, i, i);
    this.promiseGroups.set(this.stmtStart, idx);
  }

  // ---------------------------------------------------------------- results

  private finish(): ConstructResult {
    for (const [idx, meta] of this.fnMeta) {
      const c = this.out[idx];
      const recursive =
        !!meta.name &&
        (this.calls.get(meta.name) ?? []).some((pos) => pos > meta.bodyStart && pos <= meta.bodyEnd);
      const arch: Archetype = recursive ? 'recursive' : meta.isAsync ? 'async' : meta.style === 'arrow' ? 'arrow' : 'function';
      c.archetype = arch;
      if (arch === 'async' && meta.name) {
        c.label = `async ${meta.name}()`;
      } else if (arch === 'arrow' && meta.name) {
        c.label = `${meta.name} =>`;
      }
    }
    for (const [idx, depth] of this.loopDepth) {
      this.out[idx].nesting = depth;
    }
    for (const [idx, counts] of this.logicCounts) {
      const c = this.out[idx];
      c.archetype = counts.and >= counts.or ? 'and' : 'or';
      c.combo = counts.and > 0 && counts.or > 0;
    }
    for (const c of this.out) {
      c.label = truncateLabel(c.label.replace(/\s+/g, ' ').trim(), LABEL_MAX);
    }
    return { constructs: this.out, absorbedLines: this.absorbed };
  }
}
