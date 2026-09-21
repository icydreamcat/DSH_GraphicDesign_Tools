/**
 * Temporary probe 3: correct scaling, so the numbers mean something. Not a suite.
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

const AMB = ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2', 'originX', 'originY', 'lineHeight']
const ABS = ['width', 'size', 'radius', 'cell', 'dx', 'dy']

function scaleProbe(scene, f) {
  const s = JSON.parse(JSON.stringify(scene))
  s.canvas = { width: s.canvas.width * f, height: s.canvas.height * f }
  const amb = (v) => (v >= 0 && v <= 1 ? v : v * f)
  const walk = (o) => {
    for (const k of AMB) if (typeof o[k] === 'number') o[k] = amb(o[k])
    for (const k of ABS) if (typeof o[k] === 'number') o[k] = o[k] * f
    for (const k of ['points', 'c1', 'c2']) if (Array.isArray(o[k])) o[k] = o[k].map((p) => (Array.isArray(p) ? p.map(amb) : amb(p)))
    if (Array.isArray(o.dash)) o.dash = o.dash.map((v) => v * f)
    for (const [k, v] of Object.entries(o)) {
      if (k === 'canvas' || k === 'font' || k === 'd' || k === 'path') continue
      if (Array.isArray(v)) { for (const e of v) if (e !== null && typeof e === 'object' && !Array.isArray(e)) walk(e) }
      else if (v !== null && typeof v === 'object') walk(v)
    }
  }
  for (const l of s.layers) walk(l)
  return s
}

function coverage(img) {
  const out = new Float64Array(img.width * img.height)
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    const a = img.data[i + 3] / 255
    let c = a * (1 - img.data[i] / 255)
    if (c < 1e-6) c = 0
    if (c > 1 - 1e-6) c = 1
    out[p] = c
  }
  return out
}
function intermediate(img) {
  const c = coverage(img)
  let n = 0
  for (const v of c) if (v > 0.5 / 255 && v < 1 - 0.5 / 255) n++
  return n
}

const W = 200
const H = 200
async function shoot(layers, f) {
  const scene = { canvas: { width: W, height: H }, ground: '#FFFFFF', layers }
  const work = f === 1 ? scene : scaleProbe(scene, f)
  const { canvas } = await renderScene(work)
  const img = readBuffer(canvas)
  if (f === 1) return img
  const small = downsample(img, f)
  if (small.width !== W || small.height !== H) throw new Error(`bad delivered size ${small.width}x${small.height}`)
  return small
}

console.log('=== intermediate (blend) pixel counts: 1x vs 2x vs 3x vs 4x ===')
const trials = {
  'rect @ .0   ': [{ shape: 'rect', x: 20, y: 20, w: 60, h: 40, paint: '#000000' }],
  'rect @ .25  ': [{ shape: 'rect', x: 20.25, y: 20.25, w: 60.4, h: 40.4, paint: '#000000' }],
  'rect @ .5   ': [{ shape: 'rect', x: 20.5, y: 20.5, w: 60.5, h: 40.5, paint: '#000000' }],
  'rect @ .75  ': [{ shape: 'rect', x: 20.75, y: 20.75, w: 60.3, h: 40.3, paint: '#000000' }],
  'rect @ 1/3  ': [{ shape: 'rect', x: 20.3333, y: 20.3333, w: 60.3333, h: 40.3333, paint: '#000000' }],
  'rect @ 2/3  ': [{ shape: 'rect', x: 20.6667, y: 20.6667, w: 60.6667, h: 40.6667, paint: '#000000' }],
  'rect tiny   ': [{ shape: 'rect', x: 20.4, y: 20.4, w: 3.3, h: 3.3, paint: '#000000' }],
  'rect 1/3 rot': [{ shape: 'rect', x: 20.3333, y: 20.3333, w: 60.3333, h: 40.3333, paint: '#000000', transform: { rotate: 15, originX: 20.3333, originY: 20.3333 } }],
  'circ r=6    ': [{ shape: 'ellipse', x: 40.5, y: 40.25, w: 11.5, h: 11.5, paint: '#000000' }],
  'circ r=40   ': [{ shape: 'ellipse', x: 40.5, y: 40.25, w: 79.5, h: 79.5, paint: '#000000' }],
  'line 45deg  ': [{ shape: 'line', x1: 20, y1: 20, x2: 180, y2: 180, width: 3, paint: '#000000' }],
  'line 5deg   ': [{ shape: 'line', x1: 20, y1: 90.4, x2: 180, y2: 104.6, width: 2, paint: '#000000' }],
  'line 1px 5d ': [{ shape: 'line', x1: 20, y1: 90.4, x2: 180, y2: 104.6, width: 1, paint: '#000000' }],
  'rot rect 7d ': [{ shape: 'rect', x: 40, y: 60, w: 120, h: 4, paint: '#000000', transform: { rotate: 7, originX: 40, originY: 60 } }],
  'dashed 45d  ': [{ shape: 'line', x1: 20, y1: 20, x2: 180, y2: 180, width: 4, dash: [9, 5], paint: '#000000' }],
  'polygon     ': [{ shape: 'polygon', points: [[30.4, 160.2], [100.3, 30.7], [170.6, 150.4]], paint: '#000000' }],
  'poly 1/3    ': [{ shape: 'polygon', points: [[30.3333, 160.3333], [100.3333, 30.3333], [170.3333, 150.3333]], paint: '#000000' }],
}
for (const [name, layers] of Object.entries(trials)) {
  const out = []
  for (const f of [1, 2, 3, 4]) out.push(intermediate(await shoot(layers, f)))
  const verdict = out[2] < out[0] ? 'FEWER' : out[2] === out[0] ? 'same' : 'more'
  console.log(`  ${name}  1x=${String(out[0]).padStart(5)} 2x=${String(out[1]).padStart(5)} 3x=${String(out[2]).padStart(5)} 4x=${String(out[3]).padStart(5)}  ${verdict}`)
}

// ── analytic ground truth for a circle, no rasteriser involved ──────────────
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

console.log('\n=== circle: error against the exact analytic area coverage (255-scale) ===')
for (const [label, x, y, d] of [['r=2.5', 40.3, 40.7, 5], ['r=6  ', 40.5, 40.25, 11.5], ['r=40 ', 40.5, 40.25, 79.5]]) {
  const truth = circleCoverage(W, H, x + d / 2, y + d / 2, d / 2)
  console.log(`  ${label}`)
  for (const f of [1, 2, 3, 4]) {
    const c = coverage(await shoot([{ shape: 'ellipse', x, y, w: d, h: d, paint: '#000000' }], f))
    let sum = 0, max = 0, over10 = 0, over25 = 0
    for (let i = 0; i < truth.length; i++) {
      const e = Math.abs(c[i] - truth[i])
      sum += e
      if (e > max) max = e
      if (e > 0.1) over10++
      if (e > 0.25) over25++
    }
    console.log(`      ${f}x: mean=${(sum / truth.length * 255).toFixed(3)}  max=${(max * 255).toFixed(1)}  px>10%=${over10}  px>25%=${over25}`)
  }
}

console.log('\n=== shallow wire: inked thickness per column (a gear-toothed band is this varying) ===')
{
  const layers = [{ shape: 'line', x1: 20, y1: 90.4, x2: 180, y2: 104.6, width: 2, paint: '#000000' }]
  const slope = (104.6 - 90.4) / 160
  for (const f of [1, 2, 3, 4]) {
    const c = coverage(await shoot(layers, f))
    const vals = []
    let cdev = 0, cn = 0, cmax = 0
    for (let x = 25; x < 175; x++) {
      let s = 0, wsum = 0
      for (let y = 80; y < 120; y++) { const v = c[y * W + x]; s += v; wsum += v * (y + 0.5) }
      vals.push(s)
      if (s > 0.2) {
        const cd = Math.abs(wsum / s - (90.4 + slope * (x - 20) + 0.5))
        cdev += cd; cn++
        if (cd > cmax) cmax = cd
      }
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
    console.log(`  ${f}x  thickness mean=${mean.toFixed(4)} sd=${sd.toFixed(5)} max|dev|=${Math.max(...vals.map((v) => Math.abs(v - mean))).toFixed(5)} | centroid dev mean=${(cdev / cn).toFixed(4)} max=${cmax.toFixed(4)}`)
  }
}

console.log('\n=== boundary "staircase" positions on a circle edge (left boundary per row, r=40) ===')
{
  const x = 40.5, y = 40.25, d = 79.5
  const cx = x + d / 2, cy = y + d / 2, r = d / 2
  for (const f of [1, 2, 3, 4]) {
    const c = coverage(await shoot([{ shape: 'ellipse', x, y, w: d, h: d, paint: '#000000' }], f))
    // For each row across the circle's waist, find the subpixel x where coverage crosses 0.5.
    let runs = 0, prevQ = null, devSum = 0, devN = 0, devMax = 0
    for (let yy = Math.floor(cy - r * 0.5); yy < Math.ceil(cy + r * 0.5); yy++) {
      let cross = null
      for (let xx = Math.floor(cx - r) - 2; xx < cx; xx++) {
        const a = c[yy * W + xx], b = c[yy * W + xx + 1]
        if (a < 0.5 && b >= 0.5) { cross = xx + (0.5 - a) / Math.max(1e-9, b - a); break }
      }
      if (cross === null) continue
      const exact = cx - Math.sqrt(Math.max(0, r * r - (yy + 0.5 - cy) ** 2))
      const dev = Math.abs(cross - exact)
      devSum += dev; devN++
      if (dev > devMax) devMax = dev
      const q = Math.round(cross * 4) / 4
      if (q !== prevQ) runs++
      prevQ = q
    }
    console.log(`  ${f}x  boundary deviation mean=${(devSum / devN).toFixed(4)}px max=${devMax.toFixed(4)}px | distinct 1/4px boundary levels=${runs} over ${devN} rows`)
  }
}
