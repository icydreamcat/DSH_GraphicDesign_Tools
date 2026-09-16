/**
 * Reference analysis: turning a picture into a specification.
 *
 * THE POINT OF THIS MODULE
 * ------------------------
 * The previous attempt's stated hard limit was:
 *
 *   > I could not give "good-looking numbers", because I did not know what the
 *   > good-looking values were. The reference's halftone dot radius, grid
 *   > pitch, accent-colour share, luminance band — I estimated all of it.
 *
 * and its summary of what a designer's analysis should output instead:
 *
 *   WRONG: "this image has halftone, olive green, geometric elements,
 *           monospace labels"
 *   RIGHT: "ground luminance 96%; halftone only in x∈[0.3,0.6] at 22%,
 *           fading out; accent colour share 3.2%; 7 geometric elements at mean
 *           opacity 18%, largest edge 4% of canvas; grid pitch 24px covering
 *           40% of the canvas; body 15px, headline 54px; zero fully-rounded
 *           corners; hairlines uniformly 1px"
 *
 * This module produces the second kind. Every number it reports is measured
 * from pixels, and nothing is inferred from a caption or a guess. That is the
 * difference between an agent that copies a look and one that can rebuild it.
 *
 * WHY SEGMENTATION IS BANDED, NOT K-MEANS
 * ---------------------------------------
 * The obvious approach — k-means the palette and report cluster shares — gives
 * numbers that feel precise and are actively misleading for design work,
 * because it merges the accent colour into the nearest background cluster when
 * the accent is 3% of the frame, which is exactly the case that matters. This
 * module instead reports an explicit **luminance histogram with spatial
 * moments**, plus a separate saturation-based accent search. The accent colour
 * in a designed poster is almost always the most saturated thing present, not
 * the most common, so finding it by chroma is both simpler and more faithful.
 *
 * Space matters as much as amount. "Halftone 22% coverage" is not a
 * specification; "halftone present at 22% in the left third and zero in the
 * right third" is. Every field-level statistic here therefore comes with the
 * x/y extent over which it holds, which is the information that was missing.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { relativeLuminance, rgbToHex, contrastRatio } from './color.mjs'
import { rgbToHsl } from './tone.mjs'

/**
 * Load an image into a plain pixel buffer.
 *
 * @param {string} src
 * @param {{baseDir?: string, maxSide?: number}} [options]
 * @returns {Promise<{width:number, height:number, data:Uint8ClampedArray, path:string, scaled:boolean}>}
 */
export async function loadPixels(src, options = {}) {
  const baseDir = options.baseDir === undefined ? process.cwd() : options.baseDir
  const path = isAbsolute(src) ? src : resolve(baseDir, src)
  if (!existsSync(path)) throw new Error(`image not found: ${path}`)
  const img = await loadImage(path)

  // Analysis at full resolution is wasteful for a 6000px scan and can make the
  // histogram dominated by JPEG noise. Downscaling to a bounded side keeps the
  // statistics stable while staying well above the feature scale being
  // measured — a 24px grid pitch is still resolved at 1600px side.
  const maxSide = options.maxSide === undefined ? 1600 : options.maxSide
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  const imgData = ctx.getImageData(0, 0, w, h)
  return {
    width: w,
    height: h,
    data: imgData.data,
    path,
    sourceSize: { width: img.width, height: img.height },
    scaled: scale < 1,
  }
}

/**
 * Luminance histogram over perceptual (relative-luminance) bins.
 *
 * Relative luminance rather than a channel average, because the question being
 * asked is "how light does this read", and pure blue reads far darker than its
 * channel average suggests.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {number} bins
 * @returns {{bins:number[], edges:number[], mean:number, p05:number, p50:number, p95:number, dynamicRange:number}}
 */
export function luminanceHistogram(img, bins = 32) {
  const hist = new Array(bins).fill(0)
  const values = []
  const skipAlpha = img.data.length > 4
  for (let i = 0; i < img.data.length; i += 4) {
    // A transparent source pixel is not a dark pixel; counting it as one is
    // what makes a cut-out PNG analyse as if it had a black background.
    if (skipAlpha && img.data[i + 3] < 8) continue
    const lum = relativeLuminance({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] })
    values.push(lum)
    const b = Math.min(bins - 1, Math.floor(lum * bins))
    hist[b]++
  }
  values.sort((a, b) => a - b)
  const n = values.length
  const pct = (p) => (n === 0 ? 0 : values[Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)))])
  const mean = n === 0 ? 0 : values.reduce((a, b) => a + b, 0) / n
  const p05 = pct(0.05)
  const p95 = pct(0.95)
  return {
    bins: hist.map((c) => (n === 0 ? 0 : c / n)),
    edges: Array.from({ length: bins + 1 }, (_, i) => i / bins),
    mean,
    p05,
    p50: pct(0.5),
    p95,
    // The band that 90% of the image occupies. A designed surface usually sits
    // in a much narrower band than a photograph; reporting it is how "the
    // reference keeps its tonality in a tight range" becomes checkable.
    dynamicRange: p95 - p05,
  }
}

/**
 * How much of a region is ONE flat colour, and how many colours it distinguishes.
 *
 * WHY THESE TWO NUMBERS EXIST
 * ---------------------------
 * The cheapest way to make a layout measure "the same" as a reference is to match its
 * AREA: the reference gives 42% of the canvas to a region, so a 42%-sized block goes
 * there. The area matches and the design is zero, because the reference's 42% was not a
 * colour — it was an organised surface with internal hierarchy. A fill was substituted
 * for an organisation, and nothing in a flat area measurement can see the difference.
 *
 * These two statistics separate them directly:
 *   dominantFlatShare — the most frequent single colour, as a share of the region.
 *   distinctColours   — how many different colours appear in it.
 *
 * Measured anchors (a shipped design language's UI surfaces): dominant flat 3.0%-20.8%
 * and 188-7032 colours. A block reads 42.8%/327 and 87.6%/191; a designed surface reads
 * 3.5%/234. The threshold used by the rule is dominant flat < 25%.
 *
 * QUANTISATION IS 5 BITS PER CHANNEL, deliberately, to match findAccents(). Raw 8-bit
 * RGB counts are dominated by antialiasing: every glyph edge invents colours, so a
 * region holding one line of text would score thousands of "distinct colours" without
 * being organised. Quantising measures the same thing at the scale a reader sees. The
 * consequence to remember when comparing against a figure from elsewhere: a raw-RGB
 * count will come out higher than these.
 *
 * Fully transparent pixels are excluded — a transparent region is not a designed surface.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{x:number,y:number,w:number,h:number}} region - fractional, 0..1
 * @returns {{dominantFlatShare:number, distinctColours:number, opaquePixels:number}}
 */
export function regionFlatness(img, region) {
  const x0 = Math.max(0, Math.floor(region.x * img.width))
  const y0 = Math.max(0, Math.floor(region.y * img.height))
  const x1 = Math.min(img.width, Math.ceil((region.x + region.w) * img.width))
  const y1 = Math.min(img.height, Math.ceil((region.y + region.h) * img.height))

  const counts = new Map()
  let opaque = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4
      if (img.data[i + 3] < 8) continue
      opaque++
      const key = ((img.data[i] >> 3) << 10) | ((img.data[i + 1] >> 3) << 5) | (img.data[i + 2] >> 3)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  if (opaque === 0) return { dominantFlatShare: 0, distinctColours: 0, opaquePixels: 0 }

  let top = 0
  for (const n of counts.values()) if (n > top) top = n
  return {
    dominantFlatShare: round3(top / opaque),
    distinctColours: counts.size,
    opaquePixels: opaque,
  }
}


/**
 * Find the accent colours: the most chromatic pixels, not the most common.
 *
 * A NOTE ON WHAT "ACCENT" MEANS HERE
 * ----------------------------------
 * A naive chromatic-share figure is misleading on any reference that contains
 * an illustration. Measuring the actual reference for this project gives a
 * chromatic share of 21%, which looks like a violation of the "accent ≤5%"
 * rule — but almost all of it is watercolour: skin, hair, foliage. The rule is
 * about *designed* colour, and the illustration is content, not design.
 *
 * Separating them needs a signal that distinguishes flat vector marks from
 * rendered artwork. The one used here is **colour count**: a designed accent is
 * a flat fill, so it concentrates in very few distinct colours, whereas an
 * illustration spreads continuously across the gamut. So this reports both:
 *   * `accentShare` — all chromatic pixels, illustration included.
 *   * `flatAccentShare` — chromatic pixels belonging to a colour that occupies
 *     a large, tightly-clustered area, i.e. a flat fill.
 * and the colour histogram quantised to 5 bits per channel is what makes "flat"
 * measurable at all.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{minSaturation?: number, minLightness?: number, maxLightness?: number, clusters?: number, flatThreshold?: number}} [options]
 * @returns {{accentShare:number, flatAccentShare:number, flatColors:object[], clusters:object[], mostChromatic:object|null}}
 */
export function findAccents(img, options = {}) {
  const minSat = options.minSaturation === undefined ? 0.18 : options.minSaturation
  const minL = options.minLightness === undefined ? 0.08 : options.minLightness
  const maxL = options.maxLightness === undefined ? 0.94 : options.maxLightness
  const wantClusters = options.clusters === undefined ? 4 : options.clusters
  // A designed flat fill occupies enough of the frame to be a deliberate mark.
  const flatThreshold = options.flatThreshold === undefined ? 0.004 : options.flatThreshold

  const px = []
  let total = 0
  // Quantise to 5 bits per channel: fine enough to keep two nearby olive tones
  // apart, coarse enough that a smooth gradient or a rendered illustration
  // spreads across many buckets instead of collapsing into one.
  const quant = new Map()

  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 8) continue
    total++
    const hsl = rgbToHsl(img.data[i], img.data[i + 1], img.data[i + 2])
    if (hsl.s < minSat || hsl.l < minL || hsl.l > maxL) continue
    px.push({ h: hsl.h, s: hsl.s, l: hsl.l, r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] })
    const key = ((img.data[i] >> 3) << 10) | ((img.data[i + 1] >> 3) << 5) | (img.data[i + 2] >> 3)
    const bucket = quant.get(key)
    if (bucket === undefined) {
      quant.set(key, { n: 1, r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] })
    } else {
      bucket.n++
    }
  }

  if (px.length === 0) {
    return { accentShare: 0, flatAccentShare: 0, flatColors: [], clusters: [], mostChromatic: null }
  }

  // Flat accents: a quantised colour covering at least `flatThreshold` of the
  // frame. Illustrations rarely produce one; flat design fills almost always do.
  const flatColors = [...quant.entries()]
    .map(([, v]) => ({
      hex: rgbToHex({ r: v.r, g: v.g, b: v.b }),
      pixels: v.n,
      share: v.n / total,
    }))
    .filter((c) => c.share >= flatThreshold)
    .sort((a, b) => b.share - a.share)
    .slice(0, 12)

  const flatAccentShare = flatColors.reduce((acc, c) => acc + c.share, 0)

  // Cluster on hue only. Saturation and lightness within one accent colour
  // vary legitimately (a gradient, an anti-aliased edge, a shadowed fold) and
  // clustering on them would split one colour into several.
  const buckets = new Array(36).fill(0)
  for (const p of px) buckets[Math.min(35, Math.floor(p.h / 10))]++
  const clusters = []
  for (let b = 0; b < 36; b++) {
    if (buckets[b] === 0) continue
    const group = px.filter((p) => Math.min(35, Math.floor(p.h / 10)) === b)
    const meanH = group.reduce((a, p) => a + p.h, 0) / group.length
    const meanS = group.reduce((a, p) => a + p.s, 0) / group.length
    const meanL = group.reduce((a, p) => a + p.l, 0) / group.length
    const mr = group.reduce((a, p) => a + p.r, 0) / group.length
    const mg = group.reduce((a, p) => a + p.g, 0) / group.length
    const mb = group.reduce((a, p) => a + p.b, 0) / group.length
    clusters.push({
      hue: Math.round(meanH),
      saturation: round3(meanS),
      lightness: round3(meanL),
      hex: rgbToHex({ r: mr, g: mg, b: mb }),
      pixels: group.length,
      share: group.length / total,
    })
  }
  clusters.sort((a, b) => b.pixels - a.pixels)

  const mostChromatic = px.reduce((best, p) => (p.s > best.s ? p : best), px[0])
  return {
    accentShare: px.length / total,
    flatAccentShare,
    flatColors,
    clusters: clusters.slice(0, wantClusters),
    mostChromatic: {
      hex: rgbToHex(mostChromatic),
      hue: Math.round(mostChromatic.h),
      saturation: round3(mostChromatic.s),
      lightness: round3(mostChromatic.l),
    },
  }
}

/**
 * Divide the canvas into a grid of cells and characterise each.
 *
 * This is what turns "the halftone fades out to the left" into "halftone
 * coverage by cell". A designer reads a layout as zones; a single global
 * average destroys that information, and losing it is precisely what made the
 * previous attempt cover the whole canvas uniformly.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{cols?: number, rows?: number}} [options]
 * @returns {{cols:number, rows:number, cells:object[]}}
 */
export function spatialGrid(img, options = {}) {
  const cols = options.cols === undefined ? 8 : options.cols
  const rows = options.rows === undefined ? 5 : options.rows
  const { width, height, data } = img
  const cells = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * width) / cols)
      const x1 = Math.floor(((c + 1) * width) / cols)
      const y0 = Math.floor((r * height) / rows)
      const y1 = Math.floor(((r + 1) * height) / rows)
      let lumSum = 0
      let satSum = 0
      let n = 0
      let edgeSum = 0
      let edgeCount = 0
      const lumOf = (x, y) => {
        const i = (y * width + x) * 4
        return relativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] })
      }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          if (data[i + 3] < 8) continue
          lumSum += relativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] })
          satSum += rgbToHsl(data[i], data[i + 1], data[i + 2]).s
          n++
          // Local detail = mean absolute luminance gradient inside the cell.
          // This is the per-cell measurement of "how much visual event is
          // here", and it is what locates a texture or a rule field.
          if (x + 1 < x1 && y + 1 < y1) {
            edgeSum += Math.abs(lumOf(x, y) - lumOf(x + 1, y)) + Math.abs(lumOf(x, y) - lumOf(x, y + 1))
            edgeCount += 2
          }
        }
      }
      cells.push({
        col: c,
        row: r,
        x: round3(c / cols),
        y: round3(r / rows),
        w: round3(1 / cols),
        h: round3(1 / rows),
        meanLuma: n === 0 ? 0 : round3(lumSum / n),
        meanSaturation: n === 0 ? 0 : round3(satSum / n),
        detail: edgeCount === 0 ? 0 : round3(edgeSum / edgeCount),
      })
    }
  }
  return { cols, rows, cells }
}

/**
 * Estimate the layout grid pitch from LINE density, not from raw tone.
 *
 * WHY NOT AUTOCORRELATE THE TONE PROFILE
 * --------------------------------------
 * The obvious implementation — autocorrelate the column-mean luminance — does
 * not measure a layout grid at all on this visual language. Measured on the
 * actual reference for this project it reported a confident 6px pitch, which is
 * the period of the *halftone dot screen*, not of any layout division. A dot
 * field is periodic in tone, so tone autocorrelation locks onto it immediately,
 * and a 6px "layout grid" is not actionable design information.
 *
 * A layout grid is made of lines, and lines have a property a dot screen does
 * not: they are locally much darker than their surroundings along their whole
 * length. So the profile used here is **line density** — for each row, how many
 * pixels are darker than their vertical neighbours by more than a threshold.
 * A horizontal rule lights up one row hard; a halftone contributes roughly
 * evenly to every row and therefore produces a nearly flat profile with no
 * periodicity to find.
 *
 * The threshold is deliberately relative to the local neighbourhood rather than
 * absolute, so the detector works on a light ground and a dark one alike.
 *
 * Returns `null` pitch when nothing stands out, which is the honest answer for
 * an organic image and is better than inventing a number.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{threshold?: number, minLag?: number}} [options]
 * @returns {{columnPitch:number|null, rowPitch:number|null, columnStrength:number, rowStrength:number, columnLineShare:number, rowLineShare:number}}
 */
export function estimateGrid(img, options = {}) {
  const threshold = options.threshold === undefined ? 0.06 : options.threshold
  // 12, not 24: the reference's own layout grid measures a 35px column pitch, so
  // a floor of 24 was close enough to the true answer that the detector's
  // verdict flipped between runs on the same image — which makes the metric
  // useless for comparing two iterations of a design, the one thing it exists
  // for.
  const minLag = options.minLag === undefined ? 12 : options.minLag
  const { width, height, data } = img

  const lumAt = (x, y) => {
    const i = (y * width + x) * 4
    return relativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] })
  }

  // Horizontal rules -> a peak in the row profile. A pixel counts as "line ink"
  // when it is clearly darker than the pixels above and below it, which is what
  // distinguishes a 1px rule from a 40px dark block or a halftone dot.
  const rowProfile = new Float64Array(height)
  for (let y = 1; y < height - 1; y++) {
    let count = 0
    for (let x = 0; x < width; x++) {
      const c = lumAt(x, y)
      const up = lumAt(x, y - 1)
      const dn = lumAt(x, y + 1)
      if (up - c > threshold && dn - c > threshold) count++
    }
    rowProfile[y] = count / width
  }

  // Vertical rules -> the same transposed.
  const colProfile = new Float64Array(width)
  for (let x = 1; x < width - 1; x++) {
    let count = 0
    for (let y = 0; y < height; y++) {
      const c = lumAt(x, y)
      const lf = lumAt(x - 1, y)
      const rt = lumAt(x + 1, y)
      if (lf - c > threshold && rt - c > threshold) count++
    }
    colProfile[x] = count / height
  }

  const analyse = (profile) => {
    const n = profile.length
    const mean = profile.reduce((a, b) => a + b, 0) / n
    const peak = Math.max(...profile)
    const totalInk = mean
    // Guards against reporting a dot screen or a photograph as a grid.
    //
    // Calibrated against measured values: the reference's real layout grid
    // produces a peak line score of 0.278, while the attempt that had no grid at
    // all — its rules were too short and broken to be lines — peaks at 0.094.
    // 0.15 sits between them, so the reference and a design with genuine rules
    // pass while a page of scattered marks does not. A real rule crosses most of
    // its axis; a halftone spreads ink evenly; short broken marks exist in the
    // hundreds but each covers almost nothing, which is what the total-ink
    // floor rejects.
    if (peak < 0.15 || totalInk < 0.0008) {
      return { pitch: null, strength: 0, lineShare: round4(mean), peak: round4(peak) }
    }

    const centred = Float64Array.from(profile, (v) => v - mean)
    let variance = 0
    for (const v of centred) variance += v * v
    variance /= n
    if (variance < 1e-10) return { pitch: null, strength: 0, lineShare: round4(mean), peak: round4(peak) }

    let bestLag = 0
    let bestScore = 0
    const maxLag = Math.min(Math.floor(n / 3), 600)
    for (let lag = minLag; lag <= maxLag; lag++) {
      let acc = 0
      for (let i = 0; i + lag < n; i++) acc += centred[i] * centred[i + lag]
      acc /= n - lag
      const normalised = acc / variance
      if (normalised > bestScore) {
        bestScore = normalised
        bestLag = lag
      }
    }
    if (bestScore < 0.45) return { pitch: null, strength: round3(bestScore), lineShare: round4(mean), peak: round4(peak) }
    return { pitch: bestLag, strength: round3(bestScore), lineShare: round4(mean), peak: round4(peak) }
  }

  const col = analyse(colProfile)
  const row = analyse(rowProfile)
  return {
    columnPitch: col.pitch,
    rowPitch: row.pitch,
    columnStrength: col.strength,
    rowStrength: row.strength,
    columnLineShare: col.lineShare,
    rowLineShare: row.lineShare,
    columnPeak: col.peak,
    rowPeak: row.peak,
    columnPitchFraction: col.pitch === null ? null : round3(col.pitch / width),
    rowPitchFraction: row.pitch === null ? null : round3(row.pitch / height),
  }
}

/**
 * Detect ink: connected regions of "not the ground", with their geometry.
 *
 * This is how the element count, their sizes as a fraction of the canvas, and
 * their mean opacity become measurable. The opacity estimate uses the region's
 * mean luminance distance from the ground, which is a reasonable proxy for a
 * flat translucent mark and is what makes "elements 7, mean opacity 18%" (the
 * reference's actual specification) a number rather than an impression.
 *
 * Uses iterative flood fill with an explicit stack: a recursive fill blows the
 * JS stack on a large connected region, which is the common case here.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{tolerance?: number, minArea?: number, maxRegions?: number}} [options]
 * @returns {{ground:object, regions:object[], elementCount:number}}
 */
export function detectElements(img, options = {}) {
  const tolerance = options.tolerance === undefined ? 0.06 : options.tolerance
  // A designed region is a deliberate mark, not a texture cell. Keeping the
  // floor at a small fraction of the canvas means the count reflects how much
  // *structure* is present — which is the whole point, since the reference
  // language's character comes from the number of small deliberate marks. Set
  // it too high and a genuinely rich layout reports as sparse; set it to zero
  // and every dot of a halftone screen counts as an element. 0.02% of the
  // canvas is about a 40px mark at 1200x675.
  const minArea = options.minArea === undefined
    ? Math.max(12, Math.round(img.width * img.height * 0.0002))
    : options.minArea
  const maxRegions = options.maxRegions === undefined ? 60 : options.maxRegions
  const { width, height, data } = img

  // Ground = modal luminance band. Using the mode rather than the mean keeps a
  // large dark illustration from dragging the assumed ground toward itself.
  const hist = luminanceHistogram(img, 32)
  let modeBin = 0
  for (let i = 1; i < hist.bins.length; i++) if (hist.bins[i] > hist.bins[modeBin]) modeBin = i
  const groundLuma = (modeBin + 0.5) / hist.bins.length

  const visited = new Uint8Array(width * height)
  const regions = []
  const lumAt = (idx) => relativeLuminance({ r: data[idx * 4], g: data[idx * 4 + 1], b: data[idx * 4 + 2] })

  for (let sy = 0; sy < height; sy += 1) {
    for (let sx = 0; sx < width; sx += 1) {
      const start = sy * width + sx
      if (visited[start] === 1) continue
      if (Math.abs(lumAt(start) - groundLuma) < tolerance) { visited[start] = 1; continue }

      const stack = [start]
      visited[start] = 1
      let count = 0
      let minX = sx, maxX = sx, minY = sy, maxY = sy
      let lumSum = 0
      while (stack.length > 0) {
        const idx = stack.pop()
        const x = idx % width
        const y = (idx - x) / width
        count++
        lumSum += lumAt(idx)
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        const neighbours = [
          x > 0 ? idx - 1 : -1,
          x < width - 1 ? idx + 1 : -1,
          y > 0 ? idx - width : -1,
          y < height - 1 ? idx + width : -1,
        ]
        for (const nIdx of neighbours) {
          if (nIdx < 0 || visited[nIdx] === 1) continue
          if (Math.abs(lumAt(nIdx) - groundLuma) < tolerance) { visited[nIdx] = 1; continue }
          visited[nIdx] = 1
          stack.push(nIdx)
        }
      }

      if (count < minArea) continue
      const meanLum = lumSum / count
      // Opacity proxy: how far this region's tone sits from the ground,
      // normalised by the maximum possible distance in that direction.
      const denom = meanLum > groundLuma ? Math.max(1e-6, 1 - groundLuma) : Math.max(1e-6, groundLuma)
      regions.push({
        x: round3(minX / width),
        y: round3(minY / height),
        w: round3((maxX - minX + 1) / width),
        h: round3((maxY - minY + 1) / height),
        pixels: count,
        areaShare: round3(count / (width * height)),
        meanLuma: round3(meanLum),
        impliedOpacity: round3(Math.min(1, Math.abs(meanLum - groundLuma) / denom)),
        aspect: round3((maxX - minX + 1) / Math.max(1, maxY - minY + 1)),
      })
      if (regions.length >= maxRegions) break
    }
    if (regions.length >= maxRegions) break
  }

  regions.sort((a, b) => b.pixels - a.pixels)
  return {
    ground: { luminance: round3(groundLuma), hex: null },
    regions,
    elementCount: regions.length,
  }
}

/**
 * Estimate stroke weights of the hairlines present.
 *
 * Hairlines are the backbone of this visual language, and "1px uniformly" is a
 * specification. Measuring the run-length distribution of ink across the
 * luminance profile gives it.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{threshold?: number}} [options]
 * @returns {{weights:number[], median:number|null, share1px:number}}
 */
export function estimateStrokeWeights(img, options = {}) {
  const threshold = options.threshold === undefined ? 0.05 : options.threshold
  const { width, height, data } = img
  const runs = []

  // Horizontal scan: count contiguous runs of "darker than the local ground".
  for (let y = 0; y < height; y += 3) {
    let run = 0
    let prevLum = null
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const lum = relativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] })
      const isInk = prevLum !== null && Math.abs(lum - prevLum) > threshold
      if (isInk) run++
      else {
        if (run > 0) runs.push(run)
        run = 0
      }
      prevLum = lum
    }
    if (run > 0) runs.push(run)
  }

  if (runs.length === 0) return { weights: [], median: null, share1px: 0 }
  runs.sort((a, b) => a - b)
  // Count of runs, not of pixels: a hairline is one run per crossing, so this
  // measures how often each weight occurs rather than how much ink it covers.
  const counts = new Map()
  for (const r of runs) counts.set(r, (counts.get(r) || 0) + 1)
  const weights = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([weight, count]) => ({ weight, count, share: round3(count / runs.length) }))
  return {
    weights,
    median: runs[Math.floor(runs.length / 2)],
    share1px: round3((counts.get(1) || 0) / runs.length),
  }
}

/**
 * The full specification report for one reference image.
 *
 * This is the tool an agent should call before designing anything: it converts
 * a picture it can only see into numbers it can act on.
 *
 * @param {string} src
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function analyseReference(src, options = {}) {
  const img = await loadPixels(src, options)
  const lum = luminanceHistogram(img, options.bins === undefined ? 32 : options.bins)
  const accents = findAccents(img, options)
  const grid = estimateGrid(img)
  const elements = detectElements(img, options)
  const strokes = estimateStrokeWeights(img)
  const cells = spatialGrid(img, {
    cols: options.cols === undefined ? 8 : options.cols,
    rows: options.rows === undefined ? 5 : options.rows,
  })

  // Contrast between the ground and the most distinct region present, which is
  // what decides whether the design reads at a glance at 25% zoom.
  const lightest = elements.regions.reduce((a, r) => (r.meanLuma > (a === null ? -1 : a.meanLuma) ? r : a), null)
  const darkest = elements.regions.reduce((a, r) => (r.meanLuma < (a === null ? 2 : a.meanLuma) ? r : a), null)
  const groundHex = rgbToHex(luminanceToRgb(lum.mean))

  return {
    source: img.path,
    analysisSize: { width: img.width, height: img.height },
    sourceSize: img.sourceSize,
    scaled: img.scaled,
    tone: {
      groundLuminance: round3(lum.mean),
      groundHex,
      p05: round3(lum.p05),
      p50: round3(lum.p50),
      p95: round3(lum.p95),
      // The width of the band holding 90% of the image. Narrow means the
      // reference is deliberately低对比 — the "high frequency low contrast"
      // signature — and is the single most useful number here.
      dynamicRange: round3(lum.dynamicRange),
      histogram: lum.bins.map(round3),
    },
    accent: {
      // All chromatic pixels, illustration included. Useful as a raw figure but
      // NOT the number the "accent ≤5%" rule constrains.
      share: round3(accents.accentShare),
      // Chromatic pixels belonging to large flat fills — this is the one that
      // corresponds to designed colour, and the one the rule should be read
      // against.
      flatShare: round3(accents.flatAccentShare),
      flatColors: accents.flatColors,
      clusters: accents.clusters,
      mostChromatic: accents.mostChromatic,
      note: 'share counts every chromatic pixel including illustration; flatShare counts only large flat fills, which is what a designed accent is',
    },
    grid,
    structure: {
      elementCount: elements.elementCount,
      groundLuminance: elements.ground.luminance,
      // Each region carries dominantFlatShare and distinctColours, so "is this large area
      // an organised surface or a filled block" is answerable per region rather than only
      // for the whole frame. See regionFlatness() for why those two numbers exist.
      regions: elements.regions.slice(0, 24).map((r) => ({ ...r, ...regionFlatness(img, r) })),
      strokeWeights: strokes.weights,
      strokeMedian: strokes.median,
      hairlineShare: strokes.share1px,
    },
    spatial: cells,
    contrast: {
      groundToDarkest: darkest === null ? null : round3(contrastRatio(groundHex, rgbToHex(luminanceToRgb(darkest.meanLuma)))),
      groundToLightest: lightest === null ? null : round3(contrastRatio(groundHex, rgbToHex(luminanceToRgb(lightest.meanLuma)))),
    },
  }
}

/**
 * A grey RGB triple at a given relative luminance.
 *
 * Deliberately approximate: inverting the sRGB transfer function exactly needs
 * a search, and for reporting a swatch or a contrast ratio the error is far
 * below what matters.
 */
function luminanceToRgb(lum) {
  const c = Math.pow(Math.max(0, Math.min(1, lum)), 1 / 2.2) * 255
  return { r: c, g: c, b: c }
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}

/** Four decimals, for figures whose useful signal is well below 0.001. */
function round4(v) {
  return Math.round(v * 10000) / 10000
}
