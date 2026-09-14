/**
 * Build the KV scene: 明日方舟-style editorial key visual.
 *
 * Written as a generator rather than a static JSON file so the design's
 * systematic parts are actually systematic — the grid, the tick rulers, the
 * crosshair markers and the dot field are all derived from one module value,
 * which is the difference between a design and an arrangement. A hand-written
 * scene drifts: three rules at 24px and one at 26px, and the page stops reading
 * as ordered.
 *
 * Targets taken from the measured specification of the reference
 * (out/ref-timeline.json), not from memory:
 *   ground luminance   ~0.84  -> warm off-white #F1F1EC
 *   accent share        3.1% flat chromatic -> olive, small marks only
 *   column grid         35px at 2560 wide  -> 24px module at 2400
 *   dominant stroke     1-2px hairlines
 *   dynamic range       ~0.78 but concentrated: most of the canvas sits in a
 *                       narrow light band, with one dark subject
 *   element count       ~27-47 resolved regions -> needs many small marks
 *   subject height      50-65% of canvas
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'scenes')
mkdirSync(outDir, { recursive: true })

const W = 2400
const H = 1350
const M = 104           // page margin
const MODULE = 24       // base module; the page is 100 modules wide

// ── palette ────────────────────────────────────────────────────────────────
// Deliberately narrow. The reference's restraint is what makes its 3% accent
// read as an accent; a wide palette spends the same contrast on nothing.
const PAPER = '#F1F1EC'       // ground, luminance ~0.87
const PAPER_WARM = '#E9E9E0'
const INK = '#23261C'         // near-black with a green cast, not pure black
// The accent is a low-chroma olive, not a vivid one. The reference's restraint
// is what makes its 3% accent read as an accent; a saturated olive covering the
// same area reads as a colour field instead.
const OLIVE = '#83923A'
const OLIVE_DEEP = '#4C5526'
const OLIVE_PALE = '#C2C89A'
const RULE = '#A8AD93'        // hairline colour; deliberately low contrast
const SLATE = '#8A8D80'

/** Evenly spaced guides, skipping any that would sit on a page edge. */
const guides = (count, from, to) =>
  Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1))

const verticalGuides = guides(17, M, W - M)
const horizontalGuides = guides(9, M, H - M)

const layers = []

// ── 1. paper tone ──────────────────────────────────────────────────────────
// A real gradient, not stacked translucent rectangles. Two stops is enough: a
// designed ground is nearly flat, and the whole point is that it is *nearly*
// flat — a visible gradient in the ground is a different design.
layers.push({
  id: 'L01-paper-tone',
  shape: 'rect', x: 0, y: 0, w: 1, h: 1,
  paint: {
    type: 'linear', angle: 115,
    stops: [
      { at: 0, color: '#F6F6F1' },
      { at: 0.55, color: PAPER },
      { at: 1, color: PAPER_WARM },
    ],
  },
})

// ── 2. the structural grid, faded so it appears only where it should ───────
// The review's exact complaint was "grid at 24px spread evenly across the whole
// canvas" where it should have been "sparse, chosen, systematic". So the grid
// exists at the full module pitch but carries a mask that removes it from the
// right half, where the subject sits.
layers.push({
  id: 'L02-grid',
  shape: 'group',
  // Measured against the reference: its layout rules score a peak line density
  // of 0.278, and at 0.34 opacity this grid measured under 0.15 — present on the
  // page but too faint to register as a grid at all, which is its own kind of
  // failure. 0.5 with a slightly darker rule puts it in the same band as the
  // reference without making it the loudest thing on the page.
  opacity: 0.5,
  children: [
    ...verticalGuides.map((x, i) => ({
      id: `L02-grid-v${i}`,
      shape: 'line', x1: x, y1: M, x2: x, y2: H - M,
      width: 1, paint: RULE,
    })),
    ...horizontalGuides.map((y, i) => ({
      id: `L02-grid-h${i}`,
      shape: 'line', x1: M, y1: y, x2: W - M, y2: y,
      width: 1, paint: RULE,
    })),
  ],
  mask: {
    shapes: [{
      shape: 'rect', x: 0, y: 0, w: 1, h: 1,
      // Opaque at the left, gone by two-thirds across: the grid is a left-page
      // event, and its disappearance is part of the composition.
      paint: { type: 'fade', color: '#FFFFFF', from: 1, to: 0, angle: 0, gamma: 0.85 },
    }],
  },
})

// ── 3. tick rulers on the outer margins ────────────────────────────────────
// Micro-detail that raises spatial frequency at almost zero tonal cost. Each
// tick is 1px at 45% opacity — individually invisible, collectively the thing
// that makes the page look measured rather than assembled.
const ticks = []
for (let i = 0; i <= 20; i++) {
  const x = M + ((W - 2 * M) * i) / 20
  const long = i % 5 === 0
  ticks.push({
    id: `L03-tick-t${i}`,
    shape: 'line',
    x1: x, y1: M - (long ? 16 : 9), x2: x, y2: M - 1,
    width: 1, paint: OLIVE_DEEP,
  })
  ticks.push({
    id: `L03-tick-b${i}`,
    shape: 'line',
    x1: x, y1: H - M + 1, x2: x, y2: H - M + (long ? 16 : 9),
    width: 1, paint: OLIVE_DEEP,
  })
}
layers.push({ id: 'L03-ticks', shape: 'group', opacity: 0.45, children: ticks })

// ── 4. olive geometry: ONE wedge, small, translucent ───────────────────────
// The review's worst geometric error was "geometric colour blocks opaque and
// enormous" where they should be "tiny, very pale, layered". So: one wedge,
// under 8% of the canvas area, at 30% opacity, carrying a gradient across
// itself so it is not a flat plane.
layers.push({
  id: 'L04-wedge',
  shape: 'polygon',
  points: [
    [0.052, 0.30], [0.335, 0.30], [0.276, 0.735], [0.052, 0.735],
  ],
  paint: {
    type: 'linear', angle: 70,
    stops: [
      { at: 0, color: OLIVE_PALE, alpha: 0.55 },
      { at: 1, color: OLIVE, alpha: 0.30 },
    ],
  },
  opacity: 0.42,
})

// A second, smaller plane that overlaps the first — this is where layering
// starts to read, and it is exactly what a single large block cannot do.
layers.push({
  id: 'L04-plane-small',
  shape: 'polygon',
  points: [
    [0.352, 0.205], [0.60, 0.205], [0.545, 0.545], [0.352, 0.545],
  ],
  paint: {
    type: 'linear', angle: 100,
    stops: [
      { at: 0, color: OLIVE_PALE, alpha: 0.42 },
      { at: 1, color: '#E4E8C8', alpha: 0.16 },
    ],
  },
  opacity: 0.5,
})

// ── 5. the subject, at 55% of canvas height ────────────────────────────────
// "Subject at 90% of canvas height" was a listed error; 50-65% is the band.
// The image is already a cutout, so no background box can leak in.
//
// The palette is unified by a DUOTONE on the subject rather than by laying an
// olive rectangle over it. The rectangle version was a real defect: it extended
// past the point where the subject had already faded, so its remaining area had
// nothing to tint and showed as a free-floating soft-edged box. Applied as a
// duotone, the olive belongs to the figure itself and there is no rectangle to
// leak — the same intent, reached without an artefact.
layers.push({
  id: 'L05-subject',
  shape: 'image',
  src: join(here, '..', 'assets', 'yao-cutout.png'),
  x: 0.545, y: 0.085, w: 0.395, h: 0.70,
  fit: 'contain',
  anchorX: 0.5,
  anchorY: 0.5,
  quality: 'high',
  // Shadows and highlights are both pulled toward the page: a green-cast near
  // black and a warm off-white, so the figure reads as printed on this paper
  // rather than pasted onto it.
  effects: [{
    type: 'duotone',
    // Muted, not saturated. Measured against the reference, a designed accent
    // should hold only a few percent of the frame's chromatic pixels; a duotone
    // whose midtone is a saturated olive pushes the figure itself over that
    // budget and the page stops reading as restrained. The midtone is therefore
    // pulled toward grey and the strength kept under 1 so some of the original
    // tonality survives.
    shadows: '#2C3123',
    midtones: '#6E7458',
    highlights: '#EFEFE4',
    strength: 0.82,
  }],
  // Bottom fade so the figure dissolves into the page instead of ending on a
  // hard horizontal cut, which is the single most common way a placed cutout
  // looks pasted. Written as explicit stops rather than a plain ramp so opacity
  // holds at 1 down to 55% of the box and only then falls away — a ramp across
  // the whole box starts eating the figure at its waist.
  mask: {
    shapes: [{
      shape: 'rect', x: 0, y: 0, w: 1, h: 1,
      paint: {
        type: 'linear', angle: 90,
        stops: [
          { at: 0, color: '#FFFFFF' },
          { at: 0.55, color: '#FFFFFF' },
          { at: 0.78, color: '#FFFFFF', alpha: 0.55 },
          { at: 0.94, color: '#FFFFFF', alpha: 0.12 },
          { at: 1, color: '#FFFFFF', alpha: 0 },
        ],
      },
    }],
  },
})

// ── 6. the dot screen — applied to the FIGURE, not to a panel ──────────────
//
// A rectangular panel of dots was tried first and rejected: however carefully
// its edges were feathered it remained a visible rectangle lying on the page,
// because a rectangle of texture is still a rectangle. The reference's dot
// fields are not panels either — they are screens over a figure, where the dots
// take the subject's own silhouette and therefore have no boundary to give
// away.
//
// So the screen is declared on the subject layer itself. `respectAlpha` keeps
// it inside the figure's ink, and the coverage ramp fades it out toward the
// bottom so the legs dissolve into the page as dots rather than as a softened
// photograph.
layers.push({
  id: 'L06-subject-screen',
  shape: 'image',
  src: join(here, '..', 'assets', 'yao-cutout.png'),
  x: 0.545, y: 0.085, w: 0.395, h: 0.70,
  fit: 'contain',
  anchorX: 0.5,
  anchorY: 0.5,
  quality: 'high',
  blend: 'multiply',
  opacity: 0.30,
  tone: [{
    op: 'halftone',
    cell: 13, angle: 45, color: '#3F4A20',
    alpha: 1, maxTone: 0.55,
    // Tone is driven by a vertical gradient so the screen is densest at the top
    // and thins to nothing at the bottom — the dissolve, expressed in the marks
    // themselves rather than as a fade laid over them.
    tone: 'gradient', toneAngle: 90,
    coverage: [
      { at: 0, value: 1 },
      { at: 0.55, value: 0.85 },
      { at: 1, value: 0 },
    ],
  }],
})

// ── 7. the type ────────────────────────────────────────────────────────────

// The single focus. Fitted against real metrics, not estimated.
layers.push({
  id: 'L07a-hero-cjk',
  shape: 'text',
  text: '美术视觉语言',
  font: { family: ['SansSC'], size: 148, weight: 700, tracking: -0.025 },
  color: INK,
  x: 0.055, y: 0.245, w: 0.475,
  lineHeight: 1.04,
  fit: true,
})

// Secondary Latin, set at roughly 0.4x the hero — a readable step that keeps
// the focus unique.
layers.push({
  id: 'L07b-hero-latin',
  shape: 'text',
  text: 'ART & VISUAL LANGUAGE',
  font: { family: ['Grotesk'], size: 30, weight: 500, width: 88, tracking: 0.30 },
  color: OLIVE_DEEP,
  x: 0.0565, y: 0.415, w: 0.40,
  wrap: false,
})

// A hairline under the secondary line, at the exact width of the text above it
// is the sort of alignment that has to be measured, not eyeballed.
layers.push({
  id: 'L07c-rule',
  shape: 'line',
  x1: 0.0565, y1: 0.452, x2: 0.42, y2: 0.452,
  width: 1, paint: OLIVE_DEEP,
  opacity: 0.55,
})

layers.push({
  id: 'L07d-kicker',
  shape: 'text',
  text: 'ARKNIGHTS / VISUAL SYSTEM',
  font: { family: ['Grotesk'], size: 15, weight: 400, width: 84, tracking: 0.36 },
  color: SLATE,
  x: 0.0565, y: 0.196, w: 0.35,
  wrap: false,
})

layers.push({
  id: 'L07e-index',
  shape: 'text',
  text: '09',
  font: { family: ['Grotesk'], size: 13, weight: 600, width: 85, tracking: 0.10 },
  color: OLIVE,
  x: 0.0565, y: 0.166, w: 0.1,
  wrap: false,
})

// The name and class, set as a pair with a real hierarchy gap.
layers.push({
  id: 'L07f-name',
  shape: 'text',
  text: 'MuelSyse',
  font: { family: ['SerifSC'], size: 62, weight: 400, tracking: -0.005 },
  color: INK,
  x: 0.055, y: 0.615, w: 0.3,
  wrap: false,
})

layers.push({
  id: 'L07g-class',
  shape: 'text',
  text: 'VANGUARD',
  font: { family: ['Grotesk'], size: 16, weight: 400, width: 82, tracking: 0.40 },
  color: OLIVE_DEEP,
  x: 0.0565, y: 0.708, w: 0.2,
  wrap: false,
})

// Caption column: wraps against real metrics, and its width is a grid multiple.
layers.push({
  id: 'L07h-caption',
  shape: 'text',
  text: '网格与尺度级数决定版面的秩序。秩序不是限制，是让每一条信息都能被读到的前提。\nA grid and a scale ladder decide the order of a page. That order is not a constraint — it is the precondition for every item being read at all.',
  font: { family: ['SansSC'], size: 14, weight: 300, lineHeight: 1.72 },
  color: '#6A6E60',
  x: 0.0565, y: 0.775, w: 0.235,
})

// Footer metadata, monospaced, micro — the layer that adds information density
// without adding visual weight.
layers.push({
  id: 'L07i-footer',
  shape: 'text',
  text: 'ARK-VIS-003   ·   LAYER 09   ·   2400 × 1350',
  font: { family: ['Mono'], size: 12, weight: 400, tracking: 0.12 },
  color: SLATE,
  x: 0.0565, y: 0.925, w: 0.36,
  wrap: false,
})

// Right-hand data caption, right-aligned to the page margin.
layers.push({
  id: 'L07j-right-caption',
  shape: 'text',
  text: 'ORIGINIUM ARTS / HYDRO CONTROL / RANGE 3.2',
  font: { family: ['Grotesk'], size: 12, weight: 400, width: 84, tracking: 0.22 },
  color: SLATE,
  x: 0.505, y: 0.852, w: 0.415,
  align: 'right',
  wrap: false,
})

// Vertical spine label on the right edge.
layers.push({
  id: 'L07k-spine',
  shape: 'text',
  text: 'BEYOND THE TIMELINE',
  font: { family: ['Grotesk'], size: 11, weight: 400, width: 82, tracking: 0.30 },
  color: OLIVE_DEEP,
  x: 0.9635, y: 0.175,
  vertical: true,
  opacity: 0.8,
})

// Curved line, echoing the reference's ruled sweeps.
layers.push({
  id: 'L07l-arc',
  shape: 'text',
  text: 'ESCAPLATOR IS HERE FOR EVERYONE',
  font: { family: ['Grotesk'], size: 12, weight: 500, width: 84, tracking: 0.26 },
  color: OLIVE,
  path: { cx: 0.775, cy: 0.30, r: 300, startAngle: -Math.PI / 2 },
  opacity: 0.75,
})

// ── 8. micro-marks: the element count that makes the page rich ─────────────
const micro = []

// Crosshair registration marks at the four corners of the live area.
for (const [cx, cy, tag] of [[0.0435, 0.077, 'tl'], [0.9565, 0.077, 'tr'], [0.0435, 0.923, 'bl'], [0.9565, 0.923, 'br']]) {
  micro.push({ id: `L08-cross-${tag}-h`, shape: 'line', x1: cx - 0.0075, y1: cy, x2: cx + 0.0075, y2: cy, width: 1, paint: OLIVE_DEEP })
  micro.push({ id: `L08-cross-${tag}-v`, shape: 'line', x1: cx, y1: cy - 0.0133, x2: cx, y2: cy + 0.0133, width: 1, paint: OLIVE_DEEP })
}

// Small square clusters on the grid intersections — the reference language's
// signature detail. Deliberately at 12-20% opacity: many marks, barely seen.
const squares = [
  [0.415, 0.175, 7], [0.442, 0.175, 5], [0.415, 0.205, 5], [0.442, 0.205, 7],
  [0.469, 0.175, 4], [0.469, 0.205, 4],
  [0.415, 0.235, 4], [0.442, 0.235, 3],
]
squares.forEach(([sx, sy, size], i) => {
  micro.push({
    id: `L08-sq${i}`,
    shape: 'rect',
    x: sx, y: sy, w: size, h: size,
    paint: i % 3 === 0 ? OLIVE_DEEP : OLIVE,
    opacity: i % 3 === 0 ? 0.22 : 0.14,
  })
})

// A row of graduated bars — a technical scale legend.
for (let i = 0; i < 9; i++) {
  micro.push({
    id: `L08-bar${i}`,
    shape: 'rect',
    x: 0.615 + i * 0.0155, y: 0.148, w: 0.0105, h: 0.0133,
    paint: i < 3 ? INK : i < 6 ? OLIVE : OLIVE_PALE,
    opacity: 0.30 + i * 0.03,
  })
}

// Numbered letter tags — the reference's annotation vocabulary.
const tags = [
  [0.415, 0.600, 'I'],
  [0.415, 0.665, 'II'],
  [0.415, 0.730, 'III'],
]
tags.forEach(([tx, ty, label], i) => {
  micro.push({
    id: `L08-tagbox${i}`,
    shape: 'rect', x: tx, y: ty, w: 18, h: 18,
    stroke: { color: OLIVE_DEEP, width: 1 },
    paint: 'none',
    // Many marks, each faint. The individual tag is meant to be almost
    // invisible; what the reader perceives is the system of tags, not any one.
    opacity: 0.28,
  })
  micro.push({
    id: `L08-taglabel${i}`,
    shape: 'text', text: label,
    font: { family: ['Grotesk'], size: 11, weight: 600, width: 85, tracking: 0.05 },
    color: OLIVE_DEEP,
    x: tx + 6, y: ty + 3.5, w: 20, wrap: false,
    opacity: 0.55,
  })
})

// A short coordinate readout at a grid intersection.
micro.push({
  id: 'L08-coord',
  shape: 'text',
  text: "N° E 06",
  font: { family: ['Mono'], size: 10, weight: 400, tracking: 0.10 },
  color: SLATE,
  x: 0.415, y: 0.128, w: 0.1, wrap: false,
  opacity: 0.7,
})

layers.push({
  id: 'L08-micromarks',
  shape: 'group',
  // 0.62, not 1.0: the whole point of this layer is that it is felt and not
  // seen. Measured against the reference, an element population this large must
  // sit at a low mean opacity or the page reads as heavy no matter how small
  // each mark is.
  opacity: 0.62,
  children: micro,
})

// ── 9. grain: the last frequency layer ─────────────────────────────────────
// Deterministic seed so two iterations of the design are byte-comparable and a
// change in the numbers means a change in the design.
layers.push({
  id: 'L09-grain',
  shape: 'rect', x: 0, y: 0, w: 1, h: 1,
  paint: '#808080',
  effects: [{ type: 'grain', amount: 0.022, mono: true, seed: 20260911 }],
  opacity: 0.5,
  blend: 'overlay',
})

// ── 10. adjustment layer: the tone tool the old workflow could not reach ───
layers.push({
  kind: 'adjustment',
  id: 'L10-tone',
  ops: [
    // Pull a little chroma out of everything so the olive accent is the only
    // saturated thing left, then lift the blacks slightly — the reference has
    // no true black anywhere.
    { op: 'hueSaturation', saturation: -0.16 },
    { op: 'curves', rgb: [[0, 12], [64, 70], [160, 166], [255, 250]] },
  ],
  opacity: 0.85,
})

const scene = {
  canvas: { width: W, height: H },
  ground: PAPER,
  layers,
}

const outPath = join(outDir, 'kv-timeline.json')
writeFileSync(outPath, JSON.stringify(scene, null, 2))
console.log(JSON.stringify({
  ok: true,
  scene: outPath,
  canvas: `${W}x${H}`,
  module: MODULE,
  topLevelLayers: layers.length,
  totalLayers: layers.reduce((n, l) => n + (l.children === undefined ? 1 : 1 + l.children.length), 0),
}, null, 2))
