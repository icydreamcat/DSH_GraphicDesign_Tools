/**
 * Five poster variants: ONE composition, five effect vocabularies.
 *
 * WHY THE COMPOSITION IS HELD FIXED
 * ---------------------------------
 * The question is which effect vocabulary suits this subject, and that cannot be
 * answered if the layout moves as well — every difference would then have two
 * possible causes and none of them attributable. So the geometry, the type, the
 * colours and the subject asset are identical across all five; only the effects
 * change. This is the contact-sheet discipline applied at poster scale.
 *
 * The five directions bracket the useful range rather than decorate it:
 *
 *   A flat    no effects. The control — if a variant does not beat this, its
 *             effects are decoration.
 *   B soft    a restrained raise: fine stroke, light inner shadow, low bevel.
 *   C press   screen-print: halftone, duotone, hard offset shadow, no blur. High
 *             contrast and few greys — the opposite discipline to B.
 *   D light   atmospheric: glows, lens blur, gradient overlay. Soft and deep.
 *   E tooled  embossed card: pronounced bevel, pattern overlay, satin. The
 *             "physical material" reading.
 *
 * TWO TRAPS THIS FILE NOW AVOIDS, BOTH MEASURED
 * --------------------------------------------
 * 1. `src` paths resolve relative to the SCENE file, not the cwd, so a bare
 *    `assets/x.png` looks for `scenes/assets/x.png` and the layer fails.
 * 2. `resolveLength` treats a value <= 1 as a fraction and anything above as
 *    PIXELS. The band wanted `1 + bleed` = 1.16, which was therefore read as one
 *    point one six pixels — an invisible sliver, with a clean report. Widths meant
 *    to bleed are written in pixels here.
 *
 * Run: node scenes/build-poster-variants.mjs
 */
import { writeFileSync } from 'node:fs'

const W = 2400
const H = 1350
const M = 96
const INK = '#20241C'
const OLIVE = '#83923A'
const PAPER = '#F1F1EC'
const SLATE = '#3E4650'
const SUBJECT = 'D:/DSH_GDT/DSH_GraphicDesign_Tools/engine/assets/haruka-figure.png'

const variants = {}

function build(v) {
  const L = []
  const add = (l) => L.push(l)
  // USE THE ARGUMENT. The first version read `v[kind]` — looking up `v['duotone']`
  // — while every call site passed the value as `spec` (`fx('duotone', v.bandDuotone)`).
  // No variant has a key named after the effect, so every one of the 22 effect
  // slots across the five posters came out as an empty array, and all five rendered
  // identically apart from their flat colours. The engine was correct throughout:
  // `duotone` applied directly to the subject asset moves mean saturation from
  // 0.651 to 0.412, and the same effect on an image layer reports `mapped: 46775`.
  //
  // The shape of the mistake is worth naming, because it is the one the repair
  // notes keep returning to: a helper that RE-DERIVES something it was already
  // handed. `spec` was right there.
  const fx = (kind, spec) => (spec === undefined || spec === null ? [] : [{ type: kind, ...spec }])

  add({
    id: '01-ground', shape: 'rect', x: 0, y: 0, w: 1, h: 1,
    paint: v.groundGradient === undefined
      ? PAPER
      : { type: 'linear', angle: 108, stops: v.groundGradient },
  })

  // The band: large enough for a glow or a bevel to read as atmosphere rather
  // than as a border. Width in PIXELS, deliberately wider than the canvas.
  add({
    id: '02-band', shape: 'rect',
    x: -M * 2, y: H * 0.30, w: W + M * 4, h: H * 0.42,
    paint: v.bandPaint === undefined ? SLATE : v.bandPaint,
    opacity: v.bandOpacity === undefined ? 1 : v.bandOpacity,
    radius: v.bandRadius === undefined ? 0 : v.bandRadius,
    effects: [
      ...fx('duotone', v.bandDuotone),
      ...fx('halftone', v.bandHalftone),
      ...fx('bevel', v.bandBevel),
      ...fx('dropShadow', v.bandShadow),
      ...fx('gradientOverlay', v.bandGradient),
      ...fx('patternOverlay', v.bandPattern),
      ...fx('satin', v.bandSatin),
      ...fx('grain', v.bandGrain),
    ],
  })

  add({
    id: '03-subject', shape: 'image', src: SUBJECT,
    x: W * 0.52, y: H * 0.06, w: W * 0.44, h: H * 0.92,
    fit: 'contain', anchorX: 0.5, anchorY: 0.5, quality: 'high',
    opacity: v.subjectOpacity === undefined ? 1 : v.subjectOpacity,
    effects: [
      ...fx('lens', v.subjectLens),
      ...fx('outerGlow', v.subjectGlow),
      ...fx('dropShadow', v.subjectShadow),
      ...fx('stroke', v.subjectStroke),
      ...fx('bevel', v.subjectBevel),
      ...fx('duotone', v.subjectDuotone),
      ...fx('colorOverlay', v.subjectColor),
      ...fx('satin', v.subjectSatin),
    ],
  })

  add({
    id: '04-rule-top', shape: 'line', x1: M, y1: M * 1.6, x2: W - M, y2: M * 1.6,
    stroke: v.ruleColor === undefined ? INK : v.ruleColor, width: 1.5,
    opacity: 0.55, effects: fx('grain', v.ruleGrain),
  })
  add({
    id: '05-rule-bottom', shape: 'line', x1: M, y1: H - M * 1.4, x2: W - M, y2: H - M * 1.4,
    stroke: v.ruleColor === undefined ? INK : v.ruleColor, width: 1.5,
    opacity: 0.55, effects: fx('grain', v.ruleGrain),
  })

  add({
    id: '06-title', shape: 'text',
    x: M, y: H * 0.34, w: W * 0.46,
    text: 'GINKGO', size: 214, font: 'Grotesk', weight: 600,
    letterSpacing: -4, color: v.titleColor === undefined ? INK : v.titleColor,
    align: 'left', wrap: false,
    effects: [
      ...fx('dropShadow', v.titleShadow),
      ...fx('outerGlow', v.titleGlow),
      ...fx('bevel', v.titleBevel),
      ...fx('stroke', v.titleStroke),
      ...fx('gradientOverlay', v.titleGradient),
      ...fx('colorOverlay', v.titleColor2),
      ...fx('patternOverlay', v.titlePattern),
    ],
  })
  add({
    id: '07-sub', shape: 'text',
    x: M + 4, y: H * 0.34 + 208, w: W * 0.42,
    text: 'MUELSYSE · 银杏计划', size: 34, font: 'SansSC', weight: 500,
    letterSpacing: 10, color: v.subColor === undefined ? OLIVE : v.subColor,
    align: 'left', wrap: false, effects: fx('grain', v.subGrain),
  })
  // Single line on purpose: a multi-line block currently reports a wrong block
  // height (3.2 px for two 21 px lines), so a wrapped paragraph overlaps itself.
  // That is a pre-existing text bug, tracked separately, and not something to
  // paper over inside a style comparison.
  add({
    id: '08-body', shape: 'text',
    x: M, y: H - M * 3.2, w: W * 0.40,
    text: 'A study in accumulation — many faint marks, one focus, a grid that never announces itself.',
    size: 21, font: 'SansSC', weight: 400,
    color: INK, opacity: 0.72, align: 'left', wrap: false,
    effects: fx('grain', v.bodyGrain),
  })
  add({
    id: '09-meta', shape: 'text',
    x: W - M - 320, y: H - M * 1.05, w: 320,
    text: 'KV / 2400×1350 / 2026', size: 16, font: 'Mono',
    color: INK, opacity: 0.5, align: 'right', wrap: false,
  })

  const accentCount = v.accentCount === undefined ? 4 : v.accentCount
  for (let i = 0; i < accentCount; i++) {
    add({
      id: `10-accent-${i}`, shape: 'ellipse',
      x: W * (0.55 + i * 0.10), y: M * (2.2 + i * 1.1), w: M * 0.5, h: M * 0.5,
      paint: OLIVE, opacity: 0.9, effects: fx('outerGlow', v.accentGlow),
    })
  }
  return { canvas: { width: W, height: H }, ground: PAPER, layers: L }
}

// A. flat — the control
variants['poster-a-flat'] = build({})

// B. soft — a restrained physical raise
variants['poster-b-soft'] = build({
  bandRadius: 20,
  bandShadow: { angle: 135, distance: 14, size: 34, opacity: 0.28, color: '#2A2E24' },
  bandBevel: { style: 'innerBevel', size: 7, depth: 0.9, soften: 3, angle: 135, altitude: 42, highlightOpacity: 0.3, shadowOpacity: 0.26 },
  subjectShadow: { angle: 135, distance: 22, size: 46, opacity: 0.3, color: '#20241C' },
  subjectStroke: { color: '#FBFBF6', size: 3, position: 'outside', opacity: 0.85 },
  titleBevel: { style: 'innerBevel', size: 4, depth: 0.5, soften: 2, angle: 135, altitude: 50, highlightOpacity: 0.24, shadowOpacity: 0.2 },
  bandSatin: { color: '#20241C', opacity: 0.16, angle: 135, distance: 40, size: 60 },
})

// C. press — screen-print discipline: hard edges, no blur
variants['poster-c-press'] = build({
  groundGradient: ['#F4F4EA', '#EDEDE0', '#E7E7D8'],
  bandPaint: '#D8DCC4',
  bandDuotone: { shadows: '#5C6438', midtones: '#9AA364', highlights: '#E9EBD8', strength: 0.9 },
  bandHalftone: { size: 14, angle: 22, tone: 'source', maxTone: 0.42, color: '#3A4028', respectAlpha: true },
  subjectDuotone: { shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2', strength: 0.95 },
  subjectShadow: { angle: 135, distance: 18, size: 0, opacity: 0.9, color: OLIVE },
  titleShadow: { angle: 135, distance: 7, size: 0, opacity: 1, color: OLIVE },
  ruleColor: '#3A4028',
  bandGrain: { amount: 0.05, size: 1.4, monochrome: true },
  bodyGrain: { amount: 0.05, size: 1.4, monochrome: true },
  subGrain: { amount: 0.05, size: 1.4, monochrome: true },
  accentCount: 0,
})

// D. light — atmospheric depth
variants['poster-d-light'] = build({
  groundGradient: ['#F7F8F2', '#E8EDE4', '#D9E2DA'],
  bandPaint: '#4A5460',
  bandOpacity: 0.9,
  bandGradient: { gradient: { type: 'linear', angle: 120, stops: ['#8FA6B4', '#39424C'] }, opacity: 1 },
  bandShadow: { angle: 135, distance: 30, size: 70, opacity: 0.35, color: '#28303A' },
  subjectLens: { radius: 9 },
  subjectGlow: { color: '#DCE9F2', opacity: 0.8, size: 44, spread: 4 },
  subjectShadow: { angle: 135, distance: 26, size: 54, opacity: 0.35, color: '#232B34' },
  titleColor: '#FBFCF8',
  titleGlow: { color: '#9FC6D8', opacity: 0.75, size: 34, spread: 2 },
  titleShadow: { angle: 135, distance: 10, size: 26, opacity: 0.4, color: '#1A2028' },
  subColor: '#5E7A6A',
  accentGlow: { color: '#D6E8A8', opacity: 0.9, size: 30 },
})

// E. tooled — embossed card, a material reading
variants['poster-e-tooled'] = build({
  groundGradient: ['#F6F5EE', '#EFEEE2', '#E6E5D6'],
  bandPaint: '#8A9179',
  bandRadius: 14,
  bandBevel: { style: 'innerBevel', size: 16, depth: 2.2, soften: 5, angle: 135, altitude: 38, highlight: '#FDFDF6', highlightOpacity: 0.55, shadow: '#2A2E22', shadowOpacity: 0.5 },
  bandPattern: { pattern: 'crosshatch', size: 11, ink: '#4E5442', ground: 'transparent', opacity: 0.22 },
  bandShadow: { angle: 135, distance: 18, size: 30, opacity: 0.32, color: '#242820' },
  subjectBevel: { style: 'emboss', size: 12, depth: 1.6, soften: 6, angle: 135, altitude: 40, highlight: '#FFFFFF', highlightOpacity: 0.42, shadow: '#1C2018', shadowOpacity: 0.45 },
  subjectShadow: { angle: 135, distance: 20, size: 40, opacity: 0.34, color: '#20241C' },
  titleBevel: { style: 'innerBevel', size: 9, depth: 1.5, soften: 4, angle: 135, altitude: 45, highlight: '#FFFFFF', highlightOpacity: 0.5, shadow: '#22261C', shadowOpacity: 0.45 },
  titleGradient: { gradient: { type: 'linear', angle: 108, stops: ['#FCFCF6', '#B9BFA4', '#6B7256'] }, opacity: 1 },
  bandSatin: { color: '#FFFFFF', opacity: 0.2, angle: 120, distance: 50, size: 70 },
})

for (const [name, scene] of Object.entries(variants)) {
  writeFileSync(`scenes/${name}.json`, JSON.stringify(scene, null, 2), 'utf8')
  console.log(`  scenes/${name}.json  ${scene.layers.length} layers`)
}
