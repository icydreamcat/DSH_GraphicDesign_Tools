/**
 * Real typography: measurement, line breaking, and set text.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The previous agent laid out text by accumulating em values per character
 * class (CJK = 1.0, uppercase = 0.64, …). That estimate is wrong by 20-40%
 * against a real face, which forced it to write deliberately loose boxes and
 * give up on fine typography entirely — and a loose box is visible: it shows up
 * as a column that does not align, a headline that is not optically centred,
 * and a caption that orphans one word.
 *
 * Skia measures exactly and instantly: `measureText` returns not just advance
 * width but the real ink box (`actualBoundingBox*`), and CJK advances come back
 * as exact fractions of the em. So there is no reason to estimate anything, and
 * this module never does. Every public measurement returns real numbers from
 * the font, and `fitText` / `layoutParagraph` are built on those numbers rather
 * than on assumptions about them.
 *
 * THE FALLBACK PROBLEM
 * --------------------
 * A Latin-only face (Bahnschrift) renders CJK as tofu. The naive fix — measure
 * each glyph, compare widths against a known CJK face, substitute on mismatch —
 * is both slow and unreliable (a substituted glyph can coincidentally match).
 * This module instead decides from *declared* coverage: each registered face
 * states which scripts it carries, and a scene names a stack. Runs are split at
 * script boundaries, and the first family in the stack that covers the run's
 * script is used. That is deterministic, cheap, and auditable — and because a
 * mixed CJK/Latin headline genuinely does need two faces, splitting is what a
 * designer would do anyway.
 */

import { face, hasFace, styleFor } from './fonts.mjs'
import { clamp } from './color.mjs'

/** Full-width CJK punctuation, which must never start a line. */
const NO_LINE_START = '、。，．：；！？）］｝〉》」』】〙〗｠»·ー～ゝゞヽヾ'
/** Characters that must never end a line. */
const NO_LINE_END = '（［｛〈《「『【〘〖｟«'

/**
 * Classify a character's script for font-stack resolution and line breaking.
 *
 * @param {string} ch a single code point
 * @returns {'hans'|'latn'|'space'|'punct'}
 */
export function charScript(ch) {
  if (/\s/.test(ch)) return 'space'
  const cp = ch.codePointAt(0)
  // CJK Unified Ideographs, Extension A, compatibility, kana, hangul, and the
  // full-width forms block — everything a Chinese/Japanese/Korean face covers.
  if (
    (cp >= 0x2e80 && cp <= 0x2fdf) ||   // radicals, kangxi
    (cp >= 0x3000 && cp <= 0x303f) ||   // CJK punctuation
    (cp >= 0x3040 && cp <= 0x30ff) ||   // kana
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // ext A
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // main block
    (cp >= 0xac00 && cp <= 0xd7af) ||   // hangul
    (cp >= 0xf900 && cp <= 0xfaff) ||   // compatibility
    (cp >= 0xfe30 && cp <= 0xfe4f) ||   // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xffef) ||   // full-width forms
    (cp >= 0x20000 && cp <= 0x2ebef)    // ext B-F
  ) {
    return 'hans'
  }
  if (/[!-/:-@[-`{-~]/.test(ch)) return 'punct'
  return 'latn'
}

/**
 * Split a string into maximal runs of one script.
 *
 * Whitespace joins the run it follows, so a space between two CJK glyphs stays
 * with the CJK face rather than switching faces for a single space — which
 * would visibly change the gap.
 *
 * @param {string} text
 * @returns {{script: string, text: string}[]}
 */
export function splitRuns(text) {
  const runs = []
  for (const ch of text) {
    const script = charScript(ch)
    const prev = runs[runs.length - 1]
    if (prev !== undefined && (prev.script === script || script === 'space' || prev.script === 'space')) {
      prev.text += ch
      if (prev.script === 'space' && script !== 'space') prev.script = script
    } else {
      runs.push({ script, text: ch })
    }
  }
  return runs
}

/**
 * Resolve which family in a stack covers a script.
 *
 * Falls back to the first family that exists at all, so an unusual character
 * still renders in *something* rather than failing the whole render. The
 * returned `fellBack` flag makes that visible to the verification report,
 * because a silent fallback is a real design defect.
 *
 * @param {string[]} stack
 * @param {string} script
 * @returns {{family: string, fellBack: boolean}}
 */
export function resolveFamily(stack, script) {
  for (const name of stack) {
    if (!hasFace(name)) continue
    const f = face(name)
    if (script === 'space' || script === 'punct' || f.scripts.includes(script)) {
      return { family: name, fellBack: false }
    }
  }
  for (const name of stack) {
    if (hasFace(name)) return { family: name, fellBack: true }
  }
  throw new Error(
    `none of the requested families exist: ${stack.join(', ')}. ` +
      `Use the font report tool to list what is registered.`,
  )
}

/**
 * Apply a font spec to a context and report what was set.
 *
 * Kept as one call because the shorthand and the variation settings are only
 * correct together (see fonts.mjs): setting the family without the axis leaves
 * a variable face at its default weight, which for Noto Sans SC is 100 —
 * hairline. That failure is silent and looks like a style choice, so it is
 * worth a single chokepoint.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} family
 * @param {{size:number, weight?:number, width?:number, italic?:boolean}} spec
 * @returns {{clamped: string[]}}
 */
export function applyFont(ctx, family, spec) {
  const styled = styleFor(family, spec)
  ctx.fontVariationSettings = styled.variationSettings
  ctx.font = styled.font
  return { clamped: styled.clamped }
}

/**
 * Parse a scene `font` field into a stack plus a style spec.
 *
 * @param {string|object} font
 * @param {number} defaultSize
 * @returns {{stack: string[], spec: object, trackingEm: number, lineHeightEm: number}}
 */
export function parseFontSpec(font, defaultSize) {
  if (typeof font === 'string') {
    return { stack: [font], spec: { size: defaultSize }, trackingEm: 0, lineHeightEm: 1.4 }
  }
  if (typeof font !== 'object' || font === null) {
    throw new Error(`font must be a family name or an object, got ${typeof font}`)
  }
  const size = font.size === undefined ? defaultSize : font.size
  const families = font.family === undefined
    ? ['SansSC']
    : Array.isArray(font.family) ? font.family : [font.family]
  const spec = { size }
  if (font.weight !== undefined) spec.weight = font.weight
  if (font.width !== undefined) spec.width = font.width
  if (font.italic !== undefined) spec.italic = font.italic
  return {
    stack: families,
    spec,
    // Tracking in em is the only unit that survives a size change, which is
    // why the scene uses it and this converts to px at draw time.
    trackingEm: font.tracking === undefined ? 0 : font.tracking,
    lineHeightEm: font.lineHeight === undefined ? 1.4 : font.lineHeight,
  }
}

/**
 * Measure one run of text in one family, with tracking.
 *
 * Returns the real ink box as well as the advance width. The ink box is what
 * optical alignment needs: a headline beginning with "T" or a CJK glyph has no
 * left sidebearing problem, but a Latin "M" does, and centring on advance width
 * instead of ink puts it visibly off.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {{size:number}} spec
 * @param {number} trackingPx
 * @returns {{width:number, advance:number, ascent:number, descent:number, left:number, right:number, emAscent:number, emDescent:number}}
 */
export function measureRun(ctx, text, spec, trackingPx) {
  const m = ctx.measureText(text)
  // measureText's advance already includes letterSpacing when the context has
  // it set; tracking is passed explicitly here instead so measurement and
  // drawing cannot diverge if one of them is set and the other is not.
  const tracked = trackingPx * Math.max(0, [...text].length - 1)
  return {
    width: m.width + tracked,
    advance: m.width + tracked,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
    left: m.actualBoundingBoxLeft,
    right: m.actualBoundingBoxRight,
    emAscent: m.fontBoundingBoxAscent,
    emDescent: m.fontBoundingBoxDescent,
    alphabetic: m.alphabeticBaseline,
  }
}

/**
 * Measure a whole line across its script runs.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {string[]} stack
 * @param {{size:number, weight?:number, width?:number, italic?:boolean}} spec
 * @param {number} trackingEm
 * @param {{trackingPx?: number}} [options]
 * @returns {{width:number, ascent:number, descent:number, emAscent:number, emDescent:number, runs: object[], usedFamilies: string[], fellBack: boolean}}
 */
export function measureLine(ctx, text, stack, spec, trackingEm, options = {}) {
  const trackingPx = options.trackingPx === undefined ? trackingEm * spec.size : options.trackingPx
  const runs = splitRuns(text)
  let width = 0
  let ascent = 0
  let descent = 0
  let emAscent = 0
  let emDescent = 0
  let fellBack = false
  const used = []
  const measured = []

  for (const run of runs) {
    const resolved = resolveFamily(stack, run.script)
    if (resolved.fellBack) fellBack = true
    if (!used.includes(resolved.family)) used.push(resolved.family)
    applyFont(ctx, resolved.family, spec)
    // Tracking applies between glyphs, so a run of n characters carries n-1
    // extra gaps. Charging the whole line instead would over-measure by one
    // gap per run boundary and break right alignment by a few pixels.
    const chars = [...run.text].length
    const w = ctx.measureText(run.text).width + trackingPx * Math.max(0, chars - 1)
    width += w
    const m = ctx.measureText(run.text)
    ascent = Math.max(ascent, m.actualBoundingBoxAscent)
    descent = Math.max(descent, m.actualBoundingBoxDescent)
    emAscent = Math.max(emAscent, m.fontBoundingBoxAscent)
    emDescent = Math.max(emDescent, m.fontBoundingBoxDescent)
    measured.push({ ...run, family: resolved.family, width: w })
  }

  return { width, ascent, descent, emAscent, emDescent, runs: measured, usedFamilies: used, fellBack }
}

/**
 * Break a paragraph into lines that fit `maxWidth`.
 *
 * Handles the two line-breaking models that actually matter:
 *   * Latin: break at spaces, hyphenate never, and never leave a single word
 *     alone on the last line if a slightly looser earlier break avoids it.
 *   * CJK: break between any two ideographs, but respect the kinsoku rules —
 *     opening punctuation may not end a line, closing punctuation may not
 *     start one.
 *
 * Mixed text is the common case in this engine's output and is handled by
 * treating a space as a break opportunity only when it separates two
 * non-CJK characters, which is what prevents a Chinese sentence from breaking
 * at the space inside "Rhodes Island".
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @param {string[]} stack
 * @param {object} spec
 * @param {number} trackingEm
 * @returns {{lines: object[], overflow: boolean, widest: number}}
 */
export function layoutParagraph(ctx, text, maxWidth, stack, spec, trackingEm) {
  // Respect explicit breaks first; they are a design decision, not a wrapping
  // problem, and re-wrapping them would destroy intentional line structure
  // (a stacked headline, haiku-like title breaks, a two-line wordmark).
  const paragraphs = String(text).split('\n')
  const lines = []
  let overflow = false
  let widest = 0

  for (const para of paragraphs) {
    if (para === '') {
      lines.push({ text: '', width: 0, ascent: 0, descent: 0, emAscent: spec.size, emDescent: 0 })
      continue
    }
    const tokens = tokenise(para)
    let current = ''

    const flush = () => {
      if (current === '') return
      const m = measureLine(ctx, current, stack, spec, trackingEm)
      if (m.width > maxWidth + 0.5) overflow = true
      widest = Math.max(widest, m.width)
      lines.push({ text: current, ...m })
      current = ''
    }

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      const candidate = current + tok.text
      const m = measureLine(ctx, candidate, stack, spec, trackingEm)
      if (m.width <= maxWidth || current === '') {
        // A single token wider than the box has to go somewhere; it starts a
        // line and is reported as overflow rather than being dropped.
        if (current === '' && m.width > maxWidth) overflow = true
        current = candidate
        continue
      }
      // Kinsoku: if the token that would start the next line is closing
      // punctuation, pull it back onto this line even though it overflows
      // slightly — a line starting with "。" is a visible typesetting error.
      if (tok.text.length > 0 && NO_LINE_START.includes(tok.text[0]) && current !== '') {
        current = candidate
        continue
      }
      // Likewise, never end a line on an opening bracket.
      const lastCh = current.length > 0 ? current[current.length - 1] : ''
      let held = ''
      if (NO_LINE_END.includes(lastCh)) {
        held = lastCh
        current = current.slice(0, -1)
      }
      flush()
      current = held + tok.text.replace(/^\s+/, '')
      if (tok.text !== tok.text.replace(/^\s+/, '') && held === '') current = tok.text
    }
    flush()
  }

  return { lines, overflow, widest }
}

/**
 * Split a paragraph into break-opportunity tokens.
 *
 * @param {string} para
 * @returns {{text: string}[]}
 */
function tokenise(para) {
  const tokens = []
  let buf = ''
  const chars = [...para]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const script = charScript(ch)
    if (script === 'space') {
      // A space is a break opportunity only if what precedes and follows are
      // both non-CJK. Inside CJK text it is a spacer and stays put.
      const prev = i > 0 ? charScript(chars[i - 1]) : 'space'
      const next = i + 1 < chars.length ? charScript(chars[i + 1]) : 'space'
      if (prev === 'hans' && next === 'hans') {
        buf += ch
        continue
      }
      buf += ch
      tokens.push({ text: buf })
      buf = ''
      continue
    }
    if (script === 'hans') {
      // Each ideograph is its own break opportunity, but only when it is not
      // glued to preceding Latin by a space boundary we just emitted.
      if (buf !== '') {
        tokens.push({ text: buf })
        buf = ''
      }
      // Keep a CJK char with following CJK punctuation as one unbreakable unit
      // when that punctuation may not start a line.
      let unit = ch
      while (i + 1 < chars.length && NO_LINE_START.includes(chars[i + 1])) {
        unit += chars[i + 1]
        i++
      }
      tokens.push({ text: unit })
      continue
    }
    buf += ch
  }
  if (buf !== '') tokens.push({ text: buf })
  return tokens
}

/**
 * Draw one line across its script runs, honouring tracking.
 *
 * `align` positions the line inside `boxWidth`: `left`, `center`, `right`,
 * or `justify`. Justify distributes the slack into the inter-run gaps, which
 * is correct for a paragraph and wrong for a headline — the caller decides.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} line a line from layoutParagraph
 * @param {string[]} stack
 * @param {object} spec
 * @param {number} trackingEm
 * @param {number} x left edge of the text box
 * @param {number} baselineY
 * @param {number} boxWidth
 * @param {string} align
 * @param {string} fill
 * @returns {{usedFamilies: string[], fellBack: boolean}}
 */
export function drawLine(ctx, line, stack, spec, trackingEm, x, baselineY, boxWidth, align, fill) {
  const trackingPx = trackingEm * spec.size
  const slack = boxWidth - line.width
  let cursor = x
  let extraPerGap = 0

  if (align === 'center') cursor = x + slack / 2
  else if (align === 'right') cursor = x + slack
  else if (align === 'justify' && line.runs.length > 0) {
    const gaps = line.runs.length - 1
    if (gaps > 0 && slack > 0) extraPerGap = slack / gaps
  }

  const usedFamilies = []
  let fellBack = false
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = fill
  ctx.letterSpacing = '0px'

  for (let r = 0; r < line.runs.length; r++) {
    const run = line.runs[r]
    if (!usedFamilies.includes(run.family)) usedFamilies.push(run.family)
    applyFont(ctx, run.family, spec)
    if (trackingPx !== 0) ctx.letterSpacing = `${trackingPx}px`
    ctx.fillText(run.text, cursor, baselineY)
    cursor += run.width + extraPerGap
  }
  ctx.letterSpacing = '0px'
  return { usedFamilies, fellBack }
}

/**
 * Choose a size that makes `text` fit `maxWidth`, within a ratio band.
 *
 * Returning a size *and* the achieved width lets the caller detect the case
 * where even the minimum size still overflows, instead of discovering it as a
 * clipped headline in the render.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @param {string[]} stack
 * @param {object} spec
 * @param {number} trackingEm
 * @param {{minRatio?: number, maxRatio?: number, step?: number}} [options]
 * @returns {{size:number, width:number, fits:boolean}}
 */
export function fitText(ctx, text, maxWidth, stack, spec, trackingEm, options = {}) {
  const minRatio = options.minRatio === undefined ? 0.4 : options.minRatio
  const maxRatio = options.maxRatio === undefined ? 1 : options.maxRatio
  // Binary search on size: width is monotonic in size, so this converges in
  // ~10 steps instead of the dozens a linear scan would need, and it never
  // returns a size that overflows when a smaller one would fit.
  let lo = spec.size * minRatio
  let hi = spec.size * maxRatio
  const step = options.step === undefined ? 0.5 : options.step
  for (let i = 0; i < 24 && hi - lo > step; i++) {
    const mid = (lo + hi) / 2
    const m = measureLine(ctx, text, stack, { ...spec, size: mid }, trackingEm)
    if (m.width <= maxWidth) lo = mid
    else hi = mid
  }
  const finalSpec = { ...spec, size: lo }
  const m = measureLine(ctx, text, stack, finalSpec, trackingEm)
  return { size: lo, width: m.width, fits: m.width <= maxWidth + 0.5 }
}

/**
 * Draw text along a path, for the curved and arced labels this language uses.
 *
 * Implemented by placing each glyph on the path rather than by Skia's
 * `fillTextOnPath`, because per-glyph placement is what allows tracking and
 * start-offset — both of which are needed for a label that has to end exactly
 * at a tick mark.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {object} pathSpec `{type:'arc'|'circle', cx, cy, r, startAngle, endAngle, flip}`
 * @param {string[]} stack
 * @param {object} spec
 * @param {number} trackingEm
 * @param {string} fill
 * @returns {{placed:number}}
 */
export function drawTextOnPath(ctx, text, pathSpec, stack, spec, trackingEm, fill) {
  const chars = [...text]
  const trackingPx = trackingEm * spec.size
  const totalWidth = chars.reduce((acc, ch) => {
    const resolved = resolveFamily(stack, charScript(ch))
    applyFont(ctx, resolved.family, spec)
    return acc + ctx.measureText(ch).width
  }, 0) + trackingPx * Math.max(0, chars.length - 1)

  const radius = pathSpec.r
  const startAngle = pathSpec.startAngle === undefined ? -Math.PI / 2 : pathSpec.startAngle
  const totalArc = totalWidth / radius
  // Centre the text on the arc span unless an explicit start angle is given,
  // which is the behaviour a designer expects when placing a label by hand.
  let angle = pathSpec.center === false ? startAngle : startAngle - totalArc / 2
  const flip = pathSpec.flip === true ? -1 : 1

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = fill
  ctx.letterSpacing = '0px'

  let placed = 0
  for (const ch of chars) {
    const resolved = resolveFamily(stack, charScript(ch))
    applyFont(ctx, resolved.family, spec)
    const w = ctx.measureText(ch).width
    const mid = angle + w / radius / 2
    ctx.save()
    ctx.translate(pathSpec.cx + Math.cos(mid) * radius, pathSpec.cy + Math.sin(mid) * radius)
    ctx.rotate(mid + (flip === -1 ? -Math.PI / 2 : Math.PI / 2))
    // Scale the vertical axis when flipped so glyphs read outward from an
    // inner arc instead of hanging upside down around it.
    ctx.fillText(ch, -w / 2, 0)
    ctx.restore()
    angle += (w + trackingPx) / radius
    placed++
  }
  return { placed }
}

/**
 * Build a stroke-only variant used for outlined (knockout) hero type.
 *
 * The reference language leans hard on outlined type, and the naive approach —
 * `strokeText` over `fillText` with the background colour — breaks the moment
 * the ground is not flat. Returning the geometry lets the caller stroke with
 * `destination-out` on the layer buffer instead, which knocks a real hole.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} line
 * @param {string[]} stack
 * @param {object} spec
 * @param {number} trackingEm
 * @param {number} x
 * @param {number} baselineY
 * @param {number} boxWidth
 * @param {string} align
 * @param {{width:number, color:string, cap?:string, join?:string}} stroke
 * @returns {{usedFamilies: string[]}}
 */
export function strokeLine(ctx, line, stack, spec, trackingEm, x, baselineY, boxWidth, align, stroke) {
  const trackingPx = trackingEm * spec.size
  const slack = boxWidth - line.width
  let cursor = x
  if (align === 'center') cursor = x + slack / 2
  else if (align === 'right') cursor = x + slack

  ctx.lineWidth = stroke.width
  ctx.strokeStyle = stroke.color
  ctx.lineJoin = stroke.join === undefined ? 'miter' : stroke.join
  ctx.lineCap = stroke.cap === undefined ? 'butt' : stroke.cap
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.letterSpacing = '0px'

  const usedFamilies = []
  for (const run of line.runs) {
    if (!usedFamilies.includes(run.family)) usedFamilies.push(run.family)
    applyFont(ctx, run.family, spec)
    if (trackingPx !== 0) ctx.letterSpacing = `${trackingPx}px`
    ctx.strokeText(run.text, cursor, baselineY)
    cursor += run.width
  }
  ctx.letterSpacing = '0px'
  return { usedFamilies }
}

/**
 * Vertical (top-to-bottom) text, used for the spine labels in the reference
 * language. Returns the metrics so the caller can place the rule beside it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x centre of the column
 * @param {number} y top of the column
 * @param {string[]} stack
 * @param {object} spec
 * @param {number} trackingEm
 * @param {string} fill
 * @returns {{height:number, width:number, characters:number}}
 */
export function drawVerticalText(ctx, text, x, y, stack, spec, trackingEm, fill) {
  const chars = [...text]
  const trackingPx = trackingEm * spec.size
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = fill
  ctx.letterSpacing = '0px'
  let cursor = y
  let maxWidth = 0
  for (const ch of chars) {
    const resolved = resolveFamily(stack, charScript(ch))
    applyFont(ctx, resolved.family, spec)
    const m = ctx.measureText(ch)
    const advance = m.width
    // Rotate Latin glyphs upright in the column, which is how mixed
    // CJK/Latin vertical setting is actually done in East Asian typography.
    if (charScript(ch) === 'latn' || charScript(ch) === 'punct') {
      ctx.save()
      ctx.translate(x, cursor + advance / 2)
      ctx.rotate(Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(ch, 0, 0)
      ctx.restore()
    } else {
      ctx.fillText(ch, x, cursor + advance / 2)
    }
    maxWidth = Math.max(maxWidth, advance)
    cursor += advance + trackingPx
  }
  return { height: cursor - y, width: maxWidth, characters: chars.length }
}

/**
 * A typographic scale ladder.
 *
 * A design reads as systematic when its sizes come from a small set of ratios
 * rather than being chosen per element. This returns named steps with their
 * line heights attached, because a size without its leading is only half a
 * typographic decision — and 15px/1.0 and 15px/1.6 are different designs.
 *
 * @param {{base?: number, ratio?: number, steps?: number, lineHeight?: number}} [options]
 * @returns {{name:string, size:number, lineHeight:number}[]}
 */
export function scaleLadder(options = {}) {
  const base = options.base === undefined ? 16 : options.base
  const ratio = options.ratio === undefined ? 1.25 : options.ratio
  const steps = options.steps === undefined ? 7 : options.steps
  // Names run downward from the base so a caller can refer to `caption` or
  // `display` instead of remembering a number.
  const names = ['micro', 'caption', 'small', 'body', 'lead', 'subhead', 'headline', 'display', 'mega', 'colossal']
  const out = []
  const centre = 3
  for (let i = 0; i < steps; i++) {
    const offset = i - centre
    const size = base * Math.pow(ratio, offset)
    // Looser leading for small text, tighter for display: the standard
    // optical correction, and the reason a headline set at body leading looks
    // cramped rather than bold.
    const lh = size <= 14 ? 1.6 : size <= 22 ? 1.5 : size <= 40 ? 1.3 : 1.08
    out.push({
      name: names[clamp(i + (6 - centre), 0, names.length - 1)] || `step${i}`,
      size: Math.round(size * 100) / 100,
      lineHeight: Math.round(size * lh * 100) / 100,
    })
  }
  return out
}
