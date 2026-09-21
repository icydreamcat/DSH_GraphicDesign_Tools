/**
 * Build the 遥 key visual scene.
 *
 * A generator, not a hand-written JSON, because the page has to be systematic:
 * grid, ticks, registration marks, dot field, the lower-left type stack and the
 * right-hand vertical column all derive from ONE module value. A hand-written
 * scene drifts — three rules at 20px and one at 22px — and the page stops
 * reading as ordered.
 *
 * Measured facts it is built from (scenes/haruka-brief.md, tools/mass-profile,
 * tools/region-ink):
 *   figure is a single connected component, 68.9% wide x 98.7% tall of source
 *   left edge x=0.18; right edge swells to x=0.87 from y=0.56 (the banner)
 *   below y=0.87 (source) the figure only occupies x=0.20 -> 0.60
 *   columns x 0.849 -> 1.0 of the source carry under 1% ink at EVERY height
 *   => the clean fields are the LOWER LEFT and the RIGHT MARGIN, and the page
 *      is composed around those two, not around the canvas
 *
 * FOUR DEFECTS THIS FILE EXISTS TO NOT REPEAT
 *
 * 1. v1 wrote rows as `M + n * MODULE` and put a footer rule at y=3680 on a
 *    3394px sheet — off the paper. Every row now comes from row(), derived from
 *    the margin and the module, and tools/read-report.mjs flags any drawn box
 *    that leaves the sheet.
 *
 * 2. v2 positioned type by the box's TOP, but the renderer places the first
 *    baseline at `y + size*0.82`, so a 340px character's ink actually sits
 *    279px lower than its box suggests — 遥, HARUKA and the class line all
 *    landed on top of each other in the render. Type is positioned by baseline
 *    here: blk() inverts the renderer's own rule.
 *
 * 3. v3 set `lineHeight: 1.58` meaning "1.58x the size". resolveLength
 *    multiplies any value <= 1 by the CANVAS HEIGHT and treats anything above
 *    1 as bare pixels, so that was 1.58 PIXELS: seven layers stacked on top of
 *    themselves with boxes running to y=6471. Leading here is a fraction of
 *    canvas height (0.006 = 20.4px) or omitted entirely.
 *
 * 4. The dot screen silently drew nothing. `replace: true` zeroes the whole
 *    RGBA buffer, wiping the alpha channel, and the halftone's `sourceInk`
 *    guard then skipped every pixel — {dots: 0, coverage: 0} while the rest of
 *    the render report looked correct. Fixed in src/tone.mjs by capturing the
 *    shape's coverage before the clear; verified here at 18634 dots.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// ── canvas & grid ──────────────────────────────────────────────────────────
const W = 2400
const H = 3394                  // A4 portrait at 300dpi
const MODULE = 20               // 120 modules across
const M = 200                   // page margin = 10 modules
const LIVE_H = H - 2 * M        // 2994

const col = (n) => M + n * MODULE                  // live column n
const row = (n) => Math.round(M + n * MODULE)      // live row n, from the top
const LAST_ROW = Math.floor(LIVE_H / MODULE)       // 149

/**
 * Box top for a text layer whose INK BASELINE must sit at `baseline`.
 * The renderer computes `firstBaseline = y + size * 0.82`; inverting that is
 * the whole point, because a CJK glyph's ink bottom is essentially the baseline
 * and positioning by box top drifts by 0.82em — 262px at the name's size.
 */
const blk = (baseline, size) => Math.round(baseline - size * 0.82)

// ── palette ────────────────────────────────────────────────────────────────
// Deliberately narrow. The ground is a warm paper, NOT #FFFFFF: pure white
// reads as a screen, warm off-white reads as paper. The ink is a blue-cast
// near-black, never #000 — this language has no true black anywhere. The accent
// is her own crimson, read off her hair and her staff rather than invented, and
// her dress supplies the secondary indigo.
const PAPER = '#F2EFE9'
const PAPER_COOL = '#E8E6E3'
const PAPER_WARM = '#F7F4EE'
const INK = '#22232B'
const INK_SOFT = '#3A3C46'
const CRIMSON = '#9E2B22'
const CRIMSON_DEEP = '#6E211B'
const INDIGO = '#2F3E6B'
const SLATE = '#76736D'          // technical register: deliberately LOW contrast,
                                 // but measured — 4.1:1 on the paper rather than
                                 // 3.0:1, so 14px footer body is legible at 300dpi
                                 // while staying far below the name's contrast
const RULE = '#B9B4AB'

const layers = []

// ═══ 1. GROUND ═════════════════════════════════════════════════════════════
// A ground gradient must be almost invisible: three stops over a very short
// range, tilted so the lower left — where the type lands — is the lightest part
// of the sheet and the upper right a shade cooler.
layers.push({
  id: '01-ground',
  shape: 'rect', x: 0, y: 0, w: 1, h: 1,
  paint: {
    type: 'linear', angle: 135,
    stops: [
      { at: 0, color: PAPER_COOL },
      { at: 0.45, color: PAPER },
      { at: 1, color: PAPER_WARM },
    ],
  },
})

// ═══ 2. THE DOT SCREEN — the operator's own material, as a page event ═════
// Her whole fiction is a bubble: her talent grants a friendly unit a 浮泡 that
// shields it until it pops. A dot screen is the honest graphic translation, and
// it is the high-frequency layer this page would otherwise be short of.
//
// Bounded to the left 58% with a coverage ramp thinning rightward, so it is a
// local event in the left third rather than a texture spread evenly over the
// sheet — that distinction is the recorded failure this design is written
// against. It is a RECT rather than a masked full-canvas group on purpose: a
// full-canvas ink rect screened and then masked still darkened every pixel
// (measured: mean luminance 0.887 -> 0.642), because the tone op runs before
// the mask. Bounding the shape is the fix.
//
// Opacity 0.19, coverage reaching zero at 58% across, mask fading out by 62% of
// the height. Measured at 13243 dots / 0.108 raw coverage. It has to stay the
// PALEST large area on the sheet so the crimson name remains the darkest thing
// on the page: this is the page's ambient field, not its subject.
layers.push({
  id: '02-dotscreen',
  shape: 'rect',
  x: 0, y: 0, w: 0.62, h: 1,
  paint: INK,
  opacity: 0.19,
  tone: [{
    op: 'halftone',
    cell: 17, angle: 45,
    color: INK,
    alpha: 1,
    maxTone: 0.28,
    tone: 'gradient', toneAngle: 0,
    coverage: [{ at: 0, value: 1 }, { at: 0.30, value: 0.72 }, { at: 0.58, value: 0 }],
  }],
  mask: {
    shapes: [
      {
        shape: 'rect', x: 0, y: 0, w: 1, h: 1,
        paint: { type: 'fade', color: '#FFFFFF', from: 1, to: 0, angle: 90, gamma: 1.6 },
      },
    ],
  },
})

// ═══ 3. THE FIGURE ═════════════════════════════════════════════════════════
// Placed at natural scale x1.2506 so the file maps through with almost no
// resampling: 1691/1352 = 1.2506. Height is then 1690/3394 = 49.8% of canvas.
//
// The curve is the one tonal move the design makes on her, and it exists for a
// measured reason: her white coat measures ~0.95 luminance against a 0.87
// ground, i.e. 1.1:1, so the silhouette would dissolve. Pulling the top of the
// range to ~0.91 gives the whites an edge to read against without bleaching the
// drawing. The black point lifts to 12 because there is no true black here.
layers.push({
  id: '03-figure',
  shape: 'image',
  src: join(here, '..', 'assets', 'haruka-raw.png'),
  x: 0.0017, y: 0.1732, w: 0.7046, h: 0.498,
  fit: 'stretch',
  quality: 'high',
  tone: [{
    op: 'curves',
    rgb: [[0, 12], [64, 70], [128, 136], [192, 196], [243, 227], [255, 243]],
  }],
})

// ═══ 4. THE NAME — the single focus ════════════════════════════════════════
// 320px = 21x the technical register's 15px and 9.4% of canvas height. It is
// the only type on the page near this size; the next level down is 6.7x
// smaller, which is what keeps the focus unique.
//
// The placement is a measurement, not a taste. In source terms the glyph box
// runs x 0.088 -> 0.167 and y 0.735 -> 0.835, where the figure's ink does not
// begin until x 0.177 — so it sits on clear paper, with only the pale crimson
// ribbon behind its lower right corner and no fine detail there to fight.
const NAME_SIZE = 320
const NAME_BASE = 2720
const NAME_RULE = 2840

layers.push({
  id: '04-name-cjk',
  shape: 'text',
  text: '遥',
  font: { family: ['SansSC'], size: NAME_SIZE, weight: 700, tracking: -0.03 },
  color: CRIMSON,
  x: col(0), y: blk(NAME_BASE, NAME_SIZE), w: NAME_SIZE,
  wrap: false,
})

// A hairline at exactly the name's em width. Also the design's one deliberate
// accent-coloured area: 1px x 320px is 0.004% of the canvas.
layers.push({
  id: '04-name-rule',
  shape: 'line',
  x1: col(0), y1: NAME_RULE, x2: col(0) + NAME_SIZE, y2: NAME_RULE,
  width: 1, paint: CRIMSON, opacity: 0.75,
})

// The name in Latin: the second level, and the visible proof that the first
// level is first — 320 / 48 = 6.7x. Its baseline sits 68px below the glyph's
// own (the CJK em's ink bottom IS the baseline), which the render report showed
// was necessary: at a 25px gap the Latin line crowds the character's hem.
layers.push({
  id: '05-name-latin',
  shape: 'text',
  text: 'HARUKA',
  font: { family: ['Grotesk'], size: 48, weight: 400, width: 80, tracking: 0.30 },
  color: INK,
  x: col(0), y: blk(2788, 48), w: 700,
  wrap: false,
})

// The class line. Rarity is carried by a glyph rather than by colour alone, so
// it survives a single-ink print and a colour-blind reader. This is the only
// crimson type besides the name: the accent budget is spent on two things.
layers.push({
  id: '06-class',
  shape: 'text',
  text: '6★  护佑者',
  font: { family: ['SansSC'], size: 32, weight: 500, tracking: 0.04 },
  color: CRIMSON_DEEP,
  x: col(0), y: blk(2920, 32), w: 520,
  wrap: false,
})

// ═══ 5. THE RIGHT-HAND VERTICAL COLUMN ════════════════════════════════════
// Measured, not guessed: every column of the source from x=0.849 to the right
// edge carries under 1% ink at every height, so the right margin is the one
// full-height field of clear paper on the sheet. A vertical line of type there
// balances the name's mass in the lower left without touching the figure, and
// vertical CJK setting is native to the language rather than a device borrowed
// from Latin typography.
//
// 24px x 13 characters is 312px of column height, sitting in the middle of the
// margin. Aligned to the RIGHT edge of the margin: the CJK run's right side at
// x=2280, the Latin's at x=2330, both inside the frame rule at 2200-2400. The
// right edge is the stronger alignment for a vertical column, because that is
// the edge a reader's eye follows down the sheet.
layers.push({
  id: '07-spine',
  shape: 'text',
  text: '遥 · 六星护佑者 · 东',
  font: { family: ['SansSC'], size: 24, weight: 400, tracking: 0.20 },
  color: INK_SOFT,
  x: 2256, y: 700,
  vertical: true,
  opacity: 0.85,
})

layers.push({
  id: '07-spine-latin',
  shape: 'text',
  text: 'ABJURER · HIGASHI',
  font: { family: ['Grotesk'], size: 17, weight: 400, width: 82, tracking: 0.30 },
  color: SLATE,
  x: 2298, y: 700,
  vertical: true,
  opacity: 0.8,
})

// ═══ 6. FOOTER — information density at almost no visual weight ═══════════
// THREE columns, not two. With two, the right half of the footer was empty and
// the lower right of the page had no content at all — the figure ends at y 2277
// while the sheet runs to 3194. Three 640px columns at 200 / 856 / 1512 with a
// 16px gutter end exactly on the right margin at 2200.
//
// The rule sits at 2993, which is 54px under the class line's ink bottom
// (2939) and leaves the class its room; at 3033 the gap above the rule was
// 94px against 141px below it, and the block read as pushed down.
//
// Everything here is small and pale: the band exists so the page has something
// to read at close range, not so it has something loud at the bottom. Bodies
// are held to TWO lines each — three pushed the band to y=3182 against a frame
// at 3194, which is not a margin.
const F_RULE = 2993
layers.push({
  id: '08-footer-rule',
  shape: 'line',
  x1: col(0), y1: F_RULE, x2: col(100), y2: F_RULE,
  width: 1, paint: RULE,
})

const F_W = 640
const F_X = [200, 856, 1512]
const F_BODY_SIZE = 14

const footerCols = [
  {
    label: '天赋 \\ TALENT',
    head: '浮光泡影',
    body: '每过一个攻击间隔，使范围内一名友方单位获得 30% 庇护\n的浮泡；破碎时第二天赋 扶摇花火 治疗该单位。',
  },
  {
    label: '技能 \\ SKILLS',
    head: '夜啼彩羽 · 幽隙栖萤 · 夏末游鳞',
    body: '浮泡庇护 / 治疗转法伤 / 浮空与持续法伤。\n再部署 70s    费用 11→13    阻挡 1    攻击间隔 1.6s',
  },
  {
    label: '档案 \\ RECORD',
    head: '东 · HIGASHI',
    body: '上线 2025.08.02    标准寻访    六星护佑者\n远程位 · 支援 · 生存 · 治疗    画幅 2400 × 3394',
  },
]

footerCols.forEach((c, i) => {
  const x = F_X[i]
  layers.push({
    id: `08-footer-label-${i + 1}`,
    shape: 'text', text: c.label,
    font: { family: ['Grotesk', 'SansSC'], size: 13, weight: 500, width: 84, tracking: 0.24 },
    color: i === 0 ? CRIMSON : SLATE,
    x, y: blk(F_RULE + 40, 13), w: F_W, wrap: false,
  })
  layers.push({
    id: `08-footer-head-${i + 1}`,
    shape: 'text', text: c.head,
    font: { family: ['SansSC'], size: 20, weight: 500, tracking: 0.02 },
    color: INK_SOFT,
    x, y: blk(F_RULE + 92, 20), w: F_W, wrap: false,
  })
  layers.push({
    id: `08-footer-body-${i + 1}`,
    shape: 'text', text: c.body,
    // Leading: NOT set. `font.lineHeight` is an em RATIO, not a canvas
    // fraction — parseFontSpec puts it straight into lineHeightEm — so a value
    // of 0.0066 meant 0.09px of leading and both 14px lines were drawn on top of
    // each other. The default is 1.4em, which measured (tools/line-probe.mjs,
    // 14px, two lines) as a real 20px baseline pitch with two distinct ink
    // bands. The measurement is the specification here.
    font: { family: ['SansSC'], size: F_BODY_SIZE, weight: 300 },
    color: SLATE,
    x, y: blk(F_RULE + 130, F_BODY_SIZE), w: F_W,
  })
})

// ═══ 7. FRAME ═════════════════════════════════════════════════════════════
// Hairlines at 0.5: enough to say "this sheet was measured", faint enough never
// to be the strongest line on the page. The figure crosses the top rule, which
// is what keeps the frame from reading as a picture frame.
layers.push({
  id: '09-margin-frame',
  shape: 'group',
  opacity: 0.5,
  children: [
    { id: '09-frame-top', shape: 'line', x1: M, y1: M, x2: W - M, y2: M, width: 1, paint: RULE },
    { id: '09-frame-bot', shape: 'line', x1: M, y1: H - M, x2: W - M, y2: H - M, width: 1, paint: RULE },
    { id: '09-frame-left', shape: 'line', x1: M, y1: M, x2: M, y2: H - M, width: 1, paint: RULE },
    { id: '09-frame-right', shape: 'line', x1: W - M, y1: M, x2: W - M, y2: H - M, width: 1, paint: RULE },
  ],
})

// ═══ 8. STRUCTURAL GRID ═══════════════════════════════════════════════════
// At the full module pitch, but masked so it dies out rightward and downward:
// the grid is a left-page event and its disappearance is part of the
// composition. A grid spread evenly across everything is exactly what the
// recorded failure did.
const guideRows = Array.from({ length: LAST_ROW + 1 }, (_, i) => i).filter((r) => r % 5 === 0)

layers.push({
  id: '10-grid',
  shape: 'group',
  opacity: 0.40,
  children: [
    ...Array.from({ length: 21 }, (_, i) => ({
      id: `10-grid-v${i}`, shape: 'line',
      x1: col(i * 5), y1: M, x2: col(i * 5), y2: H - M,
      width: 1, paint: RULE,
    })),
    ...guideRows.map((r, i) => ({
      id: `10-grid-h${i}`, shape: 'line',
      x1: M, y1: row(r), x2: W - M, y2: row(r),
      width: 1, paint: RULE,
    })),
  ],
  mask: {
    shapes: [
      { shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: { type: 'fade', color: '#FFFFFF', from: 1, to: 0.04, angle: 0, gamma: 0.95 } },
      { shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: { type: 'fade', color: '#FFFFFF', from: 1, to: 0.12, angle: 90, gamma: 1.2 } },
    ],
  },
})

// ═══ 9. MICRO-MARKS — the element count that makes the page rich ══════════
// Many marks, each almost invisible. The reference's richness is high frequency
// at low contrast: a hundred 6% hairlines read as fine, five 60% blocks read as
// crude. Individual marks sit at 10-26% and the group itself at 0.5, so what a
// reader perceives is the system, not any one tick.
const micro = []

// Registration crosshairs at the four corners of the live area.
for (const [cx, cy, tag] of [[M, M, 'tl'], [W - M, M, 'tr'], [M, H - M, 'bl'], [W - M, H - M, 'br']]) {
  micro.push({ id: `11-cross-${tag}-h`, shape: 'line', x1: cx - 16, y1: cy, x2: cx + 16, y2: cy, width: 1, paint: INK })
  micro.push({ id: `11-cross-${tag}-v`, shape: 'line', x1: cx, y1: cy - 16, x2: cx, y2: cy + 16, width: 1, paint: INK })
}

// Graduated ticks along the top and bottom margins, every module, long every
// fifth. The cheapest available way to raise spatial frequency.
for (let i = 0; i <= 100; i++) {
  const x = col(i)
  const long = i % 5 === 0
  micro.push({ id: `11-tick-t${i}`, shape: 'line', x1: x, y1: M - (long ? 18 : 9), x2: x, y2: M - 1, width: 1, paint: INK })
  micro.push({ id: `11-tick-b${i}`, shape: 'line', x1: x, y1: H - M + 1, x2: x, y2: H - M + (long ? 18 : 9), width: 1, paint: INK })
}

// Small square clusters on grid intersections — the reference language's
// signature detail, deliberately at 12-22%. Placed in the empty right-mid band
// and the top-left corner. They were first put at x=200-340. The 900px
// full-resolution crop showed them sitting ON the HARUKA line's baseline, with
// the roman-numeral tags colliding with the "A" — a defect invisible in the 44%-
// scale preview and obvious at 1:1, which is why tools/crop-view.mjs exists.
const squares = [
  [0, 14, 7], [1, 14, 5], [0, 15, 5], [1, 15, 7], [2, 14, 4], [2, 15, 4],
  [62, 5, 6], [63, 5, 4], [62, 6, 4], [63, 6, 6], [64, 5, 3],
  [78, 70, 7], [79, 70, 5], [78, 71, 5], [79, 71, 7], [80, 70, 4], [80, 71, 4],
  [78, 74, 5], [79, 74, 4],
]
squares.forEach(([cc, rr, size], i) => {
  micro.push({
    id: `11-sq${i}`, shape: 'rect',
    x: col(cc), y: row(rr), w: size, h: size,
    paint: i % 3 === 0 ? INK : CRIMSON,
    opacity: i % 3 === 0 ? 0.22 : 0.12,
  })
})

// A graduated bar scale — a technical legend, and further frequency for free.
for (let i = 0; i < 11; i++) {
  micro.push({
    id: `11-bar${i}`, shape: 'rect',
    x: col(70) + i * 14, y: row(6), w: 10, h: 6,
    paint: i < 4 ? INK : i < 8 ? INDIGO : CRIMSON,
    opacity: 0.14 + i * 0.022,
  })
}

// Numbered annotation tags — the reference's annotation vocabulary, each one
// nearly invisible on its own. These pointed at the lower-left corner too and
// are now in the same right-mid band as the squares, for the same reason.
const tags = [[78, 78, 'I'], [78, 82, 'II'], [78, 86, 'III']]
tags.forEach(([cc, rr, label], i) => {
  micro.push({
    id: `11-tagbox${i}`, shape: 'rect',
    x: col(cc), y: row(rr), w: 18, h: 18,
    stroke: { color: INK, width: 1 }, paint: 'none', opacity: 0.26,
  })
  micro.push({
    id: `11-taglabel${i}`, shape: 'text', text: label,
    font: { family: ['Grotesk'], size: 11, weight: 500, width: 85, tracking: 0.05 },
    color: INK, x: col(cc) + 6, y: row(rr) + 3, w: 20, wrap: false, opacity: 0.5,
  })
})

// A coordinate readout, in the technical register.
micro.push({
  id: '11-coord', shape: 'text', text: 'N 35.68  E 139.69',
  font: { family: ['MonoTech'], size: 10, weight: 400, tracking: 0.12 },
  color: SLATE, x: col(0), y: row(2), w: 300, wrap: false, opacity: 0.62,
})

// ── ONE annotation callout, and only one ───────────────────────────────────
// The measured spatial grid puts detail at 0.003-0.005 in the lower-right
// cells — flatter than anywhere else on the sheet, and the flattest thing on a
// page whose whole language is fine marks. A single callout on the staff does
// two jobs at once: it raises local frequency exactly where the grid says it is
// missing, and it names the thing the picture is actually about, that the wheel
// is the focus of her arts.
//
// Placed just right of the staff wheel — the second README measurement, the
// column-extent table, puts the source's ink ending at x=0.826 = 1982px, but the
// raised hand reaches 0.77 = 1848px, so the leader is kept in the 1820-1960px
// strip between them and the label sits at 1810. Version 1 put the label at
// x=1906 with a 260px leader and the whole thing read as a floating box in the
// margin rather than as an annotation of the weapon. Deliberately ONE callout:
// a second and third would turn an annotation into a diagram.
micro.push({
  id: '11-callout-target', shape: 'rect',
  x: 1940, y: 1032, w: 20, h: 20,
  stroke: { color: CRIMSON, width: 1 }, paint: 'none', opacity: 0.66,
})
micro.push({
  id: '11-callout-lead-h', shape: 'line',
  x1: 1810, y1: 1042, x2: 1938, y2: 1042, width: 1, paint: CRIMSON, opacity: 0.45,
})
micro.push({
  id: '11-callout-lead-v', shape: 'line',
  x1: 1810, y1: 1006, x2: 1810, y2: 1042, width: 1, paint: CRIMSON, opacity: 0.45,
})
micro.push({
  id: '11-callout-text', shape: 'text',
  text: 'ORIGINIUM ARTS\n施术单元 · 浮泡发生器',
  font: { family: ['MonoTech', 'SansSC'], size: 12, weight: 400 },
  color: SLATE, x: 1810, y: 962, w: 300, wrap: false, opacity: 0.85,
})

layers.push({ id: '11-micromarks', shape: 'group', opacity: 0.5, children: micro })

// ═══ 10. GRAIN — the last frequency layer ═════════════════════════════════
// Deterministic seed, so two rounds of the design are byte-comparable and a
// change in the numbers means a change in the design, not in the noise.
layers.push({
  id: '12-grain',
  shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: '#808080',
  effects: [{ type: 'grain', amount: 0.02, mono: true, seed: 20260802 }],
  opacity: 0.45, blend: 'overlay',
})

// ═══ 11. TONE — the adjustment the old workflow could not reach ═══════════
layers.push({
  kind: 'adjustment',
  id: '13-tone',
  ops: [
    // Pull a little chroma out of everything so her crimson is the only
    // saturated thing left, then lift the blacks — no true black anywhere.
    { op: 'hueSaturation', saturation: -0.10 },
    { op: 'curves', rgb: [[0, 10], [64, 70], [160, 164], [255, 250]] },
  ],
  opacity: 0.8,
})

const scene = {
  canvas: { width: W, height: H },
  ground: PAPER,
  // GATE 1 的声明。渲染器拒绝没有 gates 块的场景；这是引擎自带的固件场景，
  // 用 --no-gates 也能渲，但补上之后它和设计稿走同一条链（交付闸门 H3/H4 会读它）。
  gates: {
    sequence: [
      "the layers listed in `gates.layers`: a fixed engine fixture, not a scene read from a brief",
      "engine fixture — it demonstrates a technique rather than reproducing a reference language",
      "top-left to bottom-right; the sheet is read as a grid of cells",
      "no depicted light source; the fixture demonstrates effects, so each layer states its own",
      "held in a narrow band by construction, because a fixture must not fight the effect it shows",
      "each cell is a sample; nothing here is a label, prop or device",
      "a single accent carries the sheet; see `accentBand`",
      "no material families on this sheet, so nothing to interleave",
      "rectangles and ellipses only — the geometry is deliberately plain so the effect is what is judged",
      "the effect under demonstration is the subject of the sheet",
      "whatever the demonstrated effect produces, reported by the render rather than claimed here",
    ],
    focus: 'THE ONE FOCUS of this sheet, and what it competes with',
    lightAxis: 'WHERE THE LIGHT COMES FROM (direction and quality, in one clause)',
    // 从本文件的 layers 里按顺序提取，不是手写 —— 手写的会与真实列表分岔
    layers: ["01","02","03","04","05","06","07","08","09","10","11","12","13"],
    drawingRule: 'THE RULE THAT GENERATES EACH GROUP, not a list of the groups',
    accentBand: [0, 0.08],
  },
  layers,
}
const outPath = join(here, 'haruka-kv.json')
writeFileSync(outPath, JSON.stringify(scene, null, 2))

console.log(JSON.stringify({
  ok: true, scene: outPath, canvas: `${W}x${H}`, module: MODULE,
  layout: {
    nameBaseline: NAME_BASE, nameBoxTop: blk(NAME_BASE, NAME_SIZE),
    nameRule: NAME_RULE, latinBaseline: 2788, classBaseline: 2920,
    spineX: 2300, footerRule: F_RULE,
    footerBodyTop: blk(F_RULE + 130, F_BODY_SIZE), frameBottom: H - M,
  },
  topLevelLayers: layers.length,
  totalLayers: layers.reduce((n, l) => n + 1 + (l.children ? l.children.length : 0), 0),
}, null, 2))
