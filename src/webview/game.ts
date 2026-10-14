import type { CodeSnapshot, EnemyKind, EnemySpec, GameSettings } from '../shared/protocol';

export type GameState = 'title' | 'playing' | 'paused' | 'over';
export type PowerKind = 'triple' | 'rapid' | 'shield' | 'life';
export type Sfx =
  | 'shoot'
  | 'hit'
  | 'explode'
  | 'bigExplode'
  | 'playerHit'
  | 'power'
  | 'level'
  | 'escape'
  | 'shield'
  | 'zap'
  | 'freeze';

/** What an enemy does when destroyed — based on what its code *means*. */
export type CodePower = 'branch' | 'loop' | 'equals' | 'throw' | 'break' | 'return' | 'await' | 'try' | 'import';

export const CODE_POWERS: Record<CodePower, { keywords: string; effect: string }> = {
  branch: { keywords: 'if / else / switch / case', effect: 'drops a power-up' },
  loop: { keywords: 'for / while / do', effect: 'loop shield: 6 s of protection' },
  equals: { keywords: '== / ===', effect: 'destroys the nearest enemy on both sides' },
  throw: { keywords: 'throw / raise', effect: 'exception blast hits everything nearby' },
  break: { keywords: 'break', effect: 'freezes all enemies for 3 s' },
  return: { keywords: 'return / yield', effect: 'returns enemy shots to sender' },
  await: { keywords: 'await', effect: 'slows time for 4 s' },
  try: { keywords: 'try / catch', effect: 'one-hit shield' },
  import: { keywords: 'import / require', effect: 'imports a spread shot for 8 s' },
};

const KEYWORD_POWERS: Record<string, CodePower> = {
  if: 'branch',
  else: 'branch',
  elif: 'branch',
  switch: 'branch',
  case: 'branch',
  match: 'branch',
  when: 'branch',
  unless: 'branch',
  for: 'loop',
  foreach: 'loop',
  while: 'loop',
  do: 'loop',
  loop: 'loop',
  until: 'loop',
  throw: 'throw',
  raise: 'throw',
  break: 'break',
  return: 'return',
  yield: 'return',
  await: 'await',
  try: 'try',
  catch: 'try',
  except: 'try',
  finally: 'try',
  import: 'import',
  from: 'import',
  require: 'import',
  using: 'import',
};

export function codePowerOf(kind: EnemyKind, label: string): CodePower | undefined {
  if (kind === 'equals') {
    return 'equals';
  }
  return kind === 'keyword' ? KEYWORD_POWERS[label] : undefined;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  cooldown: number;
  invulnerable: number;
  alive: boolean;
  respawn: number;
}

export interface Enemy {
  uid: number;
  spec: EnemySpec;
  kind: EnemyKind;
  power: CodePower | undefined;
  x: number;
  y: number;
  baseX: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  vy: number;
  phase: number;
  amp: number;
  age: number;
  flash: number;
  fireCd: number;
  fresh: boolean;
  /** Counts toward the level quota (fresh enemies from typing are a bonus and don't). */
  quota: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  enemy: boolean;
  dmg: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  type: 'spark' | 'ring' | 'glyph' | 'ember' | 'flash' | 'beam' | 'splat';
  glyph?: string;
  rot?: number;
  vr?: number;
  /** End point for beams. */
  x2?: number;
  y2?: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface PowerUp {
  x: number;
  y: number;
  kind: PowerKind;
  age: number;
}

export interface Hooks {
  sfx(name: Sfx): void;
  toast(text: string, tone?: 'info' | 'good' | 'bad'): void;
  gameOver(score: number, level: number): void;
}

export type EnemyMeasure = (kind: EnemyKind, label: string, u: number) => { w: number; h: number };

export const KIND_COLORS: Record<EnemyKind, string> = {
  line: '#7df9ff',
  function: '#c77dff',
  class: '#ffcc33',
  bracket: '#00f5d4',
  keyword: '#ff9f1c',
  comment: '#8b95c9',
  string: '#7bff8a',
  equals: '#ff6ec7',
  bug: '#ff3864',
  warning: '#ffd23f',
};

const KIND_POINTS: Record<EnemyKind, number> = {
  line: 10,
  function: 40,
  class: 150,
  bracket: 15,
  keyword: 25,
  comment: 5,
  string: 10,
  equals: 30,
  bug: 100,
  warning: 40,
};

/** Relative descent speed per kind. */
const KIND_SPEED: Record<EnemyKind, number> = {
  line: 1,
  function: 0.8,
  class: 0.45,
  bracket: 1.45,
  keyword: 1.15,
  comment: 0.7,
  string: 1.05,
  equals: 1.1,
  bug: 0.85,
  warning: 0.95,
};

const DIFFICULTY = {
  chill: { speed: 0.75, fire: 0.55, quota: 0.8 },
  normal: { speed: 1, fire: 1, quota: 1 },
  hardcore: { speed: 1.3, fire: 1.6, quota: 1.25 },
} as const;

/** Seconds between shots. */
export const FIRE_COOLDOWN = 0.12;
export const RAPID_FIRE_COOLDOWN = 0.065;

const FALLBACK_LABELS = ['null', 'undefined', 'NaN', 'void', '{}', '0', '""', '[]'];
const MAX_PARTICLES = 700;
const MAX_FRESH_QUEUE = 12;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Default (neon) hitbox sizes; the active renderer may supply its own via `Game.measureEnemy`. */
export const measureNeon: EnemyMeasure = (kind, label, u) => {
  const textW = label.length * 7.8 * u;
  switch (kind) {
    case 'class':
      return { w: Math.max(96 * u, textW + 50 * u), h: 46 * u };
    case 'function':
      return { w: Math.max(64 * u, textW + 34 * u), h: 34 * u };
    case 'bug':
      return { w: 44 * u, h: 38 * u };
    case 'warning':
      return { w: 40 * u, h: 36 * u };
    case 'bracket':
      return { w: Math.max(34 * u, textW + 16 * u), h: 30 * u };
    case 'keyword':
      return { w: Math.max(44 * u, textW + 26 * u), h: 30 * u };
    case 'equals':
      return { w: 52 * u, h: 28 * u };
    case 'comment':
      return { w: 38 * u, h: 36 * u };
    default:
      return { w: Math.max(42 * u, textW + 24 * u), h: 28 * u };
  }
};

export interface Stats {
  shots: number;
  hits: number;
  kills: number;
  escaped: number;
  bugsSquashed: number;
  powersTriggered: number;
  toughest?: { label: string; line: number; hp: number };
  livesLostThisLevel: number;
}

export class Game {
  W = 800;
  H = 600;
  /** Size unit: 1 at ~900×700, shrinks/grows with the viewport. */
  u = 1;

  state: GameState = 'title';
  settings: GameSettings = {
    startingLives: 3,
    difficulty: 'normal',
    reducedEffects: false,
    moveSensitivity: 5,
    theme: 'retro',
  };
  snapshot: CodeSnapshot | undefined;
  measureEnemy: EnemyMeasure = measureNeon;

  player: Player = { x: 400, y: 540, vx: 0, cooldown: 0, invulnerable: 0, alive: true, respawn: 0 };
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  particles: Particle[] = [];
  texts: FloatText[] = [];
  powerups: PowerUp[] = [];

  input = { left: false, right: false, fire: false };

  score = 0;
  hiScore = 0;
  level = 1;
  lives = 3;
  quota = 10;
  spawnedForQuota = 0;
  spawnTimer = 0;
  freshTimer = 0;
  levelIntro = 0;
  combo = 0;
  comboTimer = 0;
  shake = 0;
  time = 0;
  gameOverDelay = 0;
  /** Timers are seconds remaining. */
  power = { triple: 0, rapid: 0, shield: false, loop: 0, freeze: 0, slow: 0 };
  stats: Stats = this.emptyStats();

  private freshQueue: EnemySpec[] = [];
  private poolCursor = 0;
  private nextUid = 1;

  constructor(private readonly hooks: Hooks) {}

  // ------------------------------------------------------------------ setup

  resize(w: number, h: number): void {
    const sx = w / this.W;
    const sy = h / this.H;
    this.W = w;
    this.H = h;
    this.u = clamp(Math.min(w / 900, h / 700), 0.55, 1.6);
    for (const e of this.enemies) {
      e.x *= sx;
      e.baseX *= sx;
      e.y *= sy;
      this.sizeEnemy(e);
    }
    for (const b of this.bullets) {
      b.x *= sx;
      b.y *= sy;
    }
    for (const p of this.powerups) {
      p.x *= sx;
      p.y *= sy;
    }
    this.player.x = clamp(this.player.x * sx, this.shipHalfWidth(), w - this.shipHalfWidth());
    this.player.y = this.playerY();
  }

  /** Re-measure every enemy (e.g. after a theme switch changes sprite sizes). */
  remeasure(): void {
    for (const e of this.enemies) {
      this.sizeEnemy(e);
    }
  }

  setSnapshot(snapshot: CodeSnapshot): void {
    this.snapshot = snapshot;
    const pool = this.codePool();
    if (this.poolCursor >= pool.length) {
      this.poolCursor = 0;
    }
  }

  /** Newly typed code: spawns soon as highlighted bonus enemies. */
  queueFresh(specs: EnemySpec[]): void {
    if (specs.length === 0) {
      return;
    }
    this.freshQueue.push(...specs);
    if (this.freshQueue.length > MAX_FRESH_QUEUE) {
      this.freshQueue.splice(0, this.freshQueue.length - MAX_FRESH_QUEUE);
    }
    if (this.state === 'playing') {
      this.hooks.toast(`+${specs.length} new ${specs.length === 1 ? 'enemy' : 'enemies'} from your edits`, 'info');
    }
  }

  get pendingFresh(): number {
    return this.freshQueue.length;
  }

  start(): void {
    this.state = 'playing';
    this.score = 0;
    this.level = 1;
    this.lives = this.settings.startingLives;
    this.enemies = [];
    this.bullets = [];
    this.powerups = [];
    this.texts = [];
    this.combo = 0;
    this.comboTimer = 0;
    this.power = { triple: 0, rapid: 0, shield: false, loop: 0, freeze: 0, slow: 0 };
    this.stats = this.emptyStats();
    this.poolCursor = 0;
    this.gameOverDelay = 0;
    this.player = {
      x: this.W / 2,
      y: this.playerY(),
      vx: 0,
      cooldown: 0,
      invulnerable: 1.5,
      alive: true,
      respawn: 0,
    };
    this.beginLevel(1);
  }

  private emptyStats(): Stats {
    return { shots: 0, hits: 0, kills: 0, escaped: 0, bugsSquashed: 0, powersTriggered: 0, livesLostThisLevel: 0 };
  }

  private beginLevel(level: number): void {
    this.level = level;
    const d = DIFFICULTY[this.settings.difficulty];
    this.quota = Math.round((7 + level * 3) * d.quota);
    this.spawnedForQuota = 0;
    this.spawnTimer = 0.4;
    this.levelIntro = 2;
    this.stats.livesLostThisLevel = 0;
  }

  // ------------------------------------------------------------------ derived values

  playerY(): number {
    return this.H - 70 * this.u;
  }

  shipHalfWidth(): number {
    return 22 * this.u;
  }

  /** Top horizontal speed in px/s for the current sensitivity (1…10). */
  moveSpeed(): number {
    const s = clamp(Math.round(this.settings.moveSensitivity), 1, 10);
    return Math.max(220, this.W * (0.2 + 0.05 * s));
  }

  /** How quickly the ship reaches top speed (higher = snappier). */
  private moveResponse(): number {
    const s = clamp(Math.round(this.settings.moveSensitivity), 1, 10);
    return 5 + s * 0.9;
  }

  private descentSpeed(): number {
    const d = DIFFICULTY[this.settings.difficulty];
    return this.H * (0.05 + Math.min(this.level, 15) * 0.0065) * d.speed;
  }

  private maxConcurrent(): number {
    return Math.min(4 + this.level, 14);
  }

  private spawnInterval(): number {
    return Math.max(0.32, 1.25 - this.level * 0.07);
  }

  get enemiesLeft(): number {
    return this.quota - this.spawnedForQuota + this.enemies.filter((e) => e.quota).length;
  }

  private codePool(): EnemySpec[] {
    return (this.snapshot?.specs ?? []).filter((s) => s.kind !== 'bug' && s.kind !== 'warning');
  }

  private diagnosticPool(): EnemySpec[] {
    return (this.snapshot?.specs ?? []).filter((s) => s.kind === 'bug' || s.kind === 'warning');
  }

  private nextSpec(): EnemySpec {
    const diags = this.diagnosticPool();
    if (diags.length > 0 && Math.random() < 0.22) {
      return diags[Math.floor(Math.random() * diags.length)];
    }
    const pool = this.codePool();
    if (pool.length === 0) {
      const label = FALLBACK_LABELS[Math.floor(Math.random() * FALLBACK_LABELS.length)];
      return { id: `void:${label}`, kind: 'line', label, hp: 1, line: 0 };
    }
    const spec = pool[this.poolCursor % pool.length];
    this.poolCursor = (this.poolCursor + 1) % pool.length;
    return spec;
  }

  // ------------------------------------------------------------------ enemies

  private sizeEnemy(e: Enemy): void {
    const { w, h } = this.measureEnemy(e.kind, e.spec.label, this.u);
    e.w = w;
    e.h = h;
  }

  /** Public for tests and for spawning specific code. */
  spawn(spec: EnemySpec, fresh: boolean): Enemy {
    const levelHp = Math.floor((this.level - 1) / 4);
    const hp = Math.min(16, spec.hp + levelHp + (fresh ? 1 : 0));
    const e: Enemy = {
      uid: this.nextUid++,
      spec,
      kind: spec.kind,
      power: codePowerOf(spec.kind, spec.label),
      x: 0,
      y: 0,
      baseX: 0,
      w: 40,
      h: 30,
      hp,
      maxHp: hp,
      vy: this.descentSpeed() * KIND_SPEED[spec.kind] * rand(0.85, 1.15),
      phase: rand(0, Math.PI * 2),
      amp: rand(14, 46) * this.u,
      age: 0,
      flash: 0,
      fireCd: rand(1.2, 2.8),
      fresh,
      quota: !fresh,
    };
    this.sizeEnemy(e);
    const margin = e.w / 2 + e.amp + 8 * this.u;
    e.baseX = rand(margin, Math.max(margin, this.W - margin));
    e.x = e.baseX;
    e.y = -e.h;
    this.enemies.push(e);
    if (!fresh) {
      this.spawnedForQuota++;
    }
    return e;
  }

  private updateEnemy(e: Enemy, dt: number): void {
    e.flash = Math.max(0, e.flash - dt * 6);
    if (this.power.freeze > 0) {
      return; // `break`: everything stands still
    }
    e.age += dt;
    const p = this.player;
    switch (e.kind) {
      case 'bracket': {
        // Triangle-wave zig-zag.
        const t = (e.age * 0.9 + e.phase) % 2;
        e.x = e.baseX + (t < 1 ? t * 2 - 1 : 3 - t * 2) * e.amp * 1.6;
        break;
      }
      case 'keyword': {
        if (e.y > this.H * 0.3 && p.alive) {
          e.baseX += clamp(p.x - e.baseX, -1, 1) * 70 * this.u * dt;
        }
        e.x = e.baseX + Math.sin(e.age * 2.2 + e.phase) * e.amp * 0.5;
        break;
      }
      case 'bug':
        e.x = e.baseX + Math.sin(e.age * 3.1 + e.phase) * e.amp + Math.sin(e.age * 11) * 3 * this.u;
        break;
      case 'class':
        e.x = e.baseX + Math.sin(e.age * 0.7 + e.phase) * Math.min(this.W * 0.3, e.amp * 4);
        break;
      default:
        e.x = e.baseX + Math.sin(e.age * 1.3 + e.phase) * e.amp;
    }
    e.x = clamp(e.x, e.w / 2, this.W - e.w / 2);
    e.y += e.vy * dt;

    // Shooters.
    const shooter = e.kind === 'bug' || e.kind === 'warning' || e.kind === 'class' || (e.kind === 'function' && this.level >= 2);
    if (shooter && e.y > 0 && e.y < this.H * 0.75 && p.alive) {
      e.fireCd -= dt * DIFFICULTY[this.settings.difficulty].fire * (1 + this.level * 0.05);
      if (e.fireCd <= 0) {
        this.enemyFire(e);
      }
    }
  }

  private enemyFire(e: Enemy): void {
    const speed = this.H * 0.42;
    const y = e.y + e.h / 2;
    switch (e.kind) {
      case 'class':
        for (const a of [-0.28, 0, 0.28]) {
          this.bullets.push({ x: e.x, y, vx: Math.sin(a) * speed, vy: Math.cos(a) * speed, enemy: true, dmg: 1 });
        }
        e.fireCd = rand(2.2, 3.2);
        break;
      case 'bug': {
        const dx = this.player.x - e.x;
        const dy = this.player.y - y;
        const len = Math.hypot(dx, dy) || 1;
        this.bullets.push({ x: e.x, y, vx: (dx / len) * speed, vy: (dy / len) * speed, enemy: true, dmg: 1 });
        e.fireCd = rand(1.7, 2.6);
        break;
      }
      default:
        this.bullets.push({ x: e.x, y, vx: 0, vy: speed * 0.9, enemy: true, dmg: 1 });
        e.fireCd = rand(2.6, 4.2);
    }
  }

  private damageEnemy(e: Enemy, dmg: number, depth = 0): void {
    if (!this.enemies.includes(e)) {
      return;
    }
    e.hp -= dmg;
    e.flash = 1;
    this.score += 1;
    if (e.hp <= 0) {
      this.killEnemy(e, depth);
    } else {
      this.hooks.sfx('hit');
      this.burst(e.x, e.y + e.h / 2, KIND_COLORS[e.kind], 5, 0.6);
    }
  }

  /** `depth` > 0 for enemies destroyed by another enemy's power (chain reactions are capped). */
  killEnemy(e: Enemy, depth = 0): void {
    const idx = this.enemies.indexOf(e);
    if (idx < 0) {
      return;
    }
    this.enemies.splice(idx, 1);
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 1.6;
    const comboMul = 1 + Math.min(6, Math.floor(this.combo / 4)) * 0.5;
    const levelMul = 1 + (this.level - 1) * 0.1;
    const points = Math.round(KIND_POINTS[e.kind] * e.maxHp ** 0.5 * levelMul * comboMul * (e.fresh ? 1.5 : 1));
    this.score += points;
    this.stats.kills++;
    if (!this.stats.toughest || e.maxHp > this.stats.toughest.hp) {
      this.stats.toughest = { label: e.spec.label, line: e.spec.line, hp: e.maxHp };
    }

    const color = KIND_COLORS[e.kind];
    const big = e.kind === 'class' || e.kind === 'bug';
    this.flash(e.x, e.y, color, big ? 110 : 60);
    this.burst(e.x, e.y, color, big ? 60 : 32, big ? 1.7 : 1.15);
    this.ring(e.x, e.y, color, big ? 100 : 56);
    this.glyphs(e);
    this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.3, max: 0.3, color, size: e.w, type: 'splat' });
    this.texts.push({
      x: e.x,
      y: e.y,
      text: comboMul > 1 ? `+${points} x${comboMul}` : `+${points}`,
      life: 1,
      max: 1,
      color,
      size: (big ? 17 : 13) * this.u,
    });
    if (big) {
      this.shake = Math.max(this.shake, e.kind === 'class' ? 10 : 6);
    }
    this.hooks.sfx(big ? 'bigExplode' : 'explode');

    if (e.kind === 'bug' || e.kind === 'warning') {
      this.stats.bugsSquashed++;
      this.hooks.toast(`Squashed L${e.spec.line + 1}: ${e.spec.detail ?? 'bug'}`, 'good');
    }
    if (this.combo > 0 && this.combo % 10 === 0) {
      this.hooks.toast(`${this.combo}x COMBO!`, 'good');
    }

    if (e.power && depth < 2) {
      this.triggerCodePower(e, depth);
    } else {
      // Ordinary power-up drops.
      const chance = e.kind === 'class' ? 1 : e.kind === 'bug' ? 0.3 : 0.06;
      if (Math.random() < chance) {
        this.dropPowerUp(e.x, e.y);
      }
    }
  }

  private dropPowerUp(x: number, y: number): void {
    const r = Math.random();
    const kind: PowerKind = r < 0.06 ? 'life' : r < 0.4 ? 'triple' : r < 0.72 ? 'rapid' : 'shield';
    this.powerups.push({ x, y, kind, age: 0 });
  }

  // ------------------------------------------------------------------ code-meaning powers

  private triggerCodePower(e: Enemy, depth: number): void {
    this.stats.powersTriggered++;
    const label = e.spec.label;
    switch (e.power) {
      case 'branch': {
        // `if` always takes the true branch; else/switch/case only sometimes.
        if (label === 'if' || Math.random() < 0.6) {
          this.dropPowerUp(e.x, e.y);
          this.hooks.toast(`${label} (true) → power-up dropped!`, 'good');
        } else {
          this.hooks.toast(`${label} (false) → no power-up this time`, 'info');
        }
        break;
      }
      case 'loop':
        this.power.loop = 6;
        this.hooks.sfx('shield');
        this.hooks.toast(`${label} loop shield → protected for 6 s`, 'good');
        break;
      case 'equals': {
        const left = this.nearestOnSide(e, -1);
        const right = this.nearestOnSide(e, 1);
        for (const target of [left, right]) {
          if (target) {
            this.beam(e.x, e.y, target.x, target.y, KIND_COLORS.equals);
            this.killEnemy(target, depth + 1);
          }
        }
        this.hooks.sfx('zap');
        const hits = [left, right].filter(Boolean).length;
        this.hooks.toast(
          hits === 2
            ? `left ${label} right → both sides destroyed!`
            : hits === 1
              ? `${label} → one side destroyed`
              : `${label} → nothing to compare`,
          'good',
        );
        break;
      }
      case 'throw': {
        const radius = 160 * this.u;
        this.ring(e.x, e.y, '#ffffff', 170);
        this.flash(e.x, e.y, '#ff9f1c', 170);
        for (const other of [...this.enemies]) {
          if (Math.hypot(other.x - e.x, other.y - e.y) < radius) {
            this.damageEnemy(other, 4, depth + 1);
          }
        }
        this.shake = Math.max(this.shake, 9);
        this.hooks.toast(`${label} → exception blast!`, 'good');
        break;
      }
      case 'break':
        this.power.freeze = 3;
        this.hooks.sfx('freeze');
        this.hooks.toast(`${label} → all enemies frozen for 3 s`, 'good');
        break;
      case 'return': {
        let returned = 0;
        for (const b of this.bullets) {
          if (b.enemy) {
            b.enemy = false;
            b.vx = 0;
            b.vy = -this.H * 1.2;
            returned++;
          }
        }
        this.hooks.toast(`${label} → ${returned} enemy shot${returned === 1 ? '' : 's'} returned to sender`, 'good');
        break;
      }
      case 'await':
        this.power.slow = 4;
        this.hooks.toast(`${label} → time slowed for 4 s`, 'good');
        break;
      case 'try':
        this.power.shield = true;
        this.hooks.sfx('shield');
        this.hooks.toast(`${label} → one-hit shield armed`, 'good');
        break;
      case 'import':
        this.power.triple = Math.max(this.power.triple, 8);
        this.hooks.sfx('power');
        this.hooks.toast(`${label} → spread shot imported for 8 s`, 'good');
        break;
    }
  }

  /** Closest enemy strictly to the left (dir = -1) or right (dir = 1) of `e`. */
  private nearestOnSide(e: Enemy, dir: -1 | 1): Enemy | undefined {
    let best: Enemy | undefined;
    let bestDist = Infinity;
    for (const other of this.enemies) {
      if (other === e || (other.x - e.x) * dir <= 0 || other.y < -other.h / 2) {
        continue;
      }
      const d = Math.hypot(other.x - e.x, (other.y - e.y) * 1.5);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ player

  private fire(): void {
    const p = this.player;
    const speed = -this.H * 1.5;
    const y = p.y - 24 * this.u;
    this.bullets.push({ x: p.x, y, vx: 0, vy: speed, enemy: false, dmg: 1 });
    this.stats.shots++;
    if (this.power.triple > 0) {
      this.bullets.push({ x: p.x - 10 * this.u, y: y + 6, vx: speed * -0.16, vy: speed, enemy: false, dmg: 1 });
      this.bullets.push({ x: p.x + 10 * this.u, y: y + 6, vx: speed * 0.16, vy: speed, enemy: false, dmg: 1 });
    }
    p.cooldown = this.power.rapid > 0 ? RAPID_FIRE_COOLDOWN : FIRE_COOLDOWN;
    this.hooks.sfx('shoot');
  }

  /** True while the player can't be hurt (respawn blink or loop shield). */
  get protectedNow(): boolean {
    return this.player.invulnerable > 0 || this.power.loop > 0;
  }

  private hitPlayer(): void {
    const p = this.player;
    if (!p.alive || p.invulnerable > 0) {
      return;
    }
    if (this.power.loop > 0) {
      this.ring(p.x, p.y, KIND_COLORS.keyword, 50);
      return;
    }
    if (this.power.shield) {
      this.power.shield = false;
      p.invulnerable = 1;
      this.ring(p.x, p.y, '#7df9ff', 80);
      this.hooks.sfx('shield');
      return;
    }
    this.lives--;
    this.stats.livesLostThisLevel++;
    p.alive = false;
    p.respawn = 1.4;
    this.combo = 0;
    this.power.triple = 0;
    this.power.rapid = 0;
    this.flash(p.x, p.y, '#ffffff', 140);
    this.burst(p.x, p.y, '#7df9ff', 60, 1.8);
    this.burst(p.x, p.y, '#ff4fd8', 30, 1.2);
    this.ring(p.x, p.y, '#ffffff', 120);
    this.shake = 14;
    this.hooks.sfx('playerHit');
    if (this.lives <= 0) {
      this.gameOverDelay = 1.6;
    }
  }

  // ------------------------------------------------------------------ effects

  burst(x: number, y: number, color: string, count: number, power: number): void {
    const n = this.settings.reducedEffects ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(60, 260) * power * this.u;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.35, 0.9),
        max: 0.9,
        color: Math.random() < 0.2 ? '#ffffff' : color,
        size: rand(2, 4.5) * this.u,
        type: Math.random() < 0.7 ? 'spark' : 'ember',
      });
    }
  }

  /** Short bright bloom at the point of impact. */
  private flash(x: number, y: number, color: string, radius: number): void {
    if (this.particles.length < MAX_PARTICLES) {
      this.particles.push({ x, y, vx: 0, vy: 0, life: 0.22, max: 0.22, color, size: radius * this.u, type: 'flash' });
    }
  }

  private ring(x: number, y: number, color: string, radius: number): void {
    if (this.particles.length < MAX_PARTICLES) {
      this.particles.push({ x, y, vx: 0, vy: 0, life: 0.45, max: 0.45, color, size: radius * this.u, type: 'ring' });
    }
  }

  private beam(x: number, y: number, x2: number, y2: number, color: string): void {
    this.particles.push({ x, y, x2, y2, vx: 0, vy: 0, life: 0.35, max: 0.35, color, size: 4 * this.u, type: 'beam' });
  }

  /** The enemy's source characters fly apart. */
  private glyphs(e: Enemy): void {
    if (this.settings.reducedEffects) {
      return;
    }
    const chars = [...e.spec.label].filter((c) => c.trim()).slice(0, 10);
    chars.forEach((glyph, i) => {
      if (this.particles.length >= MAX_PARTICLES) {
        return;
      }
      const a = -Math.PI / 2 + (i - chars.length / 2) * 0.35 + rand(-0.2, 0.2);
      const s = rand(80, 180) * this.u;
      this.particles.push({
        x: e.x + (i - chars.length / 2) * 7 * this.u,
        y: e.y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1.1,
        max: 1.1,
        color: KIND_COLORS[e.kind],
        size: 17 * this.u,
        type: 'glyph',
        glyph,
        rot: 0,
        vr: rand(-6, 6),
      });
    });
  }

  // ------------------------------------------------------------------ main update

  update(dt: number): void {
    this.time += dt;
    this.updateEffects(dt);
    if (this.state !== 'playing') {
      return;
    }

    const p = this.player;
    const u = this.u;

    // Timers.
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.power.triple = Math.max(0, this.power.triple - dt);
    this.power.rapid = Math.max(0, this.power.rapid - dt);
    this.power.loop = Math.max(0, this.power.loop - dt);
    this.power.freeze = Math.max(0, this.power.freeze - dt);
    this.power.slow = Math.max(0, this.power.slow - dt);
    this.shake = Math.max(0, this.shake - dt * 30);
    /** Enemy time runs slower during `await`. */
    const edt = this.power.slow > 0 ? dt * 0.35 : dt;

    // Player.
    if (p.alive) {
      const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
      p.vx += (dir * this.moveSpeed() - p.vx) * Math.min(1, dt * this.moveResponse());
      p.x = clamp(p.x + p.vx * dt, this.shipHalfWidth(), this.W - this.shipHalfWidth());
      p.invulnerable = Math.max(0, p.invulnerable - dt);
      p.cooldown -= dt;
      if (this.input.fire && p.cooldown <= 0) {
        this.fire();
      }
      // Engine exhaust.
      if (!this.settings.reducedEffects && Math.random() < 0.7 && this.particles.length < MAX_PARTICLES) {
        this.particles.push({
          x: p.x + rand(-4, 4) * u,
          y: p.y + 18 * u,
          vx: rand(-20, 20),
          vy: rand(120, 220) * u,
          life: 0.25,
          max: 0.25,
          color: Math.random() < 0.5 ? '#7df9ff' : '#c77dff',
          size: rand(1.5, 3) * u,
          type: 'ember',
        });
      }
    } else if (this.lives > 0) {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        p.alive = true;
        p.invulnerable = 2;
        p.x = this.W / 2;
        p.vx = 0;
        this.bullets = this.bullets.filter((b) => !b.enemy);
      }
    }

    if (this.gameOverDelay > 0) {
      this.gameOverDelay -= dt;
      if (this.gameOverDelay <= 0) {
        this.state = 'over';
        this.hiScore = Math.max(this.hiScore, this.score);
        this.hooks.gameOver(this.score, this.level);
        return;
      }
    }

    // Spawning (paused while enemies are frozen by `break`).
    if (this.levelIntro > 0) {
      this.levelIntro -= dt;
    } else if (this.lives > 0 && this.power.freeze <= 0) {
      this.spawnTimer -= edt;
      if (this.spawnTimer <= 0 && this.spawnedForQuota < this.quota && this.enemies.length < this.maxConcurrent()) {
        this.spawn(this.nextSpec(), false);
        this.spawnTimer = this.spawnInterval() * rand(0.7, 1.3);
      }
      this.freshTimer -= edt;
      if (this.freshQueue.length > 0 && this.freshTimer <= 0 && this.enemies.length < this.maxConcurrent() + 4) {
        this.spawn(this.freshQueue.shift()!, true);
        this.freshTimer = 0.45;
      }
    }

    // Enemies.
    for (const e of [...this.enemies]) {
      if (!this.enemies.includes(e)) {
        continue; // destroyed by a chain reaction this frame
      }
      this.updateEnemy(e, edt);
      if (e.y - e.h / 2 > this.H) {
        this.enemies.splice(this.enemies.indexOf(e), 1);
        this.stats.escaped++;
        this.hooks.sfx('escape');
        this.hooks.toast(`L${e.spec.line + 1} shipped to production!`, 'bad');
        if (p.alive && !this.protectedNow) {
          this.hitPlayer();
        } else if (p.alive) {
          // Protected players still pay for escaped code.
          this.lives = Math.max(0, this.lives - 1);
          if (this.lives === 0) {
            this.gameOverDelay = 1.2;
          }
        }
        continue;
      }
      if (p.alive && Math.abs(e.x - p.x) < e.w / 2 + 16 * u && Math.abs(e.y - p.y) < e.h / 2 + 16 * u) {
        this.hitPlayer();
        this.damageEnemy(e, this.power.loop > 0 ? 99 : 3);
      }
    }

    // Bullets.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const bdt = b.enemy ? edt : dt;
      if (!(b.enemy && this.power.freeze > 0)) {
        b.x += b.vx * bdt;
        b.y += b.vy * bdt;
      }
      if (b.y < -30 || b.y > this.H + 30 || b.x < -30 || b.x > this.W + 30) {
        this.bullets.splice(i, 1);
        continue;
      }
      if (b.enemy) {
        if (p.alive && Math.abs(b.x - p.x) < 15 * u && Math.abs(b.y - p.y) < 16 * u) {
          this.bullets.splice(i, 1);
          this.hitPlayer();
        }
        continue;
      }
      for (const e of this.enemies) {
        if (Math.abs(b.x - e.x) < e.w / 2 + 3 && Math.abs(b.y - e.y) < e.h / 2 + 6) {
          this.bullets.splice(i, 1);
          this.stats.hits++;
          this.damageEnemy(e, b.dmg);
          break;
        }
      }
    }

    // Power-ups.
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.age += dt;
      pu.y += this.H * 0.16 * dt;
      if (pu.y > this.H + 20) {
        this.powerups.splice(i, 1);
      } else if (p.alive && Math.abs(pu.x - p.x) < 28 * u && Math.abs(pu.y - p.y) < 28 * u) {
        this.powerups.splice(i, 1);
        this.applyPower(pu.kind);
      }
    }

    // Level complete.
    if (this.levelIntro <= 0 && this.spawnedForQuota >= this.quota && !this.enemies.some((e) => e.quota) && this.lives > 0) {
      const clean = this.stats.livesLostThisLevel === 0;
      const bonus = 250 * this.level * (clean ? 2 : 1);
      this.score += bonus;
      this.hooks.toast(clean ? `Clean build! +${bonus}` : `Level cleared +${bonus}`, 'good');
      this.hooks.sfx('level');
      this.beginLevel(this.level + 1);
    }
  }

  private applyPower(kind: PowerKind): void {
    this.hooks.sfx('power');
    this.ring(this.player.x, this.player.y, '#ffffff', 60);
    switch (kind) {
      case 'triple':
        this.power.triple = 10;
        this.hooks.toast('Triple shot — spread operator!', 'good');
        break;
      case 'rapid':
        this.power.rapid = 10;
        this.hooks.toast('Rapid fire — hot reload!', 'good');
        break;
      case 'shield':
        this.power.shield = true;
        this.hooks.toast('Shield — try/catch armed', 'good');
        break;
      case 'life':
        this.lives = Math.min(9, this.lives + 1);
        this.hooks.toast('+1 life — backup restored', 'good');
        break;
    }
  }

  private updateEffects(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      const drag = q.type === 'glyph' ? 0.985 : 0.93;
      q.vx *= drag;
      q.vy = q.vy * drag + (q.type === 'glyph' ? 160 * this.u * dt : 0);
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.rot !== undefined && q.vr !== undefined) {
        q.rot += q.vr * dt;
      }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y -= 40 * this.u * dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
      }
    }
  }
}
