import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeCode, DEMO_SOURCE } from '../src/codeAnalyzer';
import { BOSS_DEFS, BOSS_LIMITS, bossForLevel, FINAL_LEVEL } from '../src/webview/bosses';
import { DIFFICULTY_CAPS, tuningFor } from '../src/webview/difficulty';
import { ENEMY_DEFS, LIMITS } from '../src/webview/enemies/definitions';
import { Game, type Sfx } from '../src/webview/game';
import { BOSS_INTRO_SECONDS } from '../src/webview/levels';
import { allocate, planWave, sampleEvenly } from '../src/webview/spawnDirector';
import type { Archetype, CodeSnapshot, Difficulty, EnemySpec } from '../src/shared/protocol';

const demo = (): CodeSnapshot => {
  const lines = DEMO_SOURCE.split('\n');
  return analyzeCode({
    fileName: 'demo.ts',
    languageId: 'typescript',
    lineCount: lines.length,
    getLine: (i) => lines[i],
    diagnostics: [{ line: 1, severity: 0, message: "Cannot find module './galaxy'." }],
  });
};

function makeGame(snapshot: CodeSnapshot = demo()) {
  const events = { sfx: [] as Sfx[], toasts: [] as string[], victory: [] as Array<[number, string]>, over: 0 };
  const game = new Game({
    sfx: (s) => events.sfx.push(s),
    toast: (t) => events.toasts.push(t),
    gameOver: () => events.over++,
    victory: (score, sig) => events.victory.push([score, sig]),
  });
  game.resize(900, 700);
  game.setSnapshot(snapshot);
  game.start();
  return { game, events };
}

function run(game: Game, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    each?.();
    game.update(1 / 60);
    if (game.state !== 'playing') return;
  }
}

/** Skip straight to the end of the wave: quota met, field empty. */
function finishWave(game: Game): void {
  game.levelIntro = 0;
  game.update(1 / 60);
  game.spawnedForQuota = game.quota;
  for (const e of [...game.enemies]) game.removeEnemy(e, false);
  game.update(1 / 60);
}

/** Wave → boss fight (boss in position). */
function toBoss(game: Game): void {
  finishWave(game);
  assert.equal(game.levels.phase, 'bossIntro');
  game.player.invulnerable = 999;
  run(game, BOSS_INTRO_SECONDS + 3);
  assert.equal(game.levels.phase, 'boss');
}

const spec = (i: number, archetype?: Archetype, extra: Partial<EnemySpec> = {}): EnemySpec => ({
  id: `s${i}`,
  kind: archetype ? 'keyword' : 'line',
  label: archetype ?? `line${i}`,
  hp: 1,
  line: i,
  archetype,
  ...extra,
});

describe('DifficultyManager', () => {
  it('ramps gradually and never passes the caps', () => {
    for (const d of ['chill', 'normal', 'hardcore'] as Difficulty[]) {
      let prev = tuningFor(1, d);
      for (let level = 2; level <= 30; level++) {
        const t = tuningFor(level, d);
        assert.ok(t.descent >= prev.descent && t.descent <= DIFFICULTY_CAPS.descent);
        assert.ok(t.fireRate >= prev.fireRate && t.fireRate <= DIFFICULTY_CAPS.fireRate);
        assert.ok(t.projectileSpeed <= DIFFICULTY_CAPS.projectileSpeed);
        assert.ok(t.spawnInterval <= prev.spawnInterval && t.spawnInterval >= DIFFICULTY_CAPS.minSpawnInterval);
        assert.ok(t.maxConcurrent >= prev.maxConcurrent && t.maxConcurrent <= DIFFICULTY_CAPS.maxConcurrent);
        assert.ok(t.cooldown >= DIFFICULTY_CAPS.minCooldown);
        assert.ok(t.bossHp >= prev.bossHp);
        prev = t;
      }
    }
  });

  it('chill < normal < hardcore', () => {
    const [c, n, h] = (['chill', 'normal', 'hardcore'] as Difficulty[]).map((d) => tuningFor(3, d));
    assert.ok(c.descent < n.descent && n.descent < h.descent);
    assert.ok(c.fireRate < n.fireRate && n.fireRate < h.fireRate);
    assert.ok(c.bossHp < n.bossHp && n.bossHp < h.bossHp);
  });
});

describe('SpawnDirector', () => {
  it('normalises any file to the level budget', () => {
    const t = tuningFor(1, 'normal');
    const tiny = planWave([spec(0, 'for', { construct: { loopVar: 'i' } })], 1, t);
    assert.equal(tiny.length, t.quota, 'a one-line file still fills the wave');
    const huge = Array.from({ length: 600 }, (_, i) => spec(i, i % 3 === 0 ? 'if' : undefined));
    assert.equal(planWave(huge, 1, t).length, t.quota, 'a huge file is sampled, not spawned whole');
  });

  it('samples large files evenly instead of taking the top of the file', () => {
    const picks = sampleEvenly(Array.from({ length: 1000 }, (_, i) => i), 10);
    assert.equal(picks.length, 10);
    assert.ok(picks[0] < 100 && picks[9] > 900);
  });

  it('mirrors the source composition: more loops → more loop enemies', () => {
    const t = { ...tuningFor(5, 'normal'), maxTier3: 99, maxTier2: 99, constructShare: 1 };
    const loopy = [...Array.from({ length: 30 }, (_, i) => spec(i, 'for')), ...Array.from({ length: 5 }, (_, i) => spec(100 + i, 'if'))];
    const branchy = [...Array.from({ length: 5 }, (_, i) => spec(i, 'for')), ...Array.from({ length: 30 }, (_, i) => spec(100 + i, 'if'))];
    const count = (plan: ReturnType<typeof planWave>, a: Archetype) => plan.filter((p) => p.spec.archetype === a).length;
    assert.ok(count(planWave(loopy, 5, t), 'for') > count(planWave(branchy, 5, t), 'for'));
    assert.ok(count(planWave(branchy, 5, t), 'if') > count(planWave(loopy, 5, t), 'if'));
  });

  it('caps dangerous tiers per wave and keeps variety', () => {
    const t = tuningFor(1, 'normal');
    const specs = [
      ...Array.from({ length: 40 }, (_, i) => spec(i, 'for')),
      ...Array.from({ length: 40 }, (_, i) => spec(100 + i, 'class')),
      ...Array.from({ length: 5 }, (_, i) => spec(200 + i, 'if')),
      ...Array.from({ length: 20 }, (_, i) => spec(300 + i)),
    ];
    const plan = planWave(specs, 1, t);
    const tier = (n: number) => plan.filter((p) => p.spec.archetype && ENEMY_DEFS[p.spec.archetype].tier === n).length;
    assert.ok(tier(3) <= t.maxTier3, `tier 3: ${tier(3)}`);
    assert.ok(tier(2) <= t.maxTier2, `tier 2: ${tier(2)}`);
    assert.ok(plan.some((p) => p.spec.archetype === 'if'), 'rare constructs still appear');
    const lines = plan.map((p) => p.spec.line);
    assert.deepEqual(lines, [...lines].sort((a, b) => a - b), 'code descends top to bottom');
  });

  it('nested loops become elite variants', () => {
    const plan = planWave([spec(0, 'for', { construct: { nesting: 3 } })], 2, tuningFor(2, 'normal'));
    assert.ok(plan.some((p) => p.spec.archetype === 'for' && p.elite));
  });

  it('allocate splits proportionally with at least one of each', () => {
    const a = allocate(
      new Map<Archetype, number>([
        ['if', 10],
        ['for', 5],
        ['return', 1],
      ]),
      8,
    );
    assert.equal([...a.values()].reduce((s, n) => s + n, 0), 8);
    assert.ok(a.get('if')! > a.get('for')! && a.get('return') === 1);
  });

  it('the wave is planned once per level; typing mid-level does not rebuild it', () => {
    const { game } = makeGame();
    const before = game.levels.wave.map((p) => p.spec.id);
    const lines = ['for (let i = 0; i < 3; i++) {}', 'while (x) {}'];
    game.setSnapshot(analyzeCode({ fileName: 'b.ts', languageId: 'typescript', lineCount: 2, getLine: (i) => lines[i] }));
    assert.deepEqual(
      game.levels.wave.map((p) => p.spec.id),
      before,
    );
    toBoss(game);
    game.damageEnemy(game.levels.boss!.enemy, 1e6);
    run(game, 8);
    assert.equal(game.level, 2);
    assert.ok(game.levels.wave.every((p) => p.spec.archetype === 'for' || p.spec.archetype === 'while'), 'next level uses the new code');
  });
});

describe('LevelManager: end-of-level boss flow', () => {
  it('stops the wave, clears hostile shots, and brings in the level boss', () => {
    const { game, events } = makeGame();
    game.levelIntro = 0;
    run(game, 3);
    game.enemyShot(100, 100, 0, 50);
    const leftover = game.spawn({ id: 'fresh', kind: 'line', label: 'x', hp: 1, line: 0 }, true);
    leftover.y = 200;
    finishWave(game);
    assert.equal(game.levels.phase, 'bossIntro');
    assert.equal(game.bullets.filter((b) => b.enemy).length, 0, 'hostile projectiles resolved');
    assert.ok(events.sfx.includes('bossIntro'));
    assert.equal(game.banner.text, 'WARNING');
    const boss = game.levels.boss!;
    assert.equal(boss.def.id, 'loop');
    assert.ok(boss.entering && boss.enemy.shieldTimer > 0, 'invulnerable during its entrance');
    const hp = boss.enemy.hp;
    game.damageEnemy(boss.enemy, 5);
    assert.equal(boss.enemy.hp, hp);
    const spawned = game.spawnedForQuota;
    run(game, 2);
    assert.equal(game.spawnedForQuota, spawned, 'no normal spawns during the boss');
    assert.ok(!game.enemies.includes(leftover), 'leftover enemies retreat');
  });

  it('level completion is locked until the boss is defeated', () => {
    const { game } = makeGame();
    toBoss(game);
    game.player.invulnerable = 999;
    run(game, 20, () => (game.player.invulnerable = 999));
    assert.equal(game.level, 1);
    assert.equal(game.levels.phase, 'boss');
  });

  it('boss phases change at their health thresholds, with a visible announcement', () => {
    const { game, events } = makeGame();
    toBoss(game);
    const boss = game.levels.boss!;
    const e = boss.enemy;
    assert.equal(boss.phaseIndex, 0);
    game.damageEnemy(e, e.maxHp * (1 - boss.def.phases[0].until) + 0.5);
    game.update(1 / 60);
    assert.equal(boss.phaseIndex, 1);
    assert.equal(game.banner.text, 'PHASE 2');
    assert.ok(events.sfx.includes('bossPhase'));
    assert.ok(e.shieldTimer > 0, 'short invulnerability on a phase change');
    run(game, 1.2);
    game.damageEnemy(e, e.hp - 1);
    game.update(1 / 60);
    assert.equal(boss.phaseIndex, boss.def.phases.length - 1);
  });

  it('defeat → explosion sequence → score summary → next level', () => {
    const { game, events } = makeGame();
    toBoss(game);
    const score = game.score;
    game.damageEnemy(game.levels.boss!.enemy, 1e6);
    assert.equal(game.levels.phase, 'bossDefeat');
    assert.equal(game.stats.bossesDefeated, 1);
    assert.ok(events.sfx.includes('bossDefeat'));
    run(game, 2.5);
    assert.equal(game.levels.phase, 'clear');
    const summary = game.levels.summary!;
    assert.equal(summary.level, 1);
    assert.equal(summary.bossTitle, 'THE INFINITE LOOP');
    assert.ok(game.score > score + summary.bonus, 'boss points + level bonus');
    run(game, 4);
    assert.equal(game.level, 2);
    assert.equal(game.levels.phase, 'intro');
    assert.equal(game.levels.bossDef!.id, 'hydra');
  });

  it('every level has its own boss, and the last one ends the game in victory', () => {
    assert.deepEqual(
      BOSS_DEFS.map((b) => b.id),
      ['loop', 'hydra', 'overlord', 'phantom', 'runtime'],
    );
    assert.equal(FINAL_LEVEL, 5);
    const { game, events } = makeGame();
    for (let level = 1; level <= FINAL_LEVEL; level++) {
      assert.equal(game.level, level);
      toBoss(game);
      assert.equal(game.levels.boss!.def, bossForLevel(level));
      game.damageEnemy(game.levels.boss!.enemy, 1e6);
      run(game, 7);
    }
    assert.equal(game.state, 'victory');
    assert.equal(events.victory.length, 1);
    assert.equal(events.victory[0][1], "Cannot find module './galaxy'.", 'victory shows the final boss signature');
    game.start();
    assert.equal(game.state, 'playing');
    assert.equal(game.level, 1);
  });

  it('bosses take names and signatures from the source', () => {
    const snap = demo();
    assert.equal(BOSS_DEFS[0].signature(snap), 'for (ship of this.ships)');
    assert.equal(BOSS_DEFS[2].label(snap), 'Fleet');
    assert.match(BOSS_DEFS[2].signature(snap), /^class Fleet \{ launch\(\) findWeakes/);
    assert.equal(BOSS_DEFS[0].signature(undefined), 'while (true) { }');
  });
});

describe('boss mechanics', () => {
  function bossAt(level: number) {
    const { game, events } = makeGame();
    game.levels.begin(level);
    toBoss(game);
    return { game, events, boss: game.levels.boss! };
  }

  it('Recursive Hydra: heads are capped, weaker over time, and shield the body', () => {
    const { game, boss } = bossAt(2);
    run(game, 40, () => (game.player.invulnerable = 999));
    const heads = game.childrenOf(boss.enemy).filter((c) => c.role === 'head');
    assert.ok(heads.length >= 1 && heads.length <= BOSS_LIMITS.headsAlive);
    assert.ok(boss.headsSpawned <= BOSS_LIMITS.headsTotal);
    assert.equal(boss.enemy.armor, 0.25, 'deal with the heads first');
    for (const h of heads) game.killEnemy(h);
    game.update(1 / 60);
    assert.equal(boss.enemy.armor, 1);
    // Many more cycles never exceed the total.
    run(game, 120, () => {
      game.player.invulnerable = 999;
      for (const h of game.childrenOf(boss.enemy)) game.killEnemy(h);
    });
    assert.ok(boss.headsSpawned <= BOSS_LIMITS.headsTotal);
  });

  it('Class Overlord: armoured modules; disabling one removes its attack for a while', () => {
    const { game, boss } = bossAt(3);
    const modules = () => game.childrenOf(boss.enemy).filter((c) => c.role === 'module');
    assert.equal(modules().length, 3);
    assert.ok(boss.enemy.armor < 1);
    game.killEnemy(modules()[0]);
    assert.equal(modules().length, 2);
    assert.ok(boss.modules[0].down > 0, 'disabled temporarily');
    for (const m of modules()) game.killEnemy(m);
    game.update(1 / 60);
    assert.equal(boss.enemy.armor, 1, 'armour down when every module is disabled');
    run(game, BOSS_LIMITS.moduleDowntime + 1, () => (game.player.invulnerable = 999));
    assert.equal(modules().length, 3, 'modules come back after their downtime');
    assert.ok(boss.modules.every((m) => m.respawns <= BOSS_LIMITS.moduleRespawns));
  });

  it('Async Phantom: vanishes with a warning marker and uses telegraphed delayed shots', () => {
    const { game, boss } = bossAt(4);
    let phased = false;
    let marker = false;
    let delayed = false;
    run(game, 10, () => {
      game.player.invulnerable = 999;
      phased ||= boss.enemy.phased;
      marker ||= game.warnings.some((w) => w.kind === 'marker');
      delayed ||= game.warnings.some((w) => w.label === 'await');
    });
    assert.ok(phased && marker && delayed);
  });

  it('Runtime Error: combines earlier bosses across four phases', () => {
    const def = bossForLevel(5);
    assert.equal(def.phases.length, 4);
    const attacks = new Set(def.phases.flatMap((p) => p.attacks));
    for (const a of ['wave', 'heads', 'teleport', 'delayed', 'beam']) {
      assert.ok(attacks.has(a as never), a);
    }
  });

  it('beams are harmless while they flash their warning', () => {
    const { game } = makeGame();
    game.levelIntro = 99;
    game.player.invulnerable = 0;
    game.hazards.push({ x: game.player.x, w: 30, warn: LIMITS.minTelegraph, life: 0.4, color: '#fff' });
    const lives = game.lives;
    run(game, LIMITS.minTelegraph - 0.1);
    assert.equal(game.lives, lives);
    run(game, 0.3);
    assert.equal(game.lives, lives - 1);
  });

  it('code powers cannot one-shot a boss', () => {
    const { game, boss } = bossAt(1);
    const e = boss.enemy;
    game.killEnemy(e);
    assert.ok(game.enemies.includes(e));
    assert.ok(e.hp < e.maxHp && e.hp > 0);
  });
});
