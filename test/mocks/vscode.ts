/**
 * Minimal in-memory fake of the parts of the `vscode` API that Code Invaders uses.
 * Bundled in place of `vscode` for host-side tests (see esbuild.mjs --tests).
 * It records every call so tests can assert the extension never edits documents.
 */

type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
  private listeners = new Set<Listener<T>>();
  event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(e: T): void {
    for (const l of [...this.listeners]) {
      l(e);
    }
  }
  get size(): number {
    return this.listeners.size;
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
  ) {}
  static file(path: string): Uri {
    return new Uri('file', path);
  }
  static parse(value: string): Uri {
    const i = value.indexOf(':');
    return new Uri(value.slice(0, i), value.slice(i + 1));
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, [base.path, ...parts].join('/'));
  }
  toString(): string {
    return `${this.scheme}://${this.path}`;
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}
export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}
export class Selection extends Range {
  constructor(
    readonly anchor: Position,
    readonly active: Position,
  ) {
    super(anchor, active);
  }
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}
export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}
export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}
export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}
export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}
export class ThemeColor {
  constructor(readonly id: string) {}
}
export class TabInputText {
  constructor(readonly uri: Uri) {}
}

// ------------------------------------------------------------------ fake documents / editors / tabs

export class FakeDocument {
  isDirty = false;
  constructor(
    public uri: Uri,
    public lines: string[],
    public languageId = 'typescript',
  ) {}
  get lineCount(): number {
    return this.lines.length;
  }
  lineAt(i: number): { text: string } {
    if (i < 0 || i >= this.lines.length) {
      throw new Error('Illegal value for `line`');
    }
    return { text: this.lines[i] };
  }
  validatePosition(p: Position): Position {
    const line = Math.max(0, Math.min(p.line, this.lines.length - 1));
    return new Position(line, Math.min(p.character, this.lines[line]?.length ?? 0));
  }
  validateRange(r: Range): Range {
    return new Range(this.validatePosition(r.start), this.validatePosition(r.end));
  }
  getText(): string {
    return this.lines.join('\n');
  }
}

export class FakeEditor {
  selections: Selection[];
  revealed: Range[] = [];
  constructor(
    public document: FakeDocument,
    public viewColumn: ViewColumn,
  ) {
    this.selections = [new Selection(new Position(3, 2), new Position(3, 2))];
  }
  get selection(): Selection {
    return this.selections[0];
  }
  get visibleRanges(): Range[] {
    return [new Range(new Position(1, 0), new Position(30, 0))];
  }
  revealRange(r: Range): void {
    this.revealed.push(r);
  }
}

export interface FakeTab {
  label: string;
  input: unknown;
  isDirty: boolean;
  group: FakeGroup;
}
export interface FakeGroup {
  viewColumn: ViewColumn;
  tabs: FakeTab[];
}

export class FakeWebviewPanel {
  disposed = false;
  visible = true;
  iconPath: unknown;
  readonly posted: unknown[] = [];
  readonly onDisposeEmitter = new EventEmitter<void>();
  readonly onViewStateEmitter = new EventEmitter<{ webviewPanel: FakeWebviewPanel }>();
  readonly onMessageEmitter = new EventEmitter<unknown>();
  readonly webview = {
    html: '',
    cspSource: 'https://fake.vscode-cdn.net',
    asWebviewUri: (u: Uri) => u,
    postMessage: async (m: unknown) => {
      this.posted.push(m);
      return true;
    },
    onDidReceiveMessage: this.onMessageEmitter.event,
  };
  onDidDispose = this.onDisposeEmitter.event;
  onDidChangeViewState = this.onViewStateEmitter.event;
  revealCount = 0;
  constructor(
    readonly viewType: string,
    public title: string,
    public viewColumn: ViewColumn,
    readonly options: Record<string, unknown>,
  ) {}
  reveal(): void {
    this.revealCount++;
  }
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    state.groups.forEach((g) => (g.tabs = g.tabs.filter((t) => t.input !== this)));
    this.onDisposeEmitter.fire();
  }
}

// ------------------------------------------------------------------ recorded state

export const state = {
  activeTextEditor: undefined as FakeEditor | undefined,
  documents: [] as FakeDocument[],
  groups: [] as FakeGroup[],
  panels: [] as FakeWebviewPanel[],
  diagnostics: new Map<string, Array<{ range: Range; severity: number; message: string }>>(),
  calls: [] as string[],
  infoChoice: undefined as string | undefined,
  contexts: new Map<string, unknown>(),
  config: {} as Record<string, unknown>,
  globalState: new Map<string, unknown>(),
  docChange: new EventEmitter<{ document: FakeDocument; contentChanges: unknown[] }>(),
  diagChange: new EventEmitter<{ uris: Uri[] }>(),
  configChange: new EventEmitter<{ affectsConfiguration(s: string): boolean }>(),
};

export function resetMock(): void {
  state.activeTextEditor = undefined;
  state.documents = [];
  state.groups = [{ viewColumn: ViewColumn.One, tabs: [] }];
  state.panels = [];
  state.diagnostics.clear();
  state.calls = [];
  state.infoChoice = undefined;
  state.contexts.clear();
  state.config = {};
  state.globalState.clear();
  state.docChange = new EventEmitter();
  state.diagChange = new EventEmitter();
  state.configChange = new EventEmitter();
}
resetMock();

/** Open a document in a tab in the given column and make it the active editor. */
export function openEditor(path: string, lines: string[], column = ViewColumn.One): FakeEditor {
  const doc = new FakeDocument(Uri.file(path), lines);
  state.documents.push(doc);
  const editor = new FakeEditor(doc, column);
  let group = state.groups.find((g) => g.viewColumn === column);
  if (!group) {
    group = { viewColumn: column, tabs: [] };
    state.groups.push(group);
  }
  group.tabs.push({
    label: path,
    input: new TabInputText(doc.uri),
    get isDirty() {
      return doc.isDirty;
    },
    group,
  });
  state.activeTextEditor = editor;
  return editor;
}

// ------------------------------------------------------------------ API surface

export const window = {
  get activeTextEditor() {
    return state.activeTextEditor;
  },
  createWebviewPanel(viewType: string, title: string, show: { viewColumn: ViewColumn }, options: Record<string, unknown>) {
    state.calls.push(`createWebviewPanel:${show.viewColumn}`);
    const column = show.viewColumn === ViewColumn.Active ? ViewColumn.One : show.viewColumn;
    const panel = new FakeWebviewPanel(viewType, title, column, options);
    state.panels.push(panel);
    let group = state.groups.find((g) => g.viewColumn === column);
    if (!group) {
      group = { viewColumn: column, tabs: [] };
      state.groups.push(group);
    }
    group.tabs.push({ label: title, input: panel, isDirty: false, group });
    return panel;
  },
  createStatusBarItem() {
    return {
      text: '',
      tooltip: '',
      command: '',
      backgroundColor: undefined,
      visible: false,
      show() {
        this.visible = true;
      },
      hide() {
        this.visible = false;
      },
      dispose() {
        this.visible = false;
      },
    };
  },
  async showInformationMessage(message: string) {
    state.calls.push(`info:${message}`);
    return state.infoChoice;
  },
  async showWarningMessage(message: string) {
    state.calls.push(`warn:${message}`);
    return undefined;
  },
  setStatusBarMessage(message: string) {
    state.calls.push(`status:${message}`);
    return { dispose() {} };
  },
  async showTextDocument(doc: FakeDocument, options: { viewColumn: ViewColumn }) {
    state.calls.push(`showTextDocument:${doc.uri.path}:${options.viewColumn}`);
    let group = state.groups.find((g) => g.viewColumn === options.viewColumn);
    if (!group) {
      group = { viewColumn: options.viewColumn, tabs: [] };
      state.groups.push(group);
    }
    if (!group.tabs.some((t) => t.input instanceof TabInputText && t.input.uri.toString() === doc.uri.toString())) {
      group.tabs.push({
        label: doc.uri.path,
        input: new TabInputText(doc.uri),
        get isDirty() {
          return doc.isDirty;
        },
        group,
      });
    }
    const editor = new FakeEditor(doc, options.viewColumn);
    state.activeTextEditor = editor;
    return editor;
  },
  tabGroups: {
    get all() {
      return state.groups;
    },
    get activeTabGroup() {
      return state.groups[0];
    },
    async close(tab: FakeTab) {
      state.calls.push(`closeTab:${tab.label}`);
      if (tab.isDirty) {
        throw new Error('test: closing a dirty tab would prompt the user');
      }
      tab.group.tabs = tab.group.tabs.filter((t) => t !== tab);
      return true;
    },
  },
};

export const workspace = {
  onDidChangeTextDocument: (l: Listener<{ document: FakeDocument; contentChanges: unknown[] }>) =>
    state.docChange.event(l),
  onDidChangeConfiguration: (l: Listener<{ affectsConfiguration(s: string): boolean }>) => state.configChange.event(l),
  get textDocuments() {
    return state.documents;
  },
  async openTextDocument(uri: Uri) {
    state.calls.push(`openTextDocument:${uri.path}`);
    const doc = state.documents.find((d) => d.uri.toString() === uri.toString());
    if (!doc) {
      throw new Error('file not found');
    }
    return doc;
  },
  getConfiguration() {
    return {
      get: <T>(key: string, fallback?: T): T | undefined => (key in state.config ? (state.config[key] as T) : fallback),
      update: async (key: string, value: unknown, target: unknown) => {
        state.calls.push(`configUpdate:${key}=${String(value)}@${String(target)}`);
        state.config[key] = value;
      },
    };
  },
  // Write APIs exist only so tests can prove they are never called.
  async applyEdit() {
    state.calls.push('applyEdit');
    return true;
  },
  async saveAll() {
    state.calls.push('saveAll');
    return true;
  },
};

export const languages = {
  getDiagnostics(uri: Uri) {
    return state.diagnostics.get(uri.toString()) ?? [];
  },
  onDidChangeDiagnostics: (l: Listener<{ uris: Uri[] }>) => state.diagChange.event(l),
};

export const commands = {
  async executeCommand(id: string, ...args: unknown[]) {
    state.calls.push(`command:${id}`);
    if (id === 'setContext') {
      state.contexts.set(String(args[0]), args[1]);
    }
    return undefined;
  },
  registerCommand(id: string) {
    state.calls.push(`register:${id}`);
    return { dispose() {} };
  },
};

export function fakeContext() {
  return {
    extensionUri: Uri.file('/ext'),
    subscriptions: [] as Array<{ dispose(): unknown }>,
    globalState: {
      get: <T>(key: string, fallback: T): T => (state.globalState.has(key) ? (state.globalState.get(key) as T) : fallback),
      update: async (key: string, value: unknown) => {
        state.globalState.set(key, value);
      },
    },
  };
}
