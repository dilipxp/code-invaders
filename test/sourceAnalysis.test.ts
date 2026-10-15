import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeFallbackConstructs } from '../src/analysis/fallbackConstructs';
import { analyzeJsConstructs } from '../src/analysis/jsConstructs';
import { adapterFor } from '../src/analysis/languages';
import { tokenize } from '../src/analysis/lexer';
import { ARCHETYPE_KIND, analyzeCode, MAX_SPECS } from '../src/codeAnalyzer';
import { ARCHETYPES, type Archetype, type EnemySpec } from '../src/shared/protocol';

const js = (src: string) => analyzeJsConstructs(src.split('\n'), 0);
const py = (src: string) => analyzeFallbackConstructs(src.split('\n'), 0);
const specsOf = (src: string, languageId = 'typescript', fileName = 'x.ts') => {
  const lines = src.split('\n');
  return analyzeCode({ fileName, languageId, lineCount: lines.length, getLine: (i) => lines[i] });
};
const ofType = (specs: EnemySpec[], a: Archetype) => specs.filter((s) => s.archetype === a);

describe('lexer', () => {
  it('never turns words inside strings, templates, comments or regexes into tokens', () => {
    const words = tokenize(
      [
        `const a = "for (;;) if (x) {}";`,
        `const b = 'while (true)';`,
        '// for (let i = 0; i < 3; i++)',
        '/* class Foo { } */',
        'const t = `if ${ cond ? `nested ${ x } while` : 0 } for`;',
        'const re = /for\\s*\\(/g;',
      ].join('\n'),
    )
      .filter((t) => t.type === 'word')
      .map((t) => t.value);
    for (const kw of ['for', 'if', 'while', 'class']) {
      assert.ok(!words.includes(kw), `${kw} leaked: ${words.join(' ')}`);
    }
  });

  it('tracks absolute line numbers, including across template literals', () => {
    const tokens = tokenize('a\n`x\ny`\nb', 10);
    assert.deepEqual(
      tokens.map((t) => [t.value.replace(/\n/g, '⏎'), t.line]),
      [
        ['a', 10],
        ['`x⏎y`', 11],
        ['b', 13],
      ],
    );
  });

  it('tells division from regex literals', () => {
    const tokens = tokenize('x = a / b / c; y = /a/.test(s)');
    assert.equal(tokens.filter((t) => t.type === 'regex').length, 1);
  });
});

describe('JS/TS constructs', () => {
  it('a for loop is ONE Loop Commander with its signature and loop variable', () => {
    const { constructs } = js('for (let i = 0; i < 10; i++) {\n  total += i;\n}');
    assert.equal(constructs.length, 1);
    const c = constructs[0];
    assert.equal(c.archetype, 'for');
    assert.equal(c.label, 'for');
    assert.equal(c.loopVar, 'i');
    assert.equal(c.signature, 'i < 10; i++');
    assert.equal(c.nesting, 1);
  });

  it('nested loops fold into the outer commander as escorts, with their lines absorbed', () => {
    const src = [
      'for (let i = 0; i < n; i++) {',
      '  for (let j = 0; j < i; j++) {',
      '    for (const k of items) {',
      '      sum += i * j * k;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const { constructs, absorbedLines } = js(src);
    const loops = constructs.filter((c) => c.archetype === 'for');
    assert.equal(loops.length, 1, 'no extra commanders for inner loops');
    assert.deepEqual(loops[0].innerVars, ['j', 'k']);
    assert.equal(loops[0].nesting, 3);
    assert.ok(absorbedLines.has(1) && absorbedLines.has(2));
    // In the enemy specs, the inner `for` lines don't spawn anything.
    const specs = specsOf(src).specs;
    assert.equal(specs.filter((s) => s.line === 1 || s.line === 2).length, 0);
  });

  it('for…of / for…in signatures and loops inside functions inside loops', () => {
    const { constructs } = js('for (const ship of fleet.ships) {\n  ship.items.forEach(function (x) {\n    for (const y of x) {}\n  });\n}');
    const loops = constructs.filter((c) => c.archetype === 'for');
    assert.equal(loops[0].signature, 'ship of fleet.ships');
    assert.equal(loops[0].loopVar, 'ship');
    assert.equal(loops.length, 2, 'a loop in a nested function is its own commander');
  });

  it('groups an if / else if / else chain into one conditional enemy', () => {
    const src = 'if (a > 1) {\n  x();\n} else if (b) {\n  y();\n} else {\n  z();\n}';
    const { constructs, absorbedLines } = js(src);
    const ifs = constructs.filter((c) => c.archetype === 'if');
    assert.equal(ifs.length, 1);
    assert.equal(ifs[0].count, 3);
    assert.equal(ifs[0].label, 'if a > 1');
    assert.ok(absorbedLines.has(2) && absorbedLines.has(4));
  });

  it('groups && / || by expression, flags combos and links them to their if', () => {
    const specs = specsOf('if (a && b && c) {}\nconst ok = x || y && z;').specs;
    const logic = specs.filter((s) => s.archetype === 'and' || s.archetype === 'or');
    assert.equal(logic.length, 2, 'one logic enemy per expression');
    assert.equal(logic[0].archetype, 'and');
    assert.equal(logic[0].construct?.count, 2);
    assert.equal(logic[0].construct?.parentId, specs.find((s) => s.archetype === 'if')!.id);
    assert.equal(logic[1].construct?.combo, true);
  });

  it('recognises arrow functions with the syntax, not just `=>` text', () => {
    const { constructs } = js(
      ['const square = (x) => x * x;', 'const load = async () => { await go(); };', 'items.map(item => item.id);', 'const s = "=> not an arrow";'].join('\n'),
    );
    assert.deepEqual(
      constructs.map((c) => [c.archetype, c.label]),
      [
        ['arrow', 'square =>'],
        ['async', 'async load()'],
        ['arrow', 'map(=>)'],
        ['const', 'const s'],
      ],
    );
  });

  it('functions: declarations, parameters, recursion and async', () => {
    const { constructs } = js(
      [
        'function warp(speed, mode = "safe") { return speed; }',
        'function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }',
        'async function load(url) { const r = await fetch(url); return await r.json(); }',
      ].join('\n'),
    );
    const fns = constructs.filter((c) => ['function', 'recursive', 'async'].includes(c.archetype));
    assert.deepEqual(
      fns.map((c) => [c.archetype, c.name]),
      [
        ['function', 'warp'],
        ['recursive', 'fib'],
        ['async', 'load'],
      ],
    );
    assert.deepEqual(fns[0].params, ['speed', 'mode']);
    assert.equal(fns[2].count, 2, 'awaits are folded into their async function');
    assert.equal(constructs.filter((c) => c.archetype === 'async').length, 1);
  });

  it('classes collect their methods; methods are linked to their class', () => {
    const src = 'export class Tree extends Node {\n  walk(n) { return this.walk(n.left); }\n  static create() { return new Tree(); }\n  handle = () => {};\n}';
    const specs = specsOf(src).specs;
    const cls = specs.find((s) => s.archetype === 'class')!;
    assert.equal(cls.label, 'Tree');
    assert.deepEqual(cls.construct?.methods, ['walk', 'create', 'handle']);
    assert.equal(cls.construct?.signature, 'extends Node');
    const walk = specs.find((s) => s.construct?.name === 'walk')!;
    assert.equal(walk.archetype, 'recursive', 'this.walk() inside walk is recursion');
    assert.equal(walk.construct?.parentId, cls.id);
  });

  it('while, do…while, try/catch, switch, import, return, throw, const and let', () => {
    const src = [
      'import { a } from "./lib/galaxy.js";',
      'const fs = require("fs");',
      'export * from "./utils";',
      'while (queue.length) { queue.pop(); }',
      'do { tick(); } while (running);',
      'try { risky(); } catch (e) { throw new TypeError("bad"); } finally { done(); }',
      'switch (mode) { case 1: break; case 2: break; default: break; }',
      'let counter = 0;',
      'for (let i = 0; i < 3; i++) {}',
      'function f() { return counter + 1; }',
    ].join('\n');
    const c = js(src).constructs.map((x) => `${x.archetype}:${x.label}`);
    for (const expected of [
      'import:import gala…',
      'import:require fs',
      'import:import utils',
      'while:while queue…',
      'while:do…while',
      'try:try/catch',
      'throw:throw TypeE…',
      'if:switch mode',
      'let:let counter',
      'return:return coun…',
    ]) {
      assert.ok(c.includes(expected), `missing ${expected} in ${c.join(', ')}`);
    }
    assert.ok(!c.some((x) => x.startsWith('const:const fs')), 'require() is an import, not a const');
    assert.equal(c.filter((x) => x.startsWith('let:')).length, 1, '`let i` in a for header belongs to the loop');
    const sw = js(src).constructs.find((x) => x.label === 'switch mode')!;
    assert.equal(sw.count, 3, 'cases are grouped into the switch');
  });

  it('groups Promises and top-level awaits per statement', () => {
    const { constructs } = js('new Promise((r) => r()).then(() => 1).then(() => 2);\nawait main(); await other();');
    assert.equal(constructs.filter((c) => c.archetype === 'promise').length, 1);
    const awaits = constructs.filter((c) => c.archetype === 'async');
    assert.equal(awaits.length, 2, 'two statements, two time-warp enemies');
  });

  it('survives garbage and unbalanced input without throwing', () => {
    const junk = ['for (((', 'if ) { else', '}}}}', '`unterminated ${ {', '/* open comment', 'class', 'function (', '=> =>', '&& ||'];
    for (let k = 0; k < 50; k++) {
      const src = Array.from({ length: 30 }, () => junk[Math.floor(Math.random() * junk.length)]).join('\n');
      assert.doesNotThrow(() => js(src));
      assert.doesNotThrow(() => specsOf(src));
    }
  });

  it('stays fast on the largest analysed window', () => {
    const block = 'function f{n}(a, b) {\n  for (let i = 0; i < a.length; i++) {\n    if (a[i] && b) { return f{n}(a, b - 1); }\n  }\n  const x = await load(a);\n  return x;\n}\n';
    const src = Array.from({ length: 430 }, (_, n) => block.replaceAll('{n}', String(n))).join('');
    const t0 = performance.now();
    const s = specsOf(src);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
    assert.ok(s.specs.length <= MAX_SPECS);
    assert.ok((s.constructs?.recursive ?? 0) > 0 && (s.constructs?.for ?? 0) > 0);
  });
});

describe('fallback adapter (other languages)', () => {
  const PY = [
    'import os',
    'class Solver:',
    '    def solve(self, k):',
    '        if k <= 0 or self.n == 0:',
    '            return 1',
    '        elif k == 1:',
    '            return 2',
    '        for i in range(self.n):',
    '            for j in range(i):',
    '                print("for while if", i, j)',
    '        return self.solve(k - 1)',
    'async def fetch_all(urls):',
    '    results = await gather(urls)',
    '    return results',
  ].join('\n');

  it('uses indentation for nesting, recursion and class membership', () => {
    const { constructs, absorbedLines } = py(PY);
    const kinds = constructs.map((c) => c.archetype);
    assert.equal(kinds.filter((k) => k === 'for').length, 1, 'nested loop folds into the outer one');
    const loop = constructs.find((c) => c.archetype === 'for')!;
    assert.equal(loop.loopVar, 'i');
    assert.deepEqual(loop.innerVars, ['j']);
    assert.equal(loop.nesting, 2);
    const solve = constructs.find((c) => c.name === 'solve')!;
    assert.equal(solve.archetype, 'recursive');
    assert.deepEqual(constructs.find((c) => c.archetype === 'class')!.methods, ['solve']);
    assert.equal(constructs.find((c) => c.name === 'fetch_all')!.archetype, 'async');
    assert.equal(constructs.find((c) => c.archetype === 'if')!.count, 2, 'elif joins the chain');
    assert.ok(absorbedLines.has(5) && absorbedLines.has(8));
    assert.ok(constructs.some((c) => c.archetype === 'or'), '`or` is a logic enemy');
  });

  it('ignores keywords inside strings and comments', () => {
    const { constructs } = py('x = "for while if"\n# for i in range(3):\nprint("class Foo")');
    assert.equal(constructs.length, 0);
  });

  it('C-style loops in brace languages', () => {
    const { constructs } = analyzeFallbackConstructs(
      ['for (int i = 0; i < n; i++) {', '    for (int j = 0; j < m; j++) {', '        grid[i][j] = 0;', '    }', '}'],
      0,
    );
    assert.equal(constructs.length, 1);
    assert.equal(constructs[0].signature, 'i < n; i++');
    assert.deepEqual(constructs[0].innerVars, ['j']);
  });

  it('picks the syntax parser for JS/TS and the fallback otherwise', () => {
    for (const id of ['javascript', 'typescript', 'javascriptreact', 'typescriptreact']) {
      assert.equal(adapterFor(id).parser, 'syntax');
    }
    assert.equal(adapterFor('python').parser, 'fallback');
    assert.equal(adapterFor('plaintext', 'untitled.ts').parser, 'syntax');
    assert.equal(specsOf(PY, 'python', 'a.py').parser, 'fallback');
  });
});

describe('construct specs', () => {
  it('every archetype maps to an enemy kind', () => {
    for (const a of ARCHETYPES) {
      assert.ok(ARCHETYPE_KIND[a], a);
    }
  });

  it('construct enemies replace their line; plain lines stay classic enemies', () => {
    const s = specsOf('for (let i = 0; i < 3; i++) {\n  console.log(i);\n}');
    assert.deepEqual(
      s.specs.map((x) => [x.line, x.archetype ?? x.kind]),
      [
        [0, 'for'],
        [1, 'line'],
        [2, 'bracket'],
      ],
    );
    assert.equal(s.constructs?.for, 1);
    assert.equal(s.parser, 'syntax');
  });

  it('labels come from the source and stay short', () => {
    const s = specsOf('function computeTheVeryLongTotal(a) { return a; }\nimport { x } from "./a-really-long-module-name";');
    for (const spec of s.specs) {
      assert.ok(spec.label.length <= 12, spec.label);
    }
    assert.ok(ofType(s.specs, 'function')[0].label.startsWith('computeThe'));
  });

  it('stable ids: unchanged code keeps its ids when code is added elsewhere', () => {
    const before = specsOf('for (let i = 0; i < 3; i++) {}\nif (a) {}').specs.map((s) => s.id);
    const after = specsOf('for (let i = 0; i < 3; i++) {}\nif (a) {}\nwhile (b) {}').specs.map((s) => s.id);
    for (const id of before) {
      assert.ok(after.includes(id), id);
    }
  });
});
