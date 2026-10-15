import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analysisWindow,
  analyzeCode,
  classifyLine,
  DEMO_SOURCE,
  freshSpecs,
  MAX_ANALYZED_LINES,
  MAX_FRESH,
  MAX_SPECS,
} from '../src/codeAnalyzer';

const analyze = (src: string, extra: Partial<Parameters<typeof analyzeCode>[0]> = {}) => {
  const lines = src.split('\n');
  return analyzeCode({ fileName: 'x.ts', languageId: 'typescript', lineCount: lines.length, getLine: (i) => lines[i], ...extra });
};

describe('classifyLine', () => {
  const cases: Array<[string, string, string?]> = [
    ['function render(a, b) {', 'function', 'render()'],
    ['  async function* stream() {', 'function', 'stream()'],
    ['def compute_total(items):', 'function', 'compute_to…()'], // long names are shortened
    ['fn main() -> Result<()> {', 'function', 'main()'],
    ['func (s *Server) Start() error {', 'function', 'Start()'],
    ['const greet = (who: string) => `hi ${who}`;', 'function', 'greet()'],
    ['  handleClick = async () => {', 'function', 'handleClick()'],
    ['  findWeakest(): Ship | undefined {', 'function', 'findWeakest()'],
    ['public static void main(String[] args) {', 'function', 'main()'],
    ['export class Fleet {', 'class', 'Fleet'],
    ['interface Ship {', 'class', 'Ship'],
    ['type Props = { a: number }', 'class', 'Props'],
    ['pub struct Point {', 'class', 'Point'],
    ['if (x > 3) {', 'keyword', 'if'],
    ['} else {', 'keyword', 'else'],
    ['return value;', 'keyword', 'return'],
    ['for (const s of ships) {', 'keyword', 'for'],
    ["import { a } from './a';", 'keyword', 'import'],
    ['// TODO: fix', 'comment', '//'],
    ['# python comment', 'comment', '#'],
    [' * jsdoc line', 'comment', '//'],
    ['});', 'bracket', '});'],
    ['}', 'bracket', '}'],
    ['"hello world",', 'string'],
    ['const total = items.reduce((a, b) => a + b, 0);', 'line', 'const'],
    ['print(x)', 'line', 'print'],
    ['console.log(x);', 'line', 'console'],
    ['#include <stdio.h>', 'line'],
  ];
  for (const [src, kind, label] of cases) {
    it(`${JSON.stringify(src)} → ${kind}`, () => {
      const c = classifyLine(src);
      assert.ok(c, 'expected a classification');
      assert.equal(c.kind, kind);
      if (label) {
        assert.equal(c.label, label);
      }
      assert.ok(c.hp >= 1 && c.hp <= 12);
    });
  }

  it('ignores blank lines', () => {
    assert.equal(classifyLine(''), undefined);
    assert.equal(classifyLine('   \t '), undefined);
  });

  it('gives longer, more complex code more hit points', () => {
    const simple = classifyLine('x = 1')!;
    const complex = classifyLine(
      'const result = ((a && b) || (c ? d[e] : f(g, h))) + compute(x, y, z) * (p - q) / (r % s) ^ t;',
    )!;
    assert.ok(complex.hp > simple.hp, `${complex.hp} > ${simple.hp}`);
  });

  it('copes with minified megabyte-long lines', () => {
    const c = classifyLine('var a=' + 'x+'.repeat(500_000) + '1;');
    assert.ok(c && c.hp <= 12);
  });
});

describe('analyzeCode', () => {
  it('turns the demo source into a varied wave', () => {
    const s = analyze(DEMO_SOURCE);
    const kinds = new Set(s.specs.map((x) => x.kind));
    for (const k of ['function', 'class', 'keyword', 'bracket', 'comment', 'line']) {
      assert.ok(kinds.has(k as never), `missing ${k}`);
    }
    assert.equal(s.empty, false);
    assert.equal(s.truncated, false);
  });

  it('flags empty documents', () => {
    const s = analyze('\n\n   \n');
    assert.equal(s.empty, true);
    assert.equal(s.specs.length, 0);
    const zero = analyzeCode({ fileName: 'e', languageId: 'x', lineCount: 0, getLine: () => '' });
    assert.equal(zero.empty, true);
  });

  it('turns diagnostics into bugs and warnings, ahead of code', () => {
    const s = analyze('let a = 1\nlet b = 2', {
      diagnostics: [
        { line: 0, severity: 0, message: 'Type error\nmore detail' },
        { line: 1, severity: 1, message: 'Unused variable' },
        { line: 1, severity: 2, message: 'info is ignored' },
      ],
    });
    assert.equal(s.errors, 1);
    assert.equal(s.warnings, 1);
    assert.equal(s.specs[0].kind, 'bug');
    assert.equal(s.specs[0].detail, 'Type error');
    assert.equal(s.specs[1].kind, 'warning');
    assert.equal(s.specs.length, 4);
  });

  it('caps large documents and only reads the window around the cursor', () => {
    const total = 50_000;
    const read: number[] = [];
    const s = analyzeCode({
      fileName: 'big.ts',
      languageId: 'typescript',
      lineCount: total,
      cursorLine: 40_000,
      getLine: (i) => {
        read.push(i);
        return `const v${i} = ${i};`;
      },
    });
    assert.equal(read.length, MAX_ANALYZED_LINES);
    assert.ok(Math.min(...read) <= 40_000 && Math.max(...read) >= 40_000);
    assert.equal(s.specs.length, MAX_SPECS);
    assert.equal(s.truncated, true);
  });

  it('survives a document shrinking mid-read', () => {
    const s = analyzeCode({
      fileName: 'x',
      languageId: 'x',
      lineCount: 10,
      getLine: (i) => {
        if (i > 3) {
          throw new Error('gone');
        }
        return 'a = 1';
      },
    });
    assert.equal(s.specs.length, 4);
  });

  it('assigns stable ids to duplicate lines', () => {
    const s = analyze('}\n}\n}');
    assert.deepEqual(
      s.specs.map((x) => x.id),
      ['bracket:}#1', 'bracket:}#2', 'bracket:}#3'],
    );
  });
});

describe('== enemies', () => {
  it('adds a twin-striker enemy for lines that compare with == or ===', () => {
    const s = analyze('if (a == b) {\n  ok = x === y;\n}');
    const eq = s.specs.filter((x) => x.kind === 'equals');
    assert.deepEqual(
      eq.map((x) => [x.label, x.line]),
      [
        ['==', 0],
        ['===', 1],
      ],
    );
    // The `if` itself is still there (as a conditional construct enemy labelled from the source).
    assert.ok(s.specs.some((x) => x.kind === 'keyword' && x.archetype === 'if' && x.label === 'if a == b'));
  });

  it('ignores !=, !==, <=, >=, comments and strings', () => {
    for (const src of ['if (a != b) {', 'if (a !== b) {', 'x <= y', 'x >= y', '// a == b', 'msg = "a == b";', 'a ==== b']) {
      assert.ok(!analyze(src).specs.some((x) => x.kind === 'equals'), src);
    }
  });
});

describe('analysisWindow', () => {
  it('covers small documents completely', () => {
    assert.deepEqual(analysisWindow(10, 5), [0, 10]);
  });
  it('clamps at both ends', () => {
    assert.deepEqual(analysisWindow(10_000, 0), [0, MAX_ANALYZED_LINES]);
    assert.deepEqual(analysisWindow(10_000, 9_999), [10_000 - MAX_ANALYZED_LINES, 10_000]);
  });
});

describe('freshSpecs', () => {
  it('reports only newly typed code, nearest to the cursor first', () => {
    const before = analyze('function a() {\n}\n');
    const after = analyze('function a() {\n  return 1;\n}\nconst z = 2;\n');
    const fresh = freshSpecs(new Set(before.specs.map((s) => s.id)), after, 1);
    assert.deepEqual(
      fresh.map((s) => s.kind),
      ['keyword', 'line'],
    );
    assert.equal(fresh[0].line, 1);
  });

  it('limits a large paste to a handful of enemies', () => {
    const big = analyze(Array.from({ length: 200 }, (_, i) => `let x${i} = ${i};`).join('\n'));
    assert.equal(freshSpecs(new Set(), big, 0).length, MAX_FRESH);
  });
});
