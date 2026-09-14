/**
 * The renderer.
 *
 * ARCHITECTURE
 * ------------
 * A scene is a declarative JSON object: a canvas, a palette, and a stack of
 * layers. Rendering is a two-phase composite:
 *
 *   1. Each **layer** is drawn into its own full-canvas RGBA buffer (a canvas of
 *      the same size as the document), independent of every other layer. This
 *      is what makes per-layer opacity, blend mode, mask, and adjustment
 *      possible at all — and it is also what makes the render honest: a layer
 *      cannot accidentally depend on what happens to sit underneath it.
 *
 *   2. Layers are composited **bottom to top** onto the document canvas, in the
 *      shape the scene defines. Groups recurse.
 *
 * Full-canvas layer buffers cost memory (2400x1350 RGBA is ~13 MB), so buffers
 * are pooled and released. For a design at this size the peak is acceptable and
 * the correctness win is large; a tighter tile-based renderer would trade that
 * away and is not what this is for.
 *
 * WHY ADJUSTMENT LAYERS ARE REAL HERE
 * -----------------------------------
 * The previous attempt concluded that a "gradient fill layer" and "adjustment
 * layer" were unavailable, and then tried to approximate tone with stacked
 * translucent rectangles — which produced the hard edges and uneven density
 * that the review flagged. They were never unavailable; that was a scripting
 * error. Canvas has native gradients and 26 blend modes with correct
 * Porter-Duff semantics, and per-pixel tone operations (curves, hue/saturation,
 * duotone) are straightforward on a raw buffer. So this renderer implements
 * them properly rather than approximating them, because an approximation of a
 * tonal tool is exactly the thing that makes a design look machine-made.
 *
 * GEOMETRY IS IN FRACTIONS OR PIXELS, EXPLICITLY
 * ---------------------------------------------
 * Every layer may use either. Any value at or below 1 for `x`/`y`/`w`/`h` is
 * ambiguous, so the scene uses the rule: numbers in `[0,1]` on x/y/w/h are
 * fractions of the canvas, numbers above 1 are pixels. It is stated here and
 * reported by the verifier because a silent unit mistake moves a whole layer.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { parseColor, cssColor, clamp, resolvePaint, toHex8 } from './color.mjs'
import { LAYER_EFFECTS, alphaPlane, resolveScope, blendByScope } from './effects.mjs'
import { SAT_FILTERS } from './filters.mjs'
import { run as runPalette } from './palette.mjs'
import {
  parseFontSpec, measureLine, layoutParagraph, drawLine, strokeLine,
  drawVerticalText, drawTextOnPath, fitText, splitRuns, charScript,
} from './text.mjs'
import {
  halftoneScreen, grain, duotone, curves, hueSaturation,
  desaturate, toneWipe, textureStats,
} from './tone.mjs'
import { face } from './fonts.mjs'

/** Canvas blend modes the renderer accepts, matching Photoshop's set. */
export const BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
])

/** `normal` is Photoshop's name for the canvas default. */
function toCompositeOp(mode) {
  if (mode === undefined || mode === null || mode === 'normal') return 'source-over'
  if (!BLEND_MODES.has(mode)) {
    throw new Error(`unknown blend mode "${mode}". Known: ${[...BLEND_MODES].join(', ')}`)
  }
  return mode
}

/**
 * Resolve a length that may be a fraction of the canvas or an absolute pixel
 * count, per the rule documented above.
 *
 * @param {number|undefined} value
 * @param {number} total
 * @param {number} fallback
 * @returns {number}
 */
export function resolveLength(value, total, fallback) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`length must be a number, got ${JSON.stringify(value)}`)
  }
  // FRACTIONS ARE 0..1; EVERYTHING ELSE IS PIXELS.
  //
  // The test used to be `value <= 1`, which quietly swallowed every NEGATIVE coordinate:
  // a layer placed at x = −30 was multiplied by the canvas width and drawn at −76800,
  // off the page, with a clean report and no warning. The same trap caught a photographic
  // layer placed by an ink offset of −179 (rendered at −458240). A negative offset is a
  // perfectly reasonable thing to ask for — it is how anything bleeds off the page edge —
  // so the guard has to admit it.
  return value >= 0 && value <= 1 ? value * total : value
}

/** Same rule on the x axis, with no fallback. */
function resolveX(v, w, d) { return resolveLength(v, w, d) }
function resolveY(v, h, d) { return resolveLength(v, h, d) }

/**
 * A pool of scratch canvases.
 *
 * Rendering one design allocates a buffer per layer; without pooling, a
 * 30-layer poster allocates and drops ~400 MB and spends real time in the
 * allocator. Buffers are keyed by size and reused within a single render, then
 * released together.
 */
class BufferPool {
  constructor() {
    this.free = new Map()
    this.held = []
    this.allocs = 0
  }

  /** @returns {{canvas: object, ctx: object}} */
  acquire(width, height) {
    const key = `${width}x${height}`
    const bucket = this.free.get(key)
    if (bucket !== undefined && bucket.length > 0) {
      const canvas = bucket.pop()
      canvas.getContext('2d').clearRect(0, 0, width, height)
      this.held.push(canvas)
      return { canvas, ctx: canvas.getContext('2d') }
    }
    const canvas = createCanvas(width, height)
    this.allocs++
    this.held.push(canvas)
    return { canvas, ctx: canvas.getContext('2d') }
  }

  release() {
    for (const canvas of this.held) {
      const key = `${canvas.width}x${canvas.height}`
      const bucket = this.free.get(key)
      if (bucket === undefined) this.free.set(key, [canvas])
      else bucket.push(canvas)
    }
    this.held = []
  }

  clear() {
    this.free.clear()
    this.held = []
  }
}

/** Read a canvas into a plain `{width, height, data}` image for pixel work. */
export function readBuffer(canvas) {
  const ctx = canvas.getContext('2d')
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: img.data }
}

/** Write a plain image back onto a canvas. */
export function writeBuffer(canvas, img) {
  const ctx = canvas.getContext('2d')
  const id = ctx.createImageData(img.width, img.height)
  id.data.set(img.data)
  ctx.putImageData(id, 0, 0)
}

/**
 * Scale a layer buffer's alpha by a mask image.
 *
 * Kept separate from drawing because masking must happen *before* the layer is
 * composited: multiplying alpha afterwards would mask the already-blended
 * result against the backdrop, which is a different (and wrong) operation.
 * Doing it here means a mask behaves like a Photoshop layer mask — it hides the
 * layer, it does not blend it.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} layerImg
 * @param {{width:number,height:number,data:Uint8ClampedArray}} maskImg
 * @param {{invert?: boolean, strength?: number}} [options]
 */
export function applyMask(layerImg, maskImg, options = {}) {
  const invert = options.invert === true
  const strength = options.strength === undefined ? 1 : clamp(options.strength, 0, 1)
  const n = Math.min(layerImg.data.length, maskImg.data.length)
  for (let i = 0; i < n; i += 4) {
    const maskAlpha = maskImg.data[i + 3] / 255
    // A mask's *ink* is what reveals: white ink = visible. Using luminance
    // rather than alpha means a mask drawn as a black-to-white gradient works
    // as expected, which is what a designer draws.
    const lum = (0.2126 * maskImg.data[i] + 0.7152 * maskImg.data[i + 1] + 0.0722 * maskImg.data[i + 2]) / 255
    let m = maskAlpha * lum
    if (invert) m = maskAlpha * (1 - lum)
    if (strength < 1) m = 1 - (1 - m) * strength
    layerImg.data[i + 3] = layerImg.data[i + 3] * m
  }
}

/**
 * Render one scene.
 *
 * @param {object} scene
 * @param {{pool?: BufferPool, baseDir?: string}} [options]
 * @returns {Promise<{canvas: object, report: object}>}
 */
export async function renderScene(scene, options = {}) {
  const pool = options.pool === undefined ? new BufferPool() : options.pool
  const baseDir = options.baseDir === undefined ? process.cwd() : options.baseDir
  const log = []
  const warnings = []
  // When the caller wants a layered deliverable, each leaf layer's finished
  // pixels are copied here under its own name. Captured during the same pass
  // that composites them, deliberately: a second pass that re-drew the layers
  // to capture them could disagree with the first, and a PSD whose layers do
  // not match the PNG beside it is worse than no PSD.
  const captured = options.captureLayers === true ? [] : null

  if (scene === null || typeof scene !== 'object') {
    throw new Error('scene must be an object')
  }
  const doc = scene.canvas
  if (doc === null || typeof doc !== 'object') {
    throw new Error('scene.canvas is required, e.g. {"width":2400,"height":1350}')
  }
  const W = Math.round(doc.width)
  const H = Math.round(doc.height)
  if (!(W > 0 && H > 0)) throw new Error(`scene.canvas needs positive width and height, got ${doc.width}x${doc.height}`)

  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const dpr = 1

  // Ground: a flat colour or a gradient, always fully opaque so the document
  // has no accidental transparency that a later blend mode would treat as
  // black. An unset ground defaults to opaque white, which is what a print
  // design starts from.
  const ground = scene.ground === undefined ? '#FFFFFF' : scene.ground
  ctx.save()
  ctx.fillStyle = resolvePaint(ctx, ground, { x: 0, y: 0, width: W, height: H }, '#FFFFFF')
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
  log.push({ step: 'ground', paint: typeof ground === 'string' ? ground : ground.type })

  const layers = Array.isArray(scene.layers) ? scene.layers : []
  if (layers.length === 0) warnings.push('scene has no layers — only the ground will render')

  await compositeLayers(ctx, layers, {
    W, H, pool, baseDir, log, warnings, doc, scene, dpr,
    parentOpacity: 1, captured,
  })

  // Scope conflicts are recorded as LOG entries, which is right for structure, but a
  // `warnings` list is what a caller actually reads and what the report prints. A
  // finding that exists only in the log is a finding nobody sees — and this one is
  // precisely the kind that has to be seen, because the render itself looks fine.
  for (const entry of log) {
    if (entry.step === 'scopeConflict') warnings.push(entry.note)
  }

  const report = {
    canvas: { width: W, height: H },
    layerCount: countLayers(layers),
    topLevelLayers: layers.length,
    log,
    warnings,
    allocations: pool.allocs,
    stats: textureStats(readBuffer(canvas)),
  }
  return { canvas, report, layers: captured }
}

/**
 * Composite an array of layers onto a context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} layers
 * @param {object} env
 */
async function compositeLayers(ctx, layers, env) {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (layer === null || typeof layer !== 'object') {
      env.warnings.push(`layer ${i} is not an object; skipped`)
      continue
    }
    if (layer.hidden === true) {
      env.log.push({ step: 'skip', id: layer.id, reason: 'hidden' })
      continue
    }
    try {
      // A layer is a group if it says so either way round. `shape: "group"` is
      // the form a scene author naturally writes, since every other layer uses
      // `shape`; `kind` exists so adjustment layers (which have no shape at
      // all) can be distinguished. Accepting both keeps one vocabulary for the
      // author while the renderer still tells the three kinds apart.
      const isGroup = layer.kind === 'group' || layer.shape === 'group'
      if (isGroup) {
        await compositeGroup(ctx, layer, env)
      } else if (layer.kind === 'adjustment') {
        await compositeAdjustment(ctx, layer, env)
      } else {
        await compositeLeaf(ctx, layer, env)
      }
    } catch (error) {
      // One bad layer must not destroy the whole render — but it must be
      // loudly visible, because a silently missing layer is a design defect
      // that looks like a deliberate decision.
      env.warnings.push(`layer "${layer.id === undefined ? i : layer.id}" failed: ${error.message}`)
      env.log.push({ step: 'error', id: layer.id, message: error.message })
    }
  }
}

/**
 * A group: render children into their own canvas, then composite that once.
 *
 * Group opacity is applied to the flattened result, which is what makes it
 * behave like a Photoshop group rather than like per-child opacity — the
 * difference is visible wherever children overlap.
 */
async function compositeGroup(ctx, layer, env) {
  const { W, H, pool } = env
  const buffer = pool.acquire(W, H)
  // Children may be placed relative to the group's own box.
  const groupEnv = { ...env, parentOpacity: 1 }
  // A group composites from its children, so with a layered export requested
  // only the flattened group is captured. Capturing the children as well would
  // put both the parts and the whole into the PSD, and the delivered file would
  // then show every grouped element twice.
  if (groupEnv.captured !== null && groupEnv.captured !== undefined) groupEnv.suppressCapture = true
  await compositeLayers(buffer.ctx, Array.isArray(layer.children) ? layer.children : [], groupEnv)
  delete groupEnv.suppressCapture

  await applyLayerFinishing(buffer, layer, env)

  if (env.captured !== null && env.captured !== undefined) {
    const img = readBuffer(buffer.canvas)
    env.captured.push({
      name: String(layer.id === undefined ? 'group' : layer.id),
      x: 0, y: 0, width: W, height: H,
      rgba: new Uint8ClampedArray(img.data),
      opacity: layer.opacity === undefined ? 1 : layer.opacity,
      blend: layer.blend === undefined ? 'normal' : layer.blend,
      visible: layer.hidden !== true,
    })
  }

  ctx.save()
  ctx.globalAlpha = clamp(layer.opacity === undefined ? 1 : layer.opacity, 0, 1) * env.parentOpacity
  ctx.globalCompositeOperation = toCompositeOp(layer.blend)
  ctx.drawImage(buffer.canvas, 0, 0)
  ctx.restore()

  env.log.push({ step: 'group', id: layer.id, children: Array.isArray(layer.children) ? layer.children.length : 0 })
}

/**
 * An adjustment layer: apply a tone operation to everything already composited.
 *
 * Reading back and writing the whole canvas is the price of doing this
 * correctly; it is also why the operation list is restricted to genuine
 * per-pixel transforms rather than anything geometric.
 */
async function compositeAdjustment(ctx, layer, env) {
  const { W, H } = env
  const img = ctx.getImageData(0, 0, W, H)
  // Snapshot the untransformed pixels BEFORE the ops run. An adjustment
  // layer's own opacity fades the effect by interpolating between the original
  // and the adjusted value, so the "before" has to be captured first — reading
  // the canvas back afterwards returns the adjusted pixels and makes the
  // interpolation a no-op, silently turning every faded adjustment into a full
  // one. That is a subtle enough failure to be worth the extra 13 MB.
  const before = new Uint8ClampedArray(img.data)
  const buf = { width: W, height: H, data: img.data }
  const results = []

  for (const op of Array.isArray(layer.ops) ? layer.ops : []) {
    results.push(applyToneOp(buf, op, env))
  }

  const strength = clamp(layer.opacity === undefined ? 1 : layer.opacity, 0, 1)
  if (strength < 1) {
    const d = buf.data
    for (let i = 0; i < d.length; i++) d[i] = before[i] + (d[i] - before[i]) * strength
  }
  img.data.set(buf.data)
  ctx.putImageData(img, 0, 0)
  env.log.push({ step: 'adjustment', id: layer.id, ops: results, strength: Math.round(strength * 100) / 100 })
}

/**
 * Run one tone operation against a buffer.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} buf
 * @param {object} op
 * @param {object} env
 * @returns {object} a compact result record for the report
 */
function applyToneOp(buf, op, env) {
  const kind = op.op
  switch (kind) {
    case 'curves': {
      const r = curves(buf, op)
      return { op: kind, applied: r.applied }
    }
    case 'hueSaturation':
    case 'hue-saturation': {
      const r = hueSaturation(buf, op)
      return { op: kind, touched: r.touched }
    }
    case 'desaturate':
      return { op: kind, ...desaturate(buf, op.amount) }
    case 'duotone':
      return { op: kind, ...duotone(buf, op) }
    case 'grain':
      return { op: kind, ...grain(buf, op) }
    case 'toneWipe':
    case 'tone-wipe':
      return { op: kind, ...toneWipe(buf, op) }
    case 'halftone': {
      const r = halftoneScreen(buf, op)
      return { op: kind, dots: r.dots, coverage: Number(r.coverage.toFixed(5)) }
    }
    default:
      throw new Error(`unknown adjustment op "${kind}". Known: curves, hueSaturation, desaturate, duotone, grain, toneWipe, halftone`)
  }
}

/**
 * A leaf layer: shapes, text, images. Rendered into its own buffer, finished,
 * then composited.
 */
async function compositeLeaf(ctx, layer, env) {
  const { W, H, pool } = env
  const buffer = pool.acquire(W, H)
  const g = buffer.ctx

  // Transform: translate/rotate/scale about an explicit origin, so rotating a
  // label does not also move it.
  const originX = resolveX(layer.originX, W, 0)
  const originY = resolveY(layer.originY, H, 0)
  const t = layer.transform
  if (t !== undefined && t !== null) {
    g.save()
    g.translate(originX + (t.dx === undefined ? 0 : t.dx), originY + (t.dy === undefined ? 0 : t.dy))
    if (t.rotate !== undefined) g.rotate((t.rotate * Math.PI) / 180)
    if (t.scale !== undefined) g.scale(t.scale, t.scaleX === undefined ? (t.scaleY === undefined ? t.scale : t.scaleY) : t.scaleX)
    g.translate(-originX, -originY)
  }

  const drawResult = await drawLeaf(g, layer, env)

  // Tone operations declared ON the shape (`tone`) run over the shape's own
  // box, while the same operations declared as `effects` run over the whole
  // canvas buffer. The distinction matters: a dot screen belongs to the shape
  // that generates it, and a canvas-wide pass would both modify everything
  // already drawn into the buffer and let the screen spill far outside the
  // shape's geometry.
  if (Array.isArray(layer.tone)) {
    const box = shapeBox(layer, W, H)
    for (const op of layer.tone) {
      env.log.push({
        step: 'shapetone',
        id: layer.id,
        op: op.op === undefined ? op.type : op.op,
        ...applyToneInBox(g, op, box),
      })
    }
  }

  if (t !== undefined && t !== null) g.restore()

  await applyLayerFinishing(buffer, layer, env, drawResult)

  // Snapshot the finished layer for a layered export, before it is composited.
  // Copied by value: the buffer goes back to the pool and will be cleared and
  // reused by the next layer.
  if (env.captured !== null && env.captured !== undefined && env.suppressCapture !== true) {
    const img = readBuffer(buffer.canvas)
    env.captured.push({
      name: String(layer.id === undefined ? (layer.shape === undefined ? 'layer' : layer.shape) : layer.id),
      x: 0,
      y: 0,
      width: W,
      height: H,
      rgba: new Uint8ClampedArray(img.data),
      opacity: layer.opacity === undefined ? 1 : layer.opacity,
      blend: layer.blend === undefined ? 'normal' : layer.blend,
      visible: layer.hidden !== true,
    })
  }

  ctx.save()
  ctx.globalAlpha = clamp(layer.opacity === undefined ? 1 : layer.opacity, 0, 1) * env.parentOpacity
  ctx.globalCompositeOperation = toCompositeOp(layer.blend)
  ctx.drawImage(buffer.canvas, 0, 0)
  ctx.restore()

  env.log.push({
    step: 'layer',
    id: layer.id === undefined ? layer.shape : layer.id,
    shape: layer.shape,
    drawn: drawResult,
  })
}

/**
 * Apply a layer's mask, then its non-geometric effects.
 *
 * Order matters and mirrors a raster editor: effects are generated from the
 * layer's own ink, then the mask is applied to the result. Masking first would
 * let a blur bleed the layer back into the area the mask had just hidden.
 */
async function applyLayerFinishing(buffer, layer, env, drawResult) {
  const { W, H, pool } = env

  // Effects that need a separate buffer to blur/screen from. Their results are
  // collected and merged into the layer's `drawn` record rather than discarded,
  // because a halftone that silently produces zero dots is indistinguishable
  // from a halftone that was never requested — and the whole point of this
  // engine's reporting is that those two must not look alike.
  const effects = Array.isArray(layer.effects) ? layer.effects : []
  const effectResults = []
  for (const fx of effects) {
    effectResults.push(await applyEffect(buffer, fx, env))
  }
  if (drawResult !== undefined && drawResult !== null && effectResults.length > 0) {
    drawResult.effects = effectResults
  }

  if (layer.mask !== undefined && layer.mask !== null) {
    const maskBuffer = pool.acquire(W, H)
    await drawMask(maskBuffer.ctx, layer.mask, env)
    const maskImg = readBuffer(maskBuffer.canvas)
    const layerImg = readBuffer(buffer.canvas)
    // Alpha total before masking, so the report can state how much the mask
    // actually removed. A mask that hides 0% or hides everything is the exact
    // failure the review hit ("the mask layer went wrong") and it was only
    // found by rendering a coverage figure — so it is measured here, every
    // render, rather than left to be spotted by eye later.
    let alphaBefore = 0
    for (let i = 3; i < layerImg.data.length; i += 4) alphaBefore += layerImg.data[i]

    applyMask(layerImg, maskImg, {
      invert: layer.mask.invert === true,
      strength: layer.mask.strength,
    })
    writeBuffer(buffer.canvas, layerImg)

    if (drawResult !== undefined && drawResult !== null) {
      let alphaAfter = 0
      for (let i = 3; i < layerImg.data.length; i += 4) alphaAfter += layerImg.data[i]
      drawResult.masked = true
      drawResult.maskRetained = alphaBefore === 0 ? 0 : Number((alphaAfter / alphaBefore).toFixed(4))
    }
    env.log.push({ step: 'mask', id: layer.id })
  }
}

/** Normalise a mask or group definition to its list of shapes. */
function shapesOf(definition) {
  if (definition === null || typeof definition !== 'object') return []
  return Array.isArray(definition.shapes) ? definition.shapes : [definition]
}

/** Draw a mask definition into a context. Masks reuse the shape vocabulary. */
async function drawMask(g, mask, env) {
  for (const shape of shapesOf(mask)) {
    if (shape === null || typeof shape !== 'object') continue
    // A mask paints ink; the luminance of that ink is the reveal amount.
    const paint = shape.paint === undefined ? '#FFFFFF' : shape.paint
    // A mask is often built from more than one gradient — a fade on each axis,
    // for instance — and those must MULTIPLY, not overpaint each other. Two
    // white-to-transparent gradients drawn one over the other with the default
    // operation produce the union of the two, which is not a corner fade at
    // all. Marking a shape `blend: 'multiply'` composites it into the mask
    // instead, so a mask with two axes really does fade on both.
    g.save()
    if (shape.blend !== undefined && shape.blend !== null) {
      g.globalCompositeOperation = toCompositeOp(shape.blend)
    }
    await drawLeaf(g, {
      ...shape,
      shape: shape.shape === undefined ? 'rect' : shape.shape,
      paint,
      opacity: shape.opacity === undefined ? 1 : shape.opacity,
    }, env)
    g.restore()
  }
}

/**
 * Draw one shape/text/image into a context. Returns a compact description of
 * what was drawn, which the verifier uses to check geometry against intent.
 */
async function drawLeaf(g, layer, env) {
  const { W, H, baseDir } = env
  const shape = layer.shape

  switch (shape) {
    case 'rect': {
      const x = resolveX(layer.x, W, 0)
      const y = resolveY(layer.y, H, 0)
      const w = resolveLength(layer.w, W, W)
      const h = resolveLength(layer.h, H, H)
      g.save()
      g.globalAlpha = clamp(layer.fillOpacity === undefined ? 1 : layer.fillOpacity, 0, 1)
      const box = { x, y, width: w, height: h }
      if (layer.radius !== undefined && layer.radius > 0) {
        g.beginPath()
        const r = resolveLength(layer.radius, Math.min(w, h), 0)
        g.roundRect(x, y, w, h, r)
      } else {
        g.beginPath()
        g.rect(x, y, w, h)
      }
      if (layer.paint !== 'none') {
        g.fillStyle = resolvePaint(g, layer.paint, box, '#000000')
        g.fill()
      }
      if (layer.stroke !== undefined && layer.stroke !== null) {
        const s = typeof layer.stroke === 'string' ? { color: layer.stroke } : layer.stroke
        g.lineWidth = s.width === undefined ? 1 : s.width
        g.strokeStyle = typeof s.color === 'string' ? cssColor(parseColor(s.color)) : s.color
        if (s.dash !== undefined) g.setLineDash(s.dash)
        g.stroke()
        g.setLineDash([])
      }
      g.restore()
      return { x: round(x), y: round(y), w: round(w), h: round(h) }
    }

    case 'ellipse': {
      const x = resolveX(layer.x, W, 0)
      const y = resolveY(layer.y, H, 0)
      const w = resolveLength(layer.w, W, W)
      const h = resolveLength(layer.h, H, H)
      g.save()
      g.globalAlpha = clamp(layer.fillOpacity === undefined ? 1 : layer.fillOpacity, 0, 1)
      g.beginPath()
      g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      // `paint: 'none'` means "stroke only" everywhere else in this vocabulary
      // (rect, polygon, path all honour it). The ellipse case filled
      // unconditionally, so an unfilled ring — which is exactly how a hairline
      // keyline ring is drawn — died in parseColor with `unrecognised colour
      // "none"` and the layer silently vanished from the render.
      if (layer.paint !== 'none') {
        g.fillStyle = resolvePaint(g, layer.paint, { x, y, width: w, height: h }, '#000000')
        g.fill()
      }
      if (layer.stroke !== undefined && layer.stroke !== null) {
        const s = typeof layer.stroke === 'string' ? { color: layer.stroke } : layer.stroke
        g.lineWidth = s.width === undefined ? 1 : s.width
        g.strokeStyle = cssColor(parseColor(s.color))
        g.stroke()
      }
      g.restore()
      return { cx: round(x + w / 2), cy: round(y + h / 2), rx: round(w / 2), ry: round(h / 2) }
    }

    case 'line': {
      // A line runs from (x1, y1) to (x2, y2). It does NOT use `x`/`y`, and both
      // endpoints default to the canvas edges, so a layer written as
      // `{ x: 96, y: 153, x2: 2304, y2: 153 }` — which reads like "a rule at y=153
      // from 96 to 2304" — silently ignores `x`/`y` and draws from the TOP-LEFT
      // CORNER to (2304, 153). That single misreading put an unintended diagonal
      // slash across every poster variant, and the report was clean.
      //
      // The cost of the mistake is high and the fix is cheap, so it is refused
      // rather than tolerated: `x`/`y` on a line is almost always a request for a
      // rule at that position, and saying so is more useful than drawing something
      // else. `x1`/`y1` are the real fields and are used by every scene in the
      // repository.
      if ((layer.x !== undefined || layer.y !== undefined) && layer.x1 === undefined && layer.y1 === undefined) {
        throw new Error(
          `line "${layer.id}" sets x/y, which a line ignores — it runs from (x1, y1) to (x2, y2). `
          + `A rule at y=${layer.y} spanning the canvas is `
          + `{ x1: ${layer.x === undefined ? 0 : layer.x}, y1: ${layer.y}, x2: <end x>, y2: ${layer.y} }.`,
        )
      }
      const x1 = resolveX(layer.x1, W, 0)
      const y1 = resolveY(layer.y1, H, 0)
      const x2 = resolveX(layer.x2, W, W)
      const y2 = resolveY(layer.y2, H, H)
      g.save()
      g.beginPath()
      g.moveTo(x1, y1)
      // Curvature via control points, for the ruled sweeps in the reference
      // language that are neither straight nor a plain arc.
      if (layer.c1 !== undefined && layer.c2 !== undefined) {
        g.bezierCurveTo(
          resolveX(layer.c1[0], W, 0), resolveY(layer.c1[1], H, 0),
          resolveX(layer.c2[0], W, 0), resolveY(layer.c2[1], H, 0),
          x2, y2,
        )
      } else {
        g.lineTo(x2, y2)
      }
      g.lineWidth = layer.width === undefined ? 1 : layer.width
      const col = parseColor(typeof layer.paint === 'string' ? layer.paint : '#000000')
      g.strokeStyle = cssColor(col)
      if (layer.dash !== undefined) g.setLineDash(layer.dash)
      if (layer.cap !== undefined) g.lineCap = layer.cap
      g.stroke()
      g.setLineDash([])
      g.restore()
      return { x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2), width: layer.width }
    }

    case 'polygon': {
      const pts = Array.isArray(layer.points) ? layer.points : []
      if (pts.length < 3) throw new Error('polygon needs at least 3 points')
      const mapped = pts.map(([px, py]) => [resolveX(px, W, 0), resolveY(py, H, 0)])
      g.save()
      g.globalAlpha = clamp(layer.fillOpacity === undefined ? 1 : layer.fillOpacity, 0, 1)
      g.beginPath()
      g.moveTo(mapped[0][0], mapped[0][1])
      for (let i = 1; i < mapped.length; i++) g.lineTo(mapped[i][0], mapped[i][1])
      g.closePath()
      const xs = mapped.map((p) => p[0])
      const ys = mapped.map((p) => p[1])
      const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
      if (layer.paint !== 'none') {
        g.fillStyle = resolvePaint(g, layer.paint, box, '#000000')
        g.fill()
      }
      if (layer.stroke !== undefined && layer.stroke !== null) {
        const s = typeof layer.stroke === 'string' ? { color: layer.stroke } : layer.stroke
        g.lineWidth = s.width === undefined ? 1 : s.width
        g.strokeStyle = cssColor(parseColor(s.color))
        g.stroke()
      }
      g.restore()
      return { bounds: { x: round(box.x), y: round(box.y), w: round(box.width), h: round(box.height) }, points: mapped.length }
    }

    case 'path': {
      // SVG path data, drawn directly. This is the escape hatch for the hand
      // shapes the reference language uses (chevrons, brackets, blobs) that are
      // tedious to express as polygons.
      if (typeof layer.d !== 'string') throw new Error('path needs a `d` string')
      g.save()
      const p = new (await import('@napi-rs/canvas')).Path2D(layer.d)
      if (layer.paint !== 'none') {
        g.fillStyle = resolvePaint(g, layer.paint, { x: 0, y: 0, width: W, height: H }, '#000000')
        g.fill(p)
      }
      if (layer.stroke !== undefined && layer.stroke !== null) {
        const s = typeof layer.stroke === 'string' ? { color: layer.stroke } : layer.stroke
        g.lineWidth = s.width === undefined ? 1 : s.width
        g.strokeStyle = cssColor(parseColor(s.color))
        g.stroke(p)
      }
      g.restore()
      return { path: layer.d.slice(0, 64) + (layer.d.length > 64 ? '…' : '') }
    }

    case 'text': {
      return drawTextLayer(g, layer, env)
    }

    case 'image': {
      // The result is RETURNED, like every other shape case, and that is required:
      // `drawLeaf` returns what it drew and its caller stores that in the layer log.
      //
      // NOTE FOR WHOEVER INVESTIGATES IMAGE EFFECTS NEXT: this looked like the
      // reason image layers ignore `effects`, because a `return` here reads as
      // skipping the rest of the function. It is not — `applyLayerFinishing` is
      // called by `compositeLeaf` at its own level, after `drawLeaf` returns, so
      // images reach it like everything else. Verified by reading the call site
      // rather than by reasoning from the apparent early exit. The actual cause of
      // image effects appearing to do nothing is still open; a full-strength
      // duotone on an image layer changes mean saturation by about 0.02 in the
      // poster comparison, while the same duotone applied directly to the same
      // asset changes it from 0.651 to 0.412.
      return await drawImageLayer(g, layer, env)
    }

    default:
      throw new Error(`unknown shape "${shape}". Known: rect, ellipse, line, polygon, path, text, image`)
  }
}

/**
 * Draw a text layer.
 *
 * Reports the real measured box, which is the whole point: the caller (and the
 * verifier) can compare what was intended against what the font actually did.
 */
async function drawTextLayer(g, layer, env) {
  const { W, H } = env
  const font = parseFontSpec(layer.font, layer.size === undefined ? 16 : layer.size)
  const text = layer.text === undefined ? '' : String(layer.text)
  const align = layer.align === undefined ? 'left' : layer.align
  const color = typeof layer.paint === 'string' ? layer.paint : (layer.color === undefined ? '#000000' : layer.color)

  const x = resolveX(layer.x, W, 0)
  const y = resolveY(layer.y, H, 0)
  const boxW = layer.w === undefined ? W - x : resolveLength(layer.w, W, W - x)

  if (layer.vertical === true) {
    const r = drawVerticalText(g, text, x, y, font.stack, font.spec, font.trackingEm, cssColor(parseColor(color)))
    return { mode: 'vertical', x: round(x), y: round(y), height: round(r.height), characters: r.characters }
  }

  if (layer.path !== undefined && layer.path !== null) {
    const r = drawTextOnPath(g, text, layer.path, font.stack, font.spec, font.trackingEm, cssColor(parseColor(color)))
    return { mode: 'path', placed: r.placed }
  }

  let spec = font.spec
  let fitResult = null
  if (layer.fit === true) {
    // Shrink-to-fit against the real metrics: the size that is returned is the
    // largest one that actually fits, not an estimate plus a safety margin.
    fitResult = fitText(g, text, boxW, font.stack, spec, font.trackingEm, layer.fitOptions)
    spec = { ...spec, size: fitResult.size }
  }

  const oneshot = layer.wrap === false
  const layout = oneshot
    ? { lines: text.split('\n').map((t) => ({ text: t, ...measureLine(g, t, font.stack, spec, font.trackingEm) })), overflow: false, widest: 0 }
    : layoutParagraph(g, text, boxW, font.stack, spec, font.trackingEm)

  // Leading: explicit if given, otherwise the font spec's ratio, otherwise a
  // size-derived default. A headline needs tighter leading than body text, and
  // defaulting both to one ratio is what makes generated titles look loose.
  const lineHeight = layer.lineHeight === undefined
    ? font.lineHeightEm * spec.size
    : resolveLength(layer.lineHeight, H, font.lineHeightEm * spec.size)

  const firstBaseline = y + (spec.size * 0.82)
  const usedFamilies = []
  let fellBack = false

  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i]
    if (line.text === '') continue
    const baselineY = firstBaseline + i * lineHeight
    const r = drawLine(g, line, font.stack, spec, font.trackingEm, x, baselineY, boxW, align, cssColor(parseColor(color)))
    for (const f of r.usedFamilies) if (!usedFamilies.includes(f)) usedFamilies.push(f)
    if (r.fellBack) fellBack = true

    if (layer.stroke !== undefined && layer.stroke !== null && layer.stroke !== false) {
      const s = typeof layer.stroke === 'string' ? { color: layer.stroke, width: 1 } : layer.stroke
      strokeLine(g, line, font.stack, spec, font.trackingEm, x, baselineY, boxW, align, {
        width: s.width === undefined ? 1 : s.width,
        color: cssColor(parseColor(s.color === undefined ? '#000000' : s.color)),
        cap: s.cap,
        join: s.join,
      })
    }
  }

  const blockHeight = layout.lines.length * lineHeight
  return {
    mode: 'block',
    lines: layout.lines.length,
    widest: round(layout.widest),
    boxWidth: round(boxW),
    overflow: layout.overflow,
    fontSize: round(spec.size),
    fitted: fitResult === null ? null : { size: round(fitResult.size), fits: fitResult.fits },
    block: { x: round(x), y: round(y), w: round(boxW), h: round(blockHeight) },
    families: usedFamilies,
    fontFallback: fellBack,
  }
}

/** Draw an image layer, with cover/contain/scale placement. */
async function drawImageLayer(g, layer, env) {
  const { W, H, baseDir } = env
  const src = layer.src
  if (typeof src !== 'string') throw new Error('image layer needs a `src` path')
  const path = isAbsolute(src) ? src : resolve(baseDir, src)
  if (!existsSync(path)) throw new Error(`image not found: ${path}`)

  const img = await loadImage(path)
  const x = resolveX(layer.x, W, 0)
  const y = resolveY(layer.y, H, 0)
  const w = resolveLength(layer.w, W, img.width)
  const h = resolveLength(layer.h, H, img.height)

  const fit = layer.fit === undefined ? 'stretch' : layer.fit
  let dw = w, dh = h, dx = x, dy = y
  if (fit === 'cover' || fit === 'contain') {
    const scale = fit === 'cover'
      ? Math.max(w / img.width, h / img.height)
      : Math.min(w / img.width, h / img.height)
    dw = img.width * scale
    dh = img.height * scale
    const anchorX = layer.anchorX === undefined ? 0.5 : layer.anchorX
    const anchorY = layer.anchorY === undefined ? 0.5 : layer.anchorY
    dx = x + (w - dw) * anchorX
    dy = y + (h - dh) * anchorY
  }

  g.save()
  g.globalAlpha = clamp(layer.fillOpacity === undefined ? 1 : layer.fillOpacity, 0, 1)
  // Resampling quality matters here: a downscaled illustration with the default
  // filter aliases badly, and a design that leans on fine linework shows it.
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = layer.quality === undefined ? 'high' : layer.quality
  if (layer.tint !== undefined && layer.tint !== null) {
    // Monochrome tint of a placed illustration — the "olive wash" move.
    g.drawImage(img, dx, dy, dw, dh)
    const t = parseColor(layer.tint)
    g.globalCompositeOperation = layer.tintMode === undefined ? 'multiply' : layer.tintMode
    g.globalAlpha = clamp(layer.tintStrength === undefined ? 0.35 : layer.tintStrength, 0, 1)
    g.fillStyle = cssColor(t)
    g.fillRect(dx, dy, dw, dh)
  } else {
    g.drawImage(img, dx, dy, dw, dh)
  }
  g.restore()

  // If the layer was clipped to a box, crop by masking.
  if (fit === 'cover') {
    g.save()
    g.globalCompositeOperation = 'destination-in'
    g.fillStyle = '#FFFFFF'
    g.fillRect(x, y, w, h)
    g.restore()
  }

  return { src: path, natural: { w: img.width, h: img.height }, placed: { x: round(dx), y: round(dy), w: round(dw), h: round(dh) } }
}

/**
 * Layer effects, filters, and adjustments.
 *
 * Three sources feed this, tried in order, so a scene can name an effect the way
 * it reads most naturally:
 *
 *   1. `LAYER_EFFECTS` in `effects.mjs` — anything that grows or carves the
 *      layer's own silhouette: dropShadow, outerGlow, stroke, bevel, satin, the
 *      three overlays, innerShadow, innerGlow. These need the layer's ALPHA as a
 *      mask, so they act on the layer's ink rather than on the rectangle it
 *      occupies, which is what keeps a blurred hairline a hairline instead of a
 *      soft block.
 *   2. `SAT_FILTERS` in `filters.mjs` — blurs whose cost is flat in radius.
 *      `blur` is kept as an alias for `gaussian` because older scenes use it.
 *   3. The tone operators in `tone.mjs` — grain, halftone, duotone, toneWipe,
 *      curves, hueSaturation, desaturate.
 *
 * The order is deliberate: a layer effect must see the layer's own silhouette,
 * and a filter must be able to act on a layer effect's output (a blurred drop
 * shadow, say). Within the array, effects compose in the order written.
 *
 * `scope` — the effect's EXTENT
 * ----------------------------
 * Any effect may declare `scope`, and the pipeline applies it uniformly:
 *
 *   after = before + (effected - before) * scope
 *
 * so a scope of 1 everywhere (the default) is exactly the old behaviour, a scope of
 * 0 leaves the layer untouched, and anything between interpolates. It is applied
 * HERE rather than inside each effect so that all three families get it, and so
 * that an effect which replaces the layer wholesale — a blur, a colour overlay, a
 * duotone — cannot leak past its scope.
 *
 * This is the fix for the failure that uniform strength cannot express: at full
 * strength a duotone erased a subject's internal detail, and at low strength a
 * bevel vanished. Extent, not strength, is the missing axis.
 */
async function applyEffect(buffer, fx, env) {
  const { W, H, pool } = env
  const scopeSpec = fx.scope
  const scoped = scopeSpec !== undefined && scopeSpec !== null

  // The baseline is needed for two different reasons, and separating them is what
  // makes the conflict detection below actually run.
  //
  //   * a SCOPED effect needs `before` to blend against;
  //   * an UNSCOPED effect needs it to tell whether it changed anything inside a
  //     region an earlier effect held unchanged.
  //
  // Capturing it only for the scoped case — the first version — left the detection
  // with no baseline and it silently never fired, which is the same class of failure
  // (a check that cannot run and reports nothing) that the detection exists to catch.
  // The snapshot is taken when either reason applies.
  const needsBaseline = scoped || (env.protectedRegions !== undefined && env.protectedRegions.length > 0)
  const before = needsBaseline ? readBuffer(buffer.canvas) : null

  // Resolved BEFORE the effect runs, because a `replace` effect needs to know where
  // it is allowed to act. Resolving it after — which the first version did — made the
  // knockout unavoidably global.
  const scopePlane = scoped
    ? resolveScope(scopeSpec, W, H, {
      canvasModule: { createCanvas },
      drawShapes: (g, spec) => drawScopeShapes(g, spec, env),
    })
    : null

  const record = await applyEffectUnscoped(buffer, fx, env, pool, scopePlane)

  // ── detect a later effect overwriting an earlier effect's protected region ──
  //
  // This is the fault that cost the most time in this project and the report could
  // not see it at all: every effect was correct in isolation, the render was clean,
  // and the composition was wrong. Concretely, a duotone confined by an inverted
  // ellipse preserved a face, and a following unscoped drop shadow — the whole
  // silhouette, offset, at opacity — painted straight over it. The olive treatment
  // started at y=276 where the protecting ellipse reached y=716.
  //
  // It is mechanically decidable, so it is decided here rather than left to be
  // noticed. What is tracked is where each scoped effect left the ORIGINAL pixels in
  // place (`scope < 0.5`: the effect was held off) and where it wrote its own
  // (`scope >= 0.5`). A later effect that changes pixels in a held-off region, and
  // carries no scope of its own, has overruled a decision made earlier in the stack.
  //
  // A warning, not an error: a designer may genuinely want a shadow over a face. The
  // point is that it can no longer happen BY ACCIDENT unnoticed.
  if (scoped) {
    if (env.protectedRegions === undefined) env.protectedRegions = []
    const held = new Uint8Array(W * H)
    const wrote = new Uint8Array(W * H)
    let heldCount = 0
    let wroteCount = 0
    for (let i = 0; i < held.length; i++) {
      if (scopePlane[i] < 0.5) { held[i] = 1; heldCount++ } else { wrote[i] = 1; wroteCount++ }
    }
    if (heldCount > 0 && wroteCount > 0) {
      env.protectedRegions.push({ type: fx.type, held, wrote, scope: describeScope(scopeSpec) })
    }
  } else if (env.protectedRegions !== undefined && env.protectedRegions.length > 0) {
    // Compare the layer before and after this unscoped effect, and count how much of
    // the change lands where an earlier effect had held the original pixels.
    const afterUnscoped = readBuffer(buffer.canvas)
    const baseline = before === null ? null : before
    if (baseline !== null) {
      for (const region of env.protectedRegions) {
        let trespass = 0
        for (let i = 0, p = 0; i < region.held.length; i++, p += 4) {
          if (region.held[i] === 0) continue
          if (afterUnscoped.data[p] !== baseline.data[p]
            || afterUnscoped.data[p + 1] !== baseline.data[p + 1]
            || afterUnscoped.data[p + 2] !== baseline.data[p + 2]) trespass++
        }
        if (trespass > 0) {
          env.log.push({
            step: 'scopeConflict',
            id: fx.type,
            overwrites: region.type,
            earlierScope: region.scope,
            pixels: trespass,
            note: `effect "${fx.type}" has no scope and changed ${trespass} px inside the region that `
              + `"${region.type}" (scope ${region.scope}) deliberately kept unchanged. `
              + `Give "${fx.type}" its own scope if this is not intended.`,
          })
        }
      }
    }
  }

  if (!scoped) return record

  // The effect runs UNSCORED, then its result is blended through the scope. Doing
  // it the other way — restricting the effect's input — would give wrong answers
  // for anything that reads a neighbourhood (blur, bevel, glow): those must see the
  // full image to compute correctly even where their output ends up hidden.
  const effected = readBuffer(buffer.canvas)
  const blended = blendByScope(before, effected, scopePlane)
  buffer.ctx.clearRect(0, 0, W, H)
  writeBuffer(buffer.canvas, blended)
  return { ...record, scope: describeScope(scopeSpec) }
}

/** A short, reportable description of a scope, so a report says what it did. */
function describeScope(scope) {
  const specs = Array.isArray(scope) ? scope : [scope]
  return specs.map((s) => {
    if (s === null || typeof s !== 'object') return 'invalid'
    if (s.type === 'ramp' || (s.type === undefined && s.shape === undefined)) {
      const stops = s.stops === undefined ? ['#FFF', '#000'] : s.stops
      return `ramp(${stops.join('->')}${s.invert === true ? ',inverted' : ''})`
    }
    return `${s.shape === undefined ? 'shape' : s.shape}${s.invert === true ? '(inverted)' : ''}`
  }).join('*')
}

/**
 * Draw one scope's shapes onto a context, through the ordinary shape pipeline.
 *
 * Reusing `drawLeaf` rather than writing a second shape renderer is deliberate: a
 * scope ellipse must mean exactly what a layer ellipse means, including how `w`
 * resolves, how the paint is read and how `radius` is clamped. A separate
 * implementation would be a second convention to keep in sync — the class of defect
 * the repair notes are about.
 */
async function drawScopeShapes(g, spec, env) {
  const shapes = Array.isArray(spec.shapes) ? spec.shapes : [spec]
  for (const shape of shapes) {
    if (shape === null || typeof shape !== 'object') continue
    await drawLeaf(g, { ...shape, id: `scope:${shape.shape === undefined ? 'rect' : shape.shape}` }, env)
  }
}

/** The unscoped effect application: the original three-family dispatch. */
async function applyEffectUnscoped(buffer, fx, env, pool, scopePlane = null) {
  const { W, H } = env
  const type = fx.type

  // ── the operator graph ───────────────────────────────────────────────────
  //
  // A scene may state a filter as a palette chain instead of naming a built-in effect.
  // That is the point of the palette: a filter nobody wrote is a list of operators rather
  // than new code, and the chain reports what each step did.
  //
  // Checked BEFORE the built-in families so a graph always wins, and reported in full —
  // the per-step figures are the evidence that a step did something, which is the check
  // that catches the failure this project has hit most often.
  if (Array.isArray(fx.graph)) {
    const img = readBuffer(buffer.canvas)
    const r = runPalette(img, fx.graph)
    buffer.ctx.clearRect(0, 0, W, H)
    writeBuffer(buffer.canvas, r.image)
    return {
      type: 'graph',
      operators: r.steps.map((s) => s.op),
      steps: r.steps.map((s) => ({
        op: s.op,
        changedFraction: s.changedFraction,
        ...(s.selectedFraction === undefined ? {} : { selectedFraction: s.selectedFraction }),
        ...(s.suspicious ? { problem: s.problem } : {}),
      })),
      // Surfaced rather than buried: a step that changed nothing is exactly what a report
      // must not stay quiet about.
      inertSteps: r.steps.filter((s) => s.suspicious).length,
    }
  }

  // ── layer effects: these need alpha, not a canvas ────────────────────────
  const layerFx = LAYER_EFFECTS[type]
  if (layerFx !== undefined) {
    const img = readBuffer(buffer.canvas)
    const alpha = alphaPlane(img)
    const spec = { ...(layerFx.defaults || {}), ...fx }
    const out = layerFx.run({ image: img, alpha, width: W, height: H, spec }).image
    buffer.ctx.clearRect(0, 0, W, H)
    writeBuffer(buffer.canvas, out)
    // Report the RESOLVED parameters, not the requested ones, so a defaulted
    // effect is visible in the report instead of invisible.
    return { type, ...spec }
  }

  // ── filters ──────────────────────────────────────────────────────────────
  const filterName = type === 'blur' ? 'gaussian' : type
  const filter = SAT_FILTERS[filterName]
  if (filter !== undefined) {
    const img = readBuffer(buffer.canvas)
    const res = filter(img, fx)
    const data = res.data === undefined ? res : res.data
    buffer.ctx.clearRect(0, 0, W, H)
    writeBuffer(buffer.canvas, { width: W, height: H, data })
    return { type, filter: filterName, radius: fx.radius === undefined ? null : fx.radius }
  }


  if (type === 'grain' || type === 'halftone' || type === 'duotone' || type === 'toneWipe') {
    const img = readBuffer(buffer.canvas)
    let result
    if (type === 'grain') result = { type, ...grain(img, fx) }
    else if (type === 'halftone') {
      // `replace` is the mode a dot screen is almost always wanted in.
      //
      // A halftone's purpose is to turn a flat area of ink into a screen of
      // dots. Compositing dots ON TOP of that flat area cannot achieve it: it
      // only ever adds ink, so even the sparsest screen sits on a solid ground,
      // the area still reads as a block, and no amount of tone tuning makes the
      // dots visible. That is exactly what happened here — the panel reported
      // 1660 dots drawn and 0 transparent pixels inside it. Clearing the layer
      // first, so the dot screen is the layer's only ink, is what makes the
      // modulation real.
      // `replace` clears the layer's own ink so the dot screen becomes its only ink.
      //
      // WHAT IT MUST NOT DO, AND DID
      // ---------------------------
      // The first version was `img.data.fill(0)`, which zeroes the ENTIRE BUFFER —
      // not the layer's ink. On a full-canvas buffer that also erases the paper
      // ground, the band, and every layer composited before this one, and does it
      // outside the effect's own scope as well. A dot screen on a small element
      // therefore punched a transparent hole through the whole poster.
      //
      // `replace` clears the layer's own ink so the dot screen becomes its only ink.
      //
      // SCOPED, NOT GLOBAL — AND WHY THAT MATTERS
      // -----------------------------------------
      // The first version was `img.data.fill(0)`, which zeroes the ENTIRE BUFFER:
      // not the layer's ink, and not just the effect's own region. Two separate
      // faults followed. It erased the paper ground and every layer already
      // composited (a screen on a small element punched a transparent hole through
      // the poster), and — subtler — it made a scoped screen overrun its own scope.
      //
      // The consequence in practice: a duotone confined by an inverted ellipse
      // painted the face correctly, and then a following `replace` screen, scoped to
      // a soft ramp across the whole canvas, cleared the lot and stamped its dots
      // over the protected area as well. Measured along the subject's axis, the olive
      // treatment started at y=276 when the protecting ellipse extended to y=716 —
      // the protection had been erased by the next effect in the stack.
      //
      // So the knockout goes through the SCOPE: alpha is zeroed only where the effect
      // acts, the original alpha is kept everywhere else, and the layer's silhouette
      // still bounds the result. An effect can no longer destroy what an earlier
      // effect's scope protected it from.
      let savedAlpha = null
      // The layer as it stood BEFORE the knockout. Both the screen's silhouette and
      // its source tone have to come from here: a cleared buffer has no alpha to
      // bound the dots and no luminance to modulate them, so `replace` would silently
      // produce byte-identical output to not replacing at all (measured), while still
      // reporting a healthy dot count.
      const preKnockout = fx.replace === true ? readBuffer(buffer.canvas) : null
      if (fx.replace === true) {
        savedAlpha = new Uint8ClampedArray(img.data.length / 4)
        for (let i = 0, j = 3; i < savedAlpha.length; i++, j += 4) savedAlpha[i] = img.data[j]
        for (let i = 0, j = 3; i < savedAlpha.length; i++, j += 4) {
          // No scope means the whole layer is replaced, which is the original
          // behaviour; a scope confines the knockout to where the effect acts.
          const k = scopePlane === null ? 1 : scopePlane[i]
          img.data[j] = savedAlpha[i] * k
        }
      }
      // THE SCREEN READS ITS SILHOUETTE FROM THE ALPHA, so the knockout above would
      // starve it.
      //
      // `halftoneScreen` captures the shape's coverage from the incoming alpha before
      // it draws, and skips any pixel with no ink. Clearing the alpha first — which is
      // exactly what `replace` means — therefore made the screen see an empty
      // silhouette and draw NOTHING, while still reporting a healthy dot count for the
      // dots it thought it had made. Measured: a `replace` screen and a non-`replace`
      // screen produced byte-identical output, which is how it was caught.
      //
      // So the original silhouette is supplied explicitly. It is the layer's own ink
      // as it stood before the knockout, which is what the screen was always meant to
      // follow — and `spec.alpha` is the parameter for it.
      // Pass the halftone parameters explicitly rather than forwarding the
      // whole effect object: the renderer's own `type` key would otherwise ride
      // into the tone operation, where it means nothing.
      //
      // `rampOrigin`/`rampSize` come from the effect's own spec. Tone work
      // happens on a full-canvas buffer, so without an explicit box a coverage
      // ramp is evaluated in canvas coordinates and a panel covering a quarter
      // of the canvas sees only a quarter of its own ramp — which is how a
      // field meant to fade to nothing across its own width stayed at full
      // strength right up to its edge.
      // The screen reads its SILHOUETTE and its SOURCE TONE from the layer as it stood
      // before the knockout. `shapeSource` supplies both, so a `replace` screen
      // follows the original artwork rather than an emptied buffer — which has neither
      // alpha to bound the dots nor luminance to modulate them.
      //
      // Passing it also keeps `respectAlpha` alive. An empty canvas alpha makes
      // `halftoneScreen` conclude there is no silhouette at all and fill the whole
      // buffer, so a `replace` screen on a layer with NO ink used to invent 34% ink
      // out of nothing. Supplying the layer's real alpha means no ink yields no
      // screen, which is what replacing an empty layer should do.
      // `replace` on a layer with NO ink must produce nothing, and it used to invent
      // ink from nothing.
      //
      // The path is subtle. `halftoneScreen` decides whether a silhouette exists from
      // the alpha it receives; an all-zero alpha makes it conclude there is none and
      // it fills the whole buffer regardless — measured at `silhouetteRetained 0.3427`
      // on a fully transparent layer, i.e. 34% ink conjured where the layer had none.
      // Supplying `shapeSource` is not enough on its own, because that alpha is the
      // zero one.
      //
      // So the check is made explicit: if the layer had no ink before the knockout,
      // there is no silhouette to fill and the screen is not drawn at all.
      const hadInk = savedAlpha !== null && (() => {
        for (let i = 0; i < savedAlpha.length; i++) if (savedAlpha[i] > 8) return true
        return false
      })()

      const shapeSource = preKnockout === null ? undefined : preKnockout.data
      const r = savedAlpha !== null && !hadInk
        ? { dots: 0, coverage: 0, maxTone: fx.maxTone, toneSource: 'none' }
        : halftoneScreen(img, {
          cell: fx.cell,
          angle: fx.angle,
          gamma: fx.gamma,
          color: fx.color,
          maxTone: fx.maxTone,
          alpha: fx.alpha,
          shapeSource,
          invert: fx.invert,
          tone: fx.tone,
          toneAngle: fx.toneAngle,
          coverage: fx.coverage,
          rampOrigin: fx.rampOrigin,
          rampSize: fx.rampSize,
        })
      // Coverage of exactly 0 means the field found no tone to act on — a real
      // failure worth surfacing, not a rounding detail.
      result = { type, dots: r.dots, coverage: Number(r.coverage.toFixed(5)), maxTone: r.maxTone, toneSource: r.toneSource }
      // Restore the layer's silhouette OUTSIDE the replaced region, and REPORT how
      // much of the screen the silhouette produced.
      //
      // The alpha channel does two jobs here and they must not be conflated. It is
      // the LAYER'S VISIBLE INK, and it is the SILHOUETTE the screen reads. `replace`
      // wants the first gone and the second intact:
      //
      //   outside the scope   the original ink stays — the effect did not act there
      //   inside the scope    alpha becomes the SCREEN's own coverage, so the flat
      //                       paint is gone and only the dots remain
      //
      // Taking `min(screenAlpha, savedAlpha)` inside the scope — the first version —
      // put the flat plate straight back and hid the dots behind it, which is why a
      // `replace` screen still measured as a solid colour.
      if (savedAlpha !== null) {
        let kept = 0
        for (let i = 0, j = 3; i < savedAlpha.length; i++, j += 4) {
          const k = scopePlane === null ? 1 : scopePlane[i]
          img.data[j] = k * img.data[j] + Math.max(0, 1 - k) * savedAlpha[i]
          if (img.data[j] > 8) kept++
        }
        result = { ...result, replace: true, silhouetteRetained: Number((kept / savedAlpha.length).toFixed(5)) }
      }
    } else if (type === 'duotone') result = { type, ...duotone(img, fx) }
    else result = { type, ...toneWipe(img, fx) }
    writeBuffer(buffer.canvas, img)
    return result
  }


  if (type === 'outline') {
    // Outline by alpha dilation: grow the layer's silhouette and knock out the
    // original, leaving a ring. This is what a真 knockout outline needs and
    // what `strokeText` over a non-flat ground cannot do.
    const w = Math.max(1, Math.round(fx.width === undefined ? 2 : fx.width))
    const grown = pool.acquire(W, H)
    grown.ctx.drawImage(buffer.canvas, 0, 0)
    const dilated = dilateAlpha(readBuffer(grown.canvas), w)
    const col = parseColor(fx.color === undefined ? '#000000' : fx.color)
    const original = readBuffer(buffer.canvas)
    const out = new Uint8ClampedArray(dilated.data.length)
    for (let i = 0; i < dilated.data.length; i += 4) {
      // Ring = dilated minus original coverage.
      const ring = Math.max(0, dilated.data[i + 3] - original.data[i + 3])
      out[i] = col.r
      out[i + 1] = col.g
      out[i + 2] = col.b
      out[i + 3] = ring
    }
    const ringCanvas = pool.acquire(W, H)
    writeBuffer(ringCanvas.canvas, { width: W, height: H, data: out })
    buffer.ctx.clearRect(0, 0, W, H)
    buffer.ctx.drawImage(ringCanvas.canvas, 0, 0)
    if (fx.keepFill !== false) buffer.ctx.drawImage(grown.canvas, 0, 0)
    return { type, width: w }
  }



  throw new Error(`unknown effect "${type}". Layer effects: dropShadow, outerGlow, innerShadow, innerGlow, stroke, colorOverlay, gradientOverlay, patternOverlay, bevel, satin. Filters: gaussian, motion, radial, box, lens. Tone: grain, halftone, duotone, toneWipe, curves, hueSaturation, desaturate. Legacy names shadow/emboss/glow were replaced by dropShadow/bevel/outerGlow`)
}

/**
 * Grow an alpha channel by `radius` (a square structuring element).
 *
 * Two separable passes, which is O(n·r) rather than O(n·r²) and keeps a 12px
 * outline on a full-canvas layer fast enough to iterate on.
 */
function dilateAlpha(img, radius) {
  const { width, height, data } = img
  const tmp = new Uint8ClampedArray(data.length)
  const out = new Uint8ClampedArray(data.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k
        if (xx < 0 || xx >= width) continue
        const a = data[(y * width + xx) * 4 + 3]
        if (a > m) m = a
      }
      const i = (y * width + x) * 4
      tmp[i] = data[i]; tmp[i + 1] = data[i + 1]; tmp[i + 2] = data[i + 2]; tmp[i + 3] = m
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k
        if (yy < 0 || yy >= height) continue
        const a = tmp[(yy * width + x) * 4 + 3]
        if (a > m) m = a
      }
      const i = (y * width + x) * 4
      out[i] = tmp[i]; out[i + 1] = tmp[i + 1]; out[i + 2] = tmp[i + 2]; out[i + 3] = m
    }
  }
  return { width, height, data: out }
}

/**
 * Separable box blur on a single-channel alpha plane.
 *
 * A moving sum rather than a radius loop: a 3x3 box at r=20 is 41 samples per
 * pixel per axis, which on a 2560x1219 canvas is 500 million operations for one
 * effect — too slow to iterate on. The moving sum makes each axis O(n) regardless
 * of radius, so `innerShadow` and `glow` stay in the same budget as `blur`.
 *
 * Two passes approximate a Gaussian closely enough for a soft edge, and the
 * vertical pass runs on a transposed copy so the inner loop stays linear in
 * memory (cache-friendly) rather than striding a full row.
 */
function boxBlurAlpha(src, width, height, radius) {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return src
  const pass = (input, w, h) => {
    const out = new Uint8ClampedArray(w * h)
    const norm = r * 2 + 1
    for (let y = 0; y < h; y++) {
      const row = y * w
      let sum = 0
      for (let k = -r; k <= r; k++) sum += input[row + Math.min(w - 1, Math.max(0, k))]
      for (let x = 0; x < w; x++) {
        out[row + x] = sum / norm
        const add = input[row + Math.min(w - 1, x + r + 1)]
        const sub = input[row + Math.max(0, x - r)]
        sum += add - sub
      }
    }
    return out
  }
  const horizontal = pass(src, width, height)
  // Transpose, blur, transpose back.
  const t = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) t[x * height + y] = horizontal[y * width + x]
  }
  const vertical = pass(t, height, width)
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = vertical[x * height + y]
  }
  return out
}

/** Count layers recursively, for the report. */
function countLayers(layers) {
  let n = 0
  for (const l of layers) {
    n++
    if (l !== null && typeof l === 'object' && l.kind === 'group' && Array.isArray(l.children)) {
      n += countLayers(l.children)
    }
  }
  return n
}

/**
 * The pixel box a shape occupies, for tone operations that must stay inside it.
 *
 * Circles, polygons and paths are bounded by their declared box; `null` means
 * "the whole canvas", which is the correct answer for a background field.
 */
function shapeBox(layer, W, H) {
  if (layer.x === undefined && layer.w === undefined) return null
  const x = Math.max(0, Math.floor(resolveX(layer.x, W, 0)))
  const y = Math.max(0, Math.floor(resolveY(layer.y, H, 0)))
  const w = Math.min(W - x, Math.ceil(resolveLength(layer.w, W, W - x)))
  const h = Math.min(H - y, Math.ceil(resolveLength(layer.h, H, H - y)))
  if (w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

/**
 * Run a tone operation over one box of a context, instead of the whole canvas.
 *
 * Reading and writing a sub-rectangle is what lets a dot screen belong to the
 * shape that generated it. Applied canvas-wide, a screen both spills far outside
 * that shape's geometry and, in `replace` mode, clears everything else already
 * drawn into the layer's buffer.
 *
 * @param {CanvasRenderingContext2D} g
 * @param {object} op
 * @param {{x:number,y:number,w:number,h:number}|null} box
 * @returns {object} a compact record for the render report
 */
function applyToneInBox(g, op, box) {
  const type = op.op === undefined ? op.type : op.op
  const target = box === null
    ? { x: 0, y: 0, w: g.canvas.width, h: g.canvas.height }
    : box

  const id = g.getImageData(target.x, target.y, target.w, target.h)
  const img = { width: target.w, height: target.h, data: id.data }

  if (type === 'halftone') {
    // The screen replaces the shape's fill by default when declared on a shape:
    // a dot screen composited ON TOP of a flat fill can only add ink, so the
    // fill stays solid and the screen is invisible however the tone is tuned.
    if (op.replace !== false) img.data.fill(0)
    const r = halftoneScreen(img, {
      // Ramp coordinates are relative to the shape, because the tone ramp is
      // expressed over the shape's own extent, not the canvas's.
      rampOrigin: [0, 0],
      rampSize: [target.w, target.h],
      ...op,
    })
    g.putImageData(id, target.x, target.y)
    return { dots: r.dots, coverage: Number(r.coverage.toFixed(5)), maxTone: r.maxTone, toneSource: r.toneSource }
  }
  if (type === 'grain') {
    const r = grain(img, op)
    g.putImageData(id, target.x, target.y)
    return { applied: r.applied }
  }
  if (type === 'duotone') {
    duotone(img, op)
    g.putImageData(id, target.x, target.y)
    return { mapped: img.width * img.height }
  }
  if (type === 'toneWipe' || type === 'tone-wipe') {
    toneWipe(img, op)
    g.putImageData(id, target.x, target.y)
    return { applied: img.width * img.height }
  }
  if (type === 'curves') {
    const r = curves(img, op)
    g.putImageData(id, target.x, target.y)
    return { applied: r.applied }
  }
  if (type === 'hueSaturation' || type === 'hue-saturation') {
    const r = hueSaturation(img, op)
    g.putImageData(id, target.x, target.y)
    return { touched: r.touched }
  }
  if (type === 'desaturate') {
    desaturate(img, op.amount)
    g.putImageData(id, target.x, target.y)
    return { amount: op.amount }
  }
  throw new Error(`unknown shape tone op "${type}". Known: halftone, grain, duotone, toneWipe, curves, hueSaturation, desaturate`)
}

function round(v) {
  return Math.round(v * 100) / 100
}

export { BufferPool, round }
