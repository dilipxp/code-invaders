/**
 * SpawnDirector: turns the analysed source into one level's wave.
 *
 * The wave is normalised to the level's difficulty budget (`Tuning.quota`), so a 5-line file and a
 * 5,000-line file both get a fair fight:
 *   - the source's composition decides *which* enemies appear (more loops → more loop enemies,
 *     more conditionals → more conditional enemies…), proportionally;
 *   - the budget decides *how many*, with per-tier caps;
 *   - large files are sampled evenly across the file instead of spawning hundreds of enemies;
 *   - nested loops (and, late in the game, the occasional dense construct) become elite variants.
 */
import type { Archetype, EnemySpec } from '../shared/protocol';
import type { Tuning } from './difficulty';
import { ENEMY_DEFS } from './enemies/definitions';

export interface PlannedSpawn {
  spec: EnemySpec;
  elite: boolean;
}

/** Share of the wave reserved for diagnostics (bugs / warnings) when the file has any. */
const DIAGNOSTIC_SHARE = 0.2;

/** Evenly spaced picks from a list (representative sampling of large files). */
export function sampleEvenly<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) {
    return [];
  }
  if (count >= items.length) {
    const out: T[] = [];
    for (let k = 0; k < count; k++) out.push(items[k % items.length]);
    return out;
  }
  const out: T[] = [];
  for (let k = 0; k < count; k++) {
    out.push(items[Math.floor(((k + 0.5) * items.length) / count)]);
  }
  return out;
}

/** Split `total` slots across buckets proportionally (largest remainder), each bucket ≥ 1 while slots last. */
export function allocate(counts: ReadonlyMap<Archetype, number>, total: number): Map<Archetype, number> {
  const out = new Map<Archetype, number>();
  const entries = [...counts.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (total <= 0 || entries.length === 0) {
    return out;
  }
  // Variety first: one of each present archetype (most common first) while the budget allows.
  let left = total;
  for (const [a] of entries) {
    if (left <= 0) break;
    out.set(a, 1);
    left--;
  }
  if (left <= 0) {
    return out;
  }
  const sum = entries.reduce((s, [, n]) => s + n, 0);
  const shares = entries.map(([a, n]) => ({ a, exact: (n / sum) * left }));
  let given = 0;
  for (const s of shares) {
    const whole = Math.floor(s.exact);
    out.set(s.a, (out.get(s.a) ?? 0) + whole);
    given += whole;
  }
  shares.sort((x, y) => (y.exact % 1) - (x.exact % 1));
  for (let k = 0; given < left; k++, given++) {
    const a = shares[k % shares.length].a;
    out.set(a, (out.get(a) ?? 0) + 1);
  }
  return out;
}

export function planWave(specs: readonly EnemySpec[], level: number, tuning: Tuning): PlannedSpawn[] {
  const quota = tuning.quota;
  const diags = specs.filter((s) => s.kind === 'bug' || s.kind === 'warning');
  const constructs = specs.filter((s) => s.archetype && s.kind !== 'bug' && s.kind !== 'warning');
  const grunts = specs.filter((s) => !s.archetype && s.kind !== 'bug' && s.kind !== 'warning');

  const diagSlots = Math.min(diags.length, Math.round(quota * DIAGNOSTIC_SHARE));
  const codeSlots = quota - diagSlots;
  const constructPool = constructs.length;
  const constructSlots =
    constructPool === 0 ? 0 : grunts.length === 0 ? codeSlots : Math.min(codeSlots, Math.max(1, Math.round(codeSlots * tuning.constructShare)));

  // Group by archetype, keeping source order inside each group.
  const byArch = new Map<Archetype, EnemySpec[]>();
  for (const s of constructs) {
    const list = byArch.get(s.archetype!) ?? [];
    list.push(s);
    byArch.set(s.archetype!, list);
  }

  // Per-tier caps: tier-3 and tier-2 constructs are limited per wave; overflow goes to tier 1.
  const tierCap: Record<number, number> = { 1: Infinity, 2: tuning.maxTier2, 3: tuning.maxTier3 };
  const chosen: PlannedSpawn[] = [];
  let remaining = constructSlots;
  for (const tier of [3, 2, 1] as const) {
    const counts = new Map<Archetype, number>();
    for (const [a, list] of byArch) {
      if (ENEMY_DEFS[a].tier === tier) counts.set(a, list.length);
    }
    // This tier's share of the construct slots is proportional to its share of the source.
    const tierTotal = [...counts.values()].reduce((s, n) => s + n, 0);
    if (tierTotal === 0) continue;
    const fair = tier === 1 ? remaining : Math.round((tierTotal / constructPool) * constructSlots);
    const slots = Math.min(remaining, tierCap[tier], Math.max(tier === 1 ? 0 : 1, fair));
    for (const [a, n] of allocate(counts, slots)) {
      for (const spec of sampleEvenly(byArch.get(a)!, n)) {
        const nesting = spec.construct?.nesting ?? 1;
        const elite = (a === 'for' && nesting >= 2 && level >= 2) || (level >= 4 && tier >= 2 && chosen.length % 5 === 4);
        chosen.push({ spec, elite });
      }
    }
    remaining -= Math.min(remaining, slots);
  }

  const gruntSlots = codeSlots - chosen.length;
  for (const spec of sampleEvenly(grunts.length > 0 ? grunts : constructs, gruntSlots)) {
    chosen.push({ spec, elite: false });
  }
  for (const spec of sampleEvenly(diags, diagSlots)) {
    chosen.push({ spec, elite: false });
  }

  // Your code descends top to bottom, like the original game; diagnostics are mixed in.
  chosen.sort((a, b) => a.spec.line - b.spec.line);
  return chosen.slice(0, quota);
}
