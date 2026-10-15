/**
 * Message contract between the extension host and the game webview.
 * Almost everything here is a type; the only runtime value is the small `ARCHETYPES` list.
 */

export type EnemyKind =
  | 'line' // ordinary statement
  | 'function' // function / method declaration
  | 'class' // class, interface, struct, enum… (mini-boss)
  | 'bracket' // lines made only of closing/opening brackets
  | 'keyword' // control flow: if, for, return, throw…
  | 'comment' // comments (ghosts)
  | 'string' // string-literal lines
  | 'equals' // `==` / `===` comparison: destroys the nearest enemy on each side
  | 'bug' // diagnostic with Error severity
  | 'warning'; // diagnostic with Warning severity

/**
 * Programming constructs that become dedicated enemies with their own behaviour
 * (see `src/webview/enemies/definitions.ts`). Produced by the source analyzer.
 */
export type Archetype =
  // Tier 1 — basic
  | 'if' // conditional: branches between two paths, dodges
  | 'and' // `&&`: double-strike burst
  | 'or' // `||`: splits into two halves
  | 'arrow' // `=>`: dashes, then attacks
  | 'return' // flees upward after taking damage
  // Tier 2 — intermediate
  | 'function' // fires patterns, summons its parameters
  | 'const' // static defender in a fixed lane with a shield
  | 'let' // adaptive: switches aggressive / defensive
  | 'while' // repeating pattern with a capped cycle count
  | 'class' // elite: several attacks, spawns method units
  | 'try' // recovery shield after damage
  // Tier 3 — dangerous
  | 'for' // Loop Commander with loop-variable escorts
  | 'async' // time-warp: phases out and back in
  | 'promise' // charged, delayed projectile that resolves into a follow-up
  | 'import' // enters from the side, calls reinforcements
  | 'throw' // wind-up, then a heavy shot at your previous position
  | 'recursive'; // creates weaker clones of itself (bounded)

export const ARCHETYPES: readonly Archetype[] = [
  'if', 'and', 'or', 'arrow', 'return',
  'function', 'const', 'let', 'while', 'class', 'try',
  'for', 'async', 'promise', 'import', 'throw', 'recursive',
];

/** What the analyzer learned about a construct. Every field is optional and display-only. */
export interface ConstructInfo {
  /** Function / class / variable name. */
  name?: string;
  /** Compact signature, e.g. `i < 10; i++` for a loop or `(a, b)` for a function. */
  signature?: string;
  /** Loop variable of a `for` loop (`i`). */
  loopVar?: string;
  /** Loop variables of `for` loops nested inside this one (become extra escorts). */
  innerVars?: string[];
  /** Loop nesting depth contained in this loop (1 = no inner loop). */
  nesting?: number;
  /** Parameter names (function enemies summon them). */
  params?: string[];
  /** Method names (class enemies spawn them as modules). */
  methods?: string[];
  /** Grouped occurrences: operators in an expression, branches of an if chain, awaits… */
  count?: number;
  /** `&&` and `||` in the same expression: a stronger combined logic enemy. */
  combo?: boolean;
  /** Spec id of the enclosing construct (method → class, logic → if, …). */
  parentId?: string;
}

export interface EnemySpec {
  /** Stable identity used to detect newly typed code (kind + normalized text + occurrence). */
  id: string;
  kind: EnemyKind;
  /** Short text painted on the enemy. */
  label: string;
  /** Hit points (1..12). For construct enemies this is the source-complexity bonus input. */
  hp: number;
  /** Zero-based source line. */
  line: number;
  /** Optional longer text (e.g. the diagnostic message) shown when destroyed. */
  detail?: string;
  /** Set for construct enemies: which behaviour/visual family to use. */
  archetype?: Archetype;
  construct?: ConstructInfo;
}

export interface CodeSnapshot {
  fileName: string;
  languageId: string;
  lineCount: number;
  specs: EnemySpec[];
  errors: number;
  warnings: number;
  /** True when the document was too large and only a window around the cursor was analysed. */
  truncated: boolean;
  /** True when the document has no code at all. */
  empty: boolean;
  /** How constructs were found: a syntax-aware parser, or the language-agnostic fallback. */
  parser?: 'syntax' | 'fallback';
  /** Number of construct enemies per archetype in the analysed code. */
  constructs?: Partial<Record<Archetype, number>>;
}

export type Difficulty = 'chill' | 'normal' | 'hardcore';
export type Theme = 'retro' | 'neon';

export interface GameSettings {
  startingLives: number;
  difficulty: Difficulty;
  reducedEffects: boolean;
  /** 1 (slow, precise) … 10 (fast, twitchy). */
  moveSensitivity: number;
  theme: Theme;
}

/** Settings the player can change from inside the game; persisted to the user's VS Code settings. */
export type InGameSetting = { key: 'moveSensitivity'; value: number } | { key: 'theme'; value: Theme };

export type HostToWebview =
  | { type: 'init'; snapshot: CodeSnapshot; settings: GameSettings; highScore: number; demo: boolean }
  | { type: 'code'; snapshot: CodeSnapshot; fresh: EnemySpec[] }
  | { type: 'settings'; settings: GameSettings }
  | { type: 'visibility'; visible: boolean }
  | { type: 'returned' };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'exit' }
  | { type: 'editCode' }
  | { type: 'gameOver'; score: number; level: number }
  | ({ type: 'updateSetting' } & InGameSetting);
