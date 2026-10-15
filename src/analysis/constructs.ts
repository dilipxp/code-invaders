import type { Archetype } from '../shared/protocol';

/** A programming construct found in the source, before it becomes an enemy spec. */
export interface Construct {
  archetype: Archetype;
  /** Absolute zero-based line where the construct starts. */
  line: number;
  /** Short label painted on the enemy, taken from the source. */
  label: string;
  name?: string;
  signature?: string;
  loopVar?: string;
  innerVars?: string[];
  nesting?: number;
  params?: string[];
  methods?: string[];
  count?: number;
  combo?: boolean;
  /** Index of the enclosing construct in the same result list. */
  parent?: number;
}

export interface ConstructResult {
  constructs: Construct[];
  /**
   * Lines folded into another construct's enemy (`else if`, `case`, `catch`, nested `for` headers…).
   * They don't spawn an enemy of their own.
   */
  absorbedLines: Set<number>;
}

/** A language adapter turns source lines into constructs. */
export interface LanguageAdapter {
  readonly id: string;
  readonly parser: 'syntax' | 'fallback';
  /** `lines[k]` is absolute line `firstLine + k`. */
  analyze(lines: readonly string[], firstLine: number): ConstructResult;
}

export function truncateLabel(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
