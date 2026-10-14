import type { EnemyKind } from '../shared/protocol';
import type { Enemy, EnemyMeasure, Game, PowerKind } from './game';
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

export const measureRetro: EnemyMeasure = (kind, label, u) => {
  const P = retroPixelSize(u);
  const labelW = pixelTextWidth(label);
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
      if (game.state === 'playing' && game.levelIntro > 0) {
        this.drawBanner(game);
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
    if (e.maxHp > 1 && e.hp < e.maxHp) {
      const bw = Math.min(this.q(e.w), 16);
      const x0 = cx - Math.floor(bw / 2);
      const y = this.q(e.y + e.h / 2) + 1;
      this.b.fillStyle = '#333';
      this.b.fillRect(x0, y, bw, 1);
      this.b.fillStyle = base;
      this.b.fillRect(x0, y, Math.max(1, Math.round((bw * e.hp) / e.maxHp)), 1);
    }
  }

  private drawBullets(game: Game): void {
    const b = this.b;
    for (const bullet of game.bullets) {
      const x = this.q(bullet.x);
      const y = this.q(bullet.y);
      if (bullet.enemy) {
        // Zig-zag "squiggle" shot.
        b.fillStyle = game.power.freeze > 0 ? FROZEN : '#ff5555';
        const zig = Math.floor(game.time * 12) % 2;
        for (let i = 0; i < 4; i++) {
          b.fillRect(x + ((i + zig) % 2), y - 2 + i, 1, 1);
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
    drawPixelText(b, `LEFT ${String(Math.max(0, game.enemiesLeft)).padStart(2, '0')}`, W - pad, pad + 7, 1, '#ff55ff', 'right');

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
  }
}
