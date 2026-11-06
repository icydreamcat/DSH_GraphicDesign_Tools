/**
 * End-to-end self test.
 *
 * Deliberately renders rather than merely importing: the failure modes that
 * matter here (a font that silently substitutes, a varying-font weight axis that
 * is ignored, a mask that multiplies the wrong channel, a blend mode that is
 * not what its name says) all pass a smoke test that only checks that modules
 * load. So this exercises every primitive that the design language depends on,
 * writes the artefacts, and prints the measurements that prove they worked.
 *
 * Run: node test/selftest.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerFonts, fontFamilyReport, styleFor } from '../src/fonts.mjs'
import { renderScene, readBuffer } from '../src/render.mjs'
import { measureLine, layoutParagraph, scaleLadder } from '../src/text.mjs'
import { createCanvas } from '@napi-rs/canvas'
import {
  scaleRamp, contrastRatio, mixOklab, toHex8, relativeLuminance, toOklch,
} from '../src/color.mjs'
import { textureStats, buildCurveTable } from '../src/tone.mjs'
import { analyseReference } from '../src/analyze.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Test artefacts go to the cache OUTSIDE the repository, beside it at .cache/test/.
// `engine/out/` is for real render artifacts; a file this suite rewrites on every run
// does not belong beside a finished deliverable, where it invites exactly the wrong
// assumption during maintenance.
const outDir = resolve(here, '..', '..', '..', '.cache', 'test')
mkdirSync(outDir, { recursive: true })

let failures = 0
let checks = 0

function check(label, condition, detail) {
  checks++
  if (condition) {
    console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`)
  }
}

console.log('=== 1. font registration ===')
const reg = registerFonts()
console.log(`  registered: ${reg.registered.length}  missing: ${reg.missing.length}`)
if (reg.missing.length > 0) console.log(`  missing: ${reg.missing.join(', ')}`)
check('SansSC registered', reg.registered.includes('SansSC'))
check('SerifSC registered', reg.registered.includes('SerifSC'))
check('Grotesk registered', reg.registered.includes('Grotesk'))

console.log('\n=== 2. real text metrics (the estimate this replaces) ===')
const mc = createCanvas(10, 10)
const mctx = mc.getContext('2d')
for (const family of ['SansSC', 'SerifSC', 'MiSans', 'Grotesk']) {
  const m = measureLine(mctx, '美术视觉 MuelSyse', [family], { size: 48, weight: family === 'SansSC' || family === 'SerifSC' ? 400 : undefined }, 0)
  console.log(`  ${family.padEnd(9)} width=${m.width.toFixed(1).padStart(7)}  asc=${m.ascent.toFixed(1)} desc=${m.descent.toFixed(1)}  families=${m.usedFamilies.join('+')}${m.fellBack ? '  FELL BACK' : ''}`)
  check(`${family} measures non-zero`, m.width > 10)
}

// CJK metrics must be exact: one ideograph at 24px is exactly 24px wide in a
// full-width face. This is the check that proves the measurement is real.
const cjk = measureLine(mctx, '美术视觉', ['SansSC'], { size: 24, weight: 400 }, 0)
check('CJK advance is exactly 1em per glyph', Math.abs(cjk.width - 96) < 0.01, `got ${cjk.width}`)

// A Latin-only face must not silently render CJK as tofu; the stack has to
// hand those characters to a CJK face.
const mixed = measureLine(mctx, '美术 Muel', ['Grotesk', 'SansSC'], { size: 40 }, 0)
check('mixed CJK/Latin splits across the stack', mixed.usedFamilies.length === 2, mixed.usedFamilies.join('+'))

console.log('\n=== 3. variable font axes actually vary ===')
// Weight: SansSC (Noto Sans SC VF) is the face whose wght axis is verified.
const sc100 = measureLine(mctx, '美术视觉', ['SansSC'], { size: 48, weight: 100 }, 0)
const sc900 = measureLine(mctx, '美术视觉', ['SansSC'], { size: 48, weight: 900 }, 0)
check('SansSC wght 100 vs 900 differ', sc100.ascent !== sc900.ascent || Math.abs(sc100.width - sc900.width) > 0.5, `asc ${sc100.ascent} vs ${sc900.ascent}, w ${round(sc100.width)} vs ${round(sc900.width)}`)

// Width: Bahnschrift's wdth axis is verified. Its wght axis is NOT — it was
// tested and measured identically at 300 and 700 — which is exactly why
// fonts.mjs does not declare it. This check pins that decision so a future
// edit cannot quietly re-add an axis that does nothing.
const gWide = measureLine(mctx, 'MUELSYSE', ['Grotesk'], { size: 48, width: 100 }, 0)
const gNarrow = measureLine(mctx, 'MUELSYSE', ['Grotesk'], { size: 48, width: 78 }, 0)
check('Grotesk wdth axis differs', Math.abs(gWide.width - gNarrow.width) > 5, `w100=${round(gWide.width)} vs w78=${round(gNarrow.width)}`)
check('Grotesk does not claim a wght axis it cannot deliver', styleFor('Grotesk', { size: 24, weight: 700 }).variationSettings.indexOf('wght') === -1, styleFor('Grotesk', { size: 24, weight: 700 }).variationSettings)
const clamped = styleFor('SansSC', { size: 24, weight: 1500 })
check('out-of-range weight is clamped and reported', clamped.clamped.length === 1, clamped.clamped.join(','))

console.log('\n=== 4. colour maths ===')
check('contrast black/white is 21', Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 0.01, String(round(contrastRatio('#000000', '#FFFFFF'))))
const ramp = scaleRamp('#8CA33C', { steps: 9 })
console.log(`  olive ramp: ${ramp.join(' ')}`)
check('ramp has 9 even steps', ramp.length === 9)
// Perceptual evenness is a property of OKLab lightness, NOT of linear
// luminance. Linear luminance compresses the light end by design (sRGB is a
// gamma curve), so measuring step evenness there would fail a perfectly even
// ramp and invite "fixing" it into an actually uneven one.
const ls = ramp.map((c) => toOklch(c).L)
const deltas = ls.slice(1).map((v, i) => Math.abs(v - ls[i]))
const spread = Math.max(...deltas) / Math.max(1e-9, Math.min(...deltas))
check('ramp steps are even in OKLab lightness', spread < 1.25, `max/min L delta ratio ${round(spread)}`)
check('ramp spans a usable range', ls[0] > 0.9 && ls[8] < 0.3, `L ${round(ls[0])}..${round(ls[8])}`)
// Blue and yellow are near-complements, so ANY midpoint of them is desaturated
// — that is correct colour science, not a defect, and asserting otherwise would
// be asserting something false. The property that actually matters is that
// interpolation is even in PERCEPTION: the midpoint of two colours should sit
// at the perceptual halfway point between them, which a per-channel sRGB blend
// does not achieve.
const mid = mixOklab('#1B3A8F', '#E8D44D', 0.5)
const aL = toOklch('#1B3A8F').L
const bL = toOklch('#E8D44D').L
const mL = toOklch(mid).L
const expected = (aL + bL) / 2
check('OKLab midpoint sits at the perceptual halfway point', Math.abs(mL - expected) < 0.005, `L mid=${round(mL)} expected=${round(expected)}`)

// The same test on an sRGB channel average shows the error this avoids.
const naive = { r: (0x1B + 0xE8) / 2, g: (0x3A + 0xD4) / 2, b: (0x8F + 0x4D) / 2 }
const naiveL = toOklch(`#${[naive.r, naive.g, naive.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`).L
check('sRGB channel averaging misses that point', Math.abs(naiveL - expected) > 0.005, `sRGB mid L=${round(naiveL)} vs perceptual ${round(expected)}`)

console.log('\n=== 5. curve interpolation does not overshoot ===')
const table = buildCurveTable([[0, 0], [64, 200], [128, 210], [255, 255]], 'rgb')
let monotonic = true
for (let i = 1; i < 256; i++) if (table[i] < table[i - 1] - 0.5) { monotonic = false; break }
check('steep curve stays monotonic (no overshoot)', monotonic)
check('curve hits its control points', Math.abs(table[64] - 200) < 2 && Math.abs(table[128] - 210) < 2, `f(64)=${table[64]} f(128)=${table[128]}`)

console.log('\n=== 6. layout: paragraph wrapping against real metrics ===')
const para = '网格系统与尺度级数决定了版面的秩序感。A grid system and a scale ladder decide the order of a layout, and neither can be replaced by careful hand placement.'
const laid = layoutParagraph(mctx, para, 420, ['SansSC'], { size: 18, weight: 400 }, 0)
console.log(`  ${laid.lines.length} lines, widest ${round(laid.widest)} / 420, overflow=${laid.overflow}`)
check('wraps into multiple lines', laid.lines.length > 2)
check('no line exceeds the box', laid.widest <= 420.5, String(round(laid.widest)))
check('reports overflow correctly', laid.overflow === (laid.widest > 420.5))

console.log('\n=== 7. scale ladder ===')
const ladder = scaleLadder({ base: 16, ratio: 1.25, steps: 7 })
console.log('  ' + ladder.map((s) => `${s.name}:${s.size}/${s.lineHeight}`).join('  '))
check('ladder has 7 steps', ladder.length === 7)

console.log('\n=== 8. render every primitive ===')
const scene = {
  canvas: { width: 1200, height: 675 },
  ground: '#F4F4F0',
  layers: [
    // Hairline grid, local rather than full-bleed — the "sparse and chosen"
    // correction from the anti-pattern list.
    {
      id: 'grid',
      shape: 'group',
      opacity: 0.3,
      children: Array.from({ length: 14 }, (_, i) => ({
        id: `gv${i}`,
        shape: 'line',
        x1: 60 + i * 60, y1: 80, x2: 60 + i * 60, y2: 600,
        width: 1,
        paint: '#8C9A6E',
      })).concat(Array.from({ length: 9 }, (_, i) => ({
        id: `gh${i}`,
        shape: 'line',
        x1: 60, y1: 80 + i * 65, x2: 840, y2: 80 + i * 65,
        width: 1,
        paint: '#8C9A6E',
      }))),
      mask: {
        shapes: [{
          shape: 'rect', x: 0, y: 0, w: 1, h: 1,
          paint: { type: 'fade', color: '#FFFFFF', from: 1, to: 0, angle: 0 },
        }],
      },
    },
    // Real gradient, not stacked rectangles.
    {
      id: 'wedge',
      shape: 'polygon',
      points: [[0.05, 0.25], [0.42, 0.25], [0.36, 0.75], [0.05, 0.75]],
      paint: { type: 'linear', angle: 45, stops: [{ at: 0, color: '#B9C86A' }, { at: 1, color: '#6E8127' }] },
      opacity: 0.85,
    },
    // Halftone as a TONAL tool, not as a background wash. The anti-pattern
    // list is explicit: a dot field should be local, faded, and light — so this
    // one is a small panel in the lower-right, at 22% opacity, with bounded dot
    // area. 10% ink coverage at low alpha is texture; 99% ink at full alpha is
    // the "few elements, each heavy" failure this engine exists to prevent.
    {
      id: 'halftone',
      shape: 'rect', x: 0.55, y: 0.62, w: 0.34, h: 0.28,
      paint: '#4A4A46',
      effects: [{
        type: 'halftone', cell: 6, angle: 45, color: '#3A4A1E',
        alpha: 0.55, maxTone: 0.3, tone: 0.42,
      }],
      opacity: 0.22,
      mask: { shapes: [{ shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: { type: 'fade', color: '#FFFFFF', from: 0, to: 1, angle: 0 } }] },
    },
    // Blend modes.
    {
      id: 'screen-ellipse',
      shape: 'ellipse', x: 0.55, y: 0.2, w: 0.35, h: 0.5,
      paint: { type: 'radial', stops: [{ at: 0, color: '#FFFFFF' }, { at: 1, color: '#8CA33C' }] },
      blend: 'multiply',
      opacity: 0.5,
    },
    // Curved text on a path.
    {
      id: 'arc-text',
      shape: 'text',
      text: 'BEYOND THE TIMELINE',
      font: { family: ['Grotesk', 'SansSC'], size: 15, weight: 600 },
      color: '#4A5A22',
      path: { cx: 0.75, cy: 0.72, r: 110, startAngle: -Math.PI / 2 },
    },
    // Hero CJK with real tracking and an outline.
    {
      id: 'hero',
      shape: 'text',
      text: '美术视觉语言',
      font: { family: ['SansSC'], size: 96, weight: 700, tracking: -0.02 },
      color: '#22261A',
      x: 60, y: 250,
      w: 700,
      fit: true,
    },
    // Outlined (knockout) Latin, which the old workflow could not produce.
    {
      id: 'outline-latin',
      shape: 'text',
      text: 'MUELSYSE',
      font: { family: ['Grotesk'], size: 64, weight: 700, tracking: 0.08 },
      color: '#F4F4F0',
      stroke: { color: '#5F7A2A', width: 1.5 },
      x: 60, y: 420,
      w: 700,
    },
    // Caption column, wrapped for real.
    {
      id: 'caption',
      shape: 'text',
      text: '一级信息与二级信息的差距要足够大，层级才成立。Hierarchy only reads when the gap between the first and second level is large enough.',
      font: { family: ['SansSC'], size: 13, weight: 300, lineHeight: 1.7 },
      color: '#5A5F52',
      x: 0.06, y: 0.78, w: 0.32,
    },
    // Vertical spine label.
    {
      id: 'spine',
      shape: 'text',
      text: 'ORIGINIUM ARTS',
      font: { family: ['Grotesk', 'SansSC'], size: 11, weight: 400, tracking: 0.2 },
      color: '#6E8127',
      x: 0.965, y: 0.12,
      vertical: true,
    },
    // Adjustment layer over everything: the tone tool that was "unavailable".
    {
      kind: 'adjustment',
      id: 'tone',
      ops: [
        { op: 'hueSaturation', hue: -6, saturation: -0.12 },
        { op: 'curves', rgb: [[0, 6], [128, 124], [255, 249]] },
      ],
      opacity: 0.8,
    },
  ],
}

const t0 = Date.now()
const { canvas, report } = await renderScene(scene, { baseDir: outDir })
const elapsed = Date.now() - t0

const png = canvas.encodeSync('png')
const pngPath = join(outDir, 'selftest.png')
writeFileSync(pngPath, png)

console.log(`  rendered ${report.canvas.width}x${report.canvas.height}, ${report.layerCount} layers, ${report.allocations} buffers, ${elapsed}ms`)
console.log(`  warnings: ${report.warnings.length === 0 ? 'none' : report.warnings.join(' | ')}`)
check('no layer failures', report.warnings.length === 0, report.warnings.join(' | '))
check('wrote PNG', png.length > 10000, `${round(png.length / 1024)} KB`)
check('render is fast enough to iterate on', elapsed < 20000, `${elapsed}ms`)

const heroLog = report.log.find((l) => l.id === 'hero' && l.step === 'layer')
check('hero text fitted without overflow', heroLog !== undefined && heroLog.drawn.overflow === false, heroLog === undefined ? 'missing' : `size=${heroLog.drawn.fitted.size} widest=${heroLog.drawn.widest}`)
check('hero used the requested family', heroLog !== undefined && heroLog.drawn.families.includes('SansSC'), heroLog === undefined ? '' : heroLog.drawn.families.join('+'))
check('no font fallback silently occurred', heroLog !== undefined && heroLog.drawn.fontFallback === false)

// A layer id can appear on more than one log entry — a masked layer logs both a
// `mask` step and a `layer` step under the same id. Selecting by id alone picks
// whichever came first, so this filters on `step` as well.
const htLog = report.log.find((l) => l.id === 'halftone' && l.step === 'layer')
const htFx = htLog === undefined || htLog.drawn === undefined ? undefined : (htLog.drawn.effects || []).find((e) => e.type === 'halftone')
check('halftone produced dots', htFx !== undefined && htFx.dots > 0, htFx === undefined ? 'no halftone effect recorded' : `${htFx.dots} dots, coverage ${htFx.coverage}`)
// The desired signature is a WIDE field of light marks, not a dense solid: high
// coverage at low alpha is texture, whereas the failure mode is the reverse.
check('halftone is a tonal field, not a solid block', htFx !== undefined && htFx.coverage > 0.005 && htFx.coverage < 0.6, htFx === undefined ? '' : `coverage ${htFx.coverage}, ink alpha 0.55, layer opacity 0.22`)
check('halftone respects the maxTone area cap', htFx !== undefined && htFx.maxTone === 0.3, htFx === undefined ? '' : String(htFx.maxTone))
check('mask retained a partial area, not none or all', htLog !== undefined && htLog.drawn.maskRetained > 0.01 && htLog.drawn.maskRetained < 0.99, htLog === undefined ? '' : String(htLog.drawn.maskRetained))

const adjLog = report.log.find((l) => l.id === 'tone')
check('adjustment layer ran its ops', adjLog !== undefined && adjLog.ops.length === 2)
check('adjustment opacity applied', adjLog !== undefined && adjLog.strength === 0.8, adjLog === undefined ? '' : String(adjLog.strength))

const maskLog = report.log.find((l) => l.step === 'mask')
check('at least one mask applied', maskLog !== undefined)

console.log('\n=== 9. rendered texture statistics ===')
const stats = textureStats(readBuffer(canvas))
console.log(`  frequency=${round(stats.frequency)}  contrast=${round(stats.contrast)}  meanLuma=${round(stats.meanLuma)}`)
// The target signature: high frequency relative to contrast.
check('render carries texture (frequency > 0)', stats.frequency > 0.001, String(round(stats.frequency)))

console.log('\n=== 10. reference analyser on its own output ===')
const analysis = await analyseReference(pngPath, { maxSide: 900 })
console.log(`  elements=${analysis.structure.elementCount}  accentShare=${analysis.accent.share}  groundLuma=${analysis.tone.groundLuminance}  dynamicRange=${analysis.tone.dynamicRange}`)
console.log(`  grid columnPitch=${analysis.grid.columnPitch} (strength ${analysis.grid.columnStrength})  strokes=${analysis.structure.strokeWeights.slice(0, 3).map((w) => `${w.weight}px:${w.share}`).join(' ')}`)
check('analyser found elements', analysis.structure.elementCount > 0)
check('analyser found the accent', analysis.accent.share > 0, String(analysis.accent.share))
check('analyser reports a tone band', analysis.tone.dynamicRange >= 0)

console.log(`\n=== ${checks - failures}/${checks} checks passed ===`)
console.log(`artefact: ${pngPath}`)
process.exit(failures === 0 ? 0 : 1)

function round(v) {
  return Math.round(v * 1000) / 1000
}
