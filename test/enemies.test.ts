import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BEHAVIORS } from '../src/webview/enemies/behaviors';
import { ENEMY_DEFS, LIMITS } from '../src/webview/enemies/definitions';
import { Game, type Enemy, type Sfx } from '../src/webview/game';
import { ARCHETYPES, type Archetype, type ConstructInfo, type EnemySpec } from '../src/shared/protocol';
import { ARCHETYPE_KIND } from '../src/codeAnalyzer';

function arena() {
  const events = { sfx: [] as Sfx[], toasts: [] as string[] };
  const game = new Game({
    sfx: (s) => events.sfx.push(s),
    toast: (t) => events.toasts.push(t),
    gameOver: () => {},
  });
  game.resize(900, 700);
  game.start();
  game.levelIntro = 99; // no automatic spawns
  game.player.invulnerable = 999;
  return { game, events };
}

const spec = (archetype: Archetype, label: string = archetype, construct: ConstructInfo = {}): EnemySpec => ({
  id: `${archetype}:${label}`,
  kind: ARCHETYPE_KIND[archetype],
  label,
  hp: 1,
  line: 3,
  archetype,
  construct,
});

function place(e: Enemy, x: number, y: number): Enemy {
  e.x = e.baseX = x;
  e.y = y;
  return e;
}

function run(game: Game, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    each?.();
    game.update(1 / 60);
  }
}

/** Run with Math.random fixed to `value`. */
function withRandom<T>(value: number, fn: () => T): T {
  const orig = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

/** Fire one player shot straight into an enemy (resolved on the next frame). */
function shoot(game: Game, e: Enemy): void {
  game.bullets.push({ x: e.x, y: e.y + e.h / 2 + 4, vx: 0, vy: -1, enemy: false, dmg: 1 });
  game.update(1 / 60);
}

describe('enemy definitions', () => {
  it('define every archetype with fair, data-driven stats and an implemented behaviour', () => {
    for (const a of ARCHETYPES) {
      const def = ENEMY_DEFS[a];
      assert.ok(def, a);
      assert.ok(def.tier >= 1 && def.tier <= 3, `${a} tier`);
      assert.ok(def.hp >= 1 && def.hp <= 10, `${a} hp`);
      assert.ok(def.speed > 0 && def.speed <= 1.5, `${a} speed`);
      assert.ok(BEHAVIORS[def.behavior], `${a} behaviour`);
      assert.ok(def.title.toLowerCase().startsWith(a === 'and' ? '&&' : a === 'or' ? '||' : a === 'arrow' ? '=>' : a), def.title);
    }
    // Tiers match the design: dangerous enemies are worth more than basic ones.
    const avg = (tier: number) => {
      const defs = ARCHETYPES.map((a) => ENEMY_DEFS[a]).filter((d) => d.tier === tier);
      return defs.reduce((s, d) => s + d.points, 0) / defs.length;
    };
    assert.ok(avg(1) < avg(2) && avg(2) < avg(3));
  });

  it('spawns construct enemies from their definition; complexity adds only a capped bonus', () => {
    const { game } = arena();
    const plain = game.spawn({ ...spec('function'), hp: 1 }, false);
    const dense = game.spawn({ ...spec('function'), hp: 12 }, false);
    assert.equal(plain.def, ENEMY_DEFS.function);
    assert.equal(plain.maxHp, ENEMY_DEFS.function.hp);
    assert.equal(dense.maxHp, ENEMY_DEFS.function.hp + ENEMY_DEFS.function.maxBonus);
    assert.equal(plain.role, 'leader');
  });
});

describe('Loop Commander', () => {
  const forSpec = (construct: ConstructInfo) => spec('for', 'for', { loopVar: 'i', signature: 'i < 10; i++', ...construct });

  it('spawns with its loop-variable escorts as one group', () => {
    const { game } = arena();
    const c = game.spawn(forSpec({}), false);
    const escorts = game.childrenOf(c);
    assert.equal(escorts.length, 1);
    assert.equal(escorts[0].role, 'escort');
    assert.equal(escorts[0].spec.label, 'i');
    assert.equal(escorts[0].groupId, c.groupId);
    assert.equal(escorts[0].quota, false, 'escorts are part of the commander, not extra quota');
    assert.ok(c.showSig > 0, 'signature is displayed on arrival');
  });

  it('nested loops add escorts, capped at the hard limit', () => {
    const { game } = arena();
    const c = game.spawn(forSpec({ innerVars: ['j', 'k', 'l', 'm'], nesting: 5 }), false, true);
    assert.equal(game.childrenOf(c).length, LIMITS.maxEscorts);
    assert.deepEqual(
      game.childrenOf(c).map((e) => e.spec.label),
      ['i', 'j', 'k'],
    );
    assert.ok(c.mem.maxCycles <= LIMITS.maxCommanderCycles);
  });

  it('escorts intercept shots, then the commander is shielded, then its core is exposed', () => {
    const { game, events } = arena();
    const c = place(game.spawn(forSpec({}), false), 450, 200);
    run(game, 0.1);
    const escort = game.childrenOf(c)[0];
    const hp = c.hp;
    const charges = escort.mem.intercepts;
    assert.equal(charges, ENEMY_DEFS.for.cfg.intercepts);

    // Intercepted: the commander takes nothing, the escort spends a charge and takes the hit.
    game.damageEnemy(c, 1);
    assert.equal(c.hp, hp);
    assert.equal(escort.mem.intercepts, charges - 1);
    assert.equal(escort.hp, escort.maxHp - 1);
    assert.ok(events.sfx.includes('deflect'));

    // Out of charges but still escorted: reduced damage.
    escort.mem.intercepts = 0;
    game.damageEnemy(c, 1);
    assert.equal(c.hp, hp - ENEMY_DEFS.for.cfg.shieldedDamage);

    // Escort destroyed → core exposed → extra damage for a while.
    game.killEnemy(escort);
    assert.ok(c.exposed > 0);
    const before = c.hp;
    game.damageEnemy(c, 1);
    assert.equal(c.hp, before - ENEMY_DEFS.for.cfg.exposeDamage);
    run(game, ENEMY_DEFS.for.cfg.exposeTime + 0.2);
    assert.equal(c.exposed, 0, 'the opening closes again');
  });

  it('destroying the commander removes its escorts and pays more than a normal enemy', () => {
    const { game } = arena();
    const c = place(game.spawn(forSpec({ innerVars: ['j'] }), false), 450, 200);
    assert.equal(game.enemies.length, 3);
    let score = game.score;
    game.killEnemy(c);
    const commanderPoints = game.score - score;
    assert.equal(game.enemies.length, 0, 'surviving escorts are removed with their commander');

    const plain = place(game.spawn({ id: 'x', kind: 'line', label: 'x', hp: 1, line: 0 }, false), 450, 200);
    score = game.score;
    game.killEnemy(plain);
    assert.ok(commanderPoints > (game.score - score) * 5, `${commanderPoints} vs ${game.score - score}`);
  });

  it('escorts never cost a life on their own; the group escapes as one', () => {
    const { game } = arena();
    game.player.invulnerable = 0;
    const c = place(game.spawn(forSpec({ innerVars: ['j'] }), false), 450, 0);
    const lives = game.lives;
    run(game, 0.1);
    c.y = game.H - c.h / 2 - 2; // commander still (just) on screen, escorts orbiting below the edge
    for (const e of game.childrenOf(c)) e.y = game.H + 60;
    game.power.freeze = 1; // hold everything in place for the escape check
    game.update(1 / 60);
    assert.equal(game.lives, lives);
    assert.equal(game.childrenOf(c).length, 2);
  });

  it('attack cycles stop at the cap', () => {
    const { game } = arena();
    const c = place(game.spawn(forSpec({}), false), 450, 150);
    c.vy = 0;
    run(game, 40);
    assert.ok(c.mem.cycle <= c.mem.maxCycles);
    assert.equal(c.mem.cycle, c.mem.maxCycles);
  });
});

describe('enemy abilities', () => {
  it('function summons its parameters (capped) and they leave with it', () => {
    const { game } = arena();
    const f = place(game.spawn(spec('function', 'warp()', { params: ['speed', 'mode', 'a', 'b'] }), false), 450, 150);
    f.vy = 0;
    run(game, 20);
    const minions = game.childrenOf(f);
    assert.ok(minions.length >= 1 && minions.length <= LIMITS.maxMinionsPerLeader);
    assert.ok(minions.every((m) => ['speed', 'mode', 'a', 'b'].includes(m.spec.label)));
    game.killEnemy(f);
    assert.equal(game.enemies.length, 0);
  });

  it('|| splits into two weaker halves (once)', () => {
    const { game } = arena();
    const or = place(game.spawn({ ...spec('or', 'a || b'), hp: 3 }, false), 450, 200);
    withRandom(0.1, () => game.damageEnemy(or, 1));
    assert.ok(!game.enemies.includes(or));
    const halves = game.enemies.filter((e) => e.role === 'half');
    assert.deepEqual(halves.map((h) => h.spec.label).sort(), ['a', 'b']);
    assert.ok(halves.every((h) => h.maxHp < or.maxHp));
  });

  it('return flees after damage — if it escapes, its points escape too', () => {
    const { game } = arena();
    const r = place(game.spawn({ ...spec('return', 'return x'), hp: 3 }, false), 450, 300);
    game.damageEnemy(r, 1);
    const score = game.score;
    run(game, 3);
    assert.ok(!game.enemies.includes(r));
    assert.equal(game.stats.returned, 1);
    assert.equal(game.score, score, 'no reward');
    assert.equal(game.stats.escaped, 0, 'fleeing upward is not "shipped to production"');
  });

  it('try/catch raises a timed shield after a hit, then needs a cooldown', () => {
    const { game } = arena();
    const t = place(game.spawn(spec('try', 'try/catch'), false), 450, 200);
    t.vy = 0;
    game.damageEnemy(t, 1);
    const hp = t.hp;
    assert.ok(t.shieldTimer > 0, 'recovery shield up');
    game.damageEnemy(t, 1);
    assert.equal(t.hp, hp, 'absorbed while the shield lasts');
    run(game, ENEMY_DEFS.try.cfg.shieldTime + 0.1);
    assert.equal(t.shieldTimer, 0);
    game.damageEnemy(t, 1);
    assert.equal(t.hp, hp - 1);
    assert.equal(t.shieldTimer, 0, 'still on cooldown: no new shield');
  });

  it('const holds its lane behind a shield', () => {
    const { game } = arena();
    const c = place(game.spawn(spec('const', 'const x'), false), 450, 0);
    run(game, 6);
    assert.ok(Math.abs(c.y - c.mem.laneY) < 10, 'parked in its lane');
    assert.equal(c.shield, ENEMY_DEFS.const.cfg.shield);
    const hp = c.hp;
    game.damageEnemy(c, 1);
    assert.equal(c.hp, hp);
    assert.equal(c.shield, ENEMY_DEFS.const.cfg.shield - 1);
  });

  it('let switches between aggressive and defensive modes', () => {
    const { game } = arena();
    const l = place(game.spawn(spec('let', 'let x'), false), 450, 100);
    l.vy = 1;
    const modes = new Set<string>();
    run(game, 8, () => modes.add(l.badge));
    assert.ok(modes.has('AGGRO') && modes.has('GUARD'));
  });

  it('while repeats its cycle until the cap, then breaks', () => {
    const { game } = arena();
    const w = place(game.spawn(spec('while', 'while x'), false), 450, 150);
    w.vy = 0;
    run(game, 30);
    assert.equal(w.mem.cycle, LIMITS.maxWhileCycles);
    assert.equal(w.badge, 'BREAK');
  });

  it('recursion makes weaker clones, bounded in depth and number', () => {
    const { game } = arena();
    const r = place(game.spawn({ ...spec('recursive', 'fib()'), hp: 4 }, false), 450, 150);
    run(game, 60, () => {
      for (const e of game.enemies) {
        e.vy = 0;
        e.y = 150;
      }
    });
    const clones = game.enemies.filter((e) => e.role === 'clone');
    assert.ok(clones.length > 0, 'it recursed');
    assert.ok(clones.length <= LIMITS.maxClonesPerFamily);
    assert.ok(clones.every((c) => c.cloneDepth >= 1 && c.cloneDepth <= LIMITS.maxCloneDepth));
    assert.ok(clones.every((c) => c.maxHp < r.maxHp && c.scale < 1));
  });

  it('import calls a limited number of reinforcements', () => {
    const { game } = arena();
    for (let k = 0; k < 4; k++) {
      const imp = game.spawn(spec('import', 'import x'), false);
      imp.vy = 0;
    }
    run(game, 40, () => {
      for (const e of game.enemies) e.vy = 0;
    });
    const reinforcements = game.enemies.filter((e) => e.role === 'reinforcement').length;
    assert.ok(reinforcements > 0);
    assert.ok(game.reinforcementsThisLevel <= LIMITS.maxReinforcementsPerLevel);
    assert.ok(reinforcements <= LIMITS.maxReinforcementsPerLevel);
    assert.ok(game.enemies.filter((e) => e.unit === 'import').every((e) => e.mem.calls <= LIMITS.maxReinforcementCalls));
  });

  it('throw telegraphs its wind-up, then hurls a heavy shot at where you were', () => {
    const { game } = arena();
    const t = place(game.spawn(spec('throw', 'throw Error'), false), 450, 150);
    t.vy = 0;
    let warnedAt = -1;
    let firedAt = -1;
    let target = { x: 0, y: 0 };
    let time = 0;
    run(game, 6, () => {
      time += 1 / 60;
      if (warnedAt < 0 && game.warnings.some((w) => w.label === 'throw')) {
        warnedAt = time;
        target = { x: game.player.x, y: game.player.y };
        game.input.right = true; // the player moves away during the wind-up
      }
      if (firedAt < 0 && game.bullets.some((b) => b.kind === 'heavy')) {
        firedAt = time;
        const heavy = game.bullets.find((b) => b.kind === 'heavy')!;
        // Aimed at the remembered position, not the current one.
        const dirToTarget = Math.atan2(target.y - heavy.y, target.x - heavy.x);
        assert.ok(Math.abs(Math.atan2(heavy.vy, heavy.vx) - dirToTarget) < 0.05);
      }
    });
    assert.ok(warnedAt > 0 && firedAt > 0);
    assert.ok(firedAt - warnedAt >= LIMITS.minTelegraph - 0.02, `dodge window ${(firedAt - warnedAt).toFixed(2)} s`);
  });

  it('async phases out (shots pass through) and warns before it reappears', () => {
    const { game } = arena();
    const a = place(game.spawn(spec('async', 'await x'), false), 450, 200);
    run(game, 10, () => {
      a.vy = 0;
      if (a.phased) {
        const hp = a.hp;
        shoot(game, a);
        assert.equal(a.hp, hp, 'untargetable while away');
      }
    });
    assert.ok(game.stats.shots === 0);
    assert.ok(a.mem.pattern >= 1, 'came back at least once');
  });

  it('Promise charges, launches a pending shot and resolves it into a small burst', () => {
    const { game } = arena();
    const p = place(game.spawn(spec('promise', 'new Promise'), false), 450, 150);
    let sawPending = false;
    let sawFragments = false;
    let sawWarning = false;
    run(game, 8, () => {
      p.vy = 0;
      sawPending ||= game.bullets.some((b) => b.kind === 'pending');
      sawFragments ||= game.bullets.some((b) => b.kind === 'fragment');
      sawWarning ||= game.warnings.some((w) => w.label === 'resolve');
    });
    assert.ok(sawPending && sawFragments && sawWarning);
  });

  it('if flanks the player and its condition label follows them', () => {
    const { game } = arena();
    const i = place(game.spawn(spec('if', 'if x'), false), 450, 150);
    game.player.x = 800;
    run(game, 0.2);
    assert.equal(i.badge, 'TRUE');
    game.player.x = 100;
    run(game, 0.2);
    assert.equal(i.badge, 'FALSE');
  });

  it('&& fires two shots that land together', () => {
    const { game } = arena();
    const a = place(game.spawn(spec('and', 'a && b'), false), 450, 150);
    a.fireCd = 0;
    run(game, 0.05);
    const shots = game.bullets.filter((b) => b.enemy);
    assert.equal(shots.length, 2);
    assert.equal(shots[0].vy, shots[1].vy);
    assert.equal(shots[0].y, shots[1].y);
  });

  it('enemy projectiles in flight are capped', () => {
    const { game } = arena();
    for (let k = 0; k < 200; k++) game.enemyShot(100, 100, 0, 10);
    assert.equal(game.bullets.filter((b) => b.enemy).length, LIMITS.maxEnemyBullets);
  });

  it('support units never exceed the on-screen cap', () => {
    const { game } = arena();
    for (let k = 0; k < 30; k++) {
      const c = game.spawn(spec('for', 'for', { loopVar: 'i', innerVars: ['j', 'k'] }), false);
      c.vy = 0;
    }
    assert.ok(game.supportCount() <= LIMITS.maxSupportOnScreen);
  });
});
