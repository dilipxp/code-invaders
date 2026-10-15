/**
 * DifficultyManager: every number that makes the game harder lives here, as a pure function of the
 * level and the `codeInvaders.difficulty` setting. Everything ramps gradually and is capped so late
 * levels stay fair (no enemy gets unfairly fast, no attack gets an unfair fire rate).
 */
import type { Difficulty } from '../shared/protocol';

export interface Tuning {
  /** Base descent speed as a fraction of the playfield height per second. */
  descent: number;
  /** Multiplier on enemy attack rate (higher = more attacks). */
  fireRate: number;
  /** Enemy projectile speed as a fraction of the playfield height per second. */
  projectileSpeed: number;
  /** Seconds between normal spawns. */
  spawnInterval: number;
  /** Main enemies on screen at once (support units such as escorts are counted separately). */
  maxConcurrent: number;
  /** Enemies in the level's wave before the boss arrives. */
  quota: number;
  /** Extra hit points for every normal enemy. */
  hpBonus: number;
  /** Multiplier on boss hit points. */
  bossHp: number;
  /** Multiplier on enemy ability cooldowns (lower = abilities come back sooner). */
  cooldown: number;
  /** Tier-2 / tier-3 construct enemies allowed per wave. */
  maxTier2: number;
  maxTier3: number;
  /** Tier-3 enemies alive at the same time. */
  maxTier3OnScreen: number;
  /** Share of the wave given to construct enemies (the rest are plain code lines). */
  constructShare: number;
}

interface Preset {
  speed: number;
  fire: number;
  quota: number;
  boss: number;
  cooldown: number;
}

export const DIFFICULTY_PRESETS: Record<Difficulty, Preset> = {
  chill: { speed: 0.75, fire: 0.55, quota: 0.8, boss: 0.7, cooldown: 1.25 },
  normal: { speed: 1, fire: 1, quota: 1, boss: 1, cooldown: 1 },
  hardcore: { speed: 1.3, fire: 1.6, quota: 1.25, boss: 1.35, cooldown: 0.85 },
};

/** Hard ceilings that hold whatever the level or setting. */
export const DIFFICULTY_CAPS = {
  descent: 0.16,
  fireRate: 2.2,
  projectileSpeed: 0.6,
  minSpawnInterval: 0.32,
  maxConcurrent: 14,
  minCooldown: 0.6,
} as const;

export function tuningFor(level: number, difficulty: Difficulty): Tuning {
  const p = DIFFICULTY_PRESETS[difficulty] ?? DIFFICULTY_PRESETS.normal;
  const L = Math.max(1, Math.floor(level));
  const ramp = Math.min(L, 15);
  return {
    descent: Math.min(DIFFICULTY_CAPS.descent, (0.05 + ramp * 0.0065) * p.speed),
    fireRate: Math.min(DIFFICULTY_CAPS.fireRate, p.fire * (1 + Math.min(L, 10) * 0.05)),
    projectileSpeed: Math.min(DIFFICULTY_CAPS.projectileSpeed, 0.42 * (1 + Math.min(L, 8) * 0.03) * Math.sqrt(p.speed)),
    spawnInterval: Math.max(DIFFICULTY_CAPS.minSpawnInterval, 1.25 - L * 0.07),
    maxConcurrent: Math.min(DIFFICULTY_CAPS.maxConcurrent, 4 + L),
    quota: Math.round((7 + L * 3) * p.quota),
    hpBonus: Math.floor((L - 1) / 4),
    bossHp: p.boss * (1 + (L - 1) * 0.12),
    cooldown: Math.max(DIFFICULTY_CAPS.minCooldown, p.cooldown * (1 - (Math.min(L, 6) - 1) * 0.05)),
    maxTier2: Math.min(8, 2 + L),
    maxTier3: Math.min(5, Math.ceil(L / 1.5)),
    maxTier3OnScreen: L <= 2 ? 1 : 2,
    constructShare: Math.min(0.75, 0.45 + (L - 1) * 0.07),
  };
}
