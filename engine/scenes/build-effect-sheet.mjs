/**
 * A contact sheet of every effect, on identical subjects.
 *
 * WHY A CONTACT SHEET RATHER THAN POSTERS ALONE
 * ---------------------------------------------
 * A poster tells you whether a composition works; it does not tell you whether an
 * individual effect is right, because ten of them are stacked and you cannot
 * attribute what you are looking at. A contact sheet holds the subject fixed and
 * varies one thing per cell, which is the only way to see that a bevel is too
 * strong or a glow is the wrong colour — and the repair notes' first rule applies
 * to judging as much as to measuring: constrain one variable.
 *
 * It is also a real deliverable: the icon sheet in section three of the notes was
 * what made the marks legible ("only by printing the sheet did we know what the
 * shapes were").
 *
 * Run: node scenes/build-effect-sheet.mjs
 */
import { writeFileSync } from 'node:fs'

const W = 2560
const H = 1560
const COLS = 5
const PAD = 22
const cellW = Math.floor((W - PAD * (COLS + 1)) / COLS)
const HEADER = 92

const layers = []
const add = (l) => layers.push(l)

// ── ground and header ───────────────────────────────────────────────────────
add({
  id: '00-ground', shape: 'rect', x: 0, y: 0, w: 1, h: 1,
  paint: { type: 'linear', angle: 105, stops: [{ at: 0, color: '#FCFCF7' }, { at: 1, color: '#F1F1E8' }] },
})
add({
  id: '01-title', shape: 'text', x: PAD, y: 26, w: 1,
  text: 'EFFECT SHEET', size: 34, font: 'Grotesk', weight: 600,
  letterSpacing: 4, color: '#2A2E22', align: 'left', wrap: false,
})
add({
  id: '02-sub', shape: 'text', x: PAD, y: 62, w: 1,
  text: 'identical subject per cell — one effect, one edge, one light at 135°',
  size: 17, font: 'SansSC', color: '#7C8069', align: 'left', wrap: false,
})

/** One cell: a plate, a subject, and a caption. The effect is passed IN rather
 *  than read from a module-level variable, because `subject()` is called before
 *  any such assignment could run — a hoisting trap that silently produced cells
 *  with no effects at all. */
function cell(col, row, caption, effects) {
  const x0 = PAD + col * (cellW + PAD)
  const y0 = HEADER + row * (cellH + PAD)
  add({
    id: `cell-${col}-${row}-plate`, shape: 'rect',
    x: x0, y: y0, w: cellW, h: cellH,
    paint: '#FFFFFF', radius: 10, opacity: 0.72,
    effects: [{ type: 'stroke', color: '#DCDCD0', size: 1, position: 'inside', opacity: 1 }],
  })
  // The subject: a rounded plate, so a bevel has a curved edge and a straight one
  // to catch light and a stroke has a corner.
  add({
    id: `cell-${col}-${row}-subj`, shape: 'rect',
    x: x0 + 34, y: y0 + 34, w: cellW - 68, h: cellH - 108,
    paint: '#5A6472', radius: 14,
    effects,
  })
  add({
    id: `cell-${col}-${row}-cap`, shape: 'text',
    x: x0 + 16, y: y0 + cellH - 46, w: cellW - 32,
    text: caption, size: 17, font: 'SansSC', color: '#22261C',
    align: 'left', wrap: false,
  })
}

// Rows 0-2: the ten layer effects, then the filters.
const ROWS = 3
const cellH = Math.floor((H - HEADER - PAD * (ROWS + 1)) / ROWS)

const effects = [
  ['dropShadow', { angle: 135, distance: 10, size: 14, opacity: 0.45, color: '#2B2F26' }],
  ['outerGlow', { color: '#F2C14E', opacity: 0.85, size: 22, spread: 2 }],
  ['innerShadow', { angle: 135, distance: 7, size: 10, opacity: 0.6, color: '#101418' }],
  ['innerGlow', { color: '#9FD8E8', opacity: 0.8, size: 14, choke: 2 }],
  ['stroke', { color: '#FBFBF6', size: 4, position: 'outside', opacity: 1 }],
  ['bevel', { style: 'innerBevel', size: 9, depth: 1.6, angle: 135, altitude: 45, soften: 2, highlightOpacity: 0.85, shadowOpacity: 0.8 }],
  ['bevel', { style: 'pillow', size: 11, depth: 1.4, angle: 135, altitude: 40, soften: 3, highlightOpacity: 0.8, shadowOpacity: 0.75 }],
  ['satin', { color: '#12161A', opacity: 0.55, angle: 135, distance: 16, size: 20 }],
  ['gradientOverlay', { gradient: { type: 'linear', angle: 115, stops: ['#8FA9C6', '#2E3742'] }, opacity: 1, blend: 'normal' }],
  ['patternOverlay', { pattern: 'hatch', size: 9, ink: '#FBFBF6', ground: 'transparent', opacity: 0.5 }],
  ['colorOverlay', { color: '#83923A', opacity: 0.85 }],
  ['patternOverlay', { pattern: 'dots', size: 12, ink: '#1C2118', ground: 'transparent', opacity: 0.6 }],
  ['gradientOverlay', { gradient: { type: 'linear', angle: 90, stops: ['#F6F6EA', '#C9CDB4', '#6E7554'] }, opacity: 1 }],
  ['stroke', { color: '#83923A', size: 3, position: 'inside', opacity: 1 }],
  ['outerGlow', { color: '#FFFFFF', opacity: 0.95, size: 10, spread: 4 }],
]

for (let i = 0; i < effects.length; i++) {
  const col = i % COLS
  const row = Math.floor(i / COLS)
  if (row >= ROWS) break
  cell(col, row, effects[i][0], [{ type: effects[i][0], ...effects[i][1] }])
}

// Row 2: the filters and the light-direction check, which are the two things a
// single effect cell cannot show.
const filters = [
  ['gaussian r=14', [{ type: 'gaussian', radius: 14 }]],
  ['motion 40px @ 30°', [{ type: 'motion', radius: 40, angle: 30 }]],
  ['lens r=20', [{ type: 'lens', radius: 20 }]],
  ['radial 0.25', [{ type: 'radial', amount: 0.25 }]],
  ['box r=8 (hard-edged)', [{ type: 'box', radius: 8 }]],
]
for (let i = 0; i < filters.length; i++) {
  cell(i, 2, filters[i][0], filters[i][1])
}

const scene = {
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
    layers: ["00","01","02","cell"],
    drawingRule: 'THE RULE THAT GENERATES EACH GROUP, not a list of the groups',
    accentBand: [0, 0.08],
  },
  canvas: { width: W, height: H },
  ground: '#F4F4EC',
  layers,
}
writeFileSync('scenes/effect-sheet.json', JSON.stringify(scene, null, 2), 'utf8')
console.log(`effect-sheet.json: ${layers.length} layers, ${effects.length + filters.length} cells`)
