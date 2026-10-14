/**
 * Pure (vscode-free) code → enemy conversion. Kept separate so it can be unit tested in plain Node.
 */
import type { CodeSnapshot, EnemyKind, EnemySpec } from './shared/protocol';

/** Lines analysed at most; larger documents use a window centred on the cursor. */
export const MAX_ANALYZED_LINES = 3000;
/** Enemy specs sent to the webview at most. */
export const MAX_SPECS = 600;
/** Characters of a single line looked at (minified files can have megabyte-long lines). */
const MAX_LINE_CHARS = 400;
/** Newly typed enemies sent per update at most. */
export const MAX_FRESH = 6;

export interface DiagnosticLike {
  line: number;
  /** 0 = error, 1 = warning (matches vscode.DiagnosticSeverity). Others are ignored. */
  severity: number;
  message: string;
}

export interface AnalyzeInput {
  fileName: string;
  languageId: string;
  /** Total lines in the document. */
  lineCount: number;
  /** Line source: called only for lines inside the analysed window. */
  getLine: (index: number) => string;
  cursorLine?: number;
  diagnostics?: readonly DiagnosticLike[];
}

const COMMENT_RE = /^(\/\/|\/\*|\*\/|\*(\s|$)|#(?!include|define|if|endif|pragma|region|endregion|!)|--|<!--|;;)/;
const CLASS_RE =
  /\b(class|interface|struct|enum|trait|protocol|record|object|impl|module|namespace|type)\s+([A-Za-z_$][\w$]*)/;
const FUNCTION_RES: RegExp[] = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/, // JS/TS/PHP
  /\b(?:def|fn|func|fun|sub|proc)\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)/, // Python, Rust, Go, Kotlin, Perl…
  /\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/, // arrows & function expressions
];
/** `name(args) {` — methods in C-like languages. */
const METHOD_RE =
  /^(?:(?:public|private|protected|internal|static|async|override|virtual|final|abstract|export|default|get|set|inline|const|unsafe|extern)\s+)*(?:[A-Za-z_$][\w$<>,[\]\s*&?.]*\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?:[:\-]>?\s*[^{;]+)?(?:throws\s+[^{]+)?\{?\s*$/;
const CONTROL_KEYWORDS = new Set([
  'if', 'else', 'elif', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'match', 'when', 'return', 'throw',
  'raise', 'try', 'catch', 'except', 'finally', 'break', 'continue', 'yield', 'await', 'import', 'from',
  'require', 'using', 'with', 'goto', 'defer', 'select', 'loop', 'unless', 'until',
]);
const KEYWORD_RE = /^(?:}\s*)?([A-Za-z]+)\b/;
const BRACKETS_ONLY_RE = /^[\s{}()[\]<>;,.:/]+$/;
const STRING_RE = /^(?:[A-Za-z_$][\w$]*\s*[:=]\s*)?(["'`]).*\1[,;]?$/;
const IDENT_RE = /[A-Za-z_$][\w$]*/;
/** `==` or `===` (but not `!=`, `!==`, `<=`, `>=`, or `====`). */
const EQUALS_RE = /(?:^|[^=!<>])(={2,3})(?!=)/;
const COMPLEXITY_RE = /[(){}[\]&|?:!<>=+\-*/%^]/g;

const KIND_BASE_HP: Record<EnemyKind, number> = {
  line: 1,
  function: 2,
  class: 4,
  bracket: 1,
  keyword: 1,
  comment: 1,
  string: 1,
  equals: 2,
  bug: 3,
  warning: 2,
};

function clampHp(n: number): number {
  return Math.max(1, Math.min(12, Math.round(n)));
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function complexityOf(text: string): number {
  return (text.match(COMPLEXITY_RE) ?? []).length;
}

/** Classify a single trimmed line. Returns undefined for blank lines. */
export function classifyLine(raw: string): Pick<EnemySpec, 'kind' | 'label' | 'hp'> | undefined {
  const text = raw.slice(0, MAX_LINE_CHARS).trim();
  if (!text) {
    return undefined;
  }
  const lengthBonus = Math.floor(text.length / 45);
  const complexityBonus = Math.floor(complexityOf(text) / 8);

  if (COMMENT_RE.test(text)) {
    return { kind: 'comment', label: text.startsWith('#') ? '#' : text.startsWith('--') ? '--' : '//', hp: 1 };
  }
  if (BRACKETS_ONLY_RE.test(text)) {
    const compact = text.replace(/\s+/g, '');
    return { kind: 'bracket', label: truncate(compact, 5), hp: clampHp(1 + Math.floor(compact.length / 4)) };
  }

  const cls = CLASS_RE.exec(text);
  // `type` is only a declaration when followed by `=` / `{` / generics (avoid `type` used as a word).
  if (cls && (cls[1] !== 'type' || /\btype\s+[A-Za-z_$][\w$]*\s*(<[^>]*>)?\s*[={]/.test(text))) {
    return { kind: 'class', label: truncate(cls[2], 12), hp: clampHp(KIND_BASE_HP.class + lengthBonus + complexityBonus) };
  }

  const kw = KEYWORD_RE.exec(text);
  const keyword = kw?.[1];
  if (keyword && CONTROL_KEYWORDS.has(keyword)) {
    return { kind: 'keyword', label: keyword, hp: clampHp(KIND_BASE_HP.keyword + complexityBonus) };
  }

  for (const re of FUNCTION_RES) {
    const m = re.exec(text);
    if (m && m[1]) {
      return {
        kind: 'function',
        label: truncate(m[1], 11) + '()',
        hp: clampHp(KIND_BASE_HP.function + lengthBonus + complexityBonus),
      };
    }
  }
  const method = METHOD_RE.exec(text);
  if (method && !CONTROL_KEYWORDS.has(method[1]) && !/^(new|return|typeof|sizeof|delete)$/.test(method[1])) {
    // Require a body or a return type so plain calls like `print(x)` stay ordinary lines.
    if (text.endsWith('{') || /\)\s*(?::|->)/.test(text)) {
      return {
        kind: 'function',
        label: truncate(method[1], 11) + '()',
        hp: clampHp(KIND_BASE_HP.function + lengthBonus + complexityBonus),
      };
    }
  }

  if (STRING_RE.test(text)) {
    return { kind: 'string', label: '"…"', hp: clampHp(KIND_BASE_HP.string + lengthBonus) };
  }

  const ident = IDENT_RE.exec(text);
  const label = truncate(ident ? ident[0] : text.replace(/\s+/g, ''), 10);
  return { kind: 'line', label, hp: clampHp(KIND_BASE_HP.line + lengthBonus + complexityBonus) };
}

/** The equality operator used on a line, ignoring anything inside string literals. */
export function equalsOperator(raw: string): string | undefined {
  const code = raw.slice(0, MAX_LINE_CHARS).replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  return EQUALS_RE.exec(code)?.[1];
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 120);
}

/** Pick the [start, end) window of lines to analyse. */
export function analysisWindow(lineCount: number, cursorLine = 0): [number, number] {
  if (lineCount <= MAX_ANALYZED_LINES) {
    return [0, lineCount];
  }
  const half = Math.floor(MAX_ANALYZED_LINES / 2);
  let start = Math.max(0, Math.min(cursorLine - half, lineCount - MAX_ANALYZED_LINES));
  return [start, start + MAX_ANALYZED_LINES];
}

export function analyzeCode(input: AnalyzeInput): CodeSnapshot {
  const [start, end] = analysisWindow(input.lineCount, input.cursorLine ?? 0);
  const specs: EnemySpec[] = [];
  const occurrences = new Map<string, number>();
  const makeId = (key: string): string => {
    const n = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, n);
    return `${key}#${n}`;
  };

  // Diagnostics first: they are the most important enemies and must survive the MAX_SPECS cap.
  let errors = 0;
  let warnings = 0;
  for (const d of input.diagnostics ?? []) {
    if (d.severity !== 0 && d.severity !== 1) {
      continue;
    }
    const isError = d.severity === 0;
    isError ? errors++ : warnings++;
    if (specs.length >= MAX_SPECS / 4) {
      continue;
    }
    const kind: EnemyKind = isError ? 'bug' : 'warning';
    const message = d.message.split('\n')[0];
    specs.push({
      id: makeId(`${kind}:${d.line}:${normalize(message)}`),
      kind,
      label: isError ? 'BUG' : 'WARN',
      hp: KIND_BASE_HP[kind],
      line: d.line,
      detail: truncate(message, 80),
    });
  }

  let nonBlank = 0;
  for (let i = start; i < end; i++) {
    let text: string;
    try {
      text = input.getLine(i);
    } catch {
      break; // document shrank while we were reading
    }
    const c = classifyLine(text);
    if (!c) {
      continue;
    }
    nonBlank++;
    if (specs.length >= MAX_SPECS) {
      continue;
    }
    const normalized = normalize(text.slice(0, MAX_LINE_CHARS));
    specs.push({ id: makeId(`${c.kind}:${normalized}`), line: i, ...c });

    // A comparison on the line spawns an extra `==` twin-striker enemy.
    const eq = c.kind === 'comment' || c.kind === 'string' ? null : equalsOperator(text);
    if (eq && specs.length < MAX_SPECS) {
      specs.push({ id: makeId(`equals:${normalized}`), kind: 'equals', label: eq, hp: KIND_BASE_HP.equals, line: i });
    }
  }

  return {
    fileName: input.fileName,
    languageId: input.languageId,
    lineCount: input.lineCount,
    specs,
    errors,
    warnings,
    truncated: end - start < input.lineCount || nonBlank > specs.length,
    empty: nonBlank === 0,
  };
}

/**
 * Enemies present in `next` but not in `previous` — i.e. code that was just typed.
 * Ordered by distance to the cursor so the line being edited spawns first.
 */
export function freshSpecs(previousIds: ReadonlySet<string>, next: CodeSnapshot, cursorLine = 0): EnemySpec[] {
  return next.specs
    .filter((s) => !previousIds.has(s.id))
    .sort((a, b) => Math.abs(a.line - cursorLine) - Math.abs(b.line - cursorLine))
    .slice(0, MAX_FRESH);
}

/** Built-in code for the demo wave when no text editor is open. */
export const DEMO_SOURCE = `// Code Invaders demo wave — open a real file to fight your own code!
import { Galaxy } from './galaxy';

interface Ship {
  name: string;
  shields: number;
}

export class Fleet {
  private ships: Ship[] = [];

  launch(name: string): Ship {
    const ship = { name, shields: 100 };
    this.ships.push(ship);
    return ship;
  }

  findWeakest(): Ship | undefined {
    let weakest: Ship | undefined;
    for (const ship of this.ships) {
      if (!weakest || ship.shields < weakest.shields) {
        weakest = ship;
      }
    }
    return weakest;
  }
}

const greet = (who: string) => \`Hello, \${who}\`;

function warp(speed: number, mode = 'safe') {
  if (speed > 9 || mode === 'ludicrous') {
    throw new Error("Captain, she cannae take it!");
  }
  return Galaxy.jump(speed * 1.5);
}
`;
