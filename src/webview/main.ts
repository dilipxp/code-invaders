import { ARCHETYPES, type CodeSnapshot, type EnemyKind, type GameSettings, type HostToWebview, type InGameSetting, type Theme, type WebviewToHost } from '../shared/protocol';
import { Audio } from './audio';
import { ENEMY_DEFS } from './enemies/definitions';
import { CODE_POWERS, Game, KIND_COLORS } from './game';
import { drawPixelText, pixelTextWidth } from './pixelFont';
import { NeonRenderer, type GameRenderer } from './render';
import { RETRO_COLORS, RetroRenderer } from './renderRetro';

interface VsCodeApi {
  postMessage(message: WebviewToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface PersistedState {
  muted?: boolean;
}

const vscode = acquireVsCodeApi();
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`#${id} missing`);
  }
  return el as T;
};

const stage = $('stage');
const canvas = $<HTMLCanvasElement>('game');
const hud = {
  root: $('hud'),
  score: $('hud-score'),
  hi: $('hud-hi'),
  level: $('hud-level'),
  lives: $('hud-lives'),
  enemies: $('hud-enemies'),
  file: $('hud-file'),
  powerups: $('hud-powerups'),
  hint: $('hud-hint'),
};
const screens = { title: $('screen-title'), pause: $('screen-pause'), over: $('screen-over'), victory: $('screen-victory') };
const toastEl = $('toast');

const audio = new Audio();
const persisted = (vscode.getState() as PersistedState | undefined) ?? {};
audio.muted = !!persisted.muted;

let demo = false;
let visible = true;
let rafId = 0;
let lastFrame = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let settingTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSetting: InGameSetting | undefined;
let marchTimer = 0;
let marchBeat = 0;

const game = new Game({
  sfx: (name) => audio.play(name),
  toast: (text, tone) => showToast(text, tone),
  gameOver: (score, level) => {
    vscode.postMessage({ type: 'gameOver', score, level });
    showGameOver();
  },
  victory: (score, signature) => {
    // Same message as game over so the host stores the high score.
    vscode.postMessage({ type: 'gameOver', score, level: game.level });
    showVictory(signature);
  },
});

const renderers: Partial<Record<Theme, GameRenderer>> = {};
let renderer: GameRenderer = getRenderer(game.settings.theme);

function getRenderer(theme: Theme): GameRenderer {
  return (renderers[theme] ??= theme === 'retro' ? new RetroRenderer(canvas) : new NeonRenderer(canvas));
}

// ------------------------------------------------------------------ layout

function resize(): void {
  const rect = stage.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return; // hidden
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  game.resize(rect.width, rect.height);
  renderer.resize(rect.width, rect.height, dpr, game.u);
  game.remeasure();
  renderer.render(game);
  drawLogo();
}
const resizeObserver = new ResizeObserver(() => resize());
resizeObserver.observe(stage);

// ------------------------------------------------------------------ loop

function frame(now: number): void {
  rafId = 0;
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  game.update(dt);
  march(dt);
  renderer.render(game);
  updateHud();
  if (shouldAnimate()) {
    rafId = requestAnimationFrame(frame);
  }
}

/** Retro theme: the classic four-note bass that speeds up as the wave closes in. */
function march(dt: number): void {
  if (game.settings.theme !== 'retro' || game.state !== 'playing' || game.levelIntro > 0 || game.power.freeze > 0) {
    return;
  }
  if (game.enemies.length === 0) {
    return;
  }
  marchTimer -= game.power.slow > 0 ? dt * 0.35 : dt;
  if (marchTimer <= 0) {
    audio.step(marchBeat++);
    const lowest = Math.max(...game.enemies.map((e) => e.y)) / game.H;
    marchTimer = Math.max(0.22, 0.85 - game.level * 0.04 - lowest * 0.45);
  }
}

function shouldAnimate(): boolean {
  return visible && game.state !== 'paused';
}

function startLoop(): void {
  if (!rafId && shouldAnimate()) {
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }
}

function stopLoop(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

// ------------------------------------------------------------------ settings (theme / move speed)

function applySettings(settings: GameSettings): void {
  const themeChanged = settings.theme !== game.settings.theme;
  game.settings = settings;
  document.body.classList.toggle('reduced', settings.reducedEffects);
  document.body.classList.toggle('retro', settings.theme === 'retro');
  document.body.classList.toggle('neon', settings.theme === 'neon');
  if (themeChanged || game.measureEnemy !== renderer.measure) {
    renderer = getRenderer(settings.theme);
    game.measureEnemy = renderer.measure;
    resize();
  }
  renderSettingsRows();
  renderLegend();
  updateHud();
  if (game.state === 'paused') {
    renderer.render(game);
  }
}

/** Change a setting locally right away, and persist it to VS Code settings (debounced). */
function changeSetting(change: InGameSetting): void {
  const next: GameSettings = { ...game.settings, [change.key]: change.value };
  applySettings(next);
  if (settingTimer) {
    clearTimeout(settingTimer);
  }
  pendingSetting = change;
  settingTimer = setTimeout(flushSetting, 400);
}

function flushSetting(): void {
  settingTimer = undefined;
  if (pendingSetting) {
    vscode.postMessage({ type: 'updateSetting', ...pendingSetting });
    pendingSetting = undefined;
  }
}

function nudgeSpeed(delta: number): void {
  const value = Math.max(1, Math.min(10, game.settings.moveSensitivity + delta));
  if (value !== game.settings.moveSensitivity) {
    changeSetting({ key: 'moveSensitivity', value });
  }
  showToast(`Move speed ${value}/10${value === 1 ? ' (slowest)' : value === 10 ? ' (fastest)' : ''}`);
}

function toggleTheme(): void {
  const value: Theme = game.settings.theme === 'retro' ? 'neon' : 'retro';
  changeSetting({ key: 'theme', value });
  showToast(value === 'retro' ? 'Retro arcade theme' : 'Neon theme');
}

function renderSettingsRows(): void {
  const s = game.settings;
  for (const row of document.querySelectorAll<HTMLElement>('[data-settings]')) {
    const speed = document.createElement('span');
    speed.className = 'setting';
    const down = button('−', 'speed-down', 'Slower (or press [)');
    const value = document.createElement('b');
    value.className = 'setting-value';
    value.textContent = `${s.moveSensitivity}/10`;
    const up = button('+', 'speed-up', 'Faster (or press ])');
    speed.append('Move speed ', down, value, up, kbd('['), kbd(']'));

    const theme = document.createElement('span');
    theme.className = 'setting';
    theme.append('Theme ', button(s.theme === 'retro' ? 'Retro' : 'Neon', 'theme', 'Switch theme (or press T)'), kbd('T'));
    row.replaceChildren(speed, theme);
  }
}

function button(text: string, action: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.dataset.action = action;
  b.title = title;
  b.className = 'mini';
  b.tabIndex = -1;
  return b;
}

function kbd(text: string): HTMLElement {
  const k = document.createElement('kbd');
  k.textContent = text;
  return k;
}

// ------------------------------------------------------------------ HUD & screens

const hudCache: Record<string, string> = {};
function setText(el: HTMLElement, key: string, value: string): void {
  if (hudCache[key] !== value) {
    hudCache[key] = value;
    el.textContent = value;
  }
}

function updateHud(): void {
  if (game.settings.theme === 'retro') {
    return; // the retro renderer draws its own arcade HUD on the canvas
  }
  setText(hud.score, 'score', game.score.toLocaleString('en-US'));
  setText(hud.hi, 'hi', Math.max(game.hiScore, game.score).toLocaleString('en-US'));
  setText(hud.level, 'level', String(game.level));
  setText(hud.lives, 'lives', game.lives > 0 ? '▲ '.repeat(Math.min(game.lives, 9)).trim() : '—');
  const boss = game.levels.boss;
  setText(
    hud.enemies,
    'enemies',
    boss ? `boss: ${boss.def.title.toLowerCase()}` : `${game.enemies.length} on screen · ${Math.max(0, game.enemiesLeft)} left`,
  );
  const p = game.power;
  const powers: string[] = [];
  if (p.loop > 0) powers.push(`<span class="pw loop">for-loop shield ${Math.ceil(p.loop)}s</span>`);
  if (p.freeze > 0) powers.push(`<span class="pw freeze">break: frozen ${Math.ceil(p.freeze)}s</span>`);
  if (p.slow > 0) powers.push(`<span class="pw slow">await: slow-mo ${Math.ceil(p.slow)}s</span>`);
  if (p.triple > 0) powers.push(`<span class="pw triple">... spread ${Math.ceil(p.triple)}s</span>`);
  if (p.rapid > 0) powers.push(`<span class="pw rapid">» rapid ${Math.ceil(p.rapid)}s</span>`);
  if (p.shield) powers.push('<span class="pw shield">{} try/catch</span>');
  if (game.combo >= 4 && game.comboTimer > 0) powers.push(`<span class="pw combo">${game.combo}× combo</span>`);
  const html = powers.join('');
  if (hudCache.powers !== html) {
    hudCache.powers = html; // static markup built from numbers only — no user text
    hud.powerups.innerHTML = html;
  }
}

function show(screen: keyof typeof screens | undefined): void {
  for (const [name, el] of Object.entries(screens)) {
    el.classList.toggle('hidden', name !== screen);
  }
  const inGame = game.state === 'playing' || game.state === 'paused';
  hud.root.classList.toggle('hidden', !inGame && game.state !== 'over' && game.state !== 'victory');
  hud.hint.classList.toggle('hidden', game.state !== 'playing');
  canvas.focus();
}

function showToast(text: string, tone: 'info' | 'good' | 'bad' = 'info'): void {
  toastEl.textContent = text;
  toastEl.className = `toast ${tone}`;
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2400);
}

function describeSnapshot(s: CodeSnapshot): string {
  if (s.empty) {
    return `${s.fileName} is empty — so the void itself attacks. Type some code to summon real enemies.`;
  }
  const parts = [`${s.fileName} · ${s.lineCount.toLocaleString('en-US')} lines → ${s.specs.length} enemies`];
  if (s.errors) {
    parts.push(`${s.errors} bug${s.errors === 1 ? '' : 's'}`);
  }
  if (s.warnings) {
    parts.push(`${s.warnings} warning${s.warnings === 1 ? '' : 's'}`);
  }
  let text = parts.join(' · ');
  if (s.truncated) {
    text += ' (large file: only the code around your cursor is used)';
  }
  if (s.parser === 'syntax') {
    text += ' · syntax-aware parser';
  } else if (s.parser === 'fallback') {
    text += ' · pattern-based fallback for this language';
  }
  return text;
}

/** "Your code fields:" — the construct enemies found in this file, strongest first. */
function renderRoster(s: CodeSnapshot | undefined): void {
  const colors = game.settings.theme === 'retro';
  const counts = s?.constructs ?? {};
  const found = ARCHETYPES.filter((a) => (counts[a] ?? 0) > 0).sort((a, b) => ENEMY_DEFS[b].tier - ENEMY_DEFS[a].tier);
  const items = found.slice(0, 12).map((a) => {
    const def = ENEMY_DEFS[a];
    const item = document.createElement('span');
    item.className = 'roster-item';
    item.title = `${def.role}: ${def.ability}`;
    const g = document.createElement('b');
    g.textContent = def.title.replace(/ Bot$/, '');
    g.style.color = colors ? def.retroColor : def.color;
    item.append(g, document.createTextNode(` ×${counts[a]} ${def.role.toLowerCase()}`));
    return item;
  });
  if (items.length === 0) {
    $('roster').replaceChildren();
    return;
  }
  const title = document.createElement('div');
  title.className = 'roster-title';
  title.textContent = 'Your code fields — and a boss at the end of every level';
  $('roster').replaceChildren(title, ...items);
}

const LEGEND: Array<[EnemyKind, string, string]> = [
  ['line', 'abc', 'statements'],
  ['function', 'ƒ', 'functions'],
  ['class', '◆', 'classes · shoot'],
  ['keyword', 'if', 'keywords · hunt'],
  ['equals', '==', 'comparisons'],
  ['bracket', '{}', 'brackets · zig-zag'],
  ['comment', '//', 'comments'],
  ['string', '"…"', 'strings'],
  ['bug', 'BUG', 'errors · aim at you'],
];

function renderLegend(): void {
  const colors = game.settings.theme === 'retro' ? RETRO_COLORS : KIND_COLORS;
  $('legend').replaceChildren(
    ...LEGEND.map(([kind, glyph, text]) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const g = document.createElement('b');
      g.textContent = glyph;
      g.style.color = colors[kind];
      item.append(g, document.createTextNode(` ${text}`));
      return item;
    }),
  );

  const title = document.createElement('div');
  title.className = 'powers-title';
  title.textContent = 'Code powers — destroy these for their effect';
  const grid = document.createElement('div');
  grid.className = 'powers-grid';
  for (const { keywords, effect } of Object.values(CODE_POWERS)) {
    const k = document.createElement('b');
    k.textContent = keywords;
    const v = document.createElement('span');
    v.textContent = effect;
    grid.append(k, v);
  }
  $('powers').replaceChildren(title, grid);
  renderRoster(game.snapshot);
}

/** Retro title: the logo drawn with the bitmap font. */
function drawLogo(): void {
  const logo = $<HTMLCanvasElement>('logo-pixel');
  const scale = window.innerWidth < 560 ? 4 : 7;
  const w = pixelTextWidth('INVADERS', scale) + scale;
  const h = scale * 5 * 2 + scale * 3 + scale;
  logo.width = w;
  logo.height = h;
  logo.style.width = `${w}px`;
  logo.style.height = `${h}px`;
  const ctx = logo.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, w, h);
  const cx = (w - scale) / 2;
  // Thin drop shadow, then the letters.
  const d = Math.max(2, Math.round(scale / 3));
  drawPixelText(ctx, 'CODE', cx + d, d, scale, '#aa00aa', 'center');
  drawPixelText(ctx, 'INVADERS', cx + d, scale * 8 + d, scale, '#aa00aa', 'center');
  drawPixelText(ctx, 'CODE', cx, 0, scale, '#33ff33', 'center');
  drawPixelText(ctx, 'INVADERS', cx, scale * 8, scale, '#ffffff', 'center');
}

function showVictory(signature: string): void {
  $('victory-signature').textContent = signature;
  $('victory-score').textContent = game.score.toLocaleString('en-US');
  const best = Math.max(game.hiScore, game.score);
  $('victory-best').textContent = game.score >= best && game.score > 0 ? '★ New high score!' : `Best: ${best.toLocaleString('en-US')}`;
  const s = game.stats;
  const accuracy = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
  const rows: Array<[string, string]> = [
    ['Bosses defeated', String(s.bossesDefeated)],
    ['Enemies destroyed', String(s.kills)],
    ['Bugs squashed', String(s.bugsSquashed)],
    ['Shipped to prod', String(s.escaped)],
    ['Accuracy', `${accuracy}%`],
    ['Lives left', String(game.lives)],
  ];
  $('victory-details').replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  show('victory');
  startLoop();
}

function showGameOver(): void {
  stopLoop();
  $('over-score').textContent = game.score.toLocaleString('en-US');
  const best = Math.max(game.hiScore, game.score);
  $('over-best').textContent = game.score >= best && game.score > 0 ? '★ New high score!' : `Best: ${best.toLocaleString('en-US')}`;
  const s = game.stats;
  const accuracy = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
  const rows: Array<[string, string]> = [
    ['Level reached', String(game.level)],
    ['Enemies destroyed', String(s.kills)],
    ['Bugs squashed', String(s.bugsSquashed)],
    ['Code powers used', String(s.powersTriggered)],
    ['Shipped to prod', String(s.escaped)],
    ['Accuracy', `${accuracy}%`],
  ];
  if (s.bossesDefeated > 0) {
    rows.splice(1, 0, ['Bosses defeated', String(s.bossesDefeated)]);
  }
  if (s.toughest) {
    rows.push(['Toughest kill', `${s.toughest.label} (line ${s.toughest.line + 1})`]);
  }
  $('over-details').replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  show('over');
  // Keep ambient animation (particles settling) running on the game-over screen.
  startLoop();
}

// ------------------------------------------------------------------ actions

function startGame(): void {
  audio.unlock();
  game.start();
  marchTimer = 0;
  show(undefined);
  startLoop();
}

function pause(): void {
  if (game.state !== 'playing') {
    return;
  }
  game.state = 'paused';
  game.input.left = game.input.right = game.input.fire = false;
  stopLoop();
  renderer.render(game);
  updatePauseNote();
  show('pause');
}

function resume(): void {
  if (game.state !== 'paused') {
    return;
  }
  audio.unlock();
  game.state = 'playing';
  show(undefined);
  startLoop();
}

function updatePauseNote(): void {
  const n = game.pendingFresh;
  $('pause-note').textContent =
    n > 0 ? `${n} new ${n === 1 ? 'enemy' : 'enemies'} from your edits will attack when you resume.` : '';
}

function exitToEditor(): void {
  stopLoop();
  audio.suspend();
  vscode.postMessage({ type: 'exit' });
}

function editCode(): void {
  if (demo) {
    return;
  }
  vscode.postMessage({ type: 'editCode' });
}

function toggleMute(): void {
  audio.muted = !audio.muted;
  vscode.setState({ ...persisted, muted: audio.muted } satisfies PersistedState);
  showToast(audio.muted ? 'Sound off' : 'Sound on');
}

// ------------------------------------------------------------------ input

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const FIRE = new Set(['Space', 'KeyW', 'ArrowUp']);

function onKeyDown(e: KeyboardEvent): void {
  // Leave every modifier chord to VS Code (Ctrl+P, Cmd+Shift+P, Ctrl+Tab, …).
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  }
  const code = e.code;
  let handled = true;

  if (code === 'KeyM') {
    if (!e.repeat) {
      toggleMute();
    }
  } else if (code === 'BracketLeft' || code === 'Minus' || code === 'NumpadSubtract') {
    nudgeSpeed(-1);
  } else if (code === 'BracketRight' || code === 'Equal' || code === 'NumpadAdd') {
    nudgeSpeed(1);
  } else if (code === 'KeyT') {
    if (!e.repeat) {
      toggleTheme();
    }
  } else if (game.state === 'playing') {
    if (LEFT.has(code)) {
      game.input.left = true;
    } else if (RIGHT.has(code)) {
      game.input.right = true;
    } else if (FIRE.has(code)) {
      game.input.fire = true;
    } else if (code === 'Escape' || code === 'KeyP') {
      pause();
    } else {
      handled = false;
    }
  } else if (e.repeat) {
    // Ignore auto-repeat on menus so holding Space doesn't skip screens.
  } else if (game.state === 'title') {
    if (code === 'Space' || code === 'Enter') {
      startGame();
    } else if (code === 'Escape') {
      exitToEditor();
    } else {
      handled = false;
    }
  } else if (game.state === 'paused') {
    if (code === 'Space' || code === 'Enter' || code === 'KeyP') {
      resume();
    } else if (code === 'Escape' || code === 'KeyQ') {
      exitToEditor();
    } else if (code === 'KeyE') {
      editCode();
    } else if (code === 'KeyR') {
      startGame();
    } else {
      handled = false;
    }
  } else if (game.state === 'over' || game.state === 'victory') {
    if (code === 'Enter' || code === 'KeyR' || code === 'Space') {
      startGame();
    } else if (code === 'Escape' || code === 'KeyQ') {
      exitToEditor();
    } else {
      handled = false;
    }
  }

  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (LEFT.has(e.code)) {
    game.input.left = false;
  } else if (RIGHT.has(e.code)) {
    game.input.right = false;
  } else if (FIRE.has(e.code)) {
    game.input.fire = false;
  } else {
    return;
  }
  e.preventDefault();
}

function onBlur(): void {
  game.input.left = game.input.right = game.input.fire = false;
  pause();
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', onBlur);
canvas.addEventListener('mousedown', () => canvas.focus());

const buttons: Array<[string, () => void]> = [
  ['btn-start', startGame],
  ['btn-title-exit', exitToEditor],
  ['btn-resume', resume],
  ['btn-edit', editCode],
  ['btn-restart', startGame],
  ['btn-pause-exit', exitToEditor],
  ['btn-again', startGame],
  ['btn-over-exit', exitToEditor],
  ['btn-replay', startGame],
  ['btn-victory-exit', exitToEditor],
];
for (const [id, action] of buttons) {
  const btn = $<HTMLButtonElement>(id);
  btn.tabIndex = -1; // keyboard focus stays on the canvas so Space never "clicks" a button
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => action());
}
// Settings rows are rebuilt on every change, so use one delegated listener.
document.addEventListener('mousedown', (e) => {
  if ((e.target as HTMLElement).closest('button.mini')) {
    e.preventDefault();
  }
});
document.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('button.mini')?.dataset.action;
  if (action === 'speed-down') {
    nudgeSpeed(-1);
  } else if (action === 'speed-up') {
    nudgeSpeed(1);
  } else if (action === 'theme') {
    toggleTheme();
  }
});

// ------------------------------------------------------------------ host messages

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      demo = msg.demo;
      game.hiScore = msg.highScore;
      game.setSnapshot(msg.snapshot);
      applySettings(msg.settings);
      $('btn-edit').classList.toggle('hidden', demo);
      $('title-stats').textContent = describeSnapshot(msg.snapshot);
      hud.file.textContent = msg.snapshot.fileName;
      show('title');
      resize();
      startLoop();
      break;
    case 'code':
      game.setSnapshot(msg.snapshot);
      game.queueFresh(msg.fresh);
      $('title-stats').textContent = describeSnapshot(msg.snapshot);
      renderRoster(msg.snapshot);
      if (game.state === 'paused') {
        updatePauseNote();
      }
      break;
    case 'settings':
      applySettings(msg.settings);
      break;
    case 'visibility':
      visible = msg.visible;
      if (!visible) {
        pause();
        stopLoop();
        audio.suspend();
      } else {
        resize();
        startLoop();
        canvas.focus();
      }
      break;
    case 'returned':
      visible = true;
      updatePauseNote();
      if (game.state === 'paused') {
        show('pause');
      }
      resize();
      startLoop();
      canvas.focus();
      break;
  }
});

window.addEventListener('pagehide', () => {
  stopLoop();
  resizeObserver.disconnect();
  audio.dispose();
  if (settingTimer) {
    clearTimeout(settingTimer);
    flushSetting();
  }
});

applySettings(game.settings);
resize();
canvas.focus();
vscode.postMessage({ type: 'ready' });
