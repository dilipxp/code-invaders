/**
 * CombatSystem rules that sit between "a shot touched an enemy" and "the enemy lost hit points":
 * phasing, timed shields, shield points, escort interception, exposed cores and armour.
 * Also the EnemyGroup bookkeeping when an enemy leaves the field.
 */
import type { Enemy, EnemyRole, Game } from '../game';

/** Roles that belong to another enemy and don't count toward the main-enemy cap. */
export const supportRoles: ReadonlySet<EnemyRole> = new Set<EnemyRole>(['escort', 'minion', 'module', 'head', 'clone', 'half']);

function deflect(g: Game, e: Enemy, color = '#ffffff'): void {
  g.ring(e.x, e.y, color, Math.max(24, e.w / (2 * g.u)));
  g.sfx('deflect');
}

/** Damage that actually reaches `e`'s hit points for a hit of `dmg` (0 when fully absorbed). */
export function absorbHit(g: Game, e: Enemy, dmg: number): number {
  if (e.phased) {
    return 0;
  }
  if (e.shieldTimer > 0) {
    deflect(g, e, '#7df9ff');
    return 0;
  }
  // Loop Commander: escorts intercept shots until their charges run out; while any escort lives
  // the commander only takes reduced damage.
  if (e.unit === 'for' && e.role === 'leader') {
    const escorts = g.childrenOf(e).filter((c) => c.role === 'escort');
    if (escorts.length > 0) {
      const blocker = escorts.find((c) => (c.mem.intercepts ?? 0) > 0);
      if (blocker) {
        blocker.mem.intercepts--;
        g.beam(blocker.x, blocker.y, e.x, e.y, g.colorOf(blocker));
        g.tag(blocker, 'BLOCK');
        deflect(g, e, g.colorOf(blocker));
        g.damageEnemy(blocker, 1);
        return 0;
      }
      dmg *= e.def?.cfg.shieldedDamage ?? 0.5;
    }
  }
  if (e.shield > 0) {
    e.shield = Math.max(0, e.shield - dmg);
    deflect(g, e, '#55ffff');
    if (e.shield === 0) {
      g.tag(e, 'SHIELD DOWN', '#ffffff');
    }
    return 0;
  }
  let applied = dmg * e.armor;
  if (e.exposed > 0) {
    applied *= e.def?.cfg.exposeDamage ?? 2;
  }
  if (applied < dmg) {
    deflect(g, e, '#aaaaaa');
  }
  return applied;
}

/**
 * Group cleanup when `e` leaves the field (destroyed, escaped, fled or removed with its parent):
 * support units that belong to it are removed, and its parent is told it lost a unit.
 */
export function onEnemyRemoved(g: Game, e: Enemy, killed: boolean): void {
  for (const child of g.childrenOf(e)) {
    if (child.def?.diesWithParent) {
      g.removeEnemy(child, true);
    } else {
      child.parentUid = undefined; // clones and halves carry on alone
    }
  }
  const parent = g.byUid(e.parentUid);
  if (!parent) {
    return;
  }
  if (e.role === 'escort' && parent.unit === 'for' && killed) {
    const left = g.childrenOf(parent).filter((c) => c.role === 'escort').length;
    if (left === 0) {
      parent.exposed = parent.def?.cfg.exposeTime ?? 4;
      parent.badge = 'CORE';
      g.tag(parent, 'CORE EXPOSED', '#ffffff');
      g.sfx('zap');
    }
  }
  if (parent.role === 'boss') {
    g.levels.boss?.onPartLost(e, killed);
  }
}
