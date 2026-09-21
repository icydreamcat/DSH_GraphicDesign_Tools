/**
 * Temporary probe 2: analytic ground truth + a hunt for cases where SSAA
 * genuinely reduces blend pixels. Not a suite.
 */
import { renderScene, readBuffer } from '../src/render.mjs'

function downsample(img, f) {
  const outW = Math.floor(img.width / f)
  const outH = Math.floor(img.height / f)
  const out = new Uint8ClampedArray(outW * outH * 4)
  const n = f * f
  const d = img.data
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let a = 0, r = 0, g = 0, b = 0
      for (let sy = 0; sy < f; sy++) {
        let i = ((y * f + sy) * img.width + x * f) * 4
        for (let sx = 0; sx < f; sx++, i += 4) {
          const av = d[i + 3]
          a += av
          r += d[i] * av
          g += d[i + 1] * av
          b += d[i + 2] * av
        }
      }
      const o = (y * outW + x) * 4
      out[o + 3] = a / n
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a }
    }
  }
  return { width: outW, height: outH, data: out }
}

// ink coverage 0..1 per pixel, from a black-on-white render
function coverage(img) {
  const out = new Float64Array(img.width * img.height)
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    const a = img.data[i + 3] / 255
    out[p] = a * (1 - img.data[i] / 255)
    if (out[p] < 1e-6) out[p] = 0
    if (out[p] > 1 - 1e-6) out[p] = 1
  }
  return out
}

function intermediate(img) {
  const c = coverage(img)
  let n = 0
  for (const v of c) if (v > 0.5 / 255 && v < 1 - 0.5 / 255) n++
  return n
}

/**
 * The scale factor to render a probe scene at, applied by hand: canvas x f and
 * absolute lengths x f. Fractions are left alone (they are canvas fractions).
 * `d` strings are scaled too, since the real implementation must.
 */
function scaleProbe(scene, f) {
  const s = JSON.parse(JSON.stringify(scene))
  s.canvas = { width: s.canvas.width * f, height: s.canvas.height * f }
  const abs = (v) => (v >= 0 && v <= 1 ? v : v * f)
  const walk = (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2', 'originX', 'originY'].includes(k)) o[k] = abs(v)
      else if (typeof v === 'number' && ['width', 'size', 'radius', 'cell'].includes(k)) o[k] = v * f
      else if (typeof v === 'string' && k === 'd') { /* handled by the real scaler; probe avoids paths */ }
      else if (Array.isArray(v)) { for (const e of v) if (e !== null && typeof e === 'object') walk(e) }
      else if (v !== null && typeof v === 'object') walk(v)
    }
  }
  walk(s)
  return s
}

const W = 200
const H = 200

async function shoot(layers, f) {
  const scene = { canvas: { width: W, height: H }, ground: '#FFFFFF', layers }
  const work = f === 1 ? scene : scaleProbe(scene, f)
  const { canvas } = await renderScene(work)
  const img = readBuffer(canvas)
  return f === 1 ? img : downsample(img, f)
}

// ── 1. hunt: does any natural hard-edged shape lose blend pixels at 3x? ─────
console.log('=== intermediate (blend) pixel counts, 1x vs 3x ===')
const trials = {
  'rect @ .0  ': [{ shape: 'rect', x: 20, y: 20, w: 60, h: 40, paint: '#000000' }],
  'rect @ .25 ': [{ shape: 'rect', x: 20.25, y: 20.25, w: 60.4, h: 40.4, paint: '#000000' }],
  'rect @ .5  ': [{ shape: 'rect', x: 20.5, y: 20.5, w: 60.5, h: 40.5, paint: '#000000' }],
  'rect @ .75 ': [{ shape: 'rect', x: 20.75, y: 20.75, w: 60.3, h: 40.3, paint: '#000000' }],
  'rect @ 1/3 ': [{ shape: 'rect', x: 20.3333, y: 20.3333, w: 60.3333, h: 40.3333, paint: '#000000' }],
  'rect @ 2/3 ': [{ shape: 'rect', x: 20.6667, y: 20.6667, w: 60.6667, h: 40.6667, paint: '#000000' }],
  'rect tiny  ': [{ shape: 'rect', x: 20.4, y: 20.4, w: 3.3, h: 3.3, paint: '#000000' }],
  'circ r=6   ': [{ shape: 'ellipse', x: 40.5, y: 40.25, w: 11.5, h: 11.5, paint: '#000000' }],
  'circ r=40  ': [{ shape: 'ellipse', x: 40.5, y: 40.25, w: 79.5, h: 79.5, paint: '#000000' }],
  'line 45deg ': [{ shape: 'line', x1: 20, y1: 20, x2: 180, y2: 180, width: 3, paint: '#000000' }],
  'line 5deg  ': [{ shape: 'line', x1: 20, y1: 90.4, x2: 180, y2: 104.6, width: 2, paint: '#000000' }],
  'line 1px   ': [{ shape: 'line', x1: 20, y1: 90.4, x2: 180, y2: 104.6, width: 1, paint: '#000000' }],
  'rot rect 7d': [{ shape: 'rect', x: 40, y: 60, w: 120, h: 4, paint: '#000000', transform: { rotate: 7, originX: 40, originY: 60 } }],
  'dashed 45d ': [{ shape: 'line', x1: 20, y1: 20, x2: 180, y2: 180, width: 4, dash: [9, 5], paint: '#000000' }],
  'polygon    ': [{ shape: 'polygon', points: [[30.4, 160.2], [100.3, 30.7], [170.6, 150.4]], paint: '#000000' }],
}
for (const [name, layers] of Object.entries(trials)) {
  const one = await shoot(layers, 1)
  const three = await shoot(layers, 3)
  const a = intermediate(one)
  const b = intermediate(three)
  console.log(`  ${name}  1x=${String(a).padStart(5)}  3x=${String(b).padStart(5)}  ${b < a ? 'FEWER' : b === a ? 'same' : 'more'}  (${((b - a) / Math.max(1, a) * 100).toFixed(1)}%)`)
}

// ── 2. analytic ground truth: exact circle coverage, no rasteriser involved ──
function circleCoverage(W2, H2, cx, cy, r, sub = 32) {
  const out = new Float64Array(W2 * H2)
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      let inside = 0
      for (let sy = 0; sy < sub; sy++) {
        const py = y + (sy + 0.5) / sub
        for (let sx = 0; sx < sub; sx++) {
          const px = x + (sx + 0.5) / sub
          const dx = px - cx, dy = py - cy
          if (dx * dx + dy * dy <= r * r) inside++
        }
      }
      out[y * W2 + x] = inside / (sub * sub)
    }
  }
  return out
}

console.log('\n=== circle: error against the exact analytic area coverage ===')
for (const [label, x, y, d] of [['r=6 ', 40.5, 40.25, 11.5], ['r=40', 40.5, 40.25, 79.5], ['r=2.5', 40.3, 40.7, 5]]) {
  const truth = circleCoverage(W, H, x + d / 2, y + d / 2, d / 2)
  const line = []
  for (const f of [1, 2, 3, 4]) {
    const img = await shoot([{ shape: 'ellipse', x, y, w: d, h: d, paint: '#000000' }], f)
    const c = coverage(img)
    let sum = 0, max = 0, over10 = 0, over25 = 0
    for (let i = 0; i < truth.length; i++) {
      const e = Math.abs(c[i] - truth[i])
      sum += e
      if (e > max) max = e
      if (e > 0.1) over10++
      if (e > 0.25) over25++
    }
    line.push(`${f}x: mean=${(sum / truth.length * 255).toFixed(3)} max=${(max * 255).toFixed(1)} px>10%=${over10} px>25%=${over25}`)
  }
  console.log(`  ${label}`)
  for (const l of line) console.log(`      ${l}`)
}

// ── 3. the wire: per-column ink thickness variation (a "gear-toothed band") ──
console.log('\n=== shallow wire: variation of inked thickness column to column ===')
{
  const layers = [{ shape: 'line', x1: 20, y1: 90.4, x2: 180, y2: 104.6, width: 2, paint: '#000000' }]
  for (const f of [1, 2, 3, 4]) {
    const img = await shoot(layers, f)
    const c = coverage(img)
    const vals = []
    for (let x = 25; x < 175; x++) {
      let s = 0
      for (let y = 80; y < 120; y++) s += c[y * W + x]
      vals.push(s)
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
    const maxdev = Math.max(...vals.map((v) => Math.abs(v - mean)))
    console.log(`  ${f}x  mean thickness=${mean.toFixed(4)}px  sd=${sd.toFixed(4)}  max|dev|=${maxdev.toFixed(4)}  (sd/mean=${(sd / mean * 100).toFixed(2)}%)`)
  }
}

// ── 4. subpixel edge position of the wire, per column, vs the exact line ─────
console.log('\n=== shallow wire: edge centroid deviation from the exact line ===')
{
  const layers = [{ shape: 'line', x1: 20, y1: 90.4, x2: 180, y2: 104.6, width: 2, paint: '#000000' }]
  const slope = (104.6 - 90.4) / (180 - 20)
  for (const f of [1, 2, 3, 4]) {
    const img = await shoot(layers, f)
    const c = coverage(img)
    let sum = 0, max = 0, n = 0
    for (let x = 25; x < 175; x++) {
      let wsum = 0, s = 0
      for (let y = 80; y < 120; y++) { const v = c[y * W + x]; s += v; wsum += v * (y + 0.5) }
      if (s < 0.2) continue
      const centroid = wsum / s
      const exact = 90.4 + slope * (x - 20) + 0.5 * 0 // centre of a 2px band
      const d = Math.abs(centroid - (exact + 0.5))
      sum += d; n++
      if (d > max) max = d
    }
    console.log(`  ${f}x  mean |centroid - exact|=${(sum / n).toFixed(4)}px  max=${max.toFixed(4)}px`)
  }
}
