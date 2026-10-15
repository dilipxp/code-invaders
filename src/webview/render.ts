import { BOSS_DEFS } from './bosses';
import { ENEMY_DEFS, type UnitType } from './enemies/definitions';
import { KIND_COLORS, lookOf, measureNeon, type Enemy, type EnemyMeasure, type Game, type PowerKind } from './game';

/** Common surface for the neon and retro renderers. */
export interface GameRenderer {
  /** Hitbox size of an enemy as this renderer draws it. */
  readonly measure: EnemyMeasure;
  resize(w: number, h: number, dpr: number, u: number): void;
  render(game: Game): void;
}

interface Star {
  x: number;
  y: number;
  z: number; // 0..1 depth (1 = near)
  tw: number; // twinkle phase
}

const FONT = '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace';
const CYAN = '#7df9ff';
const MAGENTA = '#ff4fd8';
const PURPLE = '#9d4edd';

const POWER_STYLE: Record<PowerKind, { color: string; glyph: string }> = {
  triple: { color: '#c77dff', glyph: '...' },
  rapid: { color: '#ff9f1c', glyph: '»' },
  shield: { color: '#7df9ff', glyph: '{}' },
  life: { color: '#7bff8a', glyph: '+1' },
};

type Pt = readonly [number, number];

/** Vector hulls for construct enemies and bosses, in unit coordinates (x, y ∈ −1…1). */
const NEON_SHAPES: Record<string, readonly Pt[]> = {
  if: [[-1, -1], [-0.4, -1], [0, -0.25], [0.4, -1], [1, -1], [0.35, 0.55], [0, 1], [-0.35, 0.55]],
  arrow: [[-1, -1], [0, -0.3], [1, -1], [0.65, 0.15], [0, 1], [-0.65, 0.15]],
  return: [[0, -1], [1, 0.15], [0.4, 0.15], [0.4, 1], [-0.4, 1], [-0.4, 0.15], [-1, 0.15]],
  const: [[-1, -1], [-0.6, -1], [-0.6, -0.65], [-0.2, -0.65], [-0.2, -1], [0.2, -1], [0.2, -0.65], [0.6, -0.65], [0.6, -1], [1, -1], [1, 0.55], [0, 1], [-1, 0.55]],
  try: [[-1, -1], [1, -1], [1, 0], [0, 1], [-1, 0]],
  for: [[-1, -0.2], [-0.6, -1], [0.6, -1], [1, -0.2], [0.75, 0.5], [0.25, 1], [-0.25, 1], [-0.75, 0.5]],
  import: [[-1, -1], [1, -1], [1, 0.7], [0.6, 1], [-0.6, 1], [-1, 0.7]],
  escort: [[0, 1], [1, -0.6], [0, -0.2], [-1, -0.6]],
  minion: [[0, -1], [1, 0], [0, 1], [-1, 0]],
  half: [[0, -1], [1, 0.4], [0, 1], [-1, 0.4]],
  module: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  'boss:overlord': [[-1, -0.1], [-0.75, -1], [0.75, -1], [1, -0.1], [0.85, 0.6], [0.35, 1], [-0.35, 1], [-0.85, 0.6]],
  'boss:phantom': [[-1, 1], [-1, -0.2], [-0.7, -0.85], [0, -1], [0.7, -0.85], [1, -0.2], [1, 1], [0.6, 0.7], [0.2, 1], [-0.2, 0.7], [-0.6, 1]],
  'boss:hydra': [[-1, -0.3], [-0.5, -1], [0.5, -1], [1, -0.3], [0.6, 1], [-0.6, 1]],
};

function neonUnitColor(e: Enemy): string {
  if (e.bossId) {
    return BOSS_DEFS.find((b) => b.id === e.bossId)?.color ?? '#ffffff';
  }
  return e.unit ? ENEMY_DEFS[e.unit as UnitType].color : KIND_COLORS[e.kind];
}

/** Neon synthwave look. Owns only cosmetic state (stars, nebula cache). */
export class NeonRenderer implements GameRenderer {
  readonly measure = measureNeon;
  private readonly ctx: CanvasRenderingContext2D;
  private stars: Star[] = [];
  private nebula: HTMLCanvasElement | undefined;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Canvas 2D is not available');
    }
    this.ctx = ctx;
  }

  resize(w: number, h: number, dpr: number, _u?: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const count = Math.round(Math.min(420, (w * h) / 2600));
    this.stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random() ** 2,
      tw: Math.random() * Math.PI * 2,
    }));
    this.nebula = this.buildNebula(w, h);
  }

  private buildNebula(w: number, h: number): HTMLCanvasElement | undefined {
    if (w < 2 || h < 2) {
      return undefined;
    }
    const c = document.createElement('canvas');
    c.width = Math.round(w / 2);
    c.height = Math.round(h / 2);
    const g = c.getContext('2d');
    if (!g) {
      return undefined;
    }
    const blobs: Array<[number, number, number, string]> = [
      [0.2, 0.25, 0.55, 'rgba(157, 78, 221, 0.22)'],
      [0.85, 0.15, 0.45, 'rgba(0, 180, 216, 0.16)'],
      [0.65, 0.65, 0.6, 'rgba(255, 79, 216, 0.10)'],
      [0.1, 0.8, 0.4, 'rgba(0, 245, 212, 0.08)'],
    ];
    for (const [bx, by, br, color] of blobs) {
      const r = br * Math.max(c.width, c.height);
      const grad = g.createRadialGradient(bx * c.width, by * c.height, 0, bx * c.width, by * c.height, r);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }

  render(game: Game): void {
    const ctx = this.ctx;
    const glow = !game.settings.reducedEffects;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true; // the retro renderer shares this context and turns it off

    this.drawBackground(game);
    this.drawVignette(); // under the action so ships near the edges stay bright

    ctx.save();
    if (game.shake > 0 && glow) {
      ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }

    if (game.state !== 'title') {
      for (const pu of game.powerups) {
        this.drawPowerUp(pu.x, pu.y, pu.kind, pu.age, game.u, glow);
      }
      this.drawWarnings(game);
      for (const e of game.enemies) {
        if (lookOf(e)) this.drawUnit(e, game, glow);
        else this.drawEnemy(e, game, glow);
      }
      this.drawBullets(game, glow);
      if (game.player.alive && game.state !== 'over') {
        this.drawPlayer(game, glow);
      }
    }
    this.drawParticles(game, glow);
    this.drawTexts(game);
    ctx.restore();

    this.drawBossBar(game);
    if (game.state === 'playing' && game.levelIntro > 0) {
      this.drawLevelBanner(game);
    } else if (game.state === 'playing' && game.levels.phase === 'clear' && game.levels.summary) {
      this.drawSummary(game);
    } else if (game.state === 'playing' && game.banner.time > 0) {
      this.drawAnnouncement(game);
    }
  }

  // ------------------------------------------------------------------ construct enemies & bosses

  private poly(points: readonly Pt[], hw: number, hh: number): void {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x * hw, y * hh) : ctx.moveTo(x * hw, y * hh)));
    ctx.closePath();
  }

  private drawUnit(e: Enemy, game: Game, glow: boolean): void {
    const { ctx } = this;
    const u = game.u;
    const look = lookOf(e)!;
    const base = game.power.freeze > 0 ? '#8fd3ff' : neonUnitColor(e);
    const blink = Math.floor(game.time * 10) % 2 === 0;
    const color = e.flash > 0.5 || (e.windup > 0.5 && blink) ? '#ffffff' : base;
    const hw = e.w / 2;
    const hh = e.h / 2;
    const boss = e.role === 'boss';

    // Tether to the group leader.
    const parent = e.parentUid !== undefined ? game.byUid(e.parentUid) : undefined;
    if (parent && e.role !== 'clone') {
      ctx.save();
      ctx.strokeStyle = withAlpha(base, 0.35);
      ctx.setLineDash([3 * u, 5 * u]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(parent.x, parent.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(e.x + (e.windup > 0 ? Math.sin(game.time * 50) * 2 * e.windup * u : 0), e.y);
    if (e.phased) {
      ctx.globalAlpha = 0.18 + 0.1 * Math.sin(game.time * 12);
      ctx.setLineDash([4 * u, 4 * u]);
    } else if (e.role === 'clone') {
      ctx.globalAlpha = 0.8;
    }
    if (glow && !e.phased) {
      ctx.shadowColor = base;
      ctx.shadowBlur = boss ? 26 : e.windup > 0 ? 10 + 20 * e.windup : 12;
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = withAlpha(base, boss ? 0.22 : 0.16);
    ctx.lineWidth = boss ? 3 : 2;

    switch (look) {
      case 'and':
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(side * hw * 0.5, 0, Math.min(hh, hw * 0.45), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        break;
      case 'or':
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(side * 2 * u, -hh);
          ctx.lineTo(side * hw, 0);
          ctx.lineTo(side * 2 * u, hh);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        break;
      case 'while':
      case 'promise':
      case 'boss:loop': {
        if (look === 'boss:loop') {
          // ∞
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(side * hw * 0.48, 0, hw * 0.46, hh * 0.85, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        } else {
          ctx.beginPath();
          ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Spinning loop / pending arc.
          ctx.beginPath();
          ctx.ellipse(0, 0, hw + 5 * u, hh + 5 * u, 0, game.time * 4, game.time * 4 + Math.PI * (look === 'while' ? 1.5 : 0.7));
          ctx.stroke();
        }
        break;
      }
      case 'let': {
        const pts: Pt[] = [];
        const n = 8;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          const rr = e.mem.mode ? (k % 2 ? 0.55 : 1) : 0.85;
          pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        this.poly(pts, hw, hh);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'throw': {
        const pts: Pt[] = [];
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 + e.age * 2;
          const rr = k % 2 ? 0.5 : 1;
          pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        this.poly(pts, Math.min(hw, hh * 1.3), hh);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'async':
        ctx.beginPath();
        ctx.moveTo(-hw * 0.7, -hh);
        ctx.lineTo(hw * 0.7, -hh);
        ctx.lineTo(-hw * 0.7, hh);
        ctx.lineTo(hw * 0.7, hh);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 'function':
      case 'recursive':
      case 'class':
      case 'head':
      case 'boss:runtime': {
        if (look === 'class') {
          this.poly(NEON_SHAPES['boss:overlord'], hw, hh);
        } else if (look === 'boss:runtime' || look === 'head') {
          ctx.beginPath();
          ctx.ellipse(0, 0, hw * 0.8, hh * 0.9, 0, 0, Math.PI * 2);
        } else {
          this.poly([[-1, 0], [-0.7, -1], [0.7, -1], [1, 0], [0.7, 1], [-0.7, 1]], hw, hh);
        }
        ctx.fill();
        ctx.stroke();
        if (look === 'recursive') {
          ctx.save();
          ctx.scale(0.6, 0.6);
          this.poly([[-1, 0], [-0.7, -1], [0.7, -1], [1, 0], [0.7, 1], [-0.7, 1]], hw, hh);
          ctx.stroke();
          ctx.restore();
        }
        if (look === 'boss:runtime') {
          ctx.beginPath();
          for (let k = -1; k <= 1; k++) {
            ctx.moveTo(-hw * 0.7, k * hh * 0.4);
            ctx.lineTo(-hw, k * hh * 0.5 + Math.sin(e.age * 10 + k) * 6 * u);
            ctx.moveTo(hw * 0.7, k * hh * 0.4);
            ctx.lineTo(hw, k * hh * 0.5 - Math.sin(e.age * 10 + k) * 6 * u);
          }
          ctx.stroke();
        }
        break;
      }
      default: {
        const shape = NEON_SHAPES[look];
        if (shape) {
          this.poly(shape, hw, hh);
        } else {
          roundRect(ctx, -hw, -hh * 0.7, e.w, hh * 1.4, 6 * u);
        }
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);

    if (!e.phased) {
      if (boss) {
        this.label(e.spec.label, 0, 0, 16 * u, '#ffffff', glow, 'bold');
      } else {
        this.label(e.spec.label, 0, look === 'for' ? -hh * 0.15 : 0, (e.role === 'escort' ? 12 : e.def?.tier === 3 ? 12 : 11) * u, color, glow, 'bold');
      }
      if (e.showSig > 0 && e.spec.construct?.signature) {
        ctx.globalAlpha = Math.min(1, e.showSig * 2);
        this.label(e.spec.construct.signature, 0, hh + 10 * u, 10 * u, '#ffffff', false);
        ctx.globalAlpha = 1;
      }
      // Shields.
      if (e.shieldTimer > 0 && !boss) {
        const max = e.mem.shieldMax || 2;
        ctx.strokeStyle = `rgba(125, 249, 255, ${0.5 + 0.4 * Math.sin(game.time * 10)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(hw, hh) + 6 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (e.shieldTimer / max));
        ctx.stroke();
      }
      if (e.shield > 0) {
        ctx.fillStyle = '#7df9ff';
        for (let k = 0; k < e.shield; k++) ctx.fillRect(-e.shieldMax * 5 * u + k * 10 * u, -hh - 7 * u, 8 * u, 3 * u);
      }
      if (e.exposed > 0) {
        ctx.fillStyle = blink ? '#ffffff' : base;
        ctx.beginPath();
        ctx.arc(0, hh * 0.2, 5 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      const badge = boss ? '' : e.badge || (e.fresh ? 'NEW' : '');
      if (badge) {
        this.label(badge, 0, -hh - (e.shield > 0 ? 14 : 8) * u, 9 * u, '#ffffff', false, 'bold');
      }
      if (e.elite) {
        ctx.fillStyle = blink ? '#ffffff' : '#ffd166';
        ctx.font = `bold ${11 * u}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('★', hw + 6 * u, -hh + 4 * u);
      }
      if (e.maxHp > 1 && !boss) {
        const bw = Math.min(e.w, 60 * u);
        const y = hh + (e.showSig > 0 ? 16 : 6) * u;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(-bw / 2, y, bw, 3 * u);
        ctx.fillStyle = base;
        ctx.fillRect(-bw / 2, y, bw * Math.max(0, e.hp / e.maxHp), 3 * u);
      }
    }
    ctx.restore();
  }

  private drawWarnings(game: Game): void {
    const { ctx } = this;
    const u = game.u;
    const blink = Math.floor(game.time * 12) % 2 === 0;
    ctx.save();
    for (const w of game.warnings) {
      const k = w.life / w.max; // 1 → 0
      const urgent = k < 0.4;
      ctx.globalAlpha = urgent ? (blink ? 0.95 : 0.4) : 0.65;
      ctx.strokeStyle = urgent ? '#ffffff' : w.color;
      ctx.fillStyle = withAlpha(w.color, 0.12);
      ctx.lineWidth = 2;
      ctx.setLineDash([6 * u, 6 * u]);
      ctx.lineDashOffset = -game.time * 40;
      switch (w.kind) {
        case 'circle':
        case 'marker':
          ctx.beginPath();
          ctx.arc(w.x, w.y, w.r * (w.kind === 'marker' ? 0.6 + 0.4 * k : 1), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          this.label('!', w.x, w.y, 16 * u, ctx.strokeStyle as string, false, 'bold');
          if (w.label) this.label(w.label, w.x, w.y + w.r + 10 * u, 10 * u, w.color, false);
          break;
        case 'line':
          ctx.beginPath();
          ctx.moveTo(w.x, w.y);
          ctx.lineTo(w.x2 ?? w.x, w.y2 ?? w.y);
          ctx.stroke();
          break;
        case 'column':
          ctx.fillRect(w.x - w.r, 0, w.r * 2, this.h);
          ctx.strokeRect(w.x - w.r, 0, w.r * 2, this.h);
          this.label('!', w.x, 40 * u, 16 * u, ctx.strokeStyle as string, false, 'bold');
          break;
        case 'row': {
          const gap = w.x2 ?? -9999;
          ctx.beginPath();
          ctx.moveTo(0, w.y);
          ctx.lineTo(gap - w.r, w.y);
          ctx.moveTo(gap + w.r, w.y);
          ctx.lineTo(this.w, w.y);
          ctx.stroke();
          this.label('gap', gap, w.y + 12 * u, 11 * u, '#7bff8a', false, 'bold');
          break;
        }
      }
    }
    ctx.setLineDash([]);
    for (const hz of game.hazards) {
      if (hz.warn > 0) {
        ctx.globalAlpha = blink ? 0.5 : 0.25;
        ctx.fillStyle = withAlpha(hz.color, 0.25);
        ctx.fillRect(hz.x - hz.w / 2, 0, hz.w, this.h);
        ctx.globalAlpha = 1;
        this.label('!!', hz.x, 40 * u, 16 * u, '#ffffff', false, 'bold');
      } else {
        ctx.globalAlpha = 0.9;
        const g = ctx.createLinearGradient(hz.x - hz.w / 2, 0, hz.x + hz.w / 2, 0);
        g.addColorStop(0, withAlpha(hz.color, 0));
        g.addColorStop(0.5, '#ffffff');
        g.addColorStop(1, withAlpha(hz.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(hz.x - hz.w / 2, 0, hz.w, this.h);
      }
    }
    ctx.restore();
  }

  private drawBossBar(game: Game): void {
    const boss = game.levels.boss;
    if (!boss || !boss.alive || game.state === 'over' || game.state === 'title') {
      return;
    }
    const { ctx } = this;
    const u = game.u;
    const e = boss.enemy;
    const w = Math.min(this.w * 0.6, 520 * u);
    const x0 = (this.w - w) / 2;
    const y = 64 * u;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(13 * u)}px ${FONT}`;
    ctx.fillStyle = boss.def.color;
    ctx.shadowColor = boss.def.color;
    ctx.shadowBlur = 10;
    ctx.fillText(boss.def.title, this.w / 2, y - 8 * u);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x0, y, w, 8 * u);
    ctx.fillStyle = e.shieldTimer > 0 ? '#ffffff' : boss.def.color;
    ctx.fillRect(x0, y, w * Math.max(0, e.hp / e.maxHp), 8 * u);
    ctx.fillStyle = '#04010d';
    for (const ph of boss.def.phases) {
      if (ph.until > 0) ctx.fillRect(x0 + w * ph.until - 1, y - 2 * u, 2, 12 * u);
    }
    ctx.font = `${Math.round(11 * u)}px ${FONT}`;
    ctx.fillStyle = '#cfc8ff';
    ctx.fillText(`phase ${boss.phaseIndex + 1}/${boss.def.phases.length} · ${boss.phase.name}${e.badge && e.badge !== boss.phase.name.toUpperCase() ? ' · ' + e.badge.toLowerCase() : ''}`, this.w / 2, y + 22 * u);
    ctx.restore();
  }

  private drawAnnouncement(game: Game): void {
    const { ctx, w, h } = this;
    const t = game.banner;
    const a = Math.min(1, t.time * 3, (t.max - t.time) * 5);
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(40 * game.u)}px ${FONT}`;
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = t.text === 'WARNING' && Math.floor(game.time * 6) % 2 ? '#ffffff' : t.color;
    ctx.fillText(t.text, w / 2, h * 0.42);
    ctx.shadowBlur = 0;
    if (t.sub) {
      ctx.font = `${Math.round(15 * game.u)}px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.sub, w / 2, h * 0.42 + 40 * game.u, w - 40);
    }
    ctx.restore();
  }

  private drawSummary(game: Game): void {
    const { ctx, w, h } = this;
    const s = game.levels.summary!;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(38 * game.u)}px ${FONT}`;
    ctx.shadowColor = '#7bff8a';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#7bff8a';
    ctx.fillText(`LEVEL ${s.level} CLEAR`, w / 2, h * 0.34);
    ctx.shadowBlur = 0;
    ctx.font = `${Math.round(15 * game.u)}px ${FONT}`;
    const rows = [
      `${s.bossTitle.toLowerCase()} defeated — ${s.signature}`,
      `kills ${s.kills} · accuracy ${s.accuracy}%`,
      `${s.clean ? 'clean build · ' : ''}bonus +${s.bonus.toLocaleString('en-US')}`,
    ];
    rows.forEach((row, i) => {
      ctx.fillStyle = i === 2 && s.clean ? '#ffd166' : '#ffffff';
      ctx.fillText(row, w / 2, h * 0.34 + (44 + i * 24) * game.u, w - 40);
    });
    ctx.restore();
  }

  // ------------------------------------------------------------------ background

  private drawBackground(game: Game): void {
    const { ctx, w, h } = this;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#04010d');
    bg.addColorStop(0.6, '#0a0420');
    bg.addColorStop(1, '#14062e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (this.nebula) {
      ctx.drawImage(this.nebula, 0, 0, w, h);
    }

    const speed = game.state === 'playing' ? 1 + game.level * 0.08 : 0.5;
    const t = game.time;
    for (const s of this.stars) {
      const y = (s.y + t * (12 + s.z * 90) * speed) % h;
      const twinkle = 0.55 + 0.45 * Math.sin(t * (1 + s.z * 3) + s.tw);
      const size = 0.6 + s.z * 1.8;
      ctx.globalAlpha = (0.25 + s.z * 0.75) * twinkle;
      ctx.fillStyle = s.z > 0.75 ? '#d6f8ff' : s.z > 0.4 ? '#b9a6ff' : '#6f6aa8';
      if (s.z > 0.85 && game.state === 'playing') {
        ctx.fillRect(s.x, y, size * 0.7, size * (2 + game.level * 0.3)); // speed streak
      } else {
        ctx.fillRect(s.x, y, size, size);
      }
    }
    ctx.globalAlpha = 1;

    this.drawHorizonGrid(t);
  }

  /** Synthwave perspective grid along the bottom edge. */
  private drawHorizonGrid(t: number): void {
    const { ctx, w, h } = this;
    const top = h * 0.8;
    const height = h - top;
    ctx.save();
    const fade = ctx.createLinearGradient(0, top, 0, h);
    fade.addColorStop(0, 'rgba(157, 78, 221, 0)');
    fade.addColorStop(1, 'rgba(157, 78, 221, 0.45)');
    ctx.strokeStyle = fade;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const offset = (t * 0.6) % 1;
    for (let i = 0; i < 10; i++) {
      const p = ((i + offset) / 10) ** 2;
      const y = top + p * height;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    const cx = w / 2;
    for (let i = -14; i <= 14; i++) {
      ctx.moveTo(cx + i * w * 0.012, top);
      ctx.lineTo(cx + i * w * 0.12, h);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawVignette(): void {
    const { ctx, w, h } = this;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // ------------------------------------------------------------------ player

  private drawPlayer(game: Game, glow: boolean): void {
    const { ctx } = this;
    const p = game.player;
    const u = game.u;
    if (p.invulnerable > 0 && Math.floor(p.invulnerable * 12) % 2 === 0) {
      ctx.globalAlpha = 0.35;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.max(-0.25, Math.min(0.25, p.vx / 2400)));
    ctx.scale(u, u);

    // Engine flame.
    const flame = 14 + Math.random() * 10;
    const fg = ctx.createLinearGradient(0, 12, 0, 12 + flame);
    fg.addColorStop(0, 'rgba(125, 249, 255, 0.95)');
    fg.addColorStop(1, 'rgba(199, 125, 255, 0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-6, 12);
    ctx.lineTo(0, 12 + flame);
    ctx.lineTo(6, 12);
    ctx.closePath();
    ctx.fill();

    if (glow) {
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 18;
    }
    // Hull.
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(7, -8);
    ctx.lineTo(22, 8);
    ctx.lineTo(22, 14);
    ctx.lineTo(8, 10);
    ctx.lineTo(5, 15);
    ctx.lineTo(-5, 15);
    ctx.lineTo(-8, 10);
    ctx.lineTo(-22, 14);
    ctx.lineTo(-22, 8);
    ctx.lineTo(-7, -8);
    ctx.closePath();
    const hull = ctx.createLinearGradient(0, -24, 0, 15);
    hull.addColorStop(0, '#e9fdff');
    hull.addColorStop(0.5, '#3fd5ff');
    hull.addColorStop(1, '#5a2fb8');
    ctx.fillStyle = hull;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Cockpit.
    ctx.fillStyle = MAGENTA;
    ctx.beginPath();
    ctx.ellipse(0, -6, 3.2, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Wing tips.
    ctx.fillStyle = MAGENTA;
    ctx.fillRect(-23, 6, 3, 9);
    ctx.fillRect(20, 6, 3, 9);
    ctx.restore();

    if (game.power.loop > 0) {
      ctx.save();
      ctx.strokeStyle = KIND_COLORS.keyword;
      ctx.lineWidth = 3;
      ctx.setLineDash([10 * u, 8 * u]);
      ctx.lineDashOffset = -game.time * 60;
      if (glow) {
        ctx.shadowColor = KIND_COLORS.keyword;
        ctx.shadowBlur = 14;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y - 2 * u, 38 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (game.power.shield) {
      ctx.save();
      ctx.strokeStyle = `rgba(125, 249, 255, ${0.5 + 0.3 * Math.sin(game.time * 6)})`;
      ctx.lineWidth = 2;
      if (glow) {
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = 14;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y - 2 * u, 32 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ enemies

  private drawEnemy(e: Enemy, game: Game, glow: boolean): void {
    const { ctx } = this;
    const u = game.u;
    const base = game.power.freeze > 0 ? '#8fd3ff' : KIND_COLORS[e.kind];
    const color = e.flash > 0.5 ? '#ffffff' : base;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (glow) {
      ctx.shadowColor = KIND_COLORS[e.kind];
      ctx.shadowBlur = e.fresh ? 22 : 12;
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = withAlpha(KIND_COLORS[e.kind], 0.16);
    ctx.lineWidth = 2;
    const hw = e.w / 2;
    const hh = e.h / 2;

    switch (e.kind) {
      case 'function': {
        // Hexagonal fighter.
        ctx.beginPath();
        ctx.moveTo(-hw, 0);
        ctx.lineTo(-hw + 12 * u, -hh);
        ctx.lineTo(hw - 12 * u, -hh);
        ctx.lineTo(hw, 0);
        ctx.lineTo(hw - 12 * u, hh);
        ctx.lineTo(-hw + 12 * u, hh);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Side cannons.
        ctx.fillStyle = color;
        ctx.fillRect(-hw - 4 * u, -3 * u, 5 * u, 6 * u);
        ctx.fillRect(hw - 1 * u, -3 * u, 5 * u, 6 * u);
        this.label(`ƒ ${e.spec.label}`, 0, 0, 12 * u, color, glow);
        break;
      }
      case 'class': {
        // Mothership with wings.
        const pulse = 1 + Math.sin(e.age * 4) * 0.05;
        ctx.beginPath();
        ctx.moveTo(-hw, -hh * 0.2);
        ctx.lineTo(-hw * 0.7, -hh);
        ctx.lineTo(hw * 0.7, -hh);
        ctx.lineTo(hw, -hh * 0.2);
        ctx.lineTo(hw * 0.8, hh * 0.6);
        ctx.lineTo(hw * 0.3, hh);
        ctx.lineTo(-hw * 0.3, hh);
        ctx.lineTo(-hw * 0.8, hh * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-hw, -hh * 0.2);
        ctx.lineTo(-hw - 14 * u, hh * 0.9);
        ctx.lineTo(-hw * 0.8, hh * 0.6);
        ctx.moveTo(hw, -hh * 0.2);
        ctx.lineTo(hw + 14 * u, hh * 0.9);
        ctx.lineTo(hw * 0.8, hh * 0.6);
        ctx.stroke();
        ctx.fillStyle = withAlpha(MAGENTA, 0.7);
        ctx.beginPath();
        ctx.arc(0, hh * 0.75, 4 * u * pulse, 0, Math.PI * 2);
        ctx.fill();
        this.label(`◆ ${e.spec.label}`, 0, -hh * 0.15, 13 * u, color, glow, 'bold');
        break;
      }
      case 'bracket': {
        ctx.rotate(Math.sin(e.age * 3 + e.phase) * 0.35);
        this.label(e.spec.label, 0, 0, 20 * u, color, glow, 'bold');
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(hw, hh), 0, Math.PI * 2);
        ctx.globalAlpha = 0.35;
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'keyword': {
        // Diamond dart.
        ctx.beginPath();
        ctx.moveTo(0, hh + 4 * u);
        ctx.lineTo(hw, 0);
        ctx.lineTo(0, -hh);
        ctx.lineTo(-hw, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        this.label(e.spec.label, 0, -1 * u, 11 * u, color, glow, 'bold');
        break;
      }
      case 'comment': {
        // Ghost that phases in and out.
        ctx.globalAlpha = 0.65 + 0.3 * Math.sin(e.age * 3 + e.phase);
        ctx.beginPath();
        ctx.arc(0, -hh * 0.2, hw, Math.PI, 0);
        const waves = 4;
        for (let i = 0; i <= waves; i++) {
          const x = hw - (i * (2 * hw)) / waves;
          const y = hh + (i % 2 === 0 ? 0 : -6 * u) + Math.sin(e.age * 6 + i) * 2 * u;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillRect(-8 * u, -hh * 0.3, 4 * u, 5 * u);
        ctx.fillRect(4 * u, -hh * 0.3, 4 * u, 5 * u);
        this.label(e.spec.label, 0, hh * 0.35, 10 * u, color, false);
        break;
      }
      case 'string': {
        // Capsule with a wavy tail.
        roundRect(ctx, -hw, -hh, e.w, e.h, hh);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          ctx.moveTo(-hw * 0.5 + i * hw * 0.33, -hh);
          ctx.lineTo(-hw * 0.5 + i * hw * 0.33 + Math.sin(e.age * 8 + i) * 4 * u, -hh - 10 * u);
        }
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
        this.label(e.spec.label, 0, 0, 12 * u, color, glow);
        break;
      }
      case 'equals': {
        // Twin pods joined by two bars: destroys the nearest enemy on each side.
        const pod = 9 * u;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(side * (hw - pod), 0, pod, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(-hw + pod * 2, -4 * u);
        ctx.lineTo(hw - pod * 2, -4 * u);
        ctx.moveTo(-hw + pod * 2, 4 * u);
        ctx.lineTo(hw - pod * 2, 4 * u);
        ctx.stroke();
        this.label(e.spec.label, 0, -hh - 6 * u, 11 * u, color, glow, 'bold');
        break;
      }
      case 'bug':
      case 'warning':
        this.drawBug(e, u, color);
        this.label(e.spec.label, 0, -hh - 9 * u, 9 * u, color, glow, 'bold');
        break;
      default: {
        // Saucer carrying a line of code.
        roundRect(ctx, -hw, -hh * 0.6, e.w, hh * 1.2, 6 * u);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, -hh * 0.6, hw * 0.35, hh * 0.45, 0, Math.PI, 0);
        ctx.stroke();
        this.label(e.spec.label, 0, hh * 0.05, 12 * u, color, glow);
        // Running lights.
        const blink = Math.floor(e.age * 4) % 3;
        ctx.fillStyle = MAGENTA;
        ctx.fillRect(-hw + 4 * u + blink * 3 * u, hh * 0.6 - 2 * u, 2 * u, 2 * u);
      }
    }
    ctx.shadowBlur = 0;

    if (e.power) {
      // Small star marks enemies whose code has a special ability.
      ctx.fillStyle = Math.floor(game.time * 4) % 2 ? '#ffffff' : base;
      ctx.font = `bold ${10 * u}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('★', hw + 4 * u, -hh + 2 * u);
    }
    if (e.fresh) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${9 * u}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('NEW', 0, -hh - (e.kind === 'bug' || e.kind === 'warning' ? 19 : 6) * u);
    }

    if (e.maxHp > 1) {
      const bw = Math.min(e.w, 60 * u);
      const y = hh + 6 * u;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(-bw / 2, y, bw, 3 * u);
      ctx.fillStyle = KIND_COLORS[e.kind];
      ctx.fillRect(-bw / 2, y, bw * Math.max(0, e.hp / e.maxHp), 3 * u);
    }
    ctx.restore();
  }

  private drawBug(e: Enemy, u: number, color: string): void {
    const { ctx } = this;
    const hw = e.w / 2;
    const hh = e.h / 2;
    const legSwing = Math.sin(e.age * 18) * 3 * u;
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      const y = i * hh * 0.45;
      ctx.moveTo(-hw * 0.5, y);
      ctx.lineTo(-hw, y + (i === 0 ? legSwing : -legSwing));
      ctx.moveTo(hw * 0.5, y);
      ctx.lineTo(hw, y + (i === 0 ? -legSwing : legSwing));
    }
    // Antennae.
    ctx.moveTo(-4 * u, -hh * 0.8);
    ctx.lineTo(-10 * u, -hh - 2 * u);
    ctx.moveTo(4 * u, -hh * 0.8);
    ctx.lineTo(10 * u, -hh - 2 * u);
    ctx.stroke();
    // Body.
    ctx.beginPath();
    ctx.ellipse(0, 2 * u, hw * 0.55, hh * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -hh * 0.6);
    ctx.lineTo(0, hh * 0.8);
    ctx.stroke();
    // Eyes.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(-4 * u, -hh * 0.55, 2.2 * u, 0, Math.PI * 2);
    ctx.arc(4 * u, -hh * 0.55, 2.2 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  private label(text: string, x: number, y: number, size: number, color: string, glow: boolean, weight = ''): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
    }
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // ------------------------------------------------------------------ projectiles & fx

  private drawBullets(game: Game, glow: boolean): void {
    const { ctx } = this;
    const u = game.u;
    ctx.save();
    ctx.lineCap = 'round';
    for (const b of game.bullets) {
      if (b.enemy) {
        const big = b.kind === 'heavy' ? 2.2 : b.kind === 'pending' ? 1.8 + 0.4 * Math.sin(game.time * 14) : b.kind === 'fragment' ? 0.7 : 1;
        const col = b.kind === 'pending' || b.kind === 'fragment' ? '#ff55aa' : b.kind === 'aimed' ? '#ff9f1c' : '#ff3864';
        ctx.fillStyle = col;
        if (glow) {
          ctx.shadowColor = col;
          ctx.shadowBlur = 10 * big;
        }
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4 * u * big, 0, Math.PI * 2);
        ctx.fill();
        if (b.kind === 'pending' && b.fuse !== undefined) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 10 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, b.fuse));
          ctx.stroke();
        }
        ctx.fillStyle = '#ffd1dc';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 1.8 * u, 0, Math.PI * 2);
        ctx.fill();
      } else {
        if (glow) {
          ctx.shadowColor = CYAN;
          ctx.shadowBlur = 12;
        }
        const len = 16 * u;
        const nx = b.vx / Math.hypot(b.vx, b.vy);
        const ny = b.vy / Math.hypot(b.vx, b.vy);
        ctx.strokeStyle = CYAN;
        ctx.lineWidth = 4 * u;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - nx * len, b.y - ny * len);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6 * u;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawParticles(game: Game, glow: boolean): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of game.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      switch (p.type) {
        case 'ring': {
          const r = p.size * (1 - a) + 4;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3 * a + 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'glyph':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot ?? 0);
          ctx.fillStyle = p.color;
          ctx.font = `bold ${Math.round(p.size)}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.glyph ?? '', 0, 0);
          ctx.restore();
          break;
        case 'beam':
          if (p.x2 !== undefined && p.y2 !== undefined) {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.size * a + 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            const mx = (p.x + p.x2) / 2 + (Math.random() - 0.5) * 20;
            const my = (p.y + p.y2) / 2 + (Math.random() - 0.5) * 20;
            ctx.lineTo(mx, my);
            ctx.lineTo(p.x2, p.y2);
            ctx.stroke();
          }
          break;
        case 'splat':
          break; // retro-only effect
        case 'spark':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size * 0.8;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06);
          ctx.stroke();
          break;
        case 'flash': {
          const r = p.size * (1.15 - a * 0.4);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, 'rgba(255,255,255,0.9)');
          g.addColorStop(0.25, withAlpha(p.color, 0.6));
          g.addColorStop(1, withAlpha(p.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        default:
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.restore();
    void glow;
  }

  private drawTexts(game: Game): void {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of game.texts) {
      ctx.globalAlpha = Math.min(1, t.life / t.max + 0.2);
      ctx.font = `bold ${Math.round(t.size)}px ${FONT}`;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }

  private drawPowerUp(x: number, y: number, kind: PowerKind, age: number, u: number, glow: boolean): void {
    const { ctx } = this;
    const style = POWER_STYLE[kind];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(age * 1.5);
    if (glow) {
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 16;
    }
    ctx.strokeStyle = style.color;
    ctx.fillStyle = withAlpha(style.color, 0.2);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * 14 * u, Math.sin(a) * 14 * u);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.rotate(-age * 1.5);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(11 * u)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.glyph, 0, 1);
    ctx.restore();
  }

  private drawLevelBanner(game: Game): void {
    const { ctx, w, h } = this;
    const t = game.levelIntro; // 2 → 0
    const a = Math.min(1, t * 2, (2 - t) * 4);
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(46 * game.u)}px ${FONT}`;
    ctx.shadowColor = PURPLE;
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`LEVEL ${game.level}`, w / 2, h * 0.4);
    ctx.shadowBlur = 0;
    ctx.font = `${Math.round(15 * game.u)}px ${FONT}`;
    ctx.fillStyle = CYAN;
    const subtitle =
      game.level === 1
        ? `Incoming: ${game.snapshot?.fileName ?? 'unknown source'}`
        : `${game.quota} hostiles · they're getting faster`;
    ctx.fillText(subtitle, w / 2, h * 0.4 + 40 * game.u);
    const boss = game.levels.bossDef;
    if (boss) {
      ctx.fillStyle = boss.color;
      ctx.font = `${Math.round(13 * game.u)}px ${FONT}`;
      ctx.fillText(`boss: ${boss.title.toLowerCase()}`, w / 2, h * 0.4 + 64 * game.u);
    }
    ctx.restore();
  }
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
