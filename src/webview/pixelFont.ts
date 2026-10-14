/**
 * A tiny 3×5 bitmap font (uppercase; lowercase renders as uppercase), drawn with fillRect so it stays
 * perfectly crisp when the retro buffer is scaled up with nearest-neighbour.
 */

const G: Record<string, string> = {
  A: '.#.#.#####.##.#',
  B: '##.#.###.#.###.',
  C: '.###..#..#...##',
  D: '##.#.##.##.###.',
  E: '####..##.#..###',
  F: '####..##.#..#..',
  G: '.###..#.##.#.##',
  H: '#.##.#####.##.#',
  I: '###.#..#..#.###',
  J: '..#..#..##.#.#.',
  K: '#.##.###.#.##.#',
  L: '#..#..#..#..###',
  M: '#.########.##.#',
  N: '##.#.##.##.##.#',
  O: '.#.#.##.##.#.#.',
  P: '##.#.###.#..#..',
  Q: '.#.#.##.###..##',
  R: '##.#.###.#.##.#',
  S: '.###...#...###.',
  T: '###.#..#..#..#.',
  U: '#.##.##.##.#.##',
  V: '#.##.##.#.#..#.',
  W: '#.##.########.#',
  X: '#.##.#.#.#.##.#',
  Y: '#.##.#.#..#..#.',
  Z: '###..#.#.#..###',
  '0': '####.##.##.####',
  '1': '.#.##..#..#.###',
  '2': '##...#.#.#..###',
  '3': '##...#.#...###.',
  '4': '#.##.####..#..#',
  '5': '####..##...###.',
  '6': '.###..####.####',
  '7': '###..#.#..#..#.',
  '8': '####.#####.####',
  '9': '####.####..###.',
  ' ': '...............',
  '.': '.............#.',
  ',': '..........#.#..',
  ':': '....#.....#....',
  ';': '....#.....#.#..',
  '!': '.#..#..#.....#.',
  '?': '##...#.#.....#.',
  '(': '..#.#..#..#...#',
  ')': '#...#..#..#.#..',
  '[': '.##.#..#..#..##',
  ']': '##..#..#..#.##.',
  '{': '.##.#.#...#..##',
  '}': '##..#...#.#.##.',
  '<': '..#.#.#...#...#',
  '>': '#...#...#.#.#..',
  '=': '...###...###...',
  '-': '......###......',
  '+': '....#.###.#....',
  '*': '#.#.#.#.#......',
  '/': '..#..#.#.#..#..',
  '\\': '#..#...#...#..#',
  _: '............###',
  '"': '#.##.#.........',
  '\'': '.#..#..........',
  '`': '#...#..........',
  '|': '.#..#..#..#..#.',
  '&': '.#.#.#.#.#.#.##',
  '%': '#.#..#.#.#..#.#',
  '#': '#.#####.#####.#',
  $: '.####..#..####.',
  '@': '####.#####...##',
  '^': '.#.#.#.........',
  '~': '....####.......',
  '…': '............#.#',
  'ƒ': '..#.#.###.#.#..',
  '◆': '....#.###.#....',
  '×': '...#.#.#.#.#...',
  '→': '.....####..#...',
};

const CACHE = new Map<string, boolean[]>();

function glyph(ch: string): boolean[] {
  let g = CACHE.get(ch);
  if (!g) {
    const src = G[ch] ?? G[ch.toUpperCase()] ?? G['?'];
    g = [...src].map((c) => c === '#');
    CACHE.set(ch, g);
  }
  return g;
}

/** Characters advance 4 cells (3 + 1 spacing). */
export const CHAR_ADVANCE = 4;
export const CHAR_HEIGHT = 5;

export function pixelTextWidth(text: string, scale = 1): number {
  const n = [...text].length;
  return n === 0 ? 0 : (n * CHAR_ADVANCE - 1) * scale;
}

/**
 * Draw text at integer pixel coordinates. `x` is the left edge, or the centre / right edge with
 * `align`. `y` is the top edge.
 */
export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string,
  align: 'left' | 'center' | 'right' = 'left',
): void {
  const width = pixelTextWidth(text, scale);
  let cx = Math.round(align === 'center' ? x - width / 2 : align === 'right' ? x - width : x);
  const cy = Math.round(y);
  ctx.fillStyle = color;
  for (const ch of text) {
    const g = glyph(ch);
    for (let i = 0; i < 15; i++) {
      if (g[i]) {
        ctx.fillRect(cx + (i % 3) * scale, cy + Math.floor(i / 3) * scale, scale, scale);
      }
    }
    cx += CHAR_ADVANCE * scale;
  }
}

/** Exposed for tests: every glyph must decode to exactly 15 cells. */
export const GLYPH_SOURCE = G;
