import * as vscode from 'vscode';
import { analyzeCode, DEMO_SOURCE, freshSpecs, type DiagnosticLike } from './codeAnalyzer';
import type { CodeSnapshot, GameSettings, HostToWebview, InGameSetting, WebviewToHost } from './shared/protocol';
import { getWebviewHtml, localResourceRoots } from './webviewHtml';

const VIEW_TYPE = 'codeInvaders.game';
const DEBOUNCE_MS = 350;
const HIGH_SCORE_KEY = 'codeInvaders.highScore';
const RUNNING_CONTEXT = 'codeInvaders.running';

/** Everything needed to put the user's editor back exactly where it was. */
interface EditorMemory {
  uri: vscode.Uri;
  viewColumn: vscode.ViewColumn;
  selections: readonly vscode.Selection[];
  visibleRange?: vscode.Range;
}

type Mode = 'playing' | 'editing';

/**
 * One running game. The webview panel is opened in the active editor's group and the original
 * text-editor tab is closed, so the game *takes over* that tab. On exit the document is reopened
 * in the same group with its selection and scroll position, and the panel is disposed.
 *
 * The extension never edits, saves or deletes the user's document; it only reads text and diagnostics.
 */
export class GameSession implements vscode.Disposable {
  private static current: GameSession | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusItem: vscode.StatusBarItem;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private knownIds = new Set<string>();
  /** Last analysed state; reused while the document's tab is closed (it cannot change then). */
  private lastSnapshot: CodeSnapshot;
  private mode: Mode = 'playing';
  private ready = false;
  private disposed = false;
  /** True while we are deliberately restoring the editor, so onDidDispose doesn't restore twice. */
  private restoring = false;

  static async start(context: vscode.ExtensionContext): Promise<void> {
    if (GameSession.current) {
      await GameSession.current.returnToGame();
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      const choice = await vscode.window.showInformationMessage(
        'Code Invaders turns the code in your active editor into enemies, but no text editor is active. ' +
          'Open a file and run "Code Invaders: Start Game" again — or play the demo wave.',
        'Open File…',
        'Play Demo Wave',
      );
      if (choice === 'Open File…') {
        await vscode.commands.executeCommand('workbench.action.files.openFile');
      } else if (choice === 'Play Demo Wave') {
        GameSession.current = new GameSession(context, undefined);
      }
      return;
    }
    const session = new GameSession(context, editor);
    GameSession.current = session;
    await session.takeOverEditorTab(editor);
  }

  static async exit(): Promise<void> {
    await GameSession.current?.exitToEditor();
  }

  static disposeCurrent(): void {
    GameSession.current?.dispose();
  }

  private readonly panel: vscode.WebviewPanel;
  private memory: EditorMemory | undefined;
  /** True when the user's editor tab was closed and must be reopened on exit. */
  private editorTabClosed = false;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    editor: vscode.TextEditor | undefined,
  ) {
    if (editor) {
      this.memory = {
        uri: editor.document.uri,
        viewColumn: editor.viewColumn ?? vscode.ViewColumn.One,
        selections: editor.selections,
        visibleRange: editor.visibleRanges[0],
      };
    }

    this.lastSnapshot = this.analyze(editor?.document);

    const title = editor ? `👾 ${basename(editor.document.uri)}` : '👾 Code Invaders';
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      title,
      { viewColumn: this.memory?.viewColumn ?? vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        enableCommandUris: false,
        enableForms: false,
        enableFindWidget: false,
        // The game must survive the "Edit code, keep game" round-trip without losing its state.
        retainContextWhenHidden: true,
        localResourceRoots: localResourceRoots(context.extensionUri),
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    this.panel.webview.html = getWebviewHtml(this.panel.webview, context.extensionUri);

    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    this.statusItem.text = '$(rocket) Back to Code Invaders';
    this.statusItem.tooltip = 'Your game is paused. Click to return to it in this tab.';
    this.statusItem.command = 'codeInvaders.start';
    this.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

    this.disposables.push(
      this.statusItem,
      this.panel.onDidDispose(() => void this.onPanelDisposed()),
      this.panel.onDidChangeViewState((e) => this.post({ type: 'visibility', visible: e.webviewPanel.visible })),
      this.panel.webview.onDidReceiveMessage((m: WebviewToHost) => void this.onMessage(m)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('codeInvaders')) {
          this.post({ type: 'settings', settings: readSettings() });
        }
      }),
    );

    if (this.memory) {
      const uri = this.memory.uri.toString();
      this.disposables.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
          if (e.document.uri.toString() === uri && e.contentChanges.length > 0) {
            this.scheduleUpdate();
          }
        }),
        vscode.languages.onDidChangeDiagnostics((e) => {
          // Language servers clear diagnostics when a file's tab closes; ignore that while frozen.
          if (!this.isFrozen() && e.uris.some((u) => u.toString() === uri)) {
            this.scheduleUpdate();
          }
        }),
      );
    }

    void vscode.commands.executeCommand('setContext', RUNNING_CONTEXT, true);
  }

  // ---------------------------------------------------------------- tab take-over / restore

  /** Close the original editor tab so the game occupies its place in the same group. */
  private async takeOverEditorTab(editor: vscode.TextEditor): Promise<void> {
    const tab = findTextTab(editor.document.uri, this.panel.viewColumn ?? this.memory?.viewColumn);
    if (!tab) {
      return;
    }
    if (tab.isDirty || editor.document.isDirty) {
      // Closing would prompt to save. Leave the tab untouched behind the game instead.
      void vscode.window.setStatusBarMessage(
        '$(info) Code Invaders: unsaved file kept open in the background — nothing was changed.',
        5000,
      );
      return;
    }
    try {
      this.editorTabClosed = await vscode.window.tabGroups.close(tab, true);
    } catch {
      this.editorTabClosed = false;
    }
    // Closing the tab can move focus; make sure the game has it.
    this.panel.reveal(this.panel.viewColumn, false);
  }

  /** Reopen the document in the game's group with the remembered selection and scroll position. */
  private async restoreEditor(column: vscode.ViewColumn | undefined): Promise<vscode.TextEditor | undefined> {
    const memory = this.memory;
    if (!memory) {
      return undefined;
    }
    try {
      const document = await vscode.workspace.openTextDocument(memory.uri);
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: column ?? memory.viewColumn,
        preview: false,
        preserveFocus: false,
      });
      editor.selections = memory.selections.map(
        (sel) => new vscode.Selection(document.validatePosition(sel.anchor), document.validatePosition(sel.active)),
      );
      if (memory.visibleRange) {
        editor.revealRange(document.validateRange(memory.visibleRange), vscode.TextEditorRevealType.AtTop);
      }
      return editor;
    } catch (err) {
      void vscode.window.showWarningMessage(
        `Code Invaders could not reopen ${basename(memory.uri)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  private rememberEditor(editor: vscode.TextEditor | undefined): void {
    if (this.memory && editor && editor.document.uri.toString() === this.memory.uri.toString()) {
      this.memory = {
        ...this.memory,
        selections: editor.selections,
        visibleRange: editor.visibleRanges[0],
      };
    }
  }

  /** Esc on the pause/game-over screen, or the Exit command. */
  async exitToEditor(): Promise<void> {
    if (this.disposed || this.restoring) {
      return;
    }
    this.restoring = true;
    if (this.mode === 'editing') {
      this.rememberEditor(vscode.window.activeTextEditor);
    }
    // Reopen (or refocus) the code *before* disposing the panel so the group never becomes empty.
    await this.restoreEditor(this.panel.viewColumn);
    this.dispose();
  }

  /** "Edit code, keep game": bring the code back into this tab; the game waits paused in the background. */
  private async enterEditMode(): Promise<void> {
    if (!this.memory || this.mode === 'editing') {
      return;
    }
    this.mode = 'editing';
    const editor = await this.restoreEditor(this.panel.viewColumn);
    if (editor) {
      this.editorTabClosed = false;
    }
    this.statusItem.show();
  }

  /** Called by the Start command while a session exists. */
  async returnToGame(): Promise<void> {
    if (this.mode === 'editing' && this.memory) {
      // Analyse pending edits now, while the document is still open and not yet frozen.
      this.flushUpdate();
      this.rememberEditor(vscode.window.activeTextEditor);
      const tab = findTextTab(this.memory.uri, this.panel.viewColumn);
      if (tab && !tab.isDirty) {
        try {
          this.editorTabClosed = await vscode.window.tabGroups.close(tab, true);
        } catch {
          /* keep it open */
        }
      }
    }
    this.mode = 'playing';
    this.statusItem.hide();
    this.panel.reveal(this.panel.viewColumn, false);
    this.post({ type: 'returned' });
  }

  private async onPanelDisposed(): Promise<void> {
    // The user closed the game tab directly (not via Esc): still give them their code back.
    if (!this.restoring && !this.disposed && this.memory && this.editorTabClosed) {
      this.restoring = true;
      await this.restoreEditor(this.memory.viewColumn);
    }
    this.dispose();
  }

  // ---------------------------------------------------------------- messages

  private async onMessage(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case 'ready': {
        this.ready = true;
        const snapshot = this.buildSnapshot();
        this.knownIds = new Set(snapshot.specs.map((s) => s.id));
        this.post({
          type: 'init',
          snapshot,
          settings: readSettings(),
          highScore: this.context.globalState.get<number>(HIGH_SCORE_KEY, 0),
          demo: !this.memory,
        });
        break;
      }
      case 'exit':
        await this.exitToEditor();
        break;
      case 'editCode':
        await this.enterEditMode();
        break;
      case 'updateSetting':
        await updateSetting(message.key, message.value);
        break;
      case 'gameOver': {
        const best = this.context.globalState.get<number>(HIGH_SCORE_KEY, 0);
        if (Number.isFinite(message.score) && message.score > best) {
          await this.context.globalState.update(HIGH_SCORE_KEY, Math.floor(message.score));
        }
        break;
      }
    }
  }

  private post(message: HostToWebview): void {
    if (!this.disposed && this.ready) {
      void this.panel.webview.postMessage(message);
    }
  }

  // ---------------------------------------------------------------- document → enemies

  private scheduleUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.flushUpdate(), DEBOUNCE_MS);
  }

  private flushUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (!this.ready || this.disposed || !this.memory) {
      return;
    }
    const snapshot = this.buildSnapshot();
    const cursor = this.currentCursorLine();
    const fresh = freshSpecs(this.knownIds, snapshot, cursor);
    this.knownIds = new Set(snapshot.specs.map((s) => s.id));
    this.post({ type: 'code', snapshot, fresh });
  }

  private currentCursorLine(): number {
    const active = vscode.window.activeTextEditor;
    if (active && this.memory && active.document.uri.toString() === this.memory.uri.toString()) {
      return active.selection.active.line;
    }
    return this.memory?.selections[0]?.active.line ?? 0;
  }

  /**
   * The document can only change while an editor shows it (our tab, a split, or edit mode).
   * When none does, keep the last analysis: language servers also clear diagnostics for closed files.
   */
  private isFrozen(): boolean {
    return !this.memory || !findTextTab(this.memory.uri, 'any');
  }

  private buildSnapshot(): CodeSnapshot {
    if (!this.memory || this.isFrozen()) {
      return this.lastSnapshot;
    }
    const target = this.memory.uri.toString();
    const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target);
    if (document) {
      this.lastSnapshot = this.analyze(document);
    }
    return this.lastSnapshot;
  }

  private analyze(document: vscode.TextDocument | undefined): CodeSnapshot {
    if (!document) {
      const lines = DEMO_SOURCE.split('\n');
      return analyzeCode({
        fileName: 'demo-wave.ts',
        languageId: 'typescript',
        lineCount: lines.length,
        getLine: (i) => lines[i],
        diagnostics: [
          { line: 1, severity: 0, message: "Cannot find module './galaxy'." },
          { line: 35, severity: 1, message: 'Unexpected magic number 1.5.' },
        ],
      });
    }
    const diagnostics: DiagnosticLike[] = vscode.languages
      .getDiagnostics(document.uri)
      .map((d) => ({ line: d.range.start.line, severity: d.severity, message: d.message }));
    return analyzeCode({
      fileName: basename(document.uri),
      languageId: document.languageId,
      lineCount: document.lineCount,
      getLine: (i) => document.lineAt(i).text,
      cursorLine: this.currentCursorLine(),
      diagnostics,
    });
  }

  // ---------------------------------------------------------------- cleanup

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    for (const d of this.disposables.splice(0)) {
      d.dispose();
    }
    this.panel.dispose(); // no-op if already disposed
    if (GameSession.current === this) {
      GameSession.current = undefined;
    }
    void vscode.commands.executeCommand('setContext', RUNNING_CONTEXT, false);
  }
}

function readSettings(): GameSettings {
  const cfg = vscode.workspace.getConfiguration('codeInvaders');
  const difficulty = cfg.get<string>('difficulty', 'normal');
  return {
    startingLives: clampInt(cfg.get<number>('startingLives', 3), 1, 9, 3),
    difficulty: difficulty === 'chill' || difficulty === 'hardcore' ? difficulty : 'normal',
    reducedEffects: cfg.get<boolean>('reducedEffects', false),
    moveSensitivity: clampInt(cfg.get<number>('moveSensitivity', 5), 1, 10, 5),
    theme: cfg.get<string>('theme', 'retro') === 'neon' ? 'neon' : 'retro',
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Persist a setting changed from inside the game (move speed / theme) to the user's global VS Code
 * settings. Only these two keys of this extension's own settings can be written, with validated values.
 */
async function updateSetting(key: InGameSetting['key'], value: unknown): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('codeInvaders');
  let valid: number | string;
  if (key === 'moveSensitivity') {
    valid = clampInt(value, 1, 10, 5);
  } else if (key === 'theme' && (value === 'retro' || value === 'neon')) {
    valid = value;
  } else {
    return;
  }
  if (cfg.get(key) === valid) {
    return;
  }
  try {
    await cfg.update(key, valid, vscode.ConfigurationTarget.Global);
  } catch {
    /* settings file not writable: the change still applies for this session */
  }
}

function findTextTab(uri: vscode.Uri, column: vscode.ViewColumn | 'any' | undefined): vscode.Tab | undefined {
  const target = uri.toString();
  const groups = vscode.window.tabGroups.all;
  const ordered =
    column === 'any' ? groups : column ? groups.filter((g) => g.viewColumn === column) : [vscode.window.tabGroups.activeTabGroup];
  for (const group of ordered) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target) {
        return tab;
      }
    }
  }
  return undefined;
}

function basename(uri: vscode.Uri): string {
  const path = uri.path;
  return path.slice(path.lastIndexOf('/') + 1) || uri.toString();
}
