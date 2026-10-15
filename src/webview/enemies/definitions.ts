/**
 * EnemyDefinition table: the stats, behaviour and look of every construct enemy, as data.
 * Behaviour code lives in `behaviors.ts` and reads its knobs from `cfg`, so balancing an enemy means
 * editing numbers here — not writing a new class.
 */
import type { Archetype } from '../../shared/protocol';
import type { CodePower } from '../game';

/** Units that only exist as part of another enemy's group. */
export type SupportUnit = 'escort' | 'minion' | 'half' | 'module' | 'head';
export type UnitType = Archetype | SupportUnit;

export type BehaviorId =
  | 'branch'
  | 'burst'
  | 'split'
  | 'dash'
  | 'flee'
  | 'summoner'
  | 'lane'
  | 'adaptive'
  | 'loop'
  | 'elite'
  | 'recover'
  | 'commander'
  | 'warp'
  | 'charge'
  | 'reinforce'
  | 'windup'
  | 'clone'
  | 'escort'
  | 'minion'
  | 'module'
  | 'drift';

export interface EnemyDefinition {
  unit: UnitType;
  /** 1 basic · 2 intermediate · 3 dangerous · 0 support unit. */
  tier: 0 | 1 | 2 | 3;
  /** Display name, e.g. "for Bot". */
  title: string;
  /** Role, e.g. "Loop Commander". */
  role: string;
  /** One line shown on the title screen and in the README. */
  ability: string;
  hp: number;
  /** Most extra hit points that source complexity (long / dense lines) may add. */
  maxBonus: number;
  /** Relative descent speed (1 = a plain statement). */
  speed: number;
  points: number;
  behavior: BehaviorId;
  /** Seconds between ordinary shots before difficulty scaling. Omit for enemies that don't shoot. */
  fire?: readonly [number, number];
  /** Behaviour knobs (documented in behaviors.ts). Times in seconds, distances relative to the size unit. */
  cfg: Readonly<Record<string, number>>;
  /** Neon theme colour and retro theme colour. */
  color: string;
  retroColor: string;
  /** Short text flashed when the ability triggers. */
  tag: string;
  /** Code power fired when it's destroyed (the original game's "code powers"). */
  power?: CodePower;
  /** Chance to drop a power-up when destroyed without a code power. */
  drop: number;
  /** Removed together with its parent (escorts, parameters, methods, modules). */
  diesWithParent?: boolean;
}

/** Hard limits that keep groups, clones and reinforcements fair. Tests assert these hold. */
export const LIMITS = {
  /** Escorts of one Loop Commander (1 + one per nested loop). */
  maxEscorts: 3,
  /** Attack cycles of a Loop Commander before its loop "terminates". */
  maxCommanderCycles: 6,
  /** Attack cycles of a while-loop enemy. */
  maxWhileCycles: 4,
  /** Clone generations below the original recursive enemy. */
  maxCloneDepth: 2,
  /** Clones alive per recursive family. */
  maxClonesPerFamily: 3,
  /** Reinforcement calls per import enemy and in total per level. */
  maxReinforcementCalls: 2,
  maxReinforcementsPerLevel: 6,
  /** Summoned parameter / method units alive per leader. */
  maxMinionsPerLeader: 3,
  /** Support units (escorts, minions, halves, clones, heads, modules) alive at once. */
  maxSupportOnScreen: 14,
  /** Enemy projectiles in flight at once. */
  maxEnemyBullets: 70,
  /** Shortest warning before a dangerous attack (seconds). */
  minTelegraph: 0.6,
} as const;

export const ENEMY_DEFS: Record<UnitType, EnemyDefinition> = {
  // ------------------------------------------------------------ Tier 1
  if: {
    unit: 'if', tier: 1, title: 'if Bot', role: 'Conditional Enemy',
    ability: 'picks a side of you to flank; dodges a shot when its condition flips',
    hp: 1, maxBonus: 1, speed: 1.25, points: 35, behavior: 'branch', fire: [3.2, 4.6],
    cfg: { offset: 0.16, steer: 150, dodgeCooldown: 2.8, dodgeDistance: 70 },
    color: '#ff9f1c', retroColor: '#ffff55', tag: 'ELSE!', power: 'branch', drop: 0,
  },
  and: {
    unit: 'and', tier: 1, title: '&& Bot', role: 'Double Strike',
    ability: 'fires twin shots that land together; && with || becomes a stronger combo',
    hp: 1, maxBonus: 1, speed: 1.3, points: 40, behavior: 'burst', fire: [2.4, 3.4],
    cfg: { spread: 14, comboShots: 2 },
    color: '#ffd166', retroColor: '#ffcc33', tag: '&&', drop: 0.06,
  },
  or: {
    unit: 'or', tier: 1, title: '|| Bot', role: 'Splitter',
    ability: 'often splits into two weaker halves when hit; alternates attack patterns',
    hp: 2, maxBonus: 1, speed: 1.05, points: 40, behavior: 'split', fire: [2.8, 4],
    cfg: { splitChance: 0.75, halves: 2 },
    color: '#06d6a0', retroColor: '#55ff99', tag: 'SPLIT', drop: 0.06,
  },
  arrow: {
    unit: 'arrow', tier: 1, title: '=> Bot', role: 'Arrow Bot',
    ability: 'telegraphs a dash to a new spot, then fires',
    hp: 1, maxBonus: 2, speed: 1, points: 40, behavior: 'dash',
    cfg: { cooldown: 2.8, windup: 0.6, dashTime: 0.32 },
    color: '#c77dff', retroColor: '#ff55ff', tag: 'DASH', drop: 0.06,
  },
  return: {
    unit: 'return', tier: 1, title: 'return Bot', role: 'Escape Enemy',
    ability: 'flees upward once damaged — if it gets away you lose its points',
    hp: 2, maxBonus: 1, speed: 1, points: 45, behavior: 'flee', fire: [3, 4.4],
    cfg: { fleeSpeed: 0.34 },
    color: '#ff9f1c', retroColor: '#ffaa00', tag: 'RETURN', power: 'return', drop: 0,
  },
  // ------------------------------------------------------------ Tier 2
  function: {
    unit: 'function', tier: 2, title: 'function Bot', role: 'Function Enemy',
    ability: 'predictable fan pattern; summons its parameters as support units',
    hp: 3, maxBonus: 3, speed: 0.8, points: 80, behavior: 'summoner', fire: [2.3, 2.3],
    cfg: { fan: 3, angle: 0.3, summonCooldown: 5, summons: 2 },
    color: '#c77dff', retroColor: '#ff55ff', tag: 'CALL', drop: 0.08,
  },
  const: {
    unit: 'const', tier: 2, title: 'const Bot', role: 'Static Defender',
    ability: 'holds a fixed lane behind a shield; slow, accurate shots',
    hp: 3, maxBonus: 2, speed: 0.9, points: 70, behavior: 'lane', fire: [2.6, 3.4],
    cfg: { laneMin: 0.16, laneMax: 0.42, shield: 3, hold: 12, shotSpeed: 0.75 },
    color: '#4cc9f0', retroColor: '#55ffff', tag: 'CONST', drop: 0.06,
  },
  let: {
    unit: 'let', tier: 2, title: 'let Bot', role: 'Adaptive Enemy',
    ability: 'reassigns itself between aggressive and defensive modes',
    hp: 3, maxBonus: 2, speed: 0.95, points: 70, behavior: 'adaptive', fire: [2, 3],
    cfg: { modeTime: 3.2, guardDamage: 0.5 },
    color: '#90e0ef', retroColor: '#aaffff', tag: 'REASSIGN', drop: 0.06,
  },
  while: {
    unit: 'while', tier: 2, title: 'while Bot', role: 'Loop Enemy',
    ability: 'repeats a sweep-and-fire cycle that grows each time — capped, then it breaks',
    hp: 3, maxBonus: 3, speed: 0.7, points: 90, behavior: 'loop',
    cfg: { cycleTime: 2.4, baseShots: 2 },
    color: '#ff9f1c', retroColor: '#ffff55', tag: 'LOOP', power: 'loop', drop: 0,
  },
  class: {
    unit: 'class', tier: 2, title: 'class Bot', role: 'Elite Enemy',
    ability: 'rotates several attacks and spawns its methods',
    hp: 6, maxBonus: 4, speed: 0.45, points: 300, behavior: 'elite', fire: [2, 2.8],
    cfg: { spawnCooldown: 6, methods: 2 },
    color: '#ffcc33', retroColor: '#ff5555', tag: 'NEW', drop: 1,
  },
  try: {
    unit: 'try', tier: 2, title: 'try/catch Bot', role: 'Recovery Enemy',
    ability: 'catches damage: raises a timed shield, then needs a cooldown',
    hp: 4, maxBonus: 2, speed: 0.85, points: 90, behavior: 'recover', fire: [2.6, 3.6],
    cfg: { shieldTime: 2.2, cooldown: 4.5 },
    color: '#7df9ff', retroColor: '#55ffff', tag: 'CATCH', power: 'try', drop: 0,
  },
  // ------------------------------------------------------------ Tier 3
  for: {
    unit: 'for', tier: 3, title: 'for Bot', role: 'Loop Commander',
    ability: 'escorted by its loop variables; destroy them to expose the core',
    hp: 8, maxBonus: 4, speed: 0.38, points: 450, behavior: 'commander',
    cfg: { intercepts: 3, exposeTime: 4, exposeDamage: 2, shieldedDamage: 0.5, cycleTime: 2.6, laneTime: 3.4, baseCycles: 4 },
    color: '#ff9f1c', retroColor: '#ffff55', tag: 'LOOP', power: 'loop', drop: 0,
  },
  async: {
    unit: 'async', tier: 3, title: 'async/await Bot', role: 'Time-Warp Enemy',
    ability: 'vanishes and reappears with a new, telegraphed attack',
    hp: 4, maxBonus: 2, speed: 0.6, points: 220, behavior: 'warp',
    cfg: { visible: 2.8, hidden: 1.4, warn: 0.8 },
    color: '#9d4edd', retroColor: '#aa88ff', tag: 'AWAIT', power: 'await', drop: 0,
  },
  promise: {
    unit: 'promise', tier: 3, title: 'Promise Bot', role: 'Delayed Attack',
    ability: 'charges a pending shot that resolves into a small follow-up burst',
    hp: 4, maxBonus: 2, speed: 0.65, points: 200, behavior: 'charge',
    cfg: { cooldown: 3.4, charge: 1.2, fuse: 1.1, fragments: 3 },
    color: '#f72585', retroColor: '#ff55aa', tag: 'PENDING', drop: 0.1,
  },
  import: {
    unit: 'import', tier: 3, title: 'import Bot', role: 'Invader Reinforcement',
    ability: 'enters from the edge and calls a limited number of reinforcements',
    hp: 4, maxBonus: 2, speed: 0.7, points: 180, behavior: 'reinforce', fire: [3.4, 4.6],
    cfg: { callCooldown: 4, perCall: 2 },
    color: '#00f5d4', retroColor: '#55ffff', tag: 'IMPORT', power: 'import', drop: 0,
  },
  throw: {
    unit: 'throw', tier: 3, title: 'throw Bot', role: 'Projectile Specialist',
    ability: 'winds up, then hurls a heavy shot at where you were',
    hp: 3, maxBonus: 2, speed: 0.8, points: 160, behavior: 'windup',
    cfg: { cooldown: 3.6, windup: 1, shotSpeed: 1.25 },
    color: '#ff3864', retroColor: '#ff5555', tag: 'THROW', power: 'throw', drop: 0,
  },
  recursive: {
    unit: 'recursive', tier: 3, title: 'recursive Bot', role: 'Clone Enemy',
    ability: 'creates weaker copies of itself — strictly bounded depth and count',
    hp: 5, maxBonus: 2, speed: 0.6, points: 220, behavior: 'clone', fire: [2.8, 3.8],
    cfg: { cloneCooldown: 4, hpScale: 0.55 },
    color: '#ff6ec7', retroColor: '#ff55ff', tag: 'RECURSE', drop: 0.1,
  },
  // ------------------------------------------------------------ Support units
  escort: {
    unit: 'escort', tier: 0, title: 'loop variable', role: 'Escort',
    ability: 'orbits its Loop Commander and intercepts shots aimed at it',
    hp: 2, maxBonus: 0, speed: 0, points: 30, behavior: 'escort',
    cfg: { radius: 44, orbitSpeed: 1.7 },
    color: '#ffd166', retroColor: '#ffffff', tag: 'BLOCK', drop: 0, diesWithParent: true,
  },
  minion: {
    unit: 'minion', tier: 0, title: 'argument', role: 'Support Unit',
    ability: 'a parameter or method fighting for its leader',
    hp: 1, maxBonus: 0, speed: 0, points: 15, behavior: 'minion', fire: [3.2, 4.8],
    cfg: {},
    color: '#e0aaff', retroColor: '#ff99ff', tag: '', drop: 0, diesWithParent: true,
  },
  half: {
    unit: 'half', tier: 0, title: 'branch', role: 'Split Half',
    ability: 'one side of an || expression',
    hp: 1, maxBonus: 0, speed: 1.3, points: 20, behavior: 'drift',
    cfg: {},
    color: '#06d6a0', retroColor: '#55ff99', tag: '', drop: 0,
  },
  module: {
    unit: 'module', tier: 0, title: 'method module', role: 'Boss Module',
    ability: 'an armoured method of the Class Overlord; destroy it to disable an attack',
    hp: 6, maxBonus: 0, speed: 0, points: 120, behavior: 'module',
    cfg: {},
    color: '#ffcc33', retroColor: '#ffaa00', tag: 'MODULE', drop: 0, diesWithParent: true,
  },
  head: {
    unit: 'head', tier: 0, title: 'hydra head', role: 'Recursive Clone',
    ability: 'a smaller copy of the Recursive Hydra',
    hp: 4, maxBonus: 0, speed: 0, points: 90, behavior: 'minion', fire: [2.4, 3.6],
    cfg: {},
    color: '#ff6ec7', retroColor: '#ff55ff', tag: '', drop: 0, diesWithParent: true,
  },
};

export function definitionOf(unit: UnitType): EnemyDefinition {
  return ENEMY_DEFS[unit];
}
