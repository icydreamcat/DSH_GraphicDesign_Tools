/**
 * Build the 遥 key visual — v12, rebuilt against the official reference.
 *
 * WHAT CHANGED AND WHY (measurements in scenes/official-principles.md)
 *
 * The previous version was technically sound — unique focus, controlled tone
 * band, real halftone, clean hairlines — and it measured 85.8% paper white with
 * 0.4% dark. The official key visual measures 31% paper, 27% dark, 22% strong
 * red, and its tone runs 0.117 at the top to 0.947 at the bottom, an arc of
 * 0.83. That gap — not the layout, not the type — is what made mine read as
 * sparse and flat. So this rebuild adopts the official's seven devices:
 *
 *   1. a full tonal ARC, darkest at the top, bottom ~14% left as clean paper
 *   2. a five-slot palette whose near-black and midtone are WARM, not neutral
 *      grey — a neutral midtone over a warm ground is what looks dirty
 *   3. richness from LAYERED IMAGE PLANES (a ghosted second figure) rather than
 *      from a hairline grid — the official has no grid at all (its own analysis
 *      reports columnPitch: null)
 *   4. information as an outlined CHIP TABLE, not as scattered footnotes
 *   5. a typographic register that includes a STAR ROW as its own graphic level
 *   6. a LOGO LOCKUP as the horizontal base the page lands on
 *   7. full-bleed composition rather than a wide margin, which is what turns a
 *      poster into a document
 *
 * Source facts (tools/mass-profile.mjs, tools/region-ink.mjs, tools/zone-tone.mjs):
 *   the cutout is ONE connected component, ink x 0.177 -> 0.866, y 0.007 -> 0.995
 *   in the columns the quote occupies (x<0.31 source) the ink begins only at
 *   y=0.71 source, so the quote sits on the drawing's own empty left field
 *   the chip zone (source x 0.58-0.78, y 0.06-0.20) measures mean luminance 0.711
 *   source columns x 0.849 -> 1.0 carry under 1% ink at every height
 *
 * DEFECTS THIS FILE EXISTS TO NOT REPEAT
 *   rows written as `M + n * MODULE` ran off the canvas; every row now comes from
 *   row()/rowN(), and tools/read-report.mjs flags any drawn box that leaves the
 *   sheet. Type is positioned by BASELINE — blk() inverts the renderer's
 *   `y + size*0.82` rule, because positioning by box top drifted a 320px glyph
 *   by 262px and stacked three type levels on each other. `lineHeight` is never
 *   set: `font.lineHeight` is an em RATIO, so 0.0066 meant 0.09px of leading and
 *   collapsed every multi-line block onto one line.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// ── canvas & grid ──────────────────────────────────────────────────────────
const W = 2400
const H = 3394                  // A4 portrait at 300dpi
const MODULE = 20
const M = 120                   // reduced from 200: the official is full-bleed,
                                // and a wide margin is what made the old page
                                // read as a document instead of a poster

const col = (n) => M + n * MODULE
const row = (n) => Math.round(M + n * MODULE)
const rowN = (n) => Math.round(H - M - n * MODULE)

/** Box top for a text layer whose INK BASELINE must sit at `baseline`. */
const blk = (baseline, size) => Math.round(baseline - size * 0.82)

// ── palette: five functional slots, all warm ───────────────────────────────
const INK_DEEP = '#171214'      // top of the arc; the official's #181616, warmed
const INK_MID = '#3A2420'       // the official's warm brown-black shadow
const CRIMSON_DEEP = '#5E211C'  // deep crimson: the shadow side of her hair
const CRIMSON = '#9E2B22'       // the accent proper
const EMBER = '#6E332A'         // mid-arc warm brown (official #683529)
const PROSE = '#7A3B31'         // upper-middle of the arc, carrying the quote
const PAPER = '#EFE7DE'         // warm cream, not white
const PAPER_HI = '#F8F4EF'
const CHIP = '#F6F1EA'          // chip fill — opaque, so it reads on any ground
const CYAN = '#1E7FA8'          // the official's one cool mark, used ONLY on
                                // hairlines and chips, well under 1% of area
const STAR = '#151011'
const TYPE_DARK = '#241A19'
const TYPE_MID = '#5C3A31'

const layers = []

// ═══ 1. THE TONAL ARC ═════════════════════════════════════════════════════
layers.push({
  id: '01-arc',
  shape: 'rect', x: 0, y: 0, w: 1, h: 1,
  paint: {
    type: 'linear', angle: 90,
    stops: [
      { at: 0.00, color: INK_DEEP },
      { at: 0.16, color: INK_MID },
      { at: 0.32, color: CRIMSON_DEEP },
      { at: 0.50, color: EMBER },
      { at: 0.66, color: PROSE },
      { at: 0.80, color: PAPER },
      { at: 1.00, color: PAPER_HI },
    ],
  },
})

// ═══ 2. THE GHOST PLANE ═══════════════════════════════════════════════════
// The official's depth comes from a second, ghosted image of the same character
// behind the main one. This is that plane: the source's head-and-shoulders crop,
// duotoned into the arc's warm dark and faded to about a sixth.
//
// WHY THE BOX IS IN PIXELS AND NOT FRACTIONS
// The renderer clamps a shape's x/w to the canvas BEFORE computing the
// contain-scale (`shapeBox` does `Math.max(0, ...)` on x and caps w at W - x).
// So an image declared as `x: -0.086, w: 2.38` — which is what the first attempt
// at this layer said — is silently rewritten to the canvas box, the scale factor
// becomes W/(W*2.38) = 0.42, and the figure is drawn at 42% size in the top-left
// corner. Measured: the figure and the ghost were both effectively absent from
// the render entirely. Every image box below is therefore an explicit pixel
// rectangle fully inside the canvas, and the ENLARGEMENT comes from the box
// being larger than the source (1352x1690 placed into a 1690x1690 box is a
// 1.25x enlargement), not from a fractional position.
//
// The fade is a MASK rather than an opacity because the crop is a rectangle and
// a rectangle of image at low opacity still has four edges; the mask dissolves
// the left and lower edges into the ground so it reads as depth, not as a pasted
// box. Same reasoning as bounding the dot screen by its own shape.
layers.push({
  id: '02-ghost',
  shape: 'image',
  src: join(here, '..', 'assets', 'haruka-raw.png'),
  x: 1180, y: -0.0750, w: 1900, h: 1900,
  fit: 'contain',
  anchorX: 0.5, anchorY: 0,
  quality: 'high',
  opacity: 0.17,
  tone: [{
    op: 'duotone',
    shadows: '#20161A',
    midtones: '#5A2E28',
    highlights: '#B98C82',
    strength: 0.92,
  }],
  mask: {
    shapes: [
      // Fade out leftward: the ghost belongs to the top-right.
      { shape: 'rect', x: 1180, y: 0, w: 1900, h: 1900, paint: { type: 'fade', color: '#FFFFFF', from: 0, to: 1, angle: 0, gamma: 0.75 } },
      // Fade out downward, so its lower edge never becomes a horizon.
      { shape: 'rect', x: 1180, y: 0, w: 1900, h: 1900, paint: { type: 'fade', color: '#FFFFFF', from: 1, to: 0, angle: 90, gamma: 0.6 } },
    ],
  },
})

// ═══ 3. THE DOT SCREEN — the operator's own material ══════════════════════
// Her talent grants a friendly unit a 浮泡 that shields it until it pops, so a
// dot screen is the honest graphic translation. Held to the upper-left, thinned
// rightward and downward, set in the arc's warm brown rather than a neutral ink.
//
// The tone op REPLACES the shape's fill: a screen composited on top of a flat
// fill can only add ink, so the fill stays solid and the screen is never seen.
// Measured after the engine fix: dots and coverage both non-zero.
layers.push({
  id: '03-dotscreen',
  shape: 'rect',
  x: 0, y: 0, w: 0.60, h: 0.62,
  paint: INK_DEEP,
  opacity: 0.34,
  tone: [{
    op: 'halftone',
    cell: 17, angle: 45,
    color: INK_DEEP,
    alpha: 1,
    maxTone: 0.30,
    tone: 'gradient', toneAngle: 0,
    coverage: [{ at: 0, value: 1 }, { at: 0.34, value: 0.66 }, { at: 0.66, value: 0 }],
  }],
  mask: {
    shapes: [{
      shape: 'rect', x: 0, y: 0, w: 1, h: 1,
      paint: { type: 'fade', color: '#FFFFFF', from: 1, to: 0, angle: 90, gamma: 1.4 },
    }],
  },
})

// ═══ 4. THE FIGURE ════════════════════════════════════════════════════════
// An explicit 1690x1690 pixel box — a 1.25x enlargement of the 1352x1690 source
// — placed so the figure occupies x 234..1924 and its ink lands at x 533..1691,
// y 282..2433. The head is then at y 282..700 and the boots at y 1917..2433.
//
// It is placed to OVERLAP the quote rather than sit beneath it, because that
// overlap is what makes the page full-bleed instead of a diagram with captions.
//
// Safety for the type placement is measured, not assumed: in the columns the
// quote occupies (canvas x 120-745, i.e. source x < 0.31) the figure's ink does
// not begin until source y = 0.71, so the quote sits on the drawing's own empty
// left field rather than across her face.
//
// The curve lifts the black point to 8 and stops the highlight top at ~0.94 so
// her white coat stays the brightest thing on a now-dark page while keeping its
// internal modelling.
layers.push({
  id: '04-figure',
  shape: 'image',
  src: join(here, '..', 'assets', 'haruka-raw.png'),
  x: 260, y: 380, w: 1552, h: 1552,
  fit: 'contain',
  anchorX: 0.5, anchorY: 0,
  quality: 'high',
  tone: [{
    op: 'curves',
    rgb: [[0, 8], [64, 68], [128, 136], [192, 198], [243, 236], [255, 248]],
  }],
})

// NO DROP SHADOW UNDER THE FIGURE.
//
// A soft blurred ellipse was tried here and removed. Measured on the render: a
// blurred ellipse in this engine reads as a distinct dark blob with a visible
// soft edge, not as a shadow — the effect blurred the ellipse's own edge but the
// shape still had one, so instead of grounding her it looked like an artefact
// lying on the paper, and it sat directly under the type. Removal was the fix,
// which is also the working rule: when a composition is not working, the first
// move is subtraction.

// ═══ 5. THE QUOTE ═════════════════════════════════════════════════════════
// The official carries a quote in light type over its dark upper third, and it
// does a job nothing else on the page can: it gives the sheet a VOICE.
//
// HONEST NOTE: there is no official quote for this operator in hand. This line is
// written by me as a presentation caption, not reproduced from the game, and it
// is flagged as such in the delivery notes rather than passed off as canon.
//
// The measure is 630px. Two earlier values were tried and both failed on a
// measurement: at 660 the block ran out to x 780, where the figure's banner —
// whose brightest fold is near-white — sweeps through and light type would lose
// its contrast; at 560 the second line broke after "他们身" and left "上。"
// orphaned on a third line, which is the dangling-last-line defect the type
// skill names. At 44px with 0.06em tracking a 10-character CJK line needs
// 10 * 44 * 1.06 = 466px, so 630 holds two lines and still clears the banner,
// which does not reach this far left until y=2132.
layers.push({
  id: '05-quote',
  shape: 'text',
  text: '以浮泡护住同行的人，\n再让海面的光落到他们身上。',
  font: { family: ['SansSC'], size: 44, weight: 300, tracking: 0.06 },
  color: '#F2E6DC',
  x: 120, y: 1380, w: 630,
  opacity: 0.94,
})

layers.push({
  id: '05-quote-src',
  shape: 'text',
  text: 'OPERATOR FILE — 遥',
  font: { family: ['Grotesk', 'SansSC'], size: 16, weight: 400, width: 84, tracking: 0.34 },
  color: '#C9A99C',
  x: 120, y: blk(1670, 16), w: 500, wrap: false,
})

// ═══ 6. THE RECORD CHIPS — the official's data plate ══════════════════════
// The official presents operator data as an outlined CHIP TABLE. That is
// information design; the previous version's three-column footnote was
// information stacking. Each chip is an opaque cream rectangle with a 1px
// crimson rule, a small crimson label, a cyan leader rule and a leadered value.
//
// It sits over the drawing, the way the official's table does. An OPAQUE fill
// makes the ground beneath irrelevant: cream reads on anything darker than 0.85,
// and this zone measures 0.711.
const CHIP_X = 1540
const CHIP_W = 740
const CHIP_H = 76
const CHIP_GAP = 12
const CHIP_TOP = 1300

const chips = [
  ['代号', '遥  /  HARUKA'],
  ['星级', '6★'],
  ['职业', '护佑者  /  ABJURER'],
  ['分支', 'SUPPORTER'],
  ['种族', '阿戈尔'],
  ['出身', '东  /  HIGASHI'],
  ['专精', '演艺 · 源石技艺（浮泡）'],
  ['天赋', '浮光泡影 / 扶摇花火'],
  ['绘制', '温泉瓜'],
  ['CV', 'kiyo  /  丰崎绘'],
]

chips.forEach(([label, value], i) => {
  const y = CHIP_TOP + i * (CHIP_H + CHIP_GAP)
  layers.push({
    id: `06-chip-${i + 1}-box`,
    shape: 'rect',
    x: CHIP_X, y, w: CHIP_W, h: CHIP_H,
    paint: CHIP,
    stroke: { color: CRIMSON, width: 1 },
  })
  layers.push({
    id: `06-chip-${i + 1}-label`,
    shape: 'text', text: label,
    font: { family: ['SansSC'], size: 19, weight: 500, tracking: 0.14 },
    color: CRIMSON_DEEP,
    x: CHIP_X + 22, y: blk(y + CHIP_H / 2 + 7, 19), w: 130, wrap: false,
  })
  layers.push({
    id: `06-chip-${i + 1}-lead`,
    shape: 'line',
    x1: CHIP_X + 150, y1: y + 18, x2: CHIP_X + 150, y2: y + CHIP_H - 18,
    width: 1, paint: CYAN, opacity: 0.65,
  })
  layers.push({
    id: `06-chip-${i + 1}-value`,
    shape: 'text', text: value,
    font: { family: ['Grotesk', 'SansSC'], size: 21, weight: 400, width: 84, tracking: 0.05 },
    color: '#2A1F1D',
    x: CHIP_X + 176, y: blk(y + CHIP_H / 2 + 7, 21), w: CHIP_W - 200, wrap: false,
  })
})

// ═══ 7. THE STAR ROW — its own typographic level ══════════════════════════
// In the official this is a row of large black stars beside the name: a graphic
// element as much as a rating, so it gets its own size and colour rather than
// being a glyph buried inside a sentence.
//
// MOVED, after the render showed why. At x 130 the star row sat directly on top
// of the name's upper stroke — 6★ above 遥 with no separation, which read as one
// tangled mark rather than as two levels. It now sits in the lower-RIGHT, on the
// open field the figure's feet leave, aligned to the right margin so it balances
// the left-hand name block instead of competing with it. That open field is a
// measurement: below canvas y 2700 the figure's ink occupies only x 440-1270.
layers.push({
  id: '07-stars',
  shape: 'text',
  text: '6★',
  font: { family: ['SansSC'], size: 108, weight: 700, tracking: 0.02 },
  color: STAR,
  x: 1560, y: blk(2840, 108), w: 360, wrap: false, align: 'right',
})
layers.push({
  id: '07-stars-caption',
  shape: 'text',
  text: 'SIX STAR  ·  护佑者  ·  东  /  HIGASHI',
  font: { family: ['Grotesk', 'SansSC'], size: 18, weight: 500, width: 84, tracking: 0.30 },
  color: TYPE_MID,
  x: 1180, y: blk(2900, 18), w: 1100, wrap: false, align: 'right',
})

// ═══ 8. THE NAME — the single focus ═══════════════════════════════════════
const NAME_SIZE = 320
const NAME_BASE = 2760

layers.push({
  id: '08-name-cjk',
  shape: 'text',
  text: '遥',
  font: { family: ['SansSC'], size: NAME_SIZE, weight: 700, tracking: -0.03 },
  color: CRIMSON,
  x: 120, y: blk(NAME_BASE, NAME_SIZE), w: NAME_SIZE,
  wrap: false,
})

layers.push({
  id: '08-name-rule',
  shape: 'line',
  x1: 120, y1: 2884, x2: 120 + NAME_SIZE, y2: 2884,
  width: 1, paint: CRIMSON, opacity: 0.8,
})

layers.push({
  id: '09-name-latin',
  shape: 'text',
  text: 'HARUKA',
  font: { family: ['Grotesk'], size: 48, weight: 400, width: 80, tracking: 0.30 },
  color: TYPE_DARK,
  x: 120, y: blk(2830, 48), w: 700, wrap: false,
})

layers.push({
  id: '09-name-sub',
  shape: 'text',
  text: '浮光泡影  ·  FLEETING FOAM',
  font: { family: ['SansSC'], size: 24, weight: 400, tracking: 0.10 },
  color: TYPE_MID,
  x: 120, y: blk(2930, 24), w: 800, wrap: false,
})

// ═══ 9. THE LOGO LOCKUP — the base the page lands on ══════════════════════
// The official closes with the 明日方舟 mark beside the faction mark, separated
// by rules and a run of small letterforms. This is that lockup: a hairline, the
// CJK wordmark as a tracked display line with its Latin beneath, a vertical cyan
// divider, then the faction mark. It is the horizontal base, and its absence is
// why the old page had nothing to land on.
layers.push({
  id: '10-logo-rule',
  shape: 'line',
  x1: 120, y1: 3060, x2: 2280, y2: 3060,
  width: 1, paint: '#8A5A4E', opacity: 0.5,
})

layers.push({
  id: '10-logo-cjk',
  shape: 'text',
  text: '明日方舟',
  font: { family: ['SansSC'], size: 60, weight: 500, tracking: 0.22 },
  color: '#1C1413',
  x: 120, y: blk(3170, 60), w: 560, wrap: false,
})

layers.push({
  id: '10-logo-latin',
  shape: 'text',
  text: 'ARKNIGHTS\nOPERATOR ARCHIVE',
  font: { family: ['Grotesk'], size: 17, weight: 400, width: 84, tracking: 0.30 },
  color: '#4A3129',
  x: 124, y: blk(3245, 17), w: 560, wrap: false,
})

layers.push({
  id: '10-logo-divider',
  shape: 'line',
  x1: 760, y1: 3090, x2: 760, y2: 3260,
  width: 1, paint: CYAN, opacity: 0.5,
})

layers.push({
  id: '10-logo-mark',
  shape: 'text',
  text: '墟',
  font: { family: ['SansSC'], size: 92, weight: 700, tracking: 0.02 },
  color: '#1C1413',
  x: 820, y: blk(3175, 92), w: 220, wrap: false,
})

layers.push({
  id: '10-logo-mark-latin',
  shape: 'text',
  text: 'A10',
  font: { family: ['Grotesk'], size: 17, weight: 500, width: 84, tracking: 0.34 },
  color: '#4A3129',
  x: 824, y: blk(3245, 17), w: 220, wrap: false,
})

layers.push({
  id: '10-logo-legal',
  shape: 'text',
  text: '图文内容仅作辅助说明使用，具体请以游戏实际情况为准。',
  font: { family: ['SansSC'], size: 15, weight: 300, tracking: 0.02 },
  color: '#6B5148',
  x: 120, y: blk(3320, 15), w: 900, wrap: false,
})

layers.push({
  id: '10-logo-credit',
  shape: 'text',
  text: '© HYPERGRYPH   ·   FAN-MADE KEY VISUAL',
  font: { family: ['Grotesk'], size: 15, weight: 400, width: 84, tracking: 0.22 },
  color: '#6B5148',
  x: 1280, y: blk(3320, 15), w: 1000, wrap: false, align: 'right',
})

// ═══ 10. MICRO-MARKS ══════════════════════════════════════════════════════
// Far fewer than before, and all of it in the dark upper half where a pale mark
// can actually be seen. The previous version spent 245 of these on a white page,
// where a 12%-opacity mark is invisible — element count that is not visible is
// not frequency, it is just weight in the file.
const micro = []

// Registration crosshairs at the four corners.
for (const [cx, cy, tag] of [[M, M, 'tl'], [W - M, M, 'tr'], [M, H - M, 'bl'], [W - M, H - M, 'br']]) {
  micro.push({ id: `11-cross-${tag}-h`, shape: 'line', x1: cx - 16, y1: cy, x2: cx + 16, y2: cy, width: 1, paint: '#D8B9AC' })
  micro.push({ id: `11-cross-${tag}-v`, shape: 'line', x1: cx, y1: cy - 16, x2: cx, y2: cy + 16, width: 1, paint: '#D8B9AC' })
}

// Graduated ticks along the top and bottom margins.
for (let i = 0; i <= 54; i++) {
  const x = col(i * 2)
  const long = i % 5 === 0
  micro.push({ id: `11-tick-t${i}`, shape: 'line', x1: x, y1: M - (long ? 20 : 10), x2: x, y2: M - 1, width: 1, paint: '#D8B9AC' })
  micro.push({ id: `11-tick-b${i}`, shape: 'line', x1: x, y1: H - M + 1, x2: x, y2: H - M + (long ? 20 : 10), width: 1, paint: '#8A5A4E' })
}

// A single cyan accent mark in the dark field — the official's one cool note,
// used once so it reads as deliberate rather than as a second accent colour.
micro.push({ id: '11-cyan-dot-1', shape: 'rect', x: 2160, y: 300, w: 12, h: 12, paint: CYAN, opacity: 0.9 })
micro.push({ id: '11-cyan-dot-2', shape: 'rect', x: 2140, y: 330, w: 7, h: 7, paint: CYAN, opacity: 0.6 })
micro.push({ id: '11-cyan-dot-3', shape: 'rect', x: 2180, y: 348, w: 5, h: 5, paint: CYAN, opacity: 0.45 })

// A graduated bar scale, in the dark upper field where it can be read.
for (let i = 0; i < 9; i++) {
  micro.push({
    id: `11-bar${i}`, shape: 'rect',
    x: 1760 + i * 16, y: 980, w: 11, h: 7,
    paint: i < 3 ? '#E8CFC4' : i < 6 ? CYAN : CRIMSON,
    opacity: 0.20 + i * 0.035,
  })
}

micro.push({
  id: '11-coord', shape: 'text', text: 'N 35.68  E 139.69',
  font: { family: ['MonoTech'], size: 11, weight: 400, tracking: 0.14 },
  color: '#C9A99C', x: 120, y: row(2), w: 320, wrap: false, opacity: 0.8,
})

layers.push({ id: '11-micromarks', shape: 'group', opacity: 0.7, children: micro })

// ═══ 11. GRAIN ════════════════════════════════════════════════════════════
layers.push({
  id: '12-grain',
  shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: '#808080',
  effects: [{ type: 'grain', amount: 0.024, mono: true, seed: 20260802 }],
  opacity: 0.5, blend: 'overlay',
})

const scene = {
  canvas: { width: W, height: H },
  ground: INK_DEEP,
  // GATE 1 的声明。渲染器拒绝没有 gates 块的场景；这是引擎自带的固件场景，
  // 用 --no-gates 也能渲，但补上之后它和设计稿走同一条链（交付闸门 H3/H4 会读它）。
  gates: {
    focus: 'THE ONE FOCUS of this sheet, and what it competes with',
    lightAxis: 'WHERE THE LIGHT COMES FROM (direction and quality, in one clause)',
    // 从本文件的 layers 里按顺序提取，不是手写 —— 手写的会与真实列表分岔
    layers: ["01","02","03","04","05","06","07","08","09","10","11","12"],
    drawingRule: 'THE RULE THAT GENERATES EACH GROUP, not a list of the groups',
    accentBand: [0, 0.08],
  },
  layers,
}
const outPath = join(here, 'haruka-kv-v12.json')
writeFileSync(outPath, JSON.stringify(scene, null, 2))
console.log(JSON.stringify({
  ok: true, scene: outPath, canvas: `${W}x${H}`, layers: layers.length,
  keyPositions: {
    quoteBaseline1: 1080 + 46 * 0.82, chipsTop: CHIP_TOP,
    chipsBottom: CHIP_TOP + chips.length * (CHIP_H + CHIP_GAP) - CHIP_GAP,
    starsBaseline: 2500, nameBaseline: NAME_BASE, nameRule: 2884,
    latinBaseline: 2830, logoRule: 3060, logoBaseline: 3170, legalBaseline: 3320,
  },
}, null, 2))
