/**
 * Retro boss encounters, one per level, and the BossController that runs them.
 * Bosses come from the progression system (level → boss), not from the normal enemy pool, and take
 * their names and signatures from the code you're editing.
 */
import type { CodeSnapshot, EnemySpec } from '../shared/protocol';
import type { Enemy, Game } from './game';
import { LIMITS } from './enemies/definitions';

export type BossId = 'loop' | 'hydra' | 'overlord' | 'phantom' | 'runtime';
export type BossMove = 'sweep' | 'figure8' | 'dart' | 'hover' | 'drift';
export type BossAttack = 'spread' | 'aimed' | 'burst' | 'wave' | 'ring' | 'rain' | 'beam' | 'delayed' | 'teleport' | 'heads' | 'modules';

export interface BossPhase {
  name: string;
  /** The phase lasts while hp / maxHp is above this fraction. */
  until: number;
  move: BossMove;
  /** Movement speed multiplier. */
  speed: number;
  /** Seconds between attacks (before difficulty scaling). */
  interval: number;
  /** Attacks used in rotation — predictable, so the player can learn them. */
  attacks: BossAttack[];
}

export interface BossDefinition {
  id: BossId;
  level: number;
  title: string;
  tagline: string;
  /** Hit points before the difficulty multiplier. */
  hp: number;
  color: string;
  retroColor: string;
  phases: BossPhase[];
  /** Short label painted on the boss. */
  label(snapshot: CodeSnapshot | undefined): string;
  /** Source-code signature shown in the intro and on the victory screen. */
  signature(snapshot: CodeSnapshot | undefined): string;
}

/** Hydra / Runtime Error head limits. */
export const BOSS_LIMITS = { headsAlive: 3, headsTotal: 9, moduleRespawns: 2, moduleDowntime: 10 } as const;

function find(snapshot: CodeSnapshot | undefined, pred: (s: EnemySpec) => boolean): EnemySpec | undefined {
  return snapshot?.specs.find(pred);
}

function deepestLoop(snapshot: CodeSnapshot | undefined): EnemySpec | undefined {
  const loops = (snapshot?.specs ?? []).filter((s) => s.archetype === 'for' || s.archetype === 'while');
  return loops.sort((a, b) => (b.construct?.nesting ?? 1) - (a.construct?.nesting ?? 1))[0];
}

export const BOSS_DEFS: readonly BossDefinition[] = [
  {
    id: 'loop',
    level: 1,
    title: 'THE INFINITE LOOP',
    tagline: 'it never terminates',
    hp: 60,
    color: '#ff9f1c',
    retroColor: '#ffff55',
    phases: [
      { name: 'basic projectiles', until: 0.66, move: 'sweep', speed: 0.5, interval: 1.5, attacks: ['spread', 'aimed'] },
      { name: 'repeating waves', until: 0.33, move: 'figure8', speed: 0.7, interval: 1.7, attacks: ['wave', 'spread'] },
      { name: 'overclocked', until: 0, move: 'dart', speed: 1.3, interval: 0.95, attacks: ['aimed', 'wave', 'ring'] },
    ],
    label: (s) => (deepestLoop(s)?.archetype === 'while' ? 'while' : 'for'),
    signature: (s) => {
      const loop = deepestLoop(s);
      if (!loop) return 'while (true) { }';
      return loop.archetype === 'for' ? `for (${loop.construct?.signature ?? ';;'})` : `while (${loop.construct?.signature ?? 'true'})`;
    },
  },
  {
    id: 'hydra',
    level: 2,
    title: 'THE RECURSIVE HYDRA',
    tagline: 'cut one head, two calls return',
    hp: 70,
    color: '#ff6ec7',
    retroColor: '#ff55ff',
    phases: [
      { name: 'fork', until: 0.6, move: 'hover', speed: 0.5, interval: 1.8, attacks: ['heads', 'spread'] },
      { name: 'stack grows', until: 0.25, move: 'sweep', speed: 0.7, interval: 1.6, attacks: ['heads', 'aimed', 'spread'] },
      { name: 'stack overflow', until: 0, move: 'dart', speed: 1.1, interval: 1.15, attacks: ['heads', 'burst', 'ring'] },
    ],
    label: (s) => (find(s, (x) => x.archetype === 'recursive')?.construct?.name ?? 'recurse').slice(0, 8) + '()',
    signature: (s) => {
      const r = find(s, (x) => x.archetype === 'recursive');
      const name = r?.construct?.name ?? 'recurse';
      const p = r?.construct?.params?.[0] ?? 'n';
      return `${name}(${p} - 1)`;
    },
  },
  {
    id: 'overlord',
    level: 3,
    title: 'THE CLASS OVERLORD',
    tagline: 'heavily armoured, many methods',
    hp: 90,
    color: '#ffcc33',
    retroColor: '#ff5555',
    phases: [
      { name: 'constructor', until: 0.6, move: 'sweep', speed: 0.4, interval: 1.6, attacks: ['modules'] },
      { name: 'inheritance', until: 0.3, move: 'sweep', speed: 0.6, interval: 1.4, attacks: ['modules', 'beam'] },
      { name: 'polymorphism', until: 0, move: 'figure8', speed: 0.9, interval: 1.1, attacks: ['modules', 'ring', 'aimed'] },
    ],
    label: (s) => (find(s, (x) => x.archetype === 'class')?.construct?.name ?? find(s, (x) => x.kind === 'class')?.label ?? 'God').slice(0, 10),
    signature: (s) => {
      const c = find(s, (x) => x.archetype === 'class');
      const methods = c?.construct?.methods?.slice(0, 2).map((m) => `${m}()`).join(' ');
      return `class ${c?.construct?.name ?? 'God'} { ${methods ?? 'everything()'} }`;
    },
  },
  {
    id: 'phantom',
    level: 4,
    title: 'THE ASYNC PHANTOM',
    tagline: 'you never know when it resolves',
    hp: 90,
    color: '#9d4edd',
    retroColor: '#aa88ff',
    phases: [
      { name: 'pending', until: 0.6, move: 'hover', speed: 0.5, interval: 2, attacks: ['teleport', 'delayed'] },
      { name: 'race condition', until: 0.3, move: 'drift', speed: 0.7, interval: 1.7, attacks: ['delayed', 'teleport', 'aimed'] },
      { name: 'deadlock', until: 0, move: 'drift', speed: 1, interval: 1.35, attacks: ['teleport', 'delayed', 'beam'] },
    ],
    label: () => 'async',
    signature: (s) => {
      const a = find(s, (x) => x.archetype === 'async');
      return a?.construct?.name ? `await ${a.construct.name}()` : `await ${a?.label.replace(/^await\s*/, '') || 'forever()'}`;
    },
  },
  {
    id: 'runtime',
    level: 5,
    title: 'THE RUNTIME ERROR',
    tagline: 'every bug you ever shipped',
    hp: 160,
    color: '#ff3864',
    retroColor: '#ff3333',
    phases: [
      { name: 'infinite loop', until: 0.75, move: 'sweep', speed: 0.7, interval: 1.3, attacks: ['wave', 'spread'] },
      { name: 'stack overflow', until: 0.5, move: 'hover', speed: 0.6, interval: 1.4, attacks: ['heads', 'aimed'] },
      { name: 'race condition', until: 0.25, move: 'drift', speed: 0.8, interval: 1.3, attacks: ['teleport', 'delayed'] },
      { name: 'segmentation fault', until: 0, move: 'dart', speed: 1.2, interval: 1, attacks: ['beam', 'ring', 'rain', 'burst'] },
    ],
    label: () => 'ERROR',
    signature: (s) => find(s, (x) => x.kind === 'bug')?.detail ?? 'TypeError: undefined is not a function',
  },
];

export const FINAL_LEVEL = BOSS_DEFS.length;

export function bossForLevel(level: number): BossDefinition {
  return BOSS_DEFS[Math.max(0, Math.min(BOSS_DEFS.length - 1, level - 1))];
}

interface ModuleSlot {
  label: string;
  uid?: number;
  /** Seconds until a destroyed module comes back (0 = active or never destroyed). */
  down: number;
  respawns: number;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export class BossController {
  phaseIndex = 0;
  entering = true;
  headsSpawned = 0;
  readonly modules: ModuleSlot[] = [];
  readonly label: string;
  readonly signature: string;
  private attackTimer = 1.4;
  private cursor = 0;
  private t = 0;
  private dartX = 0;
  private dartT = 0;
  private teleporting = false;

  constructor(
    private readonly g: Game,
    readonly def: BossDefinition,
    readonly enemy: Enemy,
  ) {
    this.label = def.label(g.snapshot);
    this.signature = def.signature(g.snapshot);
    this.dartX = g.W / 2;
    enemy.shieldTimer = 99; // invulnerable while entering
  }

  get phase(): BossPhase {
    return this.def.phases[this.phaseIndex];
  }

  get alive(): boolean {
    return this.g.enemies.includes(this.enemy);
  }

  private targetY(): number {
    return this.g.H * 0.25;
  }

  update(dt: number): void {
    const g = this.g;
    const e = this.enemy;
    if (!this.alive) {
      return;
    }
    this.t += dt;
    if (this.entering) {
      e.y += g.H * 0.16 * dt;
      e.x = e.baseX = g.W / 2;
      if (e.y >= this.targetY()) {
        e.y = this.targetY();
        this.entering = false;
        e.shieldTimer = 0;
        if (this.def.id === 'overlord') this.spawnModules();
      }
      return;
    }
    if (g.power.freeze > 0) {
      return;
    }

    // Phase transitions: visible health thresholds.
    while (this.phaseIndex < this.def.phases.length - 1 && e.hp / e.maxHp <= this.phase.until) {
      this.phaseIndex++;
      e.shieldTimer = 0.9;
      this.attackTimer = 1.2;
      this.cursor = 0;
      g.announce(`PHASE ${this.phaseIndex + 1}`, this.phase.name.toUpperCase(), 1.6, this.def.color);
      g.sfx('bossPhase');
      g.shake = Math.max(g.shake, 8);
      g.ring(e.x, e.y, '#ffffff', 140);
    }

    if (!this.teleporting) {
      this.move(dt);
    }
    this.updateArmor();
    this.updateModules(dt);

    this.attackTimer -= dt * Math.sqrt(g.tuning.fireRate);
    if (this.attackTimer <= 0 && g.player.alive && !this.teleporting) {
      const attacks = this.phase.attacks;
      this.attack(attacks[this.cursor % attacks.length]);
      this.cursor++;
      this.attackTimer = this.phase.interval * g.tuning.cooldown;
    }
  }

  private move(dt: number): void {
    const g = this.g;
    const e = this.enemy;
    const s = this.phase.speed;
    const ty = this.targetY();
    const margin = e.w / 2 + 10 * g.u;
    switch (this.phase.move) {
      case 'sweep':
        e.x = g.W / 2 + Math.sin(this.t * s) * (g.W / 2 - margin) * 0.75;
        e.y = ty + Math.sin(this.t * s * 2) * 10 * g.u;
        break;
      case 'figure8':
        e.x = g.W / 2 + Math.sin(this.t * s) * (g.W / 2 - margin) * 0.7;
        e.y = ty + Math.sin(this.t * s * 2) * g.H * 0.06;
        break;
      case 'dart':
        this.dartT -= dt;
        if (this.dartT <= 0) {
          this.dartT = 1.3 / s;
          this.dartX = rand(margin, g.W - margin);
        }
        e.x += clamp(this.dartX - e.x, -1, 1) * Math.min(Math.abs(this.dartX - e.x), 420 * g.u * s * dt);
        e.y = ty + Math.sin(this.t * 3) * 6 * g.u;
        break;
      case 'hover':
        e.x += clamp(g.player.x - e.x, -1, 1) * Math.min(Math.abs(g.player.x - e.x), 70 * g.u * s * dt);
        e.y = ty + Math.sin(this.t * 1.5) * 8 * g.u;
        break;
      case 'drift':
        e.x = g.W / 2 + Math.sin(this.t * 0.5 * s) * (g.W / 2 - margin) * 0.6 + Math.sin(this.t * 1.7 * s) * 30 * g.u;
        e.y = ty + Math.sin(this.t * 0.9 * s) * g.H * 0.05;
        break;
    }
    e.x = clamp(e.x, margin, g.W - margin);
    e.baseX = e.x;
  }

  private heads(): Enemy[] {
    return this.g.childrenOf(this.enemy).filter((c) => c.role === 'head');
  }

  private activeModules(): Enemy[] {
    return this.g.childrenOf(this.enemy).filter((c) => c.role === 'module');
  }

  private updateArmor(): void {
    const e = this.enemy;
    if (this.phase.attacks.includes('heads')) {
      const heads = this.heads().length;
      e.armor = heads > 0 ? 0.25 : 1;
      e.badge = heads > 0 ? `${heads} HEADS` : 'EXPOSED';
    } else if (this.def.id === 'overlord') {
      const n = this.activeModules().length;
      e.armor = n > 0 ? 0.35 : 1;
      e.badge = n > 0 ? 'ARMORED' : 'ARMOR DOWN';
    } else {
      e.armor = 1;
      e.badge = this.phase.name.toUpperCase();
    }
  }

  // ---------------------------------------------------------------- parts

  private spawnModules(): void {
    const methods = this.g.snapshot?.specs.find((s) => s.archetype === 'class')?.construct?.methods ?? [];
    const labels = [0, 1, 2].map((k) => (methods[k] ?? ['init', 'update', 'render'][k]).slice(0, 7) + '()');
    for (let k = 0; k < 3; k++) {
      this.modules.push({ label: labels[k], down: 0, respawns: 0 });
      this.spawnModule(k);
    }
  }

  private spawnModule(k: number): void {
    const g = this.g;
    const e = this.enemy;
    const slot = this.modules[k];
    const ox = (k - 1) * e.w * 0.42;
    const oy = e.h * 0.45 + (k === 1 ? 10 : 0) * g.u;
    const m = g.spawnUnit('module', {
      parent: e,
      role: 'module',
      label: slot.label,
      hp: Math.round(6 * g.tuning.bossHp),
      mem: { ox, oy, slot: k },
    });
    if (m) {
      m.x = e.x + ox;
      m.y = e.y + oy;
      slot.uid = m.uid;
      slot.down = 0;
    }
  }

  private updateModules(dt: number): void {
    this.modules.forEach((slot, k) => {
      if (slot.down > 0) {
        slot.down -= dt;
        if (slot.down <= 0) {
          slot.down = 0;
          slot.respawns++;
          this.spawnModule(k);
          this.g.tag(this.enemy, `${slot.label} RESTORED`, this.def.color);
        }
      }
    });
  }

  /** A head or module was destroyed (or removed). */
  onPartLost(part: Enemy, killed: boolean): void {
    if (part.role === 'module' && killed) {
      const slot = this.modules[part.mem.slot ?? -1];
      if (slot) {
        slot.uid = undefined;
        // Disabled for a while: that attack leaves the rotation. Only a limited number of repairs.
        slot.down = slot.respawns < BOSS_LIMITS.moduleRespawns ? BOSS_LIMITS.moduleDowntime : 0;
        this.g.tag(part, `${slot.label} DISABLED`, '#ffffff');
      }
    }
  }

  // ---------------------------------------------------------------- attacks

  private attack(kind: BossAttack): void {
    const g = this.g;
    const e = this.enemy;
    const y = e.y + e.h / 2;
    const tele = LIMITS.minTelegraph;
    const alive = (): boolean => this.alive && !e.phased;
    switch (kind) {
      case 'spread':
        g.fanShot(e.x, y, 5, 1, 0.85);
        break;
      case 'aimed':
        for (const off of [-0.1, 0, 0.1]) {
          g.aimedShot(e.x, y, 0.9, { x: g.player.x + off * g.W, y: g.player.y });
        }
        break;
      case 'burst':
        for (let k = 0; k < 4; k++) g.later(k * 0.14, () => alive() && g.aimedShot(e.x, y, 1.1));
        break;
      case 'wave': {
        // A full row of shots with one gap — the gap is marked before it fires.
        const gapX = clamp(g.player.x + rand(-0.25, 0.25) * g.W, 80 * g.u, g.W - 80 * g.u);
        const gapHalf = 60 * g.u;
        g.warn({ kind: 'row', x: g.W / 2, y, x2: gapX, r: gapHalf, life: tele + 0.1, color: this.def.color, label: 'loop' });
        g.later(tele + 0.1, () => {
          if (!alive()) return;
          const step = 46 * g.u;
          for (let x = step / 2; x < g.W; x += step) {
            if (Math.abs(x - gapX) > gapHalf) g.enemyShot(x, y, 0, g.projectileSpeed() * 0.7);
          }
        });
        break;
      }
      case 'ring':
        g.warn({ kind: 'circle', x: e.x, y: e.y, r: e.w * 0.6, life: tele, color: this.def.color });
        g.later(tele, () => {
          if (!alive()) return;
          const s = g.projectileSpeed() * 0.65;
          for (let k = 0; k < 14; k++) {
            const a = (k / 14) * Math.PI * 2 + this.t;
            if (Math.sin(a) > -0.3) g.enemyShot(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s);
          }
        });
        break;
      case 'rain': {
        const cols = [g.player.x, rand(0.1, 0.9) * g.W, rand(0.1, 0.9) * g.W];
        for (const x of cols) {
          g.warn({ kind: 'column', x, y: 0, r: 12 * g.u, life: tele + 0.3, color: this.def.color });
          g.later(tele + 0.3, () => alive() && g.enemyShot(x, 0, 0, g.projectileSpeed() * 1.1));
        }
        break;
      }
      case 'beam':
        // Column laser at your position: harmless while it flashes, then fires briefly.
        g.hazards.push({ x: g.player.x, w: 30 * g.u, warn: tele + 0.3, life: 0.45, color: this.def.color });
        g.sfx('warning');
        break;
      case 'delayed': {
        // Delayed projectiles: circles mark where they'll resolve.
        const px = g.player.x;
        const py = g.player.y - 40 * g.u;
        for (const dx of [-110, 0, 110]) {
          const x = clamp(px + dx * g.u, 20, g.W - 20);
          g.warn({ kind: 'circle', x, y: py, r: 26 * g.u, life: 1.1, color: this.def.color, label: 'await' });
          g.later(1.1, () => {
            if (!this.alive) return;
            const s = g.projectileSpeed() * 0.45;
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * Math.PI * 2;
              g.enemyShot(x, py, Math.cos(a) * s, Math.sin(a) * s, { kind: 'fragment' });
            }
          });
        }
        g.sfx('warning');
        break;
      }
      case 'teleport': {
        this.teleporting = true;
        e.phased = true;
        const margin = e.w / 2 + 10 * g.u;
        const toX = rand(margin, g.W - margin);
        const toY = this.targetY() + rand(-0.04, 0.08) * g.H;
        g.warn({ kind: 'marker', x: toX, y: toY, r: e.w * 0.45, life: 0.9, color: this.def.color, label: 'resolving' });
        g.sfx('warp');
        g.later(0.9, () => {
          this.teleporting = false;
          e.phased = false;
          e.x = e.baseX = toX;
          e.y = toY;
          g.ring(toX, toY, this.def.color, 120);
        });
        break;
      }
      case 'heads': {
        const maxAlive = Math.min(BOSS_LIMITS.headsAlive, 1 + this.phaseIndex + (this.def.id === 'hydra' ? 1 : 0));
        const heads = this.heads();
        if (heads.length >= maxAlive || this.headsSpawned >= BOSS_LIMITS.headsTotal) {
          g.fanShot(e.x, y, 3, 0.6, 0.85);
          break;
        }
        const gen = this.headsSpawned;
        const side = gen % 2 === 0 ? -1 : 1;
        const h = g.spawnUnit('head', {
          parent: e,
          role: 'head',
          label: `${this.label.replace(/\(\)$/, '')}(n-${1 + Math.floor(gen / 2)})`.slice(0, 10),
          // Each new head is weaker than the last.
          hp: Math.max(2, Math.round((4 - Math.floor(gen / 3)) * g.tuning.bossHp)),
          scale: Math.max(0.7, 1 - gen * 0.04),
          mem: { ox: side * (e.w * 0.55 + (gen % 3) * 14 * g.u), oy: e.h * 0.3 + (gen % 3) * 18 * g.u },
        });
        if (h) {
          this.headsSpawned++;
          g.tag(e, 'RECURSE', this.def.color);
          g.sfx('summon');
        }
        break;
      }
      case 'modules': {
        const active = this.activeModules();
        if (active.length === 0) {
          g.aimedShot(e.x, y, 0.8); // reduced capability while every module is disabled
          break;
        }
        for (const m of active) {
          const slot = m.mem.slot ?? 0;
          const my = m.y + m.h / 2;
          if (slot === 0) g.fanShot(m.x, my, 3, 0.5, 0.85);
          else if (slot === 1) g.aimedShot(m.x, my, 0.95);
          else {
            const x = g.player.x;
            g.warn({ kind: 'column', x, y: 0, r: 12 * g.u, life: tele + 0.2, color: this.def.color });
            g.later(tele + 0.2, () => this.alive && g.enemyShot(x, my, 0, g.projectileSpeed() * 1.05));
          }
        }
        break;
      }
    }
  }
}
