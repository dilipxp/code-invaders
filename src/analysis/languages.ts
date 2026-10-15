import type { LanguageAdapter } from './constructs';
import { fallbackAdapter } from './fallbackConstructs';
import { jsAdapter } from './jsConstructs';

/**
 * VS Code language id → construct finder. Add a language by writing a `LanguageAdapter`
 * and registering its ids here; everything else falls back to the indentation-based adapter.
 */
const ADAPTERS: ReadonlyArray<[readonly string[], LanguageAdapter]> = [
  [['javascript', 'typescript', 'javascriptreact', 'typescriptreact'], jsAdapter],
];

export function adapterFor(languageId: string, fileName = ''): LanguageAdapter {
  for (const [ids, adapter] of ADAPTERS) {
    if (ids.includes(languageId)) {
      return adapter;
    }
  }
  // Untitled or unknown language id, but a JS/TS file name.
  if (/\.(m?[jt]sx?|c[jt]s)$/i.test(fileName) && (languageId === 'plaintext' || languageId === '')) {
    return jsAdapter;
  }
  return fallbackAdapter;
}
