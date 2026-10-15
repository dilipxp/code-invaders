import type { EnemyKind } from '../shared/protocol';
import { BOSS_DEFS } from './bosses';
import { ENEMY_DEFS, type UnitType } from './enemies/definitions';
import { lookOf, type Enemy, type EnemyMeasure, type Game, type PowerKind } from './game';
import { CHAR_HEIGHT, drawPixelText, pixelTextWidth } from './pixelFont';
import type { GameRenderer } from './render';

/**
 * Old-school arcade look: everything is drawn into a low-resolution buffer (1 buffer pixel = P screen
 * pixels) and scaled up with nearest-neighbour, so sprites, text and effects are chunky and crisp.
 * Sprites are original pixel art (two animation frames each).
 */

type Sprite = string[];

const SPRITES: Record<'player' | 'splat' | EnemyKind, [Sprite, Sprite]> = {
  player: [
    ['.....#.....', '....###....', '....###....', '.#.#####.#.', '.#########.', '###########', '###.###.###', '#.........#'],
    ['.....#.....', '....###....', '....###....', '.#.#####.#.', '.#########.', '###########', '###.###.###', '.#.......#.'],
  ],
  line: [
    ['...###...', '.#######.', '##.#.#.##', '#########', '.#.....#.', '#.......#'],
    ['...###...', '.#######.', '##.#.#.##', '#########', '..#...#..', '.#.....#.'],
  ],
  function: [
    ['..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'],
    ['..#######..', '.##.###.##.', '###########', '..#######..', '.#.#...#.#.', '#.........#'],
  ],
  class: [
    ['.....#####.....', '...#########...', '..##.##.##.##..', '.#############.', '###.##.#.##.###', '..###.....###..', '...#.......#...'],
    ['.....#####.....', '...#########...', '..#.##.##.##.#.', '.#############.', '###.##.#.##.###', '..###.....###..', '..#.........#..'],
  ],
  bracket: [[''], ['']], // drawn as a big glyph
  keyword: [
    ['...#...', '..###..', '.##.##.', '###.###', '.##.##.', '..###..', '...#...'],
    ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
  ],
  comment: [
    ['..###..', '.#####.', '##.#.##', '#######', '#######', '#######', '#.##.#.'],
    ['..###..', '.#####.', '##.#.##', '#######', '#######', '#######', '.#.##.#'],
  ],
  string: [
    ['.#######.', '#.......#', '#.#.#.#.#', '#.......#', '.#######.'],
    ['.#######.', '#.......#', '##.#.#.##', '#.......#', '.#######.'],
  ],
  equals: [
    ['###.....###', '#.#######.#', '###.....###', '#.#######.#', '###.....###'],
    ['###.....###', '#.#.#.#.#.#', '###.....###', '#.#.#.#.#.#', '###.....###'],
  ],
  bug: [
    ['..#...#..', '...#.#...', '..#####..', '#.##.##.#', '.#######.', '#.#####.#', '.#######.', '#..#.#..#'],
    ['..#...#..', '...#.#...', '..#####..', '.###.###.', '#.#####.#', '.#######.', '#.#####.#', '.#..#..#.'],
  ],
  warning: [
    ['...#...', '..###..', '..#.#..', '.##.##.', '.#####.', '##.#.##', '#######'],
    ['...#...', '..###..', '..#.#..', '.##.##.', '.#####.', '##.#.##', '#######'],
  ],
  splat: [
    ['#...#...#', '.#..#..#.', '..#...#..', '##.....##', '..#...#..', '.#..#..#.', '#...#...#'],
    ['#...#...#', '.#..#..#.', '..#...#..', '##.....##', '..#...#..', '.#..#..#.', '#...#...#'],
  ],
};

/** Sprite scale (in buffer pixels) per kind. */
const SPRITE_SCALE: Partial<Record<EnemyKind, number>> = { class: 2 };

/** Pad rows so every sprite is rectangular (keeps the art below easy to edit). */
function rect(rows: string[]): Sprite {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, '.'));
}
const pair = (a: string[], b: string[] = a): [Sprite, Sprite] => [rect(a), rect(b)];

/** Original pixel art for construct enemies, support units and bosses (two frames each). */
const UNIT_SPRITES: Record<string, [Sprite, Sprite]> = {
  if: pair(
    ['#.......#', '##.....##', '.##...##.', '..#####..', '.##.#.##.', '#########', '...#.#...'],
    ['#.......#', '##.....##', '.##...##.', '..#####..', '.##.#.##.', '#########', '..#...#..'],
  ),
  and: pair(
    ['..#.....#..', '.###...###.', '##.##.##.##', '#####.#####', '.#.#...#.#.'],
    ['..#.....#..', '.###...###.', '##.##.##.##', '#####.#####', '#...#.#...#'],
  ),
  or: pair(
    ['...#.#...', '..##.##..', '.###.###.', '####.####', '.###.###.', '..##.##..', '...#.#...'],
    ['..#...#..', '.##...##.', '###...###', '####.####', '###...###', '.##...##.', '..#...#..'],
  ),
  arrow: pair(
    ['..#####..', '..#####..', '#########', '.#######.', '..#####..', '...###...', '....#....'],
    ['..#####..', '.#.###.#.', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  ),
  return: pair(
    ['....#....', '...###...', '..#####..', '.##.#.##.', '#..###..#', '...#.#...'],
    ['....#....', '...###...', '..#####..', '.##.#.##.', '#..###..#', '..#...#..'],
  ),
  function: pair(
    ['..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'],
    ['..#######..', '.##.###.##.', '###########', '..#######..', '.#.#...#.#.', '#.........#'],
  ),
  const: pair(
    ['#.#.#.#.#', '#########', '##.###.##', '#########', '###...###', '##.....##'],
    ['#.#.#.#.#', '#########', '###.#.###', '#########', '###...###', '##.....##'],
  ),
  let: pair(
    ['..#####..', '.#.###.#.', '#########', '#.#.#.#.#', '.#.....#.'],
    ['.#.....#.', '#.#####.#', '#########', '.#.###.#.', '..#...#..'],
  ),
  while: pair(
    ['..#####..', '.##...##.', '##.#.#.##', '#...#...#', '##.#.#.##', '.##...##.', '..#####..'],
    ['..#####..', '.##...##.', '##..#..##', '#.#...#.#', '##..#..##', '.##...##.', '..#####..'],
  ),
  class: pair(
    ['.....#####.....', '...#########...', '..##.##.##.##..', '.#############.', '###.##.#.##.###', '..###.....###..', '...#.......#...'],
    ['.....#####.....', '...#########...', '..#.##.##.##.#.', '.#############.', '###.##.#.##.###', '..###.....###..', '..#.........#..'],
  ),
  try: pair(
    ['.#######.', '#.......#', '#.##.##.#', '#..###..#', '.#.....#.', '..#####..'],
    ['.#######.', '#.......#', '#.#...#.#', '#..###..#', '.#.....#.', '..#####..'],
  ),
  for: pair(
    ['....#####....', '..#########..', '.##.##.##.##.', '#############', '#.#########.#', '#.#.#...#.#.#', '...##...##...'],
    ['....#####....', '..#########..', '.#.##.##.##.#', '#############', '#.#########.#', '#.#.#...#.#.#', '..##.....##..'],
  ),
  async: pair(
    ['#######', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#.#.#.', '#######'],
    ['#######', '.#.#.#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#######'],
  ),
  promise: pair(
    ['...###...', '.#######.', '##.....##', '#..#.#..#', '##.....##', '.#######.', '...###...'],
    ['...###...', '.#######.', '##.....##', '#...#...#', '##.....##', '.#######.', '...###...'],
  ),
  import: pair(
    ['#########', '#.#...#.#', '#..#.#..#', '#...#...#', '#########', '.#.....#.'],
    ['#########', '#.#...#.#', '#..#.#..#', '#...#...#', '#########', '#.......#'],
  ),
  throw: pair(
    ['#...#...#', '.#.###.#.', '..#####..', '#########', '..#####..', '.#.###.#.', '#...#...#'],
    ['....#....', '.#.###.#.', '..#####..', '.#######.', '..#####..', '.#.###.#.', '....#....'],
  ),
  recursive: pair(
    ['#########', '#.......#', '#.#####.#', '#.#...#.#', '#.#.#.#.#', '#.#...#.#', '#.#####.#', '#########'],
    ['#########', '#.......#', '#.#####.#', '#.#.#.#.#', '#.#...#.#', '#.#.#.#.#', '#.#####.#', '#########'],
  ),
  escort: pair(['.###.', '#####', '#.#.#'], ['.###.', '#####', '.#.#.']),
  minion: pair(['#.#.#', '.###.', '#...#'], ['.#.#.', '.###.', '.#.#.']),
  half: pair(['..#..', '.###.', '##.##', '.#.#.'], ['..#..', '.###.', '##.##', '#...#']),
  module: pair(['#######', '#.#.#.#', '#######', '.#.#.#.'], ['#######', '##.#.##', '#######', '.#.#.#.']),
  head: pair(['.#####.', '##.#.##', '#######', '#.###.#', '.#...#.'], ['.#####.', '#.#.#.#', '#######', '#.###.#', '#.....#']),
  'boss:loop': pair(
    ['..####.....####..', '.##..##...##..##.', '##....##.##....##', '#......###......#', '##....##.##....##', '.##..##...##..##.', '..####.....####..', '....#.#...#.#....'],
    ['..####.....####..', '.##..##...##..##.', '##.##.##.##.##.##', '#..##..###..##..#', '##.##.##.##.##.##', '.##..##...##..##.', '..####.....####..', '...#...#.#...#...'],
  ),
  'boss:hydra': pair(
    ['#...#...#...#...#', '##.###.###.###.##', '.#####.###.#####.', '..#############..', '.###.#######.###.', '###..#.###.#..###', '#....#######....#', '......#...#......'],
    ['.#...#.....#...#.', '.##.###...###.##.', '.#####.###.#####.', '..#############..', '.###.#######.###.', '###..#.###.#..###', '#....#######....#', '.....#.....#.....'],
  ),
  'boss:overlord': pair(
    ['......#####......', '....#########....', '..##.#.###.#.##..', '.###############.', '###.##.#.#.##.###', '#################', '.#.###.....###.#.', '#...#.......#...#'],
    ['......#####......', '....#########....', '..#.##.###.##.#..', '.###############.', '###.##.#.#.##.###', '#################', '.#.###.....###.#.', '.#..#.......#..#.'],
  ),
  'boss:phantom': pair(
    ['.....#######.....', '...###########...', '..##..#####..##..', '.###..#####..###.', '#################', '#################', '##.###.###.###.##', '#...#...#...#...#'],
    ['.....#######.....', '...###########...', '..#...#####...#..', '.##...#####...##.', '#################', '#################', '#.###.###.###.###', '.#...#...#...#...'],
  ),
  'boss:runtime': pair(
    ['..#...........#..', '...#.........#...', '....#########....', '..#####.#.#####..', '.######.#.######.', '#.#####.#.#####.#', '.###############.', '#.######.######.#', '.#..#.#####.#..#.', '#..#.........#..#'],
    ['..#...........#..', '...#.........#...', '....#########....', '..#####...#####..', '.######.#.######.', '#.#####.#.#####.#', '.###############.', '#.######.######.#', '#..#..#####..#..#', '.#..#.......#..#.'],
  ),
};

/** Buffer-pixel scale per look. */
const UNIT_SCALE: Record<string, number> = { for: 2, class: 2, 'boss:loop': 3, 'boss:hydra': 3, 'boss:overlord': 3, 'boss:phantom': 3, 'boss:runtime': 3 };

function unitColor(e: Enemy): string {
  if (e.bossId) {
    return BOSS_DEFS.find((b) => b.id === e.bossId)?.retroColor ?? '#ffffff';
  }
  return e.unit ? ENEMY_DEFS[e.unit as UnitType].retroColor : RETRO_COLORS[e.kind];
}

export const RETRO_COLORS: Record<EnemyKind, string> = {
  line: '#ffffff',
  function: '#ff55ff',
  class: '#ff5555',
  bracket: '#55ffff',
  keyword: '#ffff55',
  comment: '#9a9a9a',
  string: '#55ff55',
  equals: '#00ffaa',
  bug: '#ff3333',
  warning: '#ffaa00',
};

const GREEN = '#33ff33';
const FROZEN = '#8fd3ff';

const POWER_GLYPH: Record<PowerKind, { glyph: string; color: string }> = {
  triple: { glyph: '...', color: '#ff55ff' },
  rapid: { glyph: '>>', color: '#ffaa00' },
  shield: { glyph: '{}', color: '#55ffff' },
  life: { glyph: '+1', color: '#55ff55' },
};

/** Screen pixels per buffer pixel for a given size unit. */
export function retroPixelSize(u: number): number {
  return Math.max(2, Math.min(4, Math.round(3 * u)));
}

export const measureRetro: EnemyMeasure = (kind, label, u, look) => {
  const P = retroPixelSize(u);
  const labelW = pixelTextWidth(label);
  const unitSprite = look ? UNIT_SPRITES[look] : undefined;
  if (unitSprite) {
    const s = UNIT_SCALE[look!] ?? 1;
    const sprite = unitSprite[0];
    const boss = look!.startsWith('boss:');
    const w = Math.max(sprite[0].length * s, boss ? 0 : labelW) + 4;
    const h = sprite.length * s + 2 + (boss ? 0 : CHAR_HEIGHT);
    return { w: w * P, h: h * P };
  }
  if (kind === 'bracket') {
    return { w: (pixelTextWidth(label, 2) + 4) * P, h: (CHAR_HEIGHT * 2 + 2) * P };
  }
  const sprite = SPRITES[kind][0];
  const s = SPRITE_SCALE[kind] ?? 1;
  const w = Math.max(sprite[0].length * s, labelW) + 4;
  const h = sprite.length * s + 2 + CHAR_HEIGHT;
  return { w: w * P, h: h * P };
};

interface Star {
  x: number;
  y: number;
  phase: number;
  color: string;
}

export class RetroRenderer implements GameRenderer {
  readonly measure = measureRetro;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buf: HTMLCanvasElement;
  private readonly b: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private P = 3;
  private bw = 0;
  private bh = 0;
  private stars: Star[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    this.buf = document.createElement('canvas');
    const b = this.buf.getContext('2d');
    if (!ctx || !b) {
      throw new Error('Canvas 2D is not available');
    }
    this.ctx = ctx;
    this.b = b;
  }

  resize(w: number, h: number, dpr: number, u: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.P = retroPixelSize(u);
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.bw = Math.ceil(w / this.P);
    this.bh = Math.ceil(h / this.P);
    this.buf.width = this.bw;
    this.buf.height = this.bh;
    const palette = ['#ffffff', '#ffffff', '#55ffff', '#ffff55', '#ff55ff'];
    this.stars = Array.from({ length: Math.round((this.bw * this.bh) / 500) }, () => ({
      x: Math.floor(Math.random() * this.bw),
      y: Math.floor(Math.random() * this.bh),
      phase: Math.random() * 10,
      color: palette[Math.floor(Math.random() * palette.length)],
    }));
  }

  /** World (CSS px) → buffer pixel. */
  private q(v: number): number {
    return Math.round(v / this.P);
  }

  render(game: Game): void {
    const b = this.b;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.fillStyle = '#000';
    b.fillRect(0, 0, this.bw, this.bh);

    this.drawStars(game);
    const groundY = this.q(game.playerY()) + 7;
    const playing = game.state !== 'title';

    b.save();
    if (game.shake > 0 && !game.settings.reducedEffects) {
      b.translate(Math.round((Math.random() - 0.5) * game.shake * 0.4), Math.round((Math.random() - 0.5) * game.shake * 0.4));
    }
    if (playing) {
      this.drawWarnings(game);
      for (const pu of game.powerups) {
        this.drawPowerUp(pu.x, pu.y, pu.kind, pu.age);
      }
      for (const e of game.enemies) {
        this.drawEnemy(e, game);
      }
      this.drawBullets(game);
      if (game.player.alive && game.state !== 'over') {
        this.drawPlayer(game);
      }
    }
    this.drawParticles(game);
    this.drawTexts(game);
    b.restore();

    if (playing) {
      // Classic ground line under the cannon.
      b.fillStyle = GREEN;
      b.fillRect(0, groundY, this.bw, 1);
      this.drawHud(game, groundY);
      this.drawBossBar(game);
      if (game.state === 'playing' && game.levelIntro > 0) {
        this.drawBanner(game);
      } else if (game.levels.phase === 'clear' && game.levels.summary) {
        this.drawSummary(game);
      } else if (game.banner.time > 0 && game.state === 'playing') {
        this.drawAnnouncement(game);
      }
    }

    // Upscale with hard pixel edges.
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.drawImage(this.buf, 0, 0, this.bw * this.P, this.bh * this.P);
  }

  // ------------------------------------------------------------------ pieces

  private drawStars(game: Game): void {
    const b = this.b;
    const t = game.time;
    const drift = game.state === 'playing' ? 6 : 2;
    for (const s of this.stars) {
      if (Math.sin(t * 2 + s.phase * 3) < -0.3) {
        continue; // blink
      }
      const y = Math.floor(s.y + t * drift) % this.bh;
      b.fillStyle = s.color;
      b.globalAlpha = 0.55;
      b.fillRect(s.x, y, 1, 1);
    }
    b.globalAlpha = 1;
  }

  private sprite(sprite: Sprite, cx: number, top: number, scale: number, color: string): void {
    const b = this.b;
    const w = sprite[0].length * scale;
    const x0 = Math.round(cx - w / 2);
    b.fillStyle = color;
    for (let r = 0; r < sprite.length; r++) {
      const row = sprite[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] === '#') {
          b.fillRect(x0 + c * scale, top + r * scale, scale, scale);
        }
      }
    }
  }

  private drawPlayer(game: Game): void {
    const p = game.player;
    const cx = this.q(p.x);
    const top = this.q(p.y) - 4;
    const b = this.b;
    if (game.power.loop > 0) {
      // `for` loop shield: dots orbiting the cannon (stays visible through the respawn blink).
      const n = 10;
      const r = 11;
      b.fillStyle = game.power.loop < 1.5 && Math.floor(game.time * 10) % 2 ? '#ffffff' : RETRO_COLORS.keyword;
      for (let i = 0; i < n; i++) {
        const a = game.time * 4 + (i / n) * Math.PI * 2;
        b.fillRect(cx + Math.round(Math.cos(a) * r), top + 4 + Math.round(Math.sin(a) * r * 0.8), 1, 1);
      }
    }
    if (p.invulnerable > 0 && Math.floor(p.invulnerable * 10) % 2 === 0) {
      return; // classic blink
    }
    const frame = (Math.floor(game.time * 8) % 2) as 0 | 1;
    this.sprite(SPRITES.player[frame], cx, top, 1, GREEN);
    if (game.power.shield) {
      b.fillStyle = '#55ffff';
      b.fillRect(cx - 7, top - 3, 15, 1);
    }
  }

  private drawEnemy(e: Enemy, game: Game): void {
    const look = lookOf(e);
    if (look && UNIT_SPRITES[look]) {
      this.drawUnit(e, game, look);
      return;
    }
    const frozen = game.power.freeze > 0;
    const base = frozen ? FROZEN : RETRO_COLORS[e.kind];
    const color = e.flash > 0.5 ? '#ffffff' : base;
    const cx = this.q(e.x);
    const top = this.q(e.y - e.h / 2);
    const frame = (Math.floor(e.age * 3 + e.phase) % 2) as 0 | 1;

    if (e.kind === 'bracket') {
      drawPixelText(this.b, e.spec.label, cx, top + 1, 2, color, 'center');
    } else {
      const s = SPRITE_SCALE[e.kind] ?? 1;
      const sprite = SPRITES[e.kind][frame];
      if (e.kind === 'comment' && Math.sin(e.age * 3 + e.phase) < -0.4) {
        this.b.globalAlpha = 0.45; // ghosts flicker
      }
      this.sprite(sprite, cx, top, s, color);
      this.b.globalAlpha = 1;
      const labelTop = top + sprite.length * s + 2;
      const labelColor = e.kind === 'warning' && frame ? '#ffffff' : color;
      drawPixelText(this.b, e.spec.label, cx, labelTop, 1, labelColor, 'center');
    }

    // Code-power marker: a blinking pixel pair above enemies with a special ability.
    if (e.power && Math.floor(game.time * 4) % 2 === 0) {
      this.b.fillStyle = '#ffffff';
      this.b.fillRect(cx - 1, top - 3, 3, 1);
    }
    if (e.fresh) {
      drawPixelText(this.b, 'NEW', cx, top - 7, 1, '#ffffff', 'center');
    }
    this.drawHpBar(e, cx, base);
  }

  private drawHpBar(e: Enemy, cx: number, color: string): void {
    if (e.maxHp > 1 && e.hp < e.maxHp && e.role !== 'boss') {
      const bw = Math.min(this.q(e.w), 16);
      const x0 = cx - Math.floor(bw / 2);
      const y = this.q(e.y + e.h / 2) + 1;
      this.b.fillStyle = '#333';
      this.b.fillRect(x0, y, bw, 1);
      this.b.fillStyle = color;
      this.b.fillRect(x0, y, Math.max(1, Math.round((bw * Math.max(0, e.hp)) / e.maxHp)), 1);
    }
  }

  /** Construct enemies, support units and bosses. */
  private drawUnit(e: Enemy, game: Game, look: string): void {
    const b = this.b;
    const frozen = game.power.freeze > 0;
    const base = frozen ? FROZEN : unitColor(e);
    const blink = Math.floor(game.time * 10) % 2 === 0;
    let color = e.flash > 0.5 ? '#ffffff' : base;
    if (e.windup > 0.5 && blink) {
      color = '#ffffff'; // wind-up / charge telegraph
    }
    const s = Math.max(1, Math.round((UNIT_SCALE[look] ?? 1) * e.scale));
    const frame = (Math.floor(e.age * 3 + e.phase) % 2) as 0 | 1;
    const sprite = UNIT_SPRITES[look][frame];
    const cx = this.q(e.x) + (e.windup > 0 ? Math.round(Math.sin(game.time * 50) * e.windup) : 0);
    const top = this.q(e.y - e.h / 2);
    const sw = sprite[0].length * s;
    const sh = sprite.length * s;

    // Group link: support units are tethered to their leader.
    const parent = e.parentUid !== undefined ? game.byUid(e.parentUid) : undefined;
    if (parent && (e.role === 'escort' || e.role === 'minion' || e.role === 'module' || e.role === 'head')) {
      this.dotted(this.q(e.x), this.q(e.y), this.q(parent.x), this.q(parent.y), e.role === 'escort' ? base : '#555555');
    }

    if (e.phased) {
      // async: only a faint dotted outline while it's away.
      if (blink) {
        b.fillStyle = base;
        for (let x = 0; x < sw; x += 3) {
          b.fillRect(cx - sw / 2 + x, top, 1, 1);
          b.fillRect(cx - sw / 2 + x, top + sh, 1, 1);
        }
      }
      return;
    }
    if (e.role === 'clone' || e.cloneDepth > 0) {
      b.globalAlpha = 0.75;
    }
    this.sprite(sprite, cx, top, s, color);
    b.globalAlpha = 1;

    const boss = e.role === 'boss';
    if (!boss) {
      drawPixelText(b, e.spec.label, cx, top + sh + 2, 1, e.flash > 0.5 ? '#ffffff' : base, 'center');
    }
    // Loop signature, shown for a moment at the start of each cycle.
    if (e.showSig > 0 && e.spec.construct?.signature && (e.showSig > 0.4 || blink)) {
      drawPixelText(b, e.spec.construct.signature.slice(0, 18), cx, top + sh + 9, 1, '#888888', 'center');
    }
    // Timed shield (try/catch recovery, phase change): braces around the sprite with a draining bar.
    if (e.shieldTimer > 0 && !boss) {
      b.fillStyle = '#55ffff';
      const x0 = cx - Math.ceil(sw / 2) - 3;
      const x1 = cx + Math.ceil(sw / 2) + 2;
      drawPixelText(b, '{', x0 - 1, top + Math.round(sh / 2) - 2, 1, '#55ffff');
      drawPixelText(b, '}', x1 - 1, top + Math.round(sh / 2) - 2, 1, '#55ffff');
      const max = e.mem.shieldMax || 2;
      b.fillRect(cx - 6, top - 3, Math.max(1, Math.round((12 * e.shieldTimer) / max)), 1);
    }
    // Shield points (const).
    if (e.shield > 0) {
      b.fillStyle = '#55ffff';
      for (let k = 0; k < e.shield; k++) b.fillRect(cx - e.shieldMax * 2 + k * 4, top - 3, 3, 1);
    }
    if (e.exposed > 0 && blink) {
      drawPixelText(b, 'X', cx, top + Math.round(sh / 2) - 2, 1, '#ffffff', 'center');
    }
    // Badge: mode / loop counter / state.
    const badge = boss ? '' : e.badge;
    const badgeY = top - (e.shield > 0 || e.shieldTimer > 0 ? 10 : 7);
    if (badge) {
      drawPixelText(b, badge, cx, badgeY, 1, '#ffffff', 'center');
    } else if (e.fresh) {
      drawPixelText(b, 'NEW', cx, badgeY, 1, '#ffffff', 'center');
    }
    if (e.elite && blink) {
      drawPixelText(b, '*', cx + Math.ceil(sw / 2) + 2, top - 1, 1, '#ffff55');
    }
    if (e.power && !badge && Math.floor(game.time * 4) % 2 === 0) {
      b.fillStyle = '#ffffff';
      b.fillRect(cx - 1, top - 3, 3, 1);
    }
    if (!boss) {
      this.drawHpBar(e, cx, base);
    }
  }

  private dotted(x0: number, y0: number, x1: number, y1: number, color: string): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    this.b.fillStyle = color;
    for (let i = 0; i <= steps; i += 3) {
      const t = steps ? i / steps : 0;
      this.b.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
    }
  }

  /** Telegraphs: every dangerous attack is announced here first. */
  private drawWarnings(game: Game): void {
    const b = this.b;
    const blink = Math.floor(game.time * 12) % 2 === 0;
    for (const w of game.warnings) {
      const urgent = w.life < w.max * 0.4;
      if (urgent && !blink) continue;
      const x = this.q(w.x);
      const y = this.q(w.y);
      b.fillStyle = urgent ? '#ffffff' : w.color;
      switch (w.kind) {
        case 'circle':
        case 'marker': {
          const r = Math.max(3, this.q(w.r));
          const n = Math.max(10, r * 2);
          for (let i = 0; i < n; i += w.kind === 'marker' ? 2 : 1) {
            const a = (i / n) * Math.PI * 2;
            b.fillRect(x + Math.round(Math.cos(a) * r), y + Math.round(Math.sin(a) * r), 1, 1);
          }
          drawPixelText(b, '!', x, y - 2, 1, b.fillStyle as string, 'center');
          if (w.label) drawPixelText(b, w.label.toUpperCase(), x, y + r + 2, 1, w.color, 'center');
          break;
        }
        case 'line':
          this.dotted(x, y, this.q(w.x2 ?? w.x), this.q(w.y2 ?? w.y), b.fillStyle as string);
          break;
        case 'column':
          for (let yy = 0; yy < this.bh; yy += 4) {
            b.fillRect(x - this.q(w.r), yy, 1, 2);
            b.fillRect(x + this.q(w.r), yy, 1, 2);
          }
          drawPixelText(b, '!', x, 30, 1, b.fillStyle as string, 'center');
          break;
        case 'row': {
          const gap = this.q(w.x2 ?? -999);
          const half = this.q(w.r);
          for (let xx = 0; xx < this.bw; xx += 3) {
            if (Math.abs(xx - gap) > half) b.fillRect(xx, y, 2, 1);
          }
          drawPixelText(b, 'GAP', gap, y + 3, 1, '#55ff55', 'center');
          break;
        }
      }
    }
    // Beams: striped column while warning, solid while firing.
    for (const hz of game.hazards) {
      const x = this.q(hz.x);
      const half = Math.max(1, this.q(hz.w / 2));
      if (hz.warn > 0) {
        if (blink || hz.warn > 0.4) {
          b.fillStyle = hz.color;
          for (let yy = 0; yy < this.bh; yy += 3) {
            b.fillRect(x - half, yy, 1, 1);
            b.fillRect(x + half, yy, 1, 1);
          }
          drawPixelText(b, '!!', x, 30, 1, '#ffffff', 'center');
        }
      } else {
        b.fillStyle = blink ? '#ffffff' : hz.color;
        b.fillRect(x - half, 0, half * 2 + 1, this.bh);
      }
    }
  }

  private drawBullets(game: Game): void {
    const b = this.b;
    for (const bullet of game.bullets) {
      const x = this.q(bullet.x);
      const y = this.q(bullet.y);
      if (bullet.enemy) {
        const frozen = game.power.freeze > 0;
        const zig = Math.floor(game.time * 12) % 2;
        if (bullet.kind === 'heavy') {
          // throw: a big spinning block.
          b.fillStyle = frozen ? FROZEN : zig ? '#ffffff' : '#ff5555';
          b.fillRect(x - 2, y - 2, 5, 5);
          b.fillStyle = '#000';
          b.fillRect(x - (zig ? 0 : 2), y - (zig ? 2 : 0), 1, 1);
        } else if (bullet.kind === 'pending') {
          // Promise: a pulsing orb that resolves into fragments.
          b.fillStyle = frozen ? FROZEN : '#ff55aa';
          const r = zig ? 3 : 2;
          b.fillRect(x - r, y, r * 2 + 1, 1);
          b.fillRect(x, y - r, 1, r * 2 + 1);
          b.fillRect(x - 1, y - 1, 3, 3);
        } else if (bullet.kind === 'fragment') {
          b.fillStyle = frozen ? FROZEN : '#ff99cc';
          b.fillRect(x, y, 2, 2);
        } else {
          // Zig-zag "squiggle" shot.
          b.fillStyle = frozen ? FROZEN : bullet.kind === 'aimed' ? '#ffaa55' : '#ff5555';
          for (let i = 0; i < 4; i++) {
            b.fillRect(x + ((i + zig) % 2), y - 2 + i, 1, 1);
          }
        }
      } else {
        b.fillStyle = '#ffffff';
        b.fillRect(x, y - 3, 1, 4);
      }
    }
  }

  private drawPowerUp(x: number, y: number, kind: PowerKind, age: number): void {
    const b = this.b;
    const style = POWER_GLYPH[kind];
    const cx = this.q(x);
    const cy = this.q(y);
    const blink = Math.floor(age * 6) % 2 === 0;
    b.fillStyle = blink ? style.color : '#ffffff';
    b.fillRect(cx - 6, cy - 5, 13, 1);
    b.fillRect(cx - 6, cy + 5, 13, 1);
    b.fillRect(cx - 6, cy - 5, 1, 11);
    b.fillRect(cx + 6, cy - 5, 1, 11);
    drawPixelText(b, style.glyph, cx, cy - 2, 1, style.color, 'center');
  }

  private drawParticles(game: Game): void {
    const b = this.b;
    for (const p of game.particles) {
      const a = Math.max(0, p.life / p.max);
      const x = this.q(p.x);
      const y = this.q(p.y);
      switch (p.type) {
        case 'spark':
        case 'ember':
          if (a < 0.15) {
            break;
          }
          b.fillStyle = p.color;
          b.fillRect(x, y, 1, 1);
          break;
        case 'glyph':
          if (a > 0.1 && p.glyph) {
            drawPixelText(b, p.glyph, x, y, 1, p.color, 'center');
          }
          break;
        case 'splat': {
          const frame = SPRITES.splat[0];
          this.sprite(frame, x, y - Math.floor(frame.length / 2), 1, p.color);
          break;
        }
        case 'ring': {
          const r = this.q(p.size * (1 - a)) + 2;
          b.fillStyle = p.color;
          const n = Math.max(8, Math.round(r * 1.5));
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2;
            b.fillRect(x + Math.round(Math.cos(ang) * r), y + Math.round(Math.sin(ang) * r), 1, 1);
          }
          break;
        }
        case 'beam': {
          if (p.x2 === undefined || p.y2 === undefined) {
            break;
          }
          const x2 = this.q(p.x2);
          const y2 = this.q(p.y2);
          const steps = Math.max(Math.abs(x2 - x), Math.abs(y2 - y));
          b.fillStyle = Math.floor(game.time * 20) % 2 ? '#ffffff' : p.color;
          for (let i = 0; i <= steps; i++) {
            const t = steps ? i / steps : 0;
            const jitter = i % 3 === 0 ? Math.round((Math.random() - 0.5) * 2) : 0;
            b.fillRect(Math.round(x + (x2 - x) * t), Math.round(y + (y2 - y) * t) + jitter, 1, 1);
          }
          break;
        }
        case 'flash':
          if (a > 0.6) {
            b.fillStyle = '#ffffff';
            b.fillRect(x - 1, y - 1, 3, 3);
          }
          break;
      }
    }
  }

  private drawTexts(game: Game): void {
    for (const t of game.texts) {
      if (t.life / t.max > 0.15 || Math.floor(t.life * 20) % 2) {
        drawPixelText(this.b, t.text, this.q(t.x), this.q(t.y), 1, t.color, 'center');
      }
    }
  }

  private drawHud(game: Game, groundY: number): void {
    const b = this.b;
    const W = this.bw;
    const pad = 3;
    const score = String(game.score).padStart(6, '0');
    const hi = String(Math.max(game.hiScore, game.score)).padStart(6, '0');
    drawPixelText(b, 'SCORE', pad, pad, 1, '#ffffff');
    drawPixelText(b, score, pad, pad + 7, 1, GREEN);
    drawPixelText(b, 'HI-SCORE', W / 2, pad, 1, '#ffffff', 'center');
    drawPixelText(b, hi, W / 2, pad + 7, 1, '#ffff55', 'center');
    drawPixelText(b, `LEVEL ${game.level}`, W - pad, pad, 1, '#ffffff', 'right');
    const phase = game.levels.phase;
    const left = phase === 'boss' || phase === 'bossIntro' ? 'BOSS' : `LEFT ${String(Math.max(0, game.enemiesLeft)).padStart(2, '0')}`;
    drawPixelText(b, left, W - pad, pad + 7, 1, '#ff55ff', 'right');

    // Active powers, one per line under the score.
    const powers: Array<[string, string]> = [];
    const pw = game.power;
    if (pw.loop > 0) powers.push([`LOOP SHIELD ${Math.ceil(pw.loop)}`, RETRO_COLORS.keyword]);
    if (pw.freeze > 0) powers.push([`BREAK ${Math.ceil(pw.freeze)}`, FROZEN]);
    if (pw.slow > 0) powers.push([`AWAIT ${Math.ceil(pw.slow)}`, '#55ffff']);
    if (pw.triple > 0) powers.push([`SPREAD ${Math.ceil(pw.triple)}`, '#ff55ff']);
    if (pw.rapid > 0) powers.push([`RAPID ${Math.ceil(pw.rapid)}`, '#ffaa00']);
    if (pw.shield) powers.push(['TRY/CATCH', '#55ffff']);
    if (game.combo >= 4 && game.comboTimer > 0) powers.push([`COMBO X${game.combo}`, GREEN]);
    powers.forEach(([text, color], i) => drawPixelText(b, text, pad, pad + 17 + i * 7, 1, color));

    // Bottom bar: lives as tiny cannons, and the source file.
    const by = groundY + 3;
    if (by + 5 < this.bh) {
      drawPixelText(b, String(game.lives), pad, by, 1, '#ffffff');
      for (let i = 0; i < Math.min(game.lives - 1, 6); i++) {
        this.sprite(SPRITES.player[0], pad + 12 + i * 13, by - 1, 1, GREEN);
      }
      drawPixelText(b, (game.snapshot?.fileName ?? '').toUpperCase().slice(0, 30), W - pad, by, 1, '#666', 'right');
    }
  }

  /** Boss health bar with phase markers, under the top HUD. */
  private drawBossBar(game: Game): void {
    const boss = game.levels.boss;
    if (!boss || !boss.alive || game.state === 'over') {
      return;
    }
    const b = this.b;
    const e = boss.enemy;
    const W = this.bw;
    const y = 17;
    const w = Math.min(W - 40, 160);
    const x0 = Math.round((W - w) / 2);
    drawPixelText(b, `${boss.def.title}`, W / 2, y, 1, boss.def.retroColor, 'center');
    b.fillStyle = '#333';
    b.fillRect(x0, y + 7, w, 3);
    b.fillStyle = e.shieldTimer > 0 ? '#ffffff' : boss.def.retroColor;
    b.fillRect(x0, y + 7, Math.max(0, Math.round((w * Math.max(0, e.hp)) / e.maxHp)), 3);
    b.fillStyle = '#000';
    for (const ph of boss.def.phases) {
      if (ph.until > 0) b.fillRect(x0 + Math.round(w * ph.until), y + 6, 1, 5);
    }
    const label = `PHASE ${boss.phaseIndex + 1}/${boss.def.phases.length} ${e.badge}`;
    drawPixelText(b, label.slice(0, 40), W / 2, y + 12, 1, '#aaaaaa', 'center');
  }

  private drawAnnouncement(game: Game): void {
    const t = game.banner;
    if (t.time < 0.4 && Math.floor(t.time * 12) % 2) {
      return;
    }
    const cx = this.bw / 2;
    const cy = Math.round(this.bh * 0.42);
    const scale = pixelTextWidth(t.text, 2) < this.bw - 8 ? 2 : 1;
    drawPixelText(this.b, t.text, cx, cy, scale, t.color, 'center');
    if (t.sub) {
      const maxChars = Math.floor((this.bw - 8) / 4);
      drawPixelText(this.b, t.sub.slice(0, maxChars), cx, cy + 14, 1, '#ffffff', 'center');
    }
  }

  private drawSummary(game: Game): void {
    const s = game.levels.summary!;
    const cx = this.bw / 2;
    const cy = Math.round(this.bh * 0.32);
    drawPixelText(this.b, `LEVEL ${s.level} CLEAR`, cx, cy, 2, GREEN, 'center');
    const rows = [
      `${s.bossTitle} DEFEATED`,
      `KILLS ${s.kills}   ACCURACY ${s.accuracy}%`,
      `${s.clean ? 'CLEAN BUILD ' : ''}BONUS +${s.bonus}`,
      `SCORE ${game.score}`,
    ];
    rows.forEach((row, i) => drawPixelText(this.b, row, cx, cy + 18 + i * 8, 1, i === 2 && s.clean ? '#ffff55' : '#ffffff', 'center'));
  }

  private drawBanner(game: Game): void {
    const t = game.levelIntro;
    if (t < 0.4 && Math.floor(t * 12) % 2) {
      return; // blink out
    }
    const cx = this.bw / 2;
    const cy = Math.round(this.bh * 0.38);
    drawPixelText(this.b, `LEVEL ${game.level}`, cx, cy, 3, '#ffffff', 'center');
    const sub = game.level === 1 ? `INCOMING: ${(game.snapshot?.fileName ?? 'UNKNOWN').toUpperCase()}` : 'GET READY';
    drawPixelText(this.b, sub, cx, cy + 22, 1, GREEN, 'center');
    const boss = game.levels.bossDef;
    if (boss) {
      drawPixelText(this.b, `BOSS: ${boss.title}`, cx, cy + 30, 1, boss.retroColor, 'center');
    }
  }
}
