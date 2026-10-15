import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import * as extension from '../src/extension';
import { GameSession } from '../src/gameSession';
import { fakeContext, openEditor, resetMock, state, ViewColumn, type FakeWebviewPanel } from './mocks/vscode';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const ctx = () => fakeContext() as unknown as vscode.ExtensionContext;

const SOURCE = ['// hello', 'export class Fleet {', '  launch(name: string) {', '    return name;', '  }', '}'];

function panel(): FakeWebviewPanel {
  assert.equal(state.panels.length, 1, 'exactly one panel');
  return state.panels[0];
}
function messagesOfType(p: FakeWebviewPanel, type: string): Array<Record<string, unknown>> {
  return (p.posted as Array<Record<string, unknown>>).filter((m) => m.type === type);
}
function tabsIn(column: ViewColumn) {
  return state.groups.find((g) => g.viewColumn === column)?.tabs ?? [];
}

describe('GameSession', () => {
  beforeEach(() => {
    GameSession.disposeCurrent();
    resetMock();
  });

  it('registers commands on activation', () => {
    const c = fakeContext();
    extension.activate(c as unknown as vscode.ExtensionContext);
    assert.ok(state.calls.includes('register:codeInvaders.start'));
    assert.ok(state.calls.includes('register:codeInvaders.exit'));
    assert.equal(c.subscriptions.length, 3);
  });

  it('takes over the active tab: panel in the same column, original tab closed', async () => {
    openEditor('/w/a.ts', SOURCE, ViewColumn.Two);
    await GameSession.start(ctx());
    const p = panel();
    assert.equal(p.viewColumn, ViewColumn.Two);
    const tabs = tabsIn(ViewColumn.Two);
    assert.equal(tabs.length, 1, 'only the game tab remains in that group');
    assert.equal(tabs[0].input, p);
    assert.equal(state.contexts.get('codeInvaders.running'), true);
  });

  it('uses a restrictive webview configuration and CSP', async () => {
    openEditor('/w/a.ts', SOURCE);
    await GameSession.start(ctx());
    const p = panel();
    assert.equal(p.options.enableScripts, true);
    assert.equal(p.options.enableCommandUris, false);
    assert.equal(p.options.enableForms, false);
    const roots = (p.options.localResourceRoots as vscode.Uri[]).map((u) => u.path);
    assert.deepEqual(roots, ['/ext/media', '/ext/dist']);
    const html = p.webview.html;
    assert.match(html, /default-src 'none'/);
    assert.match(html, /script-src 'nonce-[A-Za-z0-9]{32}'/);
    assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
    const nonce = /nonce-([A-Za-z0-9]+)/.exec(html)![1];
    assert.match(html, new RegExp(`<script nonce="${nonce}" src=`));
  });

  it('sends the analysed document on ready', async () => {
    openEditor('/w/a.ts', SOURCE);
    state.diagnostics.set('file:///w/a.ts', [
      { range: new vscode.Range(new vscode.Position(3, 0), new vscode.Position(3, 4)), severity: 0, message: 'oops' },
    ]);
    await GameSession.start(ctx());
    const p = panel();
    p.onMessageEmitter.fire({ type: 'ready' });
    await tick();
    const [init] = messagesOfType(p, 'init');
    assert.ok(init);
    const snapshot = init.snapshot as { fileName: string; errors: number; specs: Array<{ kind: string }> };
    assert.equal(snapshot.fileName, 'a.ts');
    assert.equal(snapshot.errors, 1);
    assert.ok(snapshot.specs.some((s) => s.kind === 'class'));
    assert.equal(init.demo, false);
  });

  it('exit restores the editor in the same column with its selection, then disposes', async () => {
    const editor = openEditor('/w/a.ts', SOURCE);
    await GameSession.start(ctx());
    const p = panel();
    p.onMessageEmitter.fire({ type: 'ready' });
    p.onMessageEmitter.fire({ type: 'exit' });
    await tick(5);
    assert.ok(p.disposed);
    const restored = state.activeTextEditor!;
    assert.equal(restored.document, editor.document);
    assert.equal(restored.viewColumn, ViewColumn.One);
    assert.equal(restored.selections[0].active.line, 3);
    assert.equal(restored.revealed.length, 1);
    const tabs = tabsIn(ViewColumn.One);
    assert.equal(tabs.length, 1);
    assert.ok(tabs[0].input instanceof vscode.TabInputText);
    // Editor reopened *before* the panel was disposed: the group never became empty.
    const showIdx = state.calls.findIndex((c) => c.startsWith('showTextDocument'));
    assert.ok(showIdx > 0);
    assert.equal(state.contexts.get('codeInvaders.running'), false);
  });

  it('closing the game tab directly still brings the code back', async () => {
    openEditor('/w/a.ts', SOURCE);
    await GameSession.start(ctx());
    panel().dispose();
    await tick(5);
    assert.ok(state.calls.some((c) => c.startsWith('showTextDocument:/w/a.ts')));
  });

  it('never closes an unsaved tab (that would prompt) and never edits or saves', async () => {
    const editor = openEditor('/w/dirty.ts', SOURCE);
    editor.document.isDirty = true;
    await GameSession.start(ctx());
    assert.ok(!state.calls.some((c) => c.startsWith('closeTab')));
    assert.ok(state.calls.some((c) => c.startsWith('status:')));
    panel().onMessageEmitter.fire({ type: 'exit' });
    await tick(5);
    assert.ok(!state.calls.includes('applyEdit'));
    assert.ok(!state.calls.includes('saveAll'));
    assert.deepEqual(editor.document.lines, SOURCE);
  });

  it('debounces typing into a single update with the freshly typed enemies', async () => {
    const editor = openEditor('/w/a.ts', SOURCE);
    editor.document.isDirty = true; // tab stays open, so live edits are possible
    await GameSession.start(ctx());
    const p = panel();
    p.onMessageEmitter.fire({ type: 'ready' });
    await tick();
    for (const text of ['    i', '    if', '    if (x) {']) {
      editor.document.lines = [...SOURCE.slice(0, 3), text, ...SOURCE.slice(3)];
      state.docChange.fire({ document: editor.document, contentChanges: [{}] });
      await tick(50);
    }
    assert.equal(messagesOfType(p, 'code').length, 0, 'still debouncing');
    await tick(450);
    const updates = messagesOfType(p, 'code');
    assert.equal(updates.length, 1);
    const fresh = updates[0].fresh as Array<{ kind: string; label: string; archetype?: string }>;
    assert.deepEqual(
      fresh.map((f) => [f.archetype, f.label]),
      [['if', 'if x']],
    );
  });

  it('streams edits made in a split of the same file while the game runs', async () => {
    const editor = openEditor('/w/a.ts', SOURCE, ViewColumn.One);
    // Same document also shown in a second group.
    const split = { viewColumn: ViewColumn.Two, tabs: [] as typeof state.groups[number]['tabs'] };
    split.tabs.push({ label: 'a.ts', input: new vscode.TabInputText(editor.document.uri as never), isDirty: false, group: split });
    state.groups.push(split);
    await GameSession.start(ctx());
    const p = panel();
    p.onMessageEmitter.fire({ type: 'ready' });
    await tick();
    editor.document.lines = [...SOURCE, 'while (alive) {'];
    state.docChange.fire({ document: editor.document, contentChanges: [{}] });
    await tick(450);
    const update = messagesOfType(p, 'code').at(-1);
    assert.ok(update, 'update sent');
    assert.ok((update.fresh as Array<{ label: string; archetype?: string }>).some((f) => f.archetype === 'while' && f.label === 'while alive'));
  });

  it('keeps the last analysis when the file is no longer open anywhere (diagnostics cleared on close)', async () => {
    openEditor('/w/a.ts', SOURCE);
    state.diagnostics.set('file:///w/a.ts', [
      { range: new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 1)), severity: 0, message: 'x' },
    ]);
    await GameSession.start(ctx());
    const p = panel();
    p.onMessageEmitter.fire({ type: 'ready' });
    state.diagnostics.clear();
    state.diagChange.fire({ uris: [vscode.Uri.file('/w/a.ts')] });
    await tick(450);
    assert.equal(messagesOfType(p, 'code').length, 0);
  });

  it('edit mode round-trip: code comes back in the same tab, then the game takes it over again', async () => {
    const editor = openEditor('/w/a.ts', SOURCE);
    await GameSession.start(ctx());
    const p = panel();
    p.onMessageEmitter.fire({ type: 'ready' });
    p.onMessageEmitter.fire({ type: 'editCode' });
    await tick(5);
    assert.equal(state.activeTextEditor?.document, editor.document);
    assert.equal(p.disposed, false, 'game kept alive in the background');

    // Typing in edit mode streams to the game.
    editor.document.lines = [...SOURCE, 'function brandNew() {'];
    state.docChange.fire({ document: editor.document, contentChanges: [{}] });
    await GameSession.start(ctx()); // Start again == "Back to Code Invaders"
    await tick(5);
    const update = messagesOfType(p, 'code').at(-1)!;
    assert.ok((update.fresh as Array<{ label: string }>).some((f) => f.label === 'brandNew()'));
    assert.equal(messagesOfType(p, 'returned').length, 1);
    assert.equal(tabsIn(ViewColumn.One).length, 1, 'code tab closed again');
    assert.equal(state.panels.length, 1, 'no second panel');
  });

  it('shows a helpful message when no text editor is active, and can run a demo', async () => {
    await GameSession.start(ctx());
    assert.ok(state.calls.some((c) => c.startsWith('info:') && c.includes('no text editor is active')));
    assert.equal(state.panels.length, 0);

    state.infoChoice = 'Play Demo Wave';
    await GameSession.start(ctx());
    const p = panel();
    p.onMessageEmitter.fire({ type: 'ready' });
    await tick();
    const [init] = messagesOfType(p, 'init');
    assert.equal(init.demo, true);
  });

  it('persists in-game setting changes (validated) to global settings', async () => {
    openEditor('/w/a.ts', SOURCE);
    await GameSession.start(ctx());
    const p = panel();
    p.onMessageEmitter.fire({ type: 'ready' });
    await tick();
    const [init] = messagesOfType(p, 'init');
    assert.deepEqual(
      [(init.settings as { theme: string }).theme, (init.settings as { moveSensitivity: number }).moveSensitivity],
      ['retro', 5],
    );
    p.onMessageEmitter.fire({ type: 'updateSetting', key: 'moveSensitivity', value: 42 });
    p.onMessageEmitter.fire({ type: 'updateSetting', key: 'theme', value: 'neon' });
    p.onMessageEmitter.fire({ type: 'updateSetting', key: 'theme', value: 'evil' });
    p.onMessageEmitter.fire({ type: 'updateSetting', key: 'startingLives', value: 99 });
    await tick(5);
    const updates = state.calls.filter((c) => c.startsWith('configUpdate:'));
    assert.deepEqual(updates, ['configUpdate:moveSensitivity=10@1', 'configUpdate:theme=neon@1']);
  });

  it('stores the high score and cleans up every listener on dispose', async () => {
    openEditor('/w/a.ts', SOURCE);
    await GameSession.start(ctx());
    const p = panel();
    p.onMessageEmitter.fire({ type: 'ready' });
    p.onMessageEmitter.fire({ type: 'gameOver', score: 4321, level: 3 });
    await tick();
    assert.equal(state.globalState.get('codeInvaders.highScore'), 4321);
    p.onMessageEmitter.fire({ type: 'gameOver', score: 10, level: 1 });
    await tick();
    assert.equal(state.globalState.get('codeInvaders.highScore'), 4321);

    assert.ok(state.docChange.size > 0);
    extension.deactivate();
    assert.equal(state.docChange.size, 0);
    assert.equal(state.diagChange.size, 0);
    assert.equal(state.configChange.size, 0);
    assert.equal(p.onMessageEmitter.size, 0);
  });
});
