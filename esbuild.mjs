// Bundles the extension host (Node/CommonJS) and the webview game (browser/IIFE).
//   node esbuild.mjs               development build
//   node esbuild.mjs --production  minified, no source maps (used by `vsce package`)
//   node esbuild.mjs --watch       rebuild on change
//   node esbuild.mjs --tests       bundle unit tests into out/test
import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'info',
  legalComments: 'none',
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = tests
  ? [
      {
        ...common,
        entryPoints: readdirSync('test')
          .filter((f) => f.endsWith('.test.ts'))
          .map((f) => `test/${f}`),
        outdir: 'out/test',
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        // Host-side tests run against a small in-memory fake of the vscode API.
        alias: { vscode: './test/mocks/vscode.ts' },
        logLevel: 'warning',
      },
    ]
  : [
      {
        ...common,
        entryPoints: ['src/extension.ts'],
        outfile: 'dist/extension.js',
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        external: ['vscode'],
      },
      {
        ...common,
        entryPoints: ['src/webview/main.ts'],
        outfile: 'dist/webview.js',
        platform: 'browser',
        format: 'iife',
        target: 'es2020',
      },
    ];

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[watch] build finished, watching for changes…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
