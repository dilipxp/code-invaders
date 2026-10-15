import type { CodeSnapshot, EnemyKind, EnemySpec, GameSettings } from '../shared/protocol';
import { tuningFor, type Tuning } from './difficulty';
import { BEHAVIORS } from './enemies/behaviors';
import { absorbHit, onEnemyRemoved, supportRoles } from './enemies/combat';
import { ENEMY_DEFS, LIMITS, type EnemyDefinition, type UnitType } from './enemies/definitions';
import { LevelManager } from './levels';
import type { BossDefinition, BossId } from './bosses';

export type GameState = 'title' | 'playing' | 'paused' | 'over' | 'victory';
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
  | 'freeze'
  | 'warning'
  | 'deflect'
  | 'summon'
  | 'warp'
  | 'bossIntro'
  | 'bossPhase'
  | 'bossDefeat'
  | 'victory';

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

/**
 * How an enemy takes part in a group. Leaders own support units (escorts, minions, modules);
 * removing a leader removes the support units that belong to it.
 */
export type EnemyRole = 'normal' | 'leader' | 'escort' | 'minion' | 'module' | 'head' | 'clone' | 'half' | 'reinforcement' | 'boss';

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

  // ---- data-driven construct enemies (undefined for plain line enemies)
  unit?: UnitType;
  def?: EnemyDefinition;
  role: EnemyRole;
  /** Enemies created together (a commander and its escorts, a function and its parameters…). */
  groupId: number;
  parentUid?: number;
  /** Shield points that absorb hits before hit points. */
  shield: number;
  shieldMax: number;
  /** Seconds left on a timed shield (try/catch recovery, boss phase change). */
  shieldTimer: number;
  /** Phased out (async/await): can't be hit and can't hurt you by contact. */
  phased: boolean;
  /** Seconds the core stays exposed (Loop Commander without escorts). */
  exposed: number;
  /** Damage multiplier for incoming hits (armour < 1). */
  armor: number;
  /** Small text drawn above the enemy: mode, loop counter, state. */
  badge: string;
  /** 0…1 progress of a telegraphed wind-up (drawn as glow / shake). */
  windup: number;
  /** Behaviour scratch state. */
  mem: Record<string, number>;
  elite: boolean;
  cloneDepth: number;
  /** Visual / hitbox scale (clones are smaller). */
  scale: number;
  /** Seconds the construct signature (e.g. `i < 10; i++`) is shown. */
  showSig: number;
  bossId?: BossId;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  enemy: boolean;
  dmg: number;
  /** Enemy projectile variants: heavy (throw), pending (Promise: resolves into fragments). */
  kind?: 'shot' | 'heavy' | 'pending' | 'fragment' | 'aimed';
  /** Hit radius for big projectiles (defaults to the normal shot size). */
  r?: number;
  /** Pending projectiles: seconds until they resolve. */
  fuse?: number;
  frags?: number;
}

/** Visual warning before a dangerous attack. */
export interface Warning {
  kind: 'circle' | 'line' | 'column' | 'row' | 'marker';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  /** Radius (circle / marker) or half-width (column / row). */
  r: number;
  life: number;
  max: number;
  color: string;
  label?: string;
}

/** A damaging area (boss beams). Harmless while `warn` > 0. */
export interface Hazard {
  x: number;
  w: number;
  warn: number;
  life: number;
  color: string;
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
  /** All levels cleared. `signature` is the final boss's source signature. */
  victory?(score: number, signature: string): void;
}

/** Look key used by renderers: a construct/support unit, a boss, or undefined for plain enemies. */
export function lookOf(e: Pick<Enemy, 'unit' | 'bossId'>): string | undefined {
  return e.bossId ? `boss:${e.bossId}` : e.unit;
}

export type EnemyMeasure = (kind: EnemyKind, label: string, u: number, look?: string) => { w: number; h: number };

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

/** Seconds between shots. */
export const FIRE_COOLDOWN = 0.12;
export const RAPID_FIRE_COOLDOWN = 0.065;

const FALLBACK_LABELS = ['null', 'undefined', 'NaN', 'void', '{}', '0', '""', '[]'];
const MAX_PARTICLES = 700;
const MAX_FRESH_QUEUE = 12;
const MAX_WARNINGS = 40;
/** Units that ride along with their leader (escorts, parameters, modules, heads). */
const ATTACHED_ROLES: ReadonlySet<EnemyRole> = new Set<EnemyRole>(['escort', 'minion', 'module', 'head']);

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Neon hitbox sizes for construct units, support units and bosses (before the size unit). */
const NEON_UNIT_SIZE: Record<string, [number, number]> = {
  escort: [26, 22],
  minion: [30, 22],
  half: [34, 24],
  module: [40, 30],
  head: [46, 34],
  for: [92, 50],
  class: [100, 48],
  'boss:loop': [190, 96],
  'boss:hydra': [180, 100],
  'boss:overlord': [210, 104],
  'boss:phantom': [170, 100],
  'boss:runtime': [220, 116],
};

/** Default (neon) hitbox sizes; the active renderer may supply its own via `Game.measureEnemy`. */
export const measureNeon: EnemyMeasure = (kind, label, u, look) => {
  const textW = label.length * 7.8 * u;
  if (look) {
    const fixed = NEON_UNIT_SIZE[look];
    if (fixed) {
      return { w: Math.max(fixed[0] * u, look.startsWith('boss:') ? 0 : textW + 20 * u), h: fixed[1] * u };
    }
    const tier = ENEMY_DEFS[look as UnitType]?.tier ?? 1;
    const h = (tier === 3 ? 42 : tier === 2 ? 36 : 30) * u;
    return { w: Math.max((tier === 3 ? 70 : tier === 2 ? 60 : 48) * u, textW + 26 * u), h };
  }
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
  /** return-bots that got away with their points. */
  returned: number;
  bossesDefeated: number;
}

export interface SpawnOptions {
  /** Owning enemy (support units follow it and are removed with it). */
  parent?: Enemy;
  role?: EnemyRole;
  label?: string;
  x?: number;
  y?: number;
  hp?: number;
  /** Behaviour scratch values to start with. */
  mem?: Record<string, number>;
  scale?: number;
  cloneDepth?: number;
  /** Override the spec (e.g. reinforcements use real code lines). */
  spec?: EnemySpec;
  elite?: boolean;
}

interface Scheduled {
  t: number;
  run: () => void;
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
  warnings: Warning[] = [];
  hazards: Hazard[] = [];

  input = { left: false, right: false, fire: false };

  score = 0;
  hiScore = 0;
  level = 1;
  lives = 3;
  quota = 10;
  spawnedForQuota = 0;
  spawnTimer = 0;
  freshTimer = 0;
  /** Seconds left of the "LEVEL n" banner; nothing spawns while it shows. */
  levelIntro = 0;
  combo = 0;
  comboTimer = 0;
  shake = 0;
  time = 0;
  gameOverDelay = 0;
  /** Timers are seconds remaining. */
  power = { triple: 0, rapid: 0, shield: false, loop: 0, freeze: 0, slow: 0 };
  stats: Stats = this.emptyStats();
  tuning: Tuning = tuningFor(1, 'normal');
  /** Banner text for phase changes and announcements (drawn by the renderers). */
  banner = { text: '', sub: '', time: 0, max: 1, color: '#ffffff' };
  /** Reinforcements called by import enemies this level (capped). */
  reinforcementsThisLevel = 0;
  readonly levels: LevelManager;

  private freshQueue: EnemySpec[] = [];
  private nextUid = 1;
  private nextGroup = 1;
  private scheduled: Scheduled[] = [];

  constructor(private readonly hooks: Hooks) {
    this.levels = new LevelManager(this);
  }

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
    for (const wn of this.warnings) {
      wn.x *= sx;
      wn.y *= sy;
      if (wn.x2 !== undefined) wn.x2 *= sx;
      if (wn.y2 !== undefined) wn.y2 *= sy;
    }
    for (const hz of this.hazards) {
      hz.x *= sx;
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

  /**
   * Store the latest analysis. The current wave is *not* rebuilt (that would reshuffle the fight
   * every time you type): the next level's wave is planned from it, and newly typed code arrives
   * through `queueFresh` as bonus enemies.
   */
  setSnapshot(snapshot: CodeSnapshot): void {
    this.snapshot = snapshot;
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
    this.warnings = [];
    this.hazards = [];
    this.scheduled = [];
    this.combo = 0;
    this.comboTimer = 0;
    this.power = { triple: 0, rapid: 0, shield: false, loop: 0, freeze: 0, slow: 0 };
    this.stats = this.emptyStats();
    this.gameOverDelay = 0;
    this.banner.time = 0;
    this.player = {
      x: this.W / 2,
      y: this.playerY(),
      vx: 0,
      cooldown: 0,
      invulnerable: 1.5,
      alive: true,
      respawn: 0,
    };
    this.levels.begin(1);
  }

  private emptyStats(): Stats {
    return {
      shots: 0,
      hits: 0,
      kills: 0,
      escaped: 0,
      bugsSquashed: 0,
      powersTriggered: 0,
      livesLostThisLevel: 0,
      returned: 0,
      bossesDefeated: 0,
    };
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

  descentSpeed(): number {
    return this.H * this.tuning.descent;
  }

  /** Enemy projectile speed in px/s. */
  projectileSpeed(): number {
    return this.H * this.tuning.projectileSpeed;
  }

  get enemiesLeft(): number {
    return Math.max(0, this.quota - this.spawnedForQuota) + this.enemies.filter((e) => e.quota).length;
  }

  /** Main enemies on screen (support units don't block new spawns). */
  mainEnemyCount(): number {
    let n = 0;
    for (const e of this.enemies) {
      if (!supportRoles.has(e.role)) n++;
    }
    return n;
  }

  supportCount(): number {
    let n = 0;
    for (const e of this.enemies) {
      if (supportRoles.has(e.role)) n++;
    }
    return n;
  }

  tier3OnScreen(): number {
    return this.enemies.filter((e) => e.def?.tier === 3 && e.role !== 'clone').length;
  }

  // ------------------------------------------------------------------ spawning

  /** Next fresh (typed) spec, if one is waiting and the field has room. Used by the level manager. */
  takeFresh(): EnemySpec | undefined {
    return this.freshQueue.shift();
  }

  fallbackSpec(): EnemySpec {
    const label = FALLBACK_LABELS[Math.floor(Math.random() * FALLBACK_LABELS.length)];
    return { id: `void:${label}`, kind: 'line', label, hp: 1, line: 0 };
  }

  private sizeEnemy(e: Enemy): void {
    const { w, h } = this.measureEnemy(e.kind, e.spec.label, this.u, lookOf(e));
    e.w = w * e.scale;
    e.h = h * e.scale;
  }

  /** Public for tests and for spawning specific code. */
  spawn(spec: EnemySpec, fresh: boolean, elite = false): Enemy {
    const def = spec.archetype ? ENEMY_DEFS[spec.archetype] : undefined;
    let hp: number;
    if (def) {
      hp = def.hp + Math.min(def.maxBonus, Math.max(0, spec.hp - 1)) + this.tuning.hpBonus + (fresh ? 1 : 0);
      if (elite) {
        hp = Math.ceil(hp * 1.5);
      }
    } else {
      hp = Math.min(16, spec.hp + this.tuning.hpBonus + (fresh ? 1 : 0));
    }
    const e = this.makeEnemy(spec, hp, def, {
      role: def && (def.behavior === 'commander' || def.behavior === 'summoner' || def.behavior === 'elite') ? 'leader' : 'normal',
      elite,
    });
    e.fresh = fresh;
    e.quota = !fresh;
    if (!fresh) {
      this.spawnedForQuota++;
    }
    this.initBehavior(e);
    return e;
  }

  /**
   * EnemyFactory for support units and other non-quota enemies (escorts, parameters, clones,
   * reinforcements, boss parts). Returns undefined when a fairness cap is reached.
   */
  spawnUnit(unit: UnitType, opts: SpawnOptions = {}): Enemy | undefined {
    const role = opts.role ?? 'minion';
    if (supportRoles.has(role) && this.supportCount() >= LIMITS.maxSupportOnScreen) {
      return undefined;
    }
    const def = opts.spec?.archetype ? ENEMY_DEFS[opts.spec.archetype] : ENEMY_DEFS[unit];
    const parent = opts.parent;
    const spec: EnemySpec = opts.spec ?? {
      id: `${unit}:${parent?.uid ?? 0}:${this.nextUid}`,
      kind: parent?.kind ?? 'line',
      label: opts.label ?? def.title,
      hp: 1,
      line: parent?.spec.line ?? 0,
      archetype: unit in ENEMY_DEFS && def.tier > 0 ? (unit as EnemySpec['archetype']) : undefined,
      construct: parent?.spec.construct,
    };
    const hp = opts.hp ?? def.hp;
    // A plain code line called in as a reinforcement has no definition of its own.
    const plainLine = !!opts.spec && !opts.spec.archetype;
    const e = this.makeEnemy(spec, hp, plainLine ? undefined : def, {
      role,
      parent,
      scale: opts.scale,
      cloneDepth: opts.cloneDepth,
      elite: opts.elite,
    });
    e.quota = false;
    if (opts.x !== undefined) {
      e.x = e.baseX = opts.x;
    }
    if (opts.y !== undefined) {
      e.y = opts.y;
    }
    Object.assign(e.mem, opts.mem);
    this.initBehavior(e);
    return e;
  }

  private makeEnemy(
    spec: EnemySpec,
    hp: number,
    def: EnemyDefinition | undefined,
    opts: { role: EnemyRole; parent?: Enemy; scale?: number; cloneDepth?: number; elite?: boolean },
  ): Enemy {
    const speed = def ? def.speed : KIND_SPEED[spec.kind];
    const e: Enemy = {
      uid: this.nextUid++,
      spec,
      kind: spec.kind,
      power: def ? def.power : codePowerOf(spec.kind, spec.label),
      x: 0,
      y: 0,
      baseX: 0,
      w: 40,
      h: 30,
      hp,
      maxHp: hp,
      vy: this.descentSpeed() * speed * rand(0.85, 1.15),
      phase: rand(0, Math.PI * 2),
      amp: rand(14, 46) * this.u,
      age: 0,
      flash: 0,
      fireCd: def?.fire ? rand(def.fire[0], def.fire[1]) * 0.7 + 0.6 : rand(1.2, 2.8),
      fresh: false,
      quota: false,
      unit: def?.unit,
      def,
      role: opts.role,
      groupId: opts.parent ? opts.parent.groupId : this.nextGroup++,
      parentUid: opts.parent?.uid,
      shield: 0,
      shieldMax: 0,
      shieldTimer: 0,
      phased: false,
      exposed: 0,
      armor: 1,
      badge: '',
      windup: 0,
      mem: {},
      elite: !!opts.elite,
      cloneDepth: opts.cloneDepth ?? 0,
      scale: opts.scale ?? (opts.elite ? 1.15 : 1),
      showSig: 0,
    };
    this.sizeEnemy(e);
    const margin = e.w / 2 + e.amp + 8 * this.u;
    e.baseX = rand(margin, Math.max(margin, this.W - margin));
    e.x = e.baseX;
    e.y = -e.h;
    if (opts.parent) {
      e.x = e.baseX = opts.parent.x;
      e.y = opts.parent.y;
    }
    this.enemies.push(e);
    return e;
  }

  /** Behaviour set-up runs after position / state overrides are applied. */
  private initBehavior(e: Enemy): void {
    if (e.def) {
      BEHAVIORS[e.def.behavior].init?.(this, e);
    }
  }

  /** The level's boss enters from the top (the BossController drives it from then on). */
  spawnBoss(def: BossDefinition): Enemy {
    const label = def.label(this.snapshot);
    const hp = Math.max(10, Math.round(def.hp * this.tuning.bossHp));
    const spec: EnemySpec = { id: `boss:${def.id}`, kind: 'class', label, hp, line: 0 };
    const e = this.makeEnemy(spec, hp, undefined, { role: 'boss' });
    e.bossId = def.id;
    e.power = undefined;
    this.sizeEnemy(e);
    e.x = e.baseX = this.W / 2;
    e.y = -e.h / 2;
    e.quota = false;
    return e;
  }

  byUid(uid: number | undefined): Enemy | undefined {
    if (uid === undefined) {
      return undefined;
    }
    return this.enemies.find((e) => e.uid === uid);
  }

  childrenOf(e: Enemy): Enemy[] {
    return this.enemies.filter((c) => c.parentUid === e.uid);
  }

  // ------------------------------------------------------------------ helpers for behaviours and bosses

  /** Fire an enemy projectile (respects the in-flight cap). */
  enemyShot(x: number, y: number, vx: number, vy: number, extra: Partial<Bullet> = {}): boolean {
    let inFlight = 0;
    for (const b of this.bullets) {
      if (b.enemy) inFlight++;
    }
    if (inFlight >= LIMITS.maxEnemyBullets) {
      return false;
    }
    this.bullets.push({ x, y, vx, vy, enemy: true, dmg: 1, kind: 'shot', ...extra });
    return true;
  }

  /** Projectile from (x, y) toward a point (the player by default). */
  aimedShot(x: number, y: number, speedMul = 1, at: { x: number; y: number } = this.player, extra: Partial<Bullet> = {}): boolean {
    const dx = at.x - x;
    const dy = at.y - y;
    const len = Math.hypot(dx, dy) || 1;
    const s = this.projectileSpeed() * speedMul;
    return this.enemyShot(x, y, (dx / len) * s, (dy / len) * s, { kind: 'aimed', ...extra });
  }

  /** Fan of shots straight down around angle 0. */
  fanShot(x: number, y: number, count: number, arc: number, speedMul = 1): void {
    const s = this.projectileSpeed() * speedMul;
    for (let i = 0; i < count; i++) {
      const a = count === 1 ? 0 : -arc / 2 + (arc * i) / (count - 1);
      this.enemyShot(x, y, Math.sin(a) * s, Math.cos(a) * s);
    }
  }

  /** Telegraph a dangerous attack. */
  warn(w: Omit<Warning, 'max'> & { max?: number }): void {
    if (this.warnings.length >= MAX_WARNINGS) {
      this.warnings.shift();
    }
    this.warnings.push({ ...w, max: w.max ?? w.life });
  }

  /** Run `fn` after `delay` seconds of game time (cleared on level transitions and restarts). */
  later(delay: number, fn: () => void): void {
    this.scheduled.push({ t: delay, run: fn });
  }

  clearScheduled(): void {
    this.scheduled = [];
  }

  /** Small ability label floating above an enemy. */
  tag(e: Enemy, text: string, color?: string): void {
    if (!text) {
      return;
    }
    this.texts.push({ x: e.x, y: e.y - e.h / 2 - 6 * this.u, text, life: 0.8, max: 0.8, color: color ?? this.colorOf(e), size: 11 * this.u });
  }

  announce(text: string, sub = '', seconds = 1.6, color = '#ffffff'): void {
    this.banner = { text, sub, time: seconds, max: seconds, color };
  }

  colorOf(e: Enemy): string {
    return e.def?.color ?? KIND_COLORS[e.kind];
  }

  sfx(name: Sfx): void {
    this.hooks.sfx(name);
  }

  toast(text: string, tone?: 'info' | 'good' | 'bad'): void {
    this.hooks.toast(text, tone);
  }

  /** A player shot heading for `e` (used by dodging enemies). */
  incomingShot(e: Enemy, lookAhead = 0.35): boolean {
    for (const b of this.bullets) {
      if (b.enemy || b.vy >= 0) continue;
      const t = (b.y - e.y) / -b.vy;
      if (t > 0 && t < lookAhead && Math.abs(b.x + b.vx * t - e.x) < e.w / 2 + 6 * this.u) {
        return true;
      }
    }
    return false;
  }

  /** Tick an enemy's fire cooldown; true when it should attack now. Resets the cooldown. */
  fireReady(e: Enemy, dt: number, interval?: readonly [number, number]): boolean {
    const range = interval ?? e.def?.fire;
    if (!range || e.phased || !this.player.alive || e.y < 0 || e.y > this.H * 0.75) {
      return false;
    }
    e.fireCd -= dt * this.tuning.fireRate * (e.elite ? 1.2 : 1) * (e.mem.fireMul ?? 1);
    if (e.fireCd > 0) {
      return false;
    }
    e.fireCd = rand(range[0], range[1]) * this.tuning.cooldown;
    return true;
  }

  /** Ability cooldown scaled by difficulty. */
  cooldown(seconds: number): number {
    return seconds * this.tuning.cooldown;
  }

  /** Remove an enemy without reward (fled, retreated, cleaned up with its group). */
  removeEnemy(e: Enemy, effect = true): void {
    const idx = this.enemies.indexOf(e);
    if (idx < 0) {
      return;
    }
    this.enemies.splice(idx, 1);
    if (effect) {
      this.burst(e.x, e.y, this.colorOf(e), 10, 0.7);
      this.ring(e.x, e.y, this.colorOf(e), 30);
    }
    onEnemyRemoved(this, e, false);
  }

  /** Turn every enemy projectile into harmless sparks (before a boss fight). */
  resolveEnemyProjectiles(): void {
    for (const b of this.bullets) {
      if (b.enemy) {
        this.burst(b.x, b.y, '#ffffff', 2, 0.3);
      }
    }
    this.bullets = this.bullets.filter((b) => !b.enemy);
    this.warnings = [];
    this.hazards = [];
    this.scheduled = [];
  }

  // ------------------------------------------------------------------ enemies

  private updateEnemy(e: Enemy, dt: number): void {
    e.flash = Math.max(0, e.flash - dt * 6);
    if (this.power.freeze > 0) {
      return; // `break`: everything stands still
    }
    e.age += dt;
    e.shieldTimer = Math.max(0, e.shieldTimer - dt);
    e.exposed = Math.max(0, e.exposed - dt);
    e.showSig = Math.max(0, e.showSig - dt);
    if (e.mem.retreat) {
      // Leaving the field before a boss fight.
      e.y -= this.H * 0.6 * dt;
      if (e.y < -e.h * 2) {
        this.removeEnemy(e, false);
      }
      return;
    }
    if (e.role === 'boss') {
      return; // moved by the BossController
    }
    if (e.def) {
      BEHAVIORS[e.def.behavior].update(this, e, dt);
      e.x = clamp(e.x, e.w / 2, this.W - e.w / 2);
      return;
    }
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
      e.fireCd -= dt * this.tuning.fireRate;
      if (e.fireCd <= 0) {
        this.enemyFire(e);
      }
    }
  }

  private enemyFire(e: Enemy): void {
    const speed = this.projectileSpeed();
    const y = e.y + e.h / 2;
    switch (e.kind) {
      case 'class':
        this.fanShot(e.x, y, 3, 0.56);
        e.fireCd = rand(2.2, 3.2);
        break;
      case 'bug':
        this.aimedShot(e.x, y);
        e.fireCd = rand(1.7, 2.6);
        break;
      default:
        this.enemyShot(e.x, y, 0, speed * 0.9);
        e.fireCd = rand(2.6, 4.2);
    }
  }

  /** CombatSystem entry point: every hit on an enemy goes through here. */
  damageEnemy(e: Enemy, dmg: number, depth = 0): void {
    if (!this.enemies.includes(e)) {
      return;
    }
    const applied = absorbHit(this, e, dmg);
    if (applied <= 0) {
      return;
    }
    e.hp -= applied;
    e.flash = 1;
    this.score += 1;
    if (e.hp <= 0.001) {
      this.killEnemy(e, depth);
    } else {
      this.hooks.sfx('hit');
      this.burst(e.x, e.y + e.h / 2, this.colorOf(e), 5, 0.6);
      if (e.def) {
        BEHAVIORS[e.def.behavior].afterHit?.(this, e);
      }
    }
  }

  /** `depth` > 0 for enemies destroyed by another enemy's power (chain reactions are capped). */
  killEnemy(e: Enemy, depth = 0): void {
    const idx = this.enemies.indexOf(e);
    if (idx < 0) {
      return;
    }
    if (e.role === 'boss' && e.hp > 0) {
      // Bosses can't be one-shot by code powers; deal heavy damage instead.
      this.damageEnemy(e, 6, depth + 1);
      return;
    }
    this.enemies.splice(idx, 1);
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 1.6;
    const comboMul = 1 + Math.min(6, Math.floor(this.combo / 4)) * 0.5;
    const levelMul = 1 + (this.level - 1) * 0.1;
    const base = e.def ? e.def.points * (e.elite ? 1.5 : 1) * (1 + Math.max(0, e.maxHp - e.def.hp) * 0.08) : KIND_POINTS[e.kind] * e.maxHp ** 0.5;
    const points = e.role === 'boss' ? Math.round(1500 * this.level) : Math.round(base * levelMul * comboMul * (e.fresh ? 1.5 : 1));
    this.score += points;
    this.stats.kills++;
    if (!this.stats.toughest || e.maxHp > this.stats.toughest.hp) {
      this.stats.toughest = { label: e.spec.label, line: e.spec.line, hp: e.maxHp };
    }

    const color = this.colorOf(e);
    const big = e.kind === 'class' || e.kind === 'bug' || (e.def?.tier ?? 0) >= 3 || e.role === 'boss';
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
      this.shake = Math.max(this.shake, e.kind === 'class' || e.role === 'boss' ? 10 : 6);
    }
    this.hooks.sfx(big ? 'bigExplode' : 'explode');

    if (e.kind === 'bug' || e.kind === 'warning') {
      this.stats.bugsSquashed++;
      this.hooks.toast(`Squashed L${e.spec.line + 1}: ${e.spec.detail ?? 'bug'}`, 'good');
    }
    if (this.combo > 0 && this.combo % 10 === 0) {
      this.hooks.toast(`${this.combo}x COMBO!`, 'good');
    }

    onEnemyRemoved(this, e, true);
    if (e.def) {
      BEHAVIORS[e.def.behavior].onDeath?.(this, e);
    }
    if (e.role === 'boss') {
      this.levels.onBossDefeated(e);
      return;
    }

    if (e.power && depth < 2) {
      this.triggerCodePower(e, depth);
    } else {
      // Ordinary power-up drops.
      const chance = e.def ? e.def.drop : e.kind === 'class' ? 1 : e.kind === 'bug' ? 0.3 : 0.06;
      if (Math.random() < chance) {
        this.dropPowerUp(e.x, e.y);
      }
    }
  }

  dropPowerUp(x: number, y: number): void {
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
        if (label === 'if' || e.unit === 'if' || Math.random() < 0.6) {
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
            b.kind = 'shot';
            b.fuse = undefined;
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
      if (other === e || other.phased || (other.x - e.x) * dir <= 0 || other.y < -other.h / 2) {
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

  hitPlayer(): void {
    const p = this.player;
    if (!p.alive || p.invulnerable > 0 || this.lives <= 0) {
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
  flash(x: number, y: number, color: string, radius: number): void {
    if (this.particles.length < MAX_PARTICLES) {
      this.particles.push({ x, y, vx: 0, vy: 0, life: 0.22, max: 0.22, color, size: radius * this.u, type: 'flash' });
    }
  }

  ring(x: number, y: number, color: string, radius: number): void {
    if (this.particles.length < MAX_PARTICLES) {
      this.particles.push({ x, y, vx: 0, vy: 0, life: 0.45, max: 0.45, color, size: radius * this.u, type: 'ring' });
    }
  }

  beam(x: number, y: number, x2: number, y2: number, color: string): void {
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
        color: this.colorOf(e),
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
    this.banner.time = Math.max(0, this.banner.time - dt);
    /** Enemy time runs slower during `await`. */
    const edt = this.power.slow > 0 ? dt * 0.35 : dt;
    const frozen = this.power.freeze > 0;

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
        this.hazards = [];
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

    // Scheduled (telegraphed) actions run on enemy time and pause while frozen.
    if (!frozen && this.scheduled.length > 0) {
      const due: Scheduled[] = [];
      for (const s of this.scheduled) {
        s.t -= edt;
        if (s.t <= 0) due.push(s);
      }
      if (due.length > 0) {
        this.scheduled = this.scheduled.filter((s) => s.t > 0);
        for (const s of due) s.run();
      }
    }

    // Level flow: waves, boss encounters, level clear (LevelManager).
    if (this.lives > 0) {
      this.levels.update(dt, edt);
    }
    if (this.state !== 'playing') {
      return; // victory
    }

    // Enemies.
    for (const e of [...this.enemies]) {
      if (!this.enemies.includes(e)) {
        continue; // destroyed by a chain reaction this frame
      }
      this.updateEnemy(e, edt);
      if (!this.enemies.includes(e)) {
        continue;
      }
      if (e.mem.fleeing && e.y < -e.h) {
        // `return`: it got away with its points.
        this.stats.returned++;
        this.hooks.toast(`${e.spec.label} returned early — its points escaped`, 'info');
        this.removeEnemy(e, false);
        continue;
      }
      if (e.y - e.h / 2 > this.H) {
        if (ATTACHED_ROLES.has(e.role) && this.byUid(e.parentUid)) {
          continue; // attached units leave with their leader; they don't "escape" on their own
        }
        this.enemies.splice(this.enemies.indexOf(e), 1);
        onEnemyRemoved(this, e, false);
        this.stats.escaped++;
        this.hooks.sfx('escape');
        this.hooks.toast(`L${e.spec.line + 1} shipped to production!`, 'bad');
        if (p.alive && !this.protectedNow) {
          this.hitPlayer();
        } else if (p.alive) {
          // Protected players still pay for escaped code.
          this.lives = Math.max(0, this.lives - 1);
          if (this.lives === 0) {
            p.alive = false;
            this.burst(p.x, p.y, '#7df9ff', 60, 1.8);
            this.gameOverDelay = 1.2;
          }
        }
        continue;
      }
      if (!e.phased && p.alive && Math.abs(e.x - p.x) < e.w / 2 + 16 * u && Math.abs(e.y - p.y) < e.h / 2 + 16 * u) {
        this.hitPlayer();
        this.damageEnemy(e, this.power.loop > 0 ? 99 : 3);
      }
    }

    // Bullets.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b) continue;
      const bdt = b.enemy ? edt : dt;
      if (!(b.enemy && frozen)) {
        b.x += b.vx * bdt;
        b.y += b.vy * bdt;
        if (b.enemy && b.fuse !== undefined) {
          b.fuse -= bdt;
          if (b.fuse <= 0) {
            this.resolvePending(b);
            this.bullets.splice(i, 1);
            continue;
          }
        }
      }
      if (b.y < -30 || b.y > this.H + 30 || b.x < -30 || b.x > this.W + 30) {
        this.bullets.splice(i, 1);
        continue;
      }
      if (b.enemy) {
        const r = b.r ?? 0;
        if (p.alive && Math.abs(b.x - p.x) < 15 * u + r && Math.abs(b.y - p.y) < 16 * u + r) {
          this.bullets.splice(i, 1);
          this.hitPlayer();
        }
        continue;
      }
      for (const e of this.enemies) {
        if (e.phased) continue;
        if (Math.abs(b.x - e.x) < e.w / 2 + 3 && Math.abs(b.y - e.y) < e.h / 2 + 6) {
          this.bullets.splice(i, 1);
          this.stats.hits++;
          this.damageEnemy(e, b.dmg);
          break;
        }
      }
    }

    // Hazards (boss beams): harmless while the warning shows.
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hz = this.hazards[i];
      if (hz.warn > 0) {
        if (!frozen) hz.warn -= edt;
        continue;
      }
      hz.life -= edt;
      if (hz.life <= 0) {
        this.hazards.splice(i, 1);
      } else if (p.alive && Math.abs(p.x - hz.x) < hz.w / 2 + 10 * u) {
        this.hitPlayer();
      }
    }
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      if (!frozen) w.life -= edt;
      if (w.life <= 0) this.warnings.splice(i, 1);
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
  }

  /** Promise projectile resolves: a small, clearly signalled follow-up burst. */
  private resolvePending(b: Bullet): void {
    const n = Math.max(1, Math.min(6, b.frags ?? 3));
    this.ring(b.x, b.y, '#ff55aa', 40);
    const s = this.projectileSpeed() * 0.55;
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + (k - (n - 1) / 2) * 0.55;
      this.enemyShot(b.x, b.y, Math.cos(a) * s, Math.sin(a) * s, { kind: 'fragment' });
    }
  }

  /** Called by the level manager when the game is won. */
  win(signature: string): void {
    this.state = 'victory';
    this.hiScore = Math.max(this.hiScore, this.score);
    this.input.left = this.input.right = this.input.fire = false;
    this.hooks.sfx('victory');
    if (this.hooks.victory) {
      this.hooks.victory(this.score, signature);
    } else {
      this.hooks.gameOver(this.score, this.level);
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
