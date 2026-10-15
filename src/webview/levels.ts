/**
 * LevelManager: the progression state machine.
 *
 *   intro ─▶ wave ─▶ bossIntro ─▶ boss ─▶ bossDefeat ─▶ clear ─▶ (next level's intro)
 *                                                    └─▶ victory after the final level
 *
 * - intro: "LEVEL n" banner; the wave for this level is planned from the latest source snapshot.
 * - wave: the SpawnDirector's plan spawns until the quota is met and every quota enemy is gone.
 * - bossIntro: normal spawning stops, enemy projectiles are resolved into sparks, leftover enemies
 *   retreat, and the boss makes its entrance (invulnerable).
 * - boss: level completion is locked until the boss is defeated.
 * - bossDefeat: explosion sequence, then a score summary (clear) and the next level.
 */
import type { EnemySpec } from '../shared/protocol';
import { BossController, bossForLevel, FINAL_LEVEL, type BossDefinition } from './bosses';
import { tuningFor } from './difficulty';
import { ENEMY_DEFS } from './enemies/definitions';
import type { Enemy, Game } from './game';
import { planWave, type PlannedSpawn } from './spawnDirector';

export type LevelPhase = 'intro' | 'wave' | 'bossIntro' | 'boss' | 'bossDefeat' | 'clear';

export interface LevelSummary {
  level: number;
  kills: number;
  accuracy: number;
  bonus: number;
  clean: boolean;
  bossTitle: string;
  signature: string;
}

export const BOSS_INTRO_SECONDS = 3.2;
export const BOSS_DEFEAT_SECONDS = 2.2;
export const LEVEL_CLEAR_SECONDS = 3.5;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class LevelManager {
  phase: LevelPhase = 'intro';
  /** Seconds left in the current timed phase. */
  timer = 0;
  boss: BossController | undefined;
  bossDef: BossDefinition | undefined;
  summary: LevelSummary | undefined;
  private plan: PlannedSpawn[] = [];
  private cursor = 0;
  private start = { kills: 0, shots: 0, hits: 0 };
  private blast = { x: 0, y: 0, t: 0 };
  private signature = '';

  constructor(private readonly g: Game) {}

  /** Planned spawns for the current wave (for tests and the HUD). */
  get wave(): readonly PlannedSpawn[] {
    return this.plan;
  }

  begin(level: number): void {
    const g = this.g;
    g.level = level;
    g.tuning = tuningFor(level, g.settings.difficulty);
    g.quota = g.tuning.quota;
    g.spawnedForQuota = 0;
    g.spawnTimer = 0.4;
    g.levelIntro = 2;
    g.stats.livesLostThisLevel = 0;
    g.reinforcementsThisLevel = 0;
    g.clearScheduled();
    this.phase = 'intro';
    this.timer = 0;
    this.boss = undefined;
    this.bossDef = bossForLevel(level);
    this.summary = undefined;
    // Controlled refresh: the source snapshot is sampled once per level.
    this.plan = planWave(g.snapshot?.specs ?? [], level, g.tuning);
    this.cursor = 0;
    this.start = { kills: g.stats.kills, shots: g.stats.shots, hits: g.stats.hits };
  }

  update(dt: number, edt: number): void {
    const g = this.g;
    switch (this.phase) {
      case 'intro':
        if (g.levelIntro > 0) {
          g.levelIntro -= dt;
        } else {
          this.phase = 'wave';
        }
        break;
      case 'wave':
        this.spawnWave(edt);
        if (g.spawnedForQuota >= g.quota && !g.enemies.some((e) => e.quota)) {
          this.startBossIntro();
        }
        break;
      case 'bossIntro':
        this.timer -= dt;
        this.boss?.update(dt);
        if (this.timer <= 0 && this.boss && !this.boss.entering) {
          this.phase = 'boss';
        }
        break;
      case 'boss':
        this.boss?.update(edt);
        break;
      case 'bossDefeat':
        this.timer -= dt;
        this.blast.t -= dt;
        if (this.blast.t <= 0 && this.timer > 0.4) {
          // Dramatic defeat: chained explosions across the boss's hull.
          this.blast.t = 0.14;
          const x = this.blast.x + rand(-80, 80) * g.u;
          const y = this.blast.y + rand(-40, 40) * g.u;
          g.flash(x, y, this.bossDef?.color ?? '#ffffff', 90);
          g.burst(x, y, this.bossDef?.color ?? '#ffffff', 24, 1.4);
          g.ring(x, y, '#ffffff', 70);
          g.shake = Math.max(g.shake, 6);
          g.sfx('explode');
        }
        if (this.timer <= 0) {
          this.finishLevel();
        }
        break;
      case 'clear':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.begin(g.level + 1);
        }
        break;
    }
  }

  private spawnWave(edt: number): void {
    const g = this.g;
    if (g.power.freeze > 0) {
      return;
    }
    const t = g.tuning;
    g.spawnTimer -= edt;
    if (g.spawnTimer <= 0 && g.spawnedForQuota < g.quota && g.mainEnemyCount() < t.maxConcurrent) {
      const next = this.plan[this.cursor];
      const tier = next?.spec.archetype ? ENEMY_DEFS[next.spec.archetype].tier : 0;
      if (tier === 3 && g.tier3OnScreen() >= t.maxTier3OnScreen) {
        g.spawnTimer = 0.3; // wait for the dangerous one on screen to be dealt with
      } else {
        this.cursor++;
        g.spawn(next?.spec ?? g.fallbackSpec(), false, next?.elite ?? false);
        g.spawnTimer = t.spawnInterval * rand(0.7, 1.3) * (tier === 3 ? 1.5 : tier === 2 ? 1.2 : 1);
      }
    }
    g.freshTimer -= edt;
    if (g.pendingFresh > 0 && g.freshTimer <= 0 && g.mainEnemyCount() < t.maxConcurrent + 4) {
      const spec = g.takeFresh();
      if (spec) {
        g.spawn(spec, true);
      }
      g.freshTimer = 0.45;
    }
  }

  private startBossIntro(): void {
    const g = this.g;
    const def = this.bossDef ?? bossForLevel(g.level);
    this.phase = 'bossIntro';
    this.timer = BOSS_INTRO_SECONDS;
    // 1. no more normal spawns (we're out of the wave) · 2. resolve hostile projectiles
    g.resolveEnemyProjectiles();
    for (const e of g.enemies) {
      e.mem.retreat = 1; // leftover bonus / support enemies leave the field
    }
    // 3. intro animation · 4. the boss enters (invulnerable until it's in position)
    const boss = g.spawnBoss(def);
    this.boss = new BossController(g, def, boss);
    g.announce('WARNING', `${def.title} · ${this.boss.signature}`, BOSS_INTRO_SECONDS, def.color);
    g.sfx('bossIntro');
  }

  /** Called when the boss's hit points reach zero. */
  onBossDefeated(e: Enemy): void {
    const g = this.g;
    this.phase = 'bossDefeat';
    this.timer = BOSS_DEFEAT_SECONDS;
    this.blast = { x: e.x, y: e.y, t: 0 };
    this.signature = this.boss?.signature ?? '';
    g.stats.bossesDefeated++;
    g.resolveEnemyProjectiles();
    for (const other of [...g.enemies]) {
      g.removeEnemy(other, true);
    }
    g.announce(`${this.bossDef?.title ?? 'BOSS'} DEFEATED`, this.signature, BOSS_DEFEAT_SECONDS, '#ffffff');
    g.sfx('bossDefeat');
    g.shake = 16;
  }

  private finishLevel(): void {
    const g = this.g;
    const clean = g.stats.livesLostThisLevel === 0;
    const bonus = 250 * g.level * (clean ? 2 : 1);
    g.score += bonus;
    const shots = g.stats.shots - this.start.shots;
    const hits = g.stats.hits - this.start.hits;
    this.summary = {
      level: g.level,
      kills: g.stats.kills - this.start.kills,
      accuracy: shots > 0 ? Math.round((hits / shots) * 100) : 0,
      bonus,
      clean,
      bossTitle: this.bossDef?.title ?? '',
      signature: this.signature,
    };
    this.boss = undefined;
    if (g.level >= FINAL_LEVEL) {
      g.win(this.signature);
      return;
    }
    this.phase = 'clear';
    this.timer = LEVEL_CLEAR_SECONDS;
    g.toast(clean ? `Clean build! +${bonus}` : `Level cleared +${bonus}`, 'good');
    g.sfx('level');
  }

  /** A real line of code for import reinforcements (plain enemies only — no nested groups). */
  reinforcementSpec(): EnemySpec {
    const pool = (this.g.snapshot?.specs ?? []).filter(
      (s) => s.kind !== 'bug' && s.kind !== 'warning' && (!s.archetype || ENEMY_DEFS[s.archetype].tier === 1),
    );
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : this.g.fallbackSpec();
  }
}
