/**
 * EnemyBehavior implementations, one per `BehaviorId`. Each behaviour reads its tuning from the
 * enemy's definition (`e.def.cfg`) and talks to the game only through the small public helper API on
 * `Game` (shots, warnings, support units, tags), so it can be tested headlessly.
 *
 * Movement is in CSS pixels; `g.u` scales distances with the viewport.
 */
import type { Enemy, Game } from '../game';
import { ENEMY_DEFS, LIMITS } from './definitions';

export interface Behavior {
  init?(g: Game, e: Enemy): void;
  update(g: Game, e: Enemy, dt: number): void;
  /** After a hit that the enemy survived. */
  afterHit?(g: Game, e: Enemy): void;
  onDeath?(g: Game, e: Enemy): void;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const cfg = (e: Enemy, key: string, fallback = 0): number => e.def?.cfg[key] ?? fallback;

function sway(e: Enemy, freq = 1.3, ampMul = 1): void {
  e.x = e.baseX + Math.sin(e.age * freq + e.phase) * e.amp * ampMul;
}

function descend(e: Enemy, dt: number, mul = 1): void {
  e.y += e.vy * dt * mul;
}

/** Move `baseX` toward `x` at most `speed` px/s. */
function steer(e: Enemy, x: number, speed: number, dt: number): void {
  const d = x - e.baseX;
  e.baseX += clamp(d, -speed * dt, speed * dt);
}

function bottom(e: Enemy): number {
  return e.y + e.h / 2;
}

/** Plain straight-down shot. */
function shootDown(g: Game, e: Enemy, speedMul = 0.9): void {
  g.enemyShot(e.x, bottom(e), 0, g.projectileSpeed() * speedMul);
}

const branch: Behavior = {
  init(_g, e) {
    e.mem.side = Math.random() < 0.5 ? -1 : 1;
  },
  update(g, e, dt) {
    const p = g.player;
    // The condition: is the player to my right? Each branch flanks a different side.
    const cond = p.x > e.x ? 1 : -1;
    if (cond !== e.mem.cond) {
      const flipped = e.mem.cond !== undefined;
      e.mem.cond = cond;
      e.badge = cond > 0 ? 'TRUE' : 'FALSE';
      e.mem.dodgeCd = Math.max(0, e.mem.dodgeCd ?? 0);
      if (flipped && (e.mem.dodgeCd ?? 0) <= 0 && g.incomingShot(e)) {
        // The condition changed with a shot on its way: take the other branch.
        e.baseX = clamp(e.baseX - cond * cfg(e, 'dodgeDistance', 70) * g.u, e.w / 2, g.W - e.w / 2);
        e.mem.dodgeCd = g.cooldown(cfg(e, 'dodgeCooldown', 2.8));
        g.tag(e, e.def?.tag ?? 'ELSE!');
      }
    }
    e.mem.dodgeCd = (e.mem.dodgeCd ?? 0) - dt;
    if (p.alive) {
      const target = p.x - cond * g.W * cfg(e, 'offset', 0.16);
      steer(e, target, cfg(e, 'steer', 150) * g.u, dt);
    }
    e.x = e.baseX + Math.sin(e.age * 3 + e.phase) * 6 * g.u;
    descend(e, dt);
    if (g.fireReady(e, dt)) {
      shootDown(g, e);
    }
  },
};

const burst: Behavior = {
  update(g, e, dt) {
    sway(e, 1.8, 0.8);
    descend(e, dt);
    if (g.fireReady(e, dt)) {
      // Two shots that land together — side by side, same speed.
      const gap = cfg(e, 'spread', 14) * g.u;
      const s = g.projectileSpeed();
      g.enemyShot(e.x - gap / 2, bottom(e), 0, s);
      g.enemyShot(e.x + gap / 2, bottom(e), 0, s);
      if (e.spec.construct?.combo) {
        // `&&` and `||` together: the combination also fires an aimed pair.
        for (let k = 0; k < cfg(e, 'comboShots', 2); k++) {
          g.later(0.18 * (k + 1), () => {
            if (g.enemies.includes(e)) g.aimedShot(e.x, bottom(e), 0.9);
          });
        }
      }
    }
  },
};

const split: Behavior = {
  update(g, e, dt) {
    sway(e, 1.4);
    descend(e, dt);
    if (g.fireReady(e, dt)) {
      // `||`: alternate attack patterns.
      e.mem.alt = ((e.mem.alt ?? 0) + 1) % 2;
      if (e.mem.alt) g.aimedShot(e.x, bottom(e), 0.85);
      else g.fanShot(e.x, bottom(e), 2, 0.5, 0.9);
    }
  },
  afterHit(g, e) {
    if (e.mem.split || e.role === 'half' || Math.random() > cfg(e, 'splitChance', 0.75)) {
      e.mem.split = 1;
      return;
    }
    e.mem.split = 1;
    const parts = e.spec.label.split('||').map((s) => s.trim()).filter(Boolean);
    const halves = Math.max(2, Math.min(2, cfg(e, 'halves', 2)));
    for (let k = 0; k < halves; k++) {
      const side = k === 0 ? -1 : 1;
      g.spawnUnit('half', {
        role: 'half',
        label: (parts[k] ?? (k === 0 ? 'a' : 'b')).slice(0, 6),
        x: clamp(e.x + side * 26 * g.u, 20, g.W - 20),
        y: e.y,
        mem: { drift: side },
      });
    }
    g.tag(e, e.def?.tag ?? 'SPLIT');
    g.sfx('summon');
    g.removeEnemy(e, true);
  },
};

const dash: Behavior = {
  init(g, e) {
    e.mem.cd = g.cooldown(cfg(e, 'cooldown', 2.8)) * rand(0.4, 0.9);
  },
  update(g, e, dt) {
    descend(e, dt, e.mem.state === 2 ? 0.3 : 1);
    if (e.mem.state === 1) {
      // Wind-up: the dash target is already marked.
      e.mem.t -= dt;
      e.windup = 1 - e.mem.t / cfg(e, 'windup', 0.6);
      if (e.mem.t <= 0) {
        e.mem.state = 2;
        e.mem.t = cfg(e, 'dashTime', 0.32);
        e.mem.fromX = e.baseX;
        e.windup = 0;
      }
    } else if (e.mem.state === 2) {
      e.mem.t -= dt;
      const k = 1 - Math.max(0, e.mem.t) / cfg(e, 'dashTime', 0.32);
      e.baseX = e.mem.fromX + (e.mem.toX - e.mem.fromX) * k;
      if (e.mem.t <= 0) {
        e.mem.state = 0;
        e.mem.cd = g.cooldown(cfg(e, 'cooldown', 2.8));
        if (e.y > 0 && e.y < g.H * 0.75 && g.player.alive) {
          g.aimedShot(e.x, bottom(e), 1);
        }
      }
    } else {
      e.mem.cd -= dt;
      if (e.mem.cd <= 0 && e.y > 0 && e.y < g.H * 0.7) {
        const toward = g.player.x + rand(-0.2, 0.2) * g.W;
        e.mem.toX = clamp(toward, e.w / 2 + 8, g.W - e.w / 2 - 8);
        e.mem.state = 1;
        e.mem.t = cfg(e, 'windup', 0.6);
        g.warn({ kind: 'line', x: e.x, y: e.y, x2: e.mem.toX, y2: e.y, r: 3 * g.u, life: e.mem.t, color: g.colorOf(e), label: '=>' });
        g.tag(e, e.def?.tag ?? 'DASH');
      }
    }
    e.x = e.baseX;
  },
};

const flee: Behavior = {
  update(g, e, dt) {
    sway(e, 1.2);
    if (e.mem.fleeing) {
      e.y -= g.H * cfg(e, 'fleeSpeed', 0.34) * dt;
      e.badge = 'RETURN';
      return;
    }
    descend(e, dt);
    if (g.fireReady(e, dt)) {
      shootDown(g, e);
    }
  },
  afterHit(g, e) {
    if (!e.mem.fleeing) {
      e.mem.fleeing = 1;
      g.tag(e, e.def?.tag ?? 'RETURN');
    }
  },
};

const summoner: Behavior = {
  init(g, e) {
    e.mem.summonCd = g.cooldown(cfg(e, 'summonCooldown', 5)) * 0.4;
  },
  update(g, e, dt) {
    sway(e, 1.1);
    descend(e, dt);
    if (g.fireReady(e, dt)) {
      // Predictable: the same fan every time, on a fixed rhythm.
      g.fanShot(e.x, bottom(e), cfg(e, 'fan', 3), cfg(e, 'angle', 0.3) * 2, 0.85);
    }
    e.mem.summonCd -= dt;
    if (e.mem.summonCd <= 0 && e.y > 0 && e.y < g.H * 0.6) {
      e.mem.summonCd = g.cooldown(cfg(e, 'summonCooldown', 5));
      const params = e.spec.construct?.params ?? [];
      const max = Math.min(LIMITS.maxMinionsPerLeader, Math.max(1, Math.min(params.length || 1, cfg(e, 'summons', 2))));
      const alive = g.childrenOf(e).filter((c) => c.role === 'minion').length;
      if (alive < max) {
        const label = params[(e.mem.summoned ?? 0) % Math.max(1, params.length)] ?? 'arg';
        const side = alive % 2 === 0 ? -1 : 1;
        if (g.spawnUnit('minion', { parent: e, role: 'minion', label, mem: { ox: side * (e.w / 2 + 16 * g.u), oy: 18 * g.u } })) {
          e.mem.summoned = (e.mem.summoned ?? 0) + 1;
          g.tag(e, `${e.def?.tag ?? 'CALL'} ${label}`);
          g.sfx('summon');
        }
      }
    }
  },
};

const lane: Behavior = {
  init(g, e) {
    e.mem.laneY = g.H * rand(cfg(e, 'laneMin', 0.16), cfg(e, 'laneMax', 0.42));
    e.shield = e.shieldMax = cfg(e, 'shield', 3);
    e.mem.hold = cfg(e, 'hold', 12);
  },
  update(g, e, dt) {
    if (e.y < e.mem.laneY) {
      descend(e, dt, 1.4);
    } else if (e.mem.hold > 0) {
      // Fixed horizontal lane: strafe left and right, never lower.
      e.mem.hold -= dt;
      e.badge = 'CONST';
      steer(e, g.W / 2 + Math.sin(e.age * 0.6 + e.phase) * g.W * 0.35, 120 * g.u, dt);
    } else {
      e.badge = '';
      descend(e, dt);
    }
    e.x = e.baseX;
    if (g.fireReady(e, dt)) {
      g.aimedShot(e.x, bottom(e), cfg(e, 'shotSpeed', 0.75));
    }
  },
};

const adaptive: Behavior = {
  init(g, e) {
    e.mem.mode = Math.random() < 0.5 ? 1 : 0;
    e.mem.t = g.cooldown(cfg(e, 'modeTime', 3.2));
    applyMode(e);
  },
  update(g, e, dt) {
    e.mem.t -= dt;
    if (e.mem.t <= 0) {
      e.mem.mode = e.mem.mode ? 0 : 1;
      e.mem.t = g.cooldown(cfg(e, 'modeTime', 3.2));
      applyMode(e);
      g.tag(e, `${e.def?.tag ?? 'REASSIGN'} ${e.badge}`);
    }
    if (e.mem.mode) {
      // Aggressive: chase the player and push down.
      if (g.player.alive) steer(e, g.player.x, 110 * g.u, dt);
      e.x = e.baseX + Math.sin(e.age * 5) * 5 * g.u;
      descend(e, dt, 1.35);
    } else {
      // Defensive: zig-zag and hang back.
      const t = (e.age * 0.8 + e.phase) % 2;
      e.x = e.baseX + (t < 1 ? t * 2 - 1 : 3 - t * 2) * e.amp;
      descend(e, dt, 0.45);
    }
    if (g.fireReady(e, dt)) {
      if (e.mem.mode) g.aimedShot(e.x, bottom(e), 1);
      else shootDown(g, e, 0.8);
    }
  },
};

function applyMode(e: Enemy): void {
  e.badge = e.mem.mode ? 'AGGRO' : 'GUARD';
  e.armor = e.mem.mode ? 1 : cfg(e, 'guardDamage', 0.5);
  e.mem.fireMul = e.mem.mode ? 1.5 : 0.6;
}

const loop: Behavior = {
  init(g, e) {
    e.mem.cycle = 0;
    e.mem.t = g.cooldown(cfg(e, 'cycleTime', 2.4)) * 0.6;
    e.badge = `0/${LIMITS.maxWhileCycles}`;
  },
  update(g, e, dt) {
    const done = e.mem.cycle >= LIMITS.maxWhileCycles;
    // The same sweep, over and over.
    e.x = e.baseX + Math.sin(e.age * 1.6 + e.phase) * Math.min(g.W * 0.25, e.amp * 3);
    descend(e, dt, done ? 1.5 : 0.8);
    if (done || e.y < 0 || e.y > g.H * 0.75 || !g.player.alive) {
      return;
    }
    e.mem.t -= dt * g.tuning.fireRate;
    if (e.mem.t <= 0) {
      e.mem.cycle++;
      e.mem.t = g.cooldown(cfg(e, 'cycleTime', 2.4));
      // Pressure grows each cycle (capped by maxWhileCycles).
      const shots = cfg(e, 'baseShots', 2) + e.mem.cycle;
      g.fanShot(e.x, bottom(e), shots, 0.25 * shots, 0.85);
      e.badge = e.mem.cycle >= LIMITS.maxWhileCycles ? 'BREAK' : `${e.mem.cycle}/${LIMITS.maxWhileCycles}`;
      if (e.mem.cycle >= LIMITS.maxWhileCycles) g.tag(e, 'break;');
    }
  },
};

const elite: Behavior = {
  init(g, e) {
    e.mem.spawnCd = g.cooldown(cfg(e, 'spawnCooldown', 6)) * 0.5;
    e.mem.attack = 0;
  },
  update(g, e, dt) {
    e.x = e.baseX + Math.sin(e.age * 0.7 + e.phase) * Math.min(g.W * 0.3, e.amp * 4);
    descend(e, dt);
    if (g.fireReady(e, dt)) {
      // Several attack patterns, in rotation.
      const a = e.mem.attack++ % 3;
      if (a === 0) {
        g.fanShot(e.x, bottom(e), 3, 0.56);
      } else if (a === 1) {
        g.aimedShot(e.x, bottom(e), 1);
        g.later(0.2, () => g.enemies.includes(e) && g.aimedShot(e.x, bottom(e), 1));
      } else {
        // Ring burst: telegraphed with a circle first.
        g.warn({ kind: 'circle', x: e.x, y: e.y, r: e.w * 0.7, life: LIMITS.minTelegraph, color: g.colorOf(e) });
        g.later(LIMITS.minTelegraph, () => {
          if (!g.enemies.includes(e)) return;
          const s = g.projectileSpeed() * 0.7;
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2 + 0.2;
            if (Math.sin(ang) > -0.2) g.enemyShot(e.x, e.y, Math.cos(ang) * s, Math.sin(ang) * s);
          }
        });
      }
    }
    e.mem.spawnCd -= dt;
    if (e.mem.spawnCd <= 0 && e.y > 0 && e.y < g.H * 0.55) {
      e.mem.spawnCd = g.cooldown(cfg(e, 'spawnCooldown', 6));
      const methods = e.spec.construct?.methods ?? [];
      const max = Math.min(LIMITS.maxMinionsPerLeader, cfg(e, 'methods', 2));
      const alive = g.childrenOf(e).filter((c) => c.role === 'minion').length;
      if (alive < max) {
        const label = (methods[(e.mem.spawned ?? 0) % Math.max(1, methods.length)] ?? 'method') + '()';
        const side = alive % 2 === 0 ? -1 : 1;
        if (g.spawnUnit('minion', { parent: e, role: 'minion', label: label.slice(0, 9), hp: 2, mem: { ox: side * (e.w / 2 + 10 * g.u), oy: 24 * g.u } })) {
          e.mem.spawned = (e.mem.spawned ?? 0) + 1;
          g.tag(e, `${e.def?.tag ?? 'NEW'} ${label}`);
          g.sfx('summon');
        }
      }
    }
  },
};

const recover: Behavior = {
  update(g, e, dt) {
    sway(e, 1.3);
    e.mem.cd = Math.max(0, (e.mem.cd ?? 0) - dt);
    e.badge = e.shieldTimer > 0 ? 'CATCH' : e.mem.cd > 0 ? '' : 'TRY';
    // Recovery phase: back off while the shield is up.
    descend(e, dt, e.shieldTimer > 0 ? 0.2 : 1);
    if (e.shieldTimer <= 0 && g.fireReady(e, dt)) {
      shootDown(g, e);
    }
  },
  afterHit(g, e) {
    if (e.shieldTimer <= 0 && (e.mem.cd ?? 0) <= 0) {
      e.shieldTimer = cfg(e, 'shieldTime', 2.2);
      e.mem.shieldMax = e.shieldTimer;
      e.mem.cd = e.shieldTimer + g.cooldown(cfg(e, 'cooldown', 4.5));
      g.tag(e, e.def?.tag ?? 'CATCH');
      g.sfx('shield');
    }
  },
};

/** Loop Commander: the signature mechanic. */
const commander: Behavior = {
  init(g, e) {
    const c = e.spec.construct ?? {};
    const vars = [c.loopVar ?? 'i', ...(c.innerVars ?? [])];
    const extra = e.elite ? 1 : 0;
    const count = Math.min(LIMITS.maxEscorts, vars.length + extra);
    const names = ['i', 'j', 'k'];
    for (let k = 0; k < count; k++) {
      const label = (vars[k] ?? names.find((n) => !vars.includes(n)) ?? `v${k}`).slice(0, 4);
      g.spawnUnit('escort', {
        parent: e,
        role: 'escort',
        label,
        mem: { angle: (k / count) * Math.PI * 2, intercepts: cfg(e, 'intercepts', 3) },
      });
    }
    const nesting = Math.max(1, c.nesting ?? 1);
    e.mem.maxCycles = Math.min(LIMITS.maxCommanderCycles, cfg(e, 'baseCycles', 4) + (nesting - 1));
    e.mem.phases = Math.min(3, nesting + 1);
    e.mem.cycle = 0;
    e.mem.t = g.cooldown(cfg(e, 'cycleTime', 2.6));
    e.mem.lane = Math.floor(Math.random() * 4);
    e.mem.laneT = cfg(e, 'laneTime', 3.4);
    e.showSig = 3.5;
  },
  update(g, e, dt) {
    // Move between four lanes.
    e.mem.laneT -= dt;
    if (e.mem.laneT <= 0) {
      e.mem.lane = (e.mem.lane + 1 + Math.floor(Math.random() * 2)) % 4;
      e.mem.laneT = cfg(e, 'laneTime', 3.4);
    }
    const laneX = g.W * (0.2 + 0.2 * e.mem.lane);
    steer(e, laneX, 90 * g.u, dt);
    e.x = e.baseX + Math.sin(e.age * 2) * 4 * g.u;
    const done = e.mem.cycle >= e.mem.maxCycles;
    descend(e, dt, done ? 1.6 : 1);
    if (e.exposed <= 0 && e.badge === 'CORE') {
      e.badge = '';
    }
    if (done || e.y < 0 || e.y > g.H * 0.75 || !g.player.alive) {
      return;
    }
    e.mem.t -= dt * g.tuning.fireRate;
    if (e.mem.t <= 0) {
      // One loop iteration = one attack cycle; the pattern follows the loop's phases.
      const phase = e.mem.cycle % e.mem.phases;
      e.mem.cycle++;
      e.mem.t = g.cooldown(cfg(e, 'cycleTime', 2.6));
      e.showSig = 1;
      if (e.exposed <= 0) e.badge = `${e.mem.cycle}/${e.mem.maxCycles}`;
      const y = bottom(e);
      if (phase === 0) {
        for (let k = 0; k < 3; k++) g.later(k * 0.16, () => g.enemies.includes(e) && shootDown(g, e, 0.95));
      } else if (phase === 1) {
        g.fanShot(e.x, y, 5, 1, 0.8);
      } else {
        g.aimedShot(e.x - 10 * g.u, y, 0.9);
        g.aimedShot(e.x + 10 * g.u, y, 0.9);
      }
      if (e.mem.cycle >= e.mem.maxCycles) {
        g.tag(e, 'loop done');
      }
    }
  },
};

const warp: Behavior = {
  init(_g, e) {
    e.mem.state = 0;
    e.mem.t = cfg(e, 'visible', 2.8) * 0.6;
  },
  update(g, e, dt) {
    e.mem.t -= dt;
    if (e.mem.state === 0) {
      sway(e, 1.2);
      descend(e, dt, 0.8);
      if (!e.mem.attacked && e.mem.t < cfg(e, 'visible', 2.8) * 0.5 && e.y > 0 && e.y < g.H * 0.7 && g.player.alive) {
        // Telegraphed attack: a line to the player, then shots along it.
        e.mem.attacked = 1;
        const tx = g.player.x;
        const ty = g.player.y;
        g.warn({ kind: 'line', x: e.x, y: e.y, x2: tx, y2: ty, r: 2 * g.u, life: LIMITS.minTelegraph + 0.1, color: g.colorOf(e) });
        const pattern = e.mem.pattern ?? 0;
        g.later(LIMITS.minTelegraph + 0.1, () => {
          if (!g.enemies.includes(e) || e.phased) return;
          if (pattern % 2 === 0) {
            for (let k = 0; k < 3; k++) g.later(k * 0.12, () => g.enemies.includes(e) && g.aimedShot(e.x, e.y, 1, { x: tx, y: ty }));
          } else {
            g.fanShot(e.x, bottom(e), 4, 0.7, 0.8);
          }
        });
      }
      if (e.mem.t <= 0) {
        // await: vanish.
        e.mem.state = 1;
        e.mem.t = cfg(e, 'hidden', 1.4);
        e.phased = true;
        e.mem.toX = clamp(g.player.x + rand(-0.3, 0.3) * g.W, e.w, g.W - e.w);
        e.mem.toY = clamp(e.y + rand(-0.05, 0.08) * g.H, g.H * 0.1, g.H * 0.55);
        g.sfx('warp');
        g.tag(e, e.def?.tag ?? 'AWAIT');
      }
    } else {
      if (e.mem.t <= cfg(e, 'warn', 0.8) && !e.mem.warned) {
        e.mem.warned = 1;
        g.warn({ kind: 'marker', x: e.mem.toX, y: e.mem.toY, r: e.w * 0.5, life: e.mem.t, color: g.colorOf(e), label: 'await' });
      }
      if (e.mem.t <= 0) {
        // Resolved: reappear somewhere new with the next attack pattern.
        e.phased = false;
        e.baseX = e.x = e.mem.toX;
        e.y = e.mem.toY;
        e.mem.state = 0;
        e.mem.t = cfg(e, 'visible', 2.8);
        e.mem.attacked = 0;
        e.mem.warned = 0;
        e.mem.pattern = (e.mem.pattern ?? 0) + 1;
        g.ring(e.x, e.y, g.colorOf(e), 50);
      }
    }
    e.badge = e.phased ? '' : 'ASYNC';
  },
};

const charge: Behavior = {
  init(g, e) {
    e.mem.cd = g.cooldown(cfg(e, 'cooldown', 3.4)) * 0.6;
  },
  update(g, e, dt) {
    sway(e, 1);
    descend(e, dt, e.mem.charging ? 0.3 : 1);
    if (e.mem.charging) {
      e.mem.t -= dt;
      e.windup = 1 - e.mem.t / cfg(e, 'charge', 1.2);
      if (e.mem.t <= 0) {
        e.mem.charging = 0;
        e.windup = 0;
        e.badge = '';
        const fuse = cfg(e, 'fuse', 1.1);
        const tx = e.mem.tx;
        const ty = e.mem.ty;
        const vx = (tx - e.x) / fuse;
        const vy = (ty - e.y) / fuse;
        g.enemyShot(e.x, bottom(e), vx, vy, { kind: 'pending', r: 6 * g.u, fuse, frags: cfg(e, 'fragments', 3) });
        g.warn({ kind: 'circle', x: tx, y: ty, r: 36 * g.u, life: fuse, color: g.colorOf(e), label: 'resolve' });
      }
      return;
    }
    e.mem.cd -= dt * g.tuning.fireRate;
    if (e.mem.cd <= 0 && e.y > 0 && e.y < g.H * 0.6 && g.player.alive) {
      e.mem.cd = g.cooldown(cfg(e, 'cooldown', 3.4));
      e.mem.charging = 1;
      e.mem.t = Math.max(LIMITS.minTelegraph, cfg(e, 'charge', 1.2));
      // Resolves where the player was when charging started, a bit above the ship.
      e.mem.tx = g.player.x;
      e.mem.ty = g.player.y - 70 * g.u;
      e.badge = 'PENDING';
      g.tag(e, e.def?.tag ?? 'PENDING');
    }
  },
};

const reinforce: Behavior = {
  init(g, e) {
    // Enter from a screen edge.
    const fromLeft = Math.random() < 0.5;
    e.mem.targetX = g.W * rand(0.25, 0.75);
    e.baseX = e.x = fromLeft ? -e.w : g.W + e.w;
    e.y = g.H * rand(0.1, 0.25);
    e.mem.calls = 0;
    e.mem.cd = 1.2;
  },
  update(g, e, dt) {
    if (Math.abs(e.baseX - e.mem.targetX) > 4) {
      steer(e, e.mem.targetX, 260 * g.u, dt);
      e.x = e.baseX;
      return;
    }
    sway(e, 1);
    descend(e, dt, 0.8);
    e.mem.cd -= dt;
    if (e.mem.cd <= 0 && e.mem.calls < LIMITS.maxReinforcementCalls && g.reinforcementsThisLevel < LIMITS.maxReinforcementsPerLevel && e.y < g.H * 0.6) {
      e.mem.cd = g.cooldown(cfg(e, 'callCooldown', 4));
      e.mem.calls++;
      const n = Math.min(cfg(e, 'perCall', 2), LIMITS.maxReinforcementsPerLevel - g.reinforcementsThisLevel);
      for (let k = 0; k < n; k++) {
        const spec = g.levels.reinforcementSpec();
        const r = g.spawnUnit('minion', { role: 'reinforcement', spec, hp: Math.max(1, Math.min(3, spec.hp)), x: clamp(e.x + (k - (n - 1) / 2) * 40 * g.u, 20, g.W - 20), y: e.y - 10 * g.u });
        if (r) {
          g.reinforcementsThisLevel++;
        }
      }
      g.tag(e, `${e.def?.tag ?? 'IMPORT'} ×${n}`);
      g.sfx('summon');
      e.badge = `${e.mem.calls}/${LIMITS.maxReinforcementCalls}`;
    }
    if (g.fireReady(e, dt)) {
      shootDown(g, e);
    }
  },
};

const windup: Behavior = {
  init(g, e) {
    e.mem.cd = g.cooldown(cfg(e, 'cooldown', 3.6)) * 0.6;
  },
  update(g, e, dt) {
    if (e.mem.winding) {
      e.mem.t -= dt;
      const total = Math.max(LIMITS.minTelegraph, cfg(e, 'windup', 1));
      e.windup = 1 - e.mem.t / total;
      e.x = e.baseX + Math.sin(e.age * 40) * 2 * g.u * e.windup; // shaking wind-up
      descend(e, dt, 0.2);
      if (e.mem.t <= 0) {
        e.mem.winding = 0;
        e.windup = 0;
        e.badge = '';
        // Heavy shot at where the player *was* when the wind-up began.
        g.aimedShot(e.x, bottom(e), cfg(e, 'shotSpeed', 1.25), { x: e.mem.tx, y: e.mem.ty }, { kind: 'heavy', r: 7 * g.u });
        g.shake = Math.max(g.shake, 3);
      }
      return;
    }
    sway(e, 1.2);
    descend(e, dt);
    e.mem.cd -= dt * g.tuning.fireRate;
    if (e.mem.cd <= 0 && e.y > 0 && e.y < g.H * 0.65 && g.player.alive) {
      e.mem.cd = g.cooldown(cfg(e, 'cooldown', 3.6));
      e.mem.winding = 1;
      e.mem.t = Math.max(LIMITS.minTelegraph, cfg(e, 'windup', 1));
      e.mem.tx = g.player.x;
      e.mem.ty = g.player.y;
      e.badge = 'THROW';
      g.warn({ kind: 'circle', x: e.mem.tx, y: e.mem.ty, r: 30 * g.u, life: e.mem.t + 0.4, color: g.colorOf(e), label: 'throw' });
      g.tag(e, e.def?.tag ?? 'THROW');
    }
  },
};

const clone: Behavior = {
  init(g, e) {
    e.mem.cd = g.cooldown(cfg(e, 'cloneCooldown', 4)) * (e.cloneDepth === 0 ? 0.6 : 1);
    if (e.cloneDepth > 0) {
      e.mem.fireMul = Math.pow(0.7, e.cloneDepth); // clones hit less often
      e.badge = `n-${e.cloneDepth}`;
    }
  },
  update(g, e, dt) {
    sway(e, 1.4);
    descend(e, dt);
    if (g.fireReady(e, dt)) {
      shootDown(g, e, 0.85);
    }
    e.mem.cd -= dt;
    if (e.mem.cd <= 0 && e.y > 0 && e.y < g.H * 0.55) {
      e.mem.cd = g.cooldown(cfg(e, 'cloneCooldown', 4));
      if (e.cloneDepth >= LIMITS.maxCloneDepth) {
        return; // base case reached
      }
      const family = g.enemies.filter((c) => c.groupId === e.groupId && c.role === 'clone').length;
      if (family >= LIMITS.maxClonesPerFamily) {
        return;
      }
      const hp = Math.max(1, Math.ceil(e.maxHp * cfg(e, 'hpScale', 0.55)));
      const c = g.spawnUnit('recursive', {
        parent: e,
        role: 'clone',
        spec: e.spec,
        hp,
        scale: Math.max(0.6, e.scale * 0.8),
        cloneDepth: e.cloneDepth + 1,
        x: clamp(e.x + rand(-1, 1) * 50 * g.u, 20, g.W - 20),
        y: e.y + 6 * g.u,
      });
      if (c) {
        c.vy = e.vy;
        g.tag(e, e.def?.tag ?? 'RECURSE');
        g.sfx('summon');
      }
    }
  },
};

const escort: Behavior = {
  update(g, e, dt) {
    const parent = g.byUid(e.parentUid);
    if (!parent) {
      descend(e, dt);
      return;
    }
    e.mem.angle = (e.mem.angle ?? 0) + dt * cfg(e, 'orbitSpeed', 1.7);
    const r = (cfg(e, 'radius', 44) * g.u + parent.w * 0.25);
    e.x = e.baseX = parent.x + Math.cos(e.mem.angle) * r;
    e.y = parent.y + Math.sin(e.mem.angle) * r * 0.45 + 6 * g.u;
  },
};

const minion: Behavior = {
  init(g, e) {
    if (e.mem.ox === undefined) {
      e.mem.ox = rand(-1, 1) * 40 * g.u;
      e.mem.oy = 22 * g.u;
    }
  },
  update(g, e, dt) {
    const parent = g.byUid(e.parentUid);
    if (parent) {
      const wob = Math.sin(e.age * 2.5 + e.phase) * 6 * g.u;
      e.baseX = parent.x + e.mem.ox + wob;
      e.x = e.baseX;
      e.y = parent.y + e.mem.oy;
    } else {
      sway(e, 1.6, 0.6);
      descend(e, dt, 1.2);
    }
    if (g.fireReady(e, dt)) {
      if (e.role === 'head') g.aimedShot(e.x, bottom(e), 0.85);
      else shootDown(g, e, 0.85);
    }
  },
};

const moduleBehavior: Behavior = {
  update(g, e) {
    const parent = g.byUid(e.parentUid);
    if (parent) {
      e.x = e.baseX = parent.x + (e.mem.ox ?? 0);
      e.y = parent.y + (e.mem.oy ?? 0);
    }
  },
};

const drift: Behavior = {
  update(g, e, dt) {
    e.baseX += (e.mem.drift ?? 0) * 40 * g.u * dt;
    sway(e, 2.2, 0.5);
    descend(e, dt);
  },
};

export const BEHAVIORS: Record<(typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS]['behavior'], Behavior> = {
  branch,
  burst,
  split,
  dash,
  flee,
  summoner,
  lane,
  adaptive,
  loop,
  elite,
  recover,
  commander,
  warp,
  charge,
  reinforce,
  windup,
  clone,
  escort,
  minion,
  module: moduleBehavior,
  drift,
};
