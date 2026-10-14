import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeCode, DEMO_SOURCE } from '../src/codeAnalyzer';
import { CODE_POWERS, FIRE_COOLDOWN, Game, type Sfx } from '../src/webview/game';
import type { EnemySpec } from '../src/shared/protocol';

function makeGame() {
  const events = { sfx: [] as Sfx[], toasts: [] as string[], over: [] as Array<[number, number]> };
  const game = new Game({
    sfx: (s) => events.sfx.push(s),
    toast: (t) => events.toasts.push(t),
    gameOver: (score, level) => events.over.push([score, level]),
  });
  game.resize(900, 700);
  const lines = DEMO_SOURCE.split('\n');
  game.setSnapshot(
    analyzeCode({
      fileName: 'demo.ts',
      languageId: 'typescript',
      lineCount: lines.length,
      getLine: (i) => lines[i],
      diagnostics: [{ line: 1, severity: 0, message: 'boom' }],
    }),
  );
  return { game, events };
}

/** Advance the simulation in 1/60 s steps. */
function run(game: Game, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    each?.();
    game.update(1 / 60);
    if (game.state === 'over') {
      return;
    }
  }
}

/** A perfect autopilot: steer under the lowest enemy and keep firing. */
function autopilot(game: Game): () => void {
  return () => {
    const target = [...game.enemies].sort((a, b) => b.y - a.y)[0];
    game.input.fire = true;
    game.input.left = !!target && target.x < game.player.x - 6;
    game.input.right = !!target && target.x > game.player.x + 6;
    // Make the pilot immortal so the test checks progression, not luck.
    game.player.invulnerable = 1;
    game.bullets = game.bullets.filter((b) => !b.enemy);
  };
}

describe('Game', () => {
  it('starts on the title screen and resets on start', () => {
    const { game } = makeGame();
    assert.equal(game.state, 'title');
    game.start();
    assert.equal(game.state, 'playing');
    assert.equal(game.lives, 3);
    assert.equal(game.level, 1);
    assert.equal(game.score, 0);
  });

  it('spawns enemies from the code after the level banner', () => {
    const { game } = makeGame();
    game.start();
    run(game, 1.5);
    assert.equal(game.enemies.length, 0, 'banner phase has no enemies');
    run(game, 3);
    assert.ok(game.enemies.length > 0);
    assert.ok(game.enemies.every((e) => e.spec.label.length > 0));
  });

  it('shooting destroys enemies, scores, and clears levels', () => {
    const { game, events } = makeGame();
    game.start();
    run(game, 90, autopilot(game));
    assert.ok(game.stats.kills > 15, `kills=${game.stats.kills}`);
    assert.ok(game.score > 500, `score=${game.score}`);
    assert.ok(game.level >= 2, `level=${game.level}`);
    assert.ok(events.sfx.includes('shoot') && events.sfx.includes('explode'));
    assert.ok(game.particles.length < 800, 'particles stay capped');
  });

  it('loses lives and ends the game when nobody defends the build', () => {
    const { game, events } = makeGame();
    game.start();
    run(game, 240);
    assert.equal(game.state, 'over');
    assert.equal(game.lives, 0);
    assert.equal(events.over.length, 1);
    assert.ok(game.stats.escaped + game.stats.kills >= 0 && game.stats.shots === 0, 'no input → no shots');
    // Restart works from game over.
    game.start();
    assert.equal(game.state, 'playing');
    assert.equal(game.lives, 3);
    assert.equal(game.enemies.length, 0);
  });

  it('freezes while paused', () => {
    const { game } = makeGame();
    game.start();
    run(game, 4);
    game.state = 'paused';
    const ys = game.enemies.map((e) => e.y);
    run(game, 2);
    assert.deepEqual(
      game.enemies.map((e) => e.y),
      ys,
    );
  });

  it('spawns newly typed code as bonus "fresh" enemies', () => {
    const { game, events } = makeGame();
    game.start();
    run(game, 2.2);
    game.queueFresh([{ id: 'new#1', kind: 'function', label: 'justTyped()', hp: 2, line: 5 }]);
    assert.ok(events.toasts.some((t) => t.includes('new enemy')));
    run(game, 1);
    const fresh = game.enemies.find((e) => e.fresh);
    assert.ok(fresh, 'fresh enemy spawned');
    assert.equal(fresh.quota, false);
  });

  it('falls back to void enemies for an empty file', () => {
    const { game } = makeGame();
    game.setSnapshot(analyzeCode({ fileName: 'e', languageId: 'x', lineCount: 0, getLine: () => '' }));
    game.start();
    run(game, 4);
    assert.ok(game.enemies.length > 0);
  });

  it('rescales entities on resize', () => {
    const { game } = makeGame();
    game.start();
    run(game, 4);
    const e = game.enemies[0];
    const ratio = e.x / 900;
    game.resize(450, 700);
    assert.ok(Math.abs(e.x / 450 - ratio) < 0.05);
    assert.ok(game.player.x <= 450);
  });

  it('fires at least 8 shots per second', () => {
    const { game } = makeGame();
    game.start();
    game.input.fire = true;
    run(game, 1);
    assert.ok(FIRE_COOLDOWN <= 0.125);
    assert.ok(game.stats.shots >= 8, `shots=${game.stats.shots}`);
  });

  it('move sensitivity scales ship speed (1 slow … 10 fast)', () => {
    const speedAt = (s: number) => {
      const { game } = makeGame();
      game.settings.moveSensitivity = s;
      game.start();
      game.input.right = true;
      run(game, 0.3);
      return game.player.x;
    };
    const slow = speedAt(1);
    const mid = speedAt(5);
    const fast = speedAt(10);
    assert.ok(slow < mid && mid < fast, `${slow} < ${mid} < ${fast}`);
    // Default is noticeably calmer than the old 0.75 × width top speed.
    const { game } = makeGame();
    assert.ok(game.moveSpeed() < 900 * 0.5);
  });
});

describe('code powers', () => {
  const spec = (kind: EnemySpec['kind'], label: string): EnemySpec => ({ id: `${kind}:${label}`, kind, label, hp: 1, line: 0 });
  function arena() {
    const { game, events } = makeGame();
    game.start();
    game.levelIntro = 99; // no automatic spawns
    return { game, events };
  }

  it('documents every power', () => {
    assert.equal(Object.keys(CODE_POWERS).length, 9);
  });

  it('if → always drops a power-up', () => {
    const { game } = arena();
    for (let i = 0; i < 5; i++) {
      const e = game.spawn(spec('keyword', 'if'), false);
      game.killEnemy(e);
    }
    assert.equal(game.powerups.length, 5);
  });

  it('for / while → loop shield protects the player for a while', () => {
    const { game } = arena();
    game.player.invulnerable = 0;
    game.killEnemy(game.spawn(spec('keyword', 'for'), false));
    assert.ok(game.power.loop >= 5.9);
    const lives = game.lives;
    game.bullets.push({ x: game.player.x, y: game.player.y, vx: 0, vy: 0, enemy: true, dmg: 1 });
    run(game, 0.1);
    assert.equal(game.lives, lives, 'shot absorbed');
    run(game, 6.5);
    assert.equal(game.power.loop, 0, 'shield expires');
    game.killEnemy(game.spawn(spec('keyword', 'while'), false));
    assert.ok(game.power.loop > 0);
  });

  it('== → destroys the nearest enemy on the left and on the right', () => {
    const { game, events } = arena();
    const place = (label: string, x: number) => {
      const e = game.spawn(spec('line', label), false);
      e.x = e.baseX = x;
      e.y = 200;
      return e;
    };
    place('farLeft', 100);
    place('left', 300);
    const eq = game.spawn(spec('equals', '=='), false);
    eq.x = eq.baseX = 450;
    eq.y = 200;
    place('right', 600);
    place('farRight', 800);
    game.killEnemy(eq);
    assert.deepEqual(game.enemies.map((e) => e.spec.label).sort(), ['farLeft', 'farRight']);
    assert.equal(game.stats.kills, 3);
    assert.ok(events.sfx.includes('zap'));
    assert.ok(game.particles.some((p) => p.type === 'beam'));
  });

  it('== chain reactions are bounded', () => {
    const { game } = arena();
    for (let i = 0; i < 12; i++) {
      const e = game.spawn(spec('equals', '=='), false);
      e.x = e.baseX = 40 + i * 70;
      e.y = 200;
    }
    game.killEnemy(game.enemies[6]);
    assert.ok(game.enemies.length >= 4, `left=${game.enemies.length}`);
  });

  it('break freezes, await slows, return reflects, throw blasts, try shields, import spreads', () => {
    const { game } = arena();
    const victim = game.spawn(spec('line', 'v'), false);
    victim.y = 200;
    game.killEnemy(game.spawn(spec('keyword', 'break'), false));
    const y = victim.y;
    run(game, 1);
    assert.equal(victim.y, y, 'frozen');
    assert.ok(game.power.freeze > 0);

    game.killEnemy(game.spawn(spec('keyword', 'await'), false));
    assert.ok(game.power.slow > 0);

    game.bullets.push({ x: 100, y: 300, vx: 0, vy: 200, enemy: true, dmg: 1 });
    game.killEnemy(game.spawn(spec('keyword', 'return'), false));
    assert.ok(game.bullets.every((b) => !b.enemy && b.vy < 0));

    const near = game.spawn(spec('line', 'near'), false);
    const t = game.spawn(spec('keyword', 'throw'), false);
    near.x = t.x = 400;
    near.y = 250;
    t.y = 260;
    game.killEnemy(t);
    assert.ok(!game.enemies.includes(near), 'blast destroyed neighbour');

    game.killEnemy(game.spawn(spec('keyword', 'try'), false));
    assert.equal(game.power.shield, true);
    game.killEnemy(game.spawn(spec('keyword', 'import'), false));
    assert.ok(game.power.triple >= 7.9);
  });

  it('keywords without a power behave normally', () => {
    const { game } = arena();
    const e = game.spawn(spec('keyword', 'continue'), false);
    assert.equal(e.power, undefined);
  });
});
