/**
 * Message contract between the extension host and the game webview.
 * Imported with `import type` on both sides so nothing here is bundled at runtime.
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

export interface EnemySpec {
  /** Stable identity used to detect newly typed code (kind + normalized text + occurrence). */
  id: string;
  kind: EnemyKind;
  /** Short text painted on the enemy. */
  label: string;
  /** Hit points (1..12). */
  hp: number;
  /** Zero-based source line. */
  line: number;
  /** Optional longer text (e.g. the diagnostic message) shown when destroyed. */
  detail?: string;
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
