/**
 * Temporary probe: what does 3x supersampling actually change on this rasteriser?
 * Not a suite. Deleted before the feature lands.
 */
import { createCanvas } from '@napi-rs/canvas'
import { renderScene, readBuffer } from '../src/render.mjs'
import { scaleScene } from '../src/scale.mjs'

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

function lum(img) {
  const out = new Float64Array(img.width * img.height)
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    out[p] = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]
  }
  return out
}

// pixels strictly between the two inks
function intermediate(img, inkV = 0, groundV = 255) {
  const lo = Math.min(inkV, groundV)
  const hi = Math.max(inkV, groundV)
  const l = lum(img)
  let n = 0
  for (const v of l) if (v > lo + 0.5 && v < hi - 0.5) n++
  return n
}

function compare(ref, test, box) {
  let sum = 0, max = 0, n = 0
  const a = lum(ref), b = lum(test)
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const p = y * ref.width + x
      const d = Math.abs(a[p] - b[p])
      sum += d
      if (d > max) max = d
      n++
    }
  }
  return { mean: sum / n, max }
}

const W = 320
const H = 240

async function shoot(layers, f) {
  const scene = { canvas: { width: W, height: H }, ground: '#FFFFFF', layers }
  const work = JSON.parse(JSON.stringify(scene))
  if (f > 1) scaleScene(work, f)
  const { canvas } = await renderScene(work)
  const img = readBuffer(canvas)
  return f === 1 ? img : downsample(img, f)
}

const cases = {
  'small circle r=6 (fractional centre)': [
    { id: 'c', shape: 'ellipse', x: 100.5, y: 80.25, w: 11.5, h: 11.5, paint: '#000000' },
  ],
  'disc r=2.5': [
    { id: 'c', shape: 'ellipse', x: 100.3, y: 80.7, w: 5, h: 5, paint: '#000000' },
  ],
  'big circle r=40': [
    { id: 'c', shape: 'ellipse', x: 100.5, y: 80.25, w: 79.5, h: 79.5, paint: '#000000' },
  ],
  'shallow wire h=2 slope 1/12': [
    { id: 'w', shape: 'line', x1: 20, y1: 100.4, x2: 300, y2: 123.6, width: 2, paint: '#000000' },
  ],
  'rotated thin rect': [
    { id: 'r', shape: 'rect', x: 40, y: 60, w: 200, h: 3, paint: '#000000', transform: { rotate: 7, originX: 40, originY: 60 } },
  ],
  'frac rect': [
    { id: 'r', shape: 'rect', x: 60.5, y: 40.25, w: 120.4, h: 60.35, paint: '#000000' },
  ],
  'bezier path': [
    { id: 'p', shape: 'path', d: 'M 20 200 C 80 40, 240 220, 300 60', paint: 'none', stroke: { color: '#000000', width: 3 } },
  ],
}

for (const [name, layers] of Object.entries(cases)) {
  const one = await shoot(layers, 1)
  const three = await shoot(layers, 3)
  const twelve = await shoot(layers, 12)
  const box = { x0: 0, y0: 0, x1: W, y1: H }
  const e1 = compare(twelve, one, box)
  const e3 = compare(twelve, three, box)
  console.log(`\n${name}`)
  console.log(`  intermediate px   1x=${intermediate(one)}  3x=${intermediate(three)}  12x=${intermediate(twelve)}`)
  console.log(`  err vs 12x ref    1x mean=${e1.mean.toFixed(3)} max=${e1.max}   3x mean=${e3.mean.toFixed(3)} max=${e3.max}`)
}

// radial deviation for the small circle: outermost inked radius per angle
function radial(img) {
  const cx = (100.5 + 11.5 / 2)
  const cy = (80.25 + 11.5 / 2)
  const l = lum(img)
  const r = []
  for (let a = 0; a < 360; a += 1) {
    const th = (a * Math.PI) / 180
    let last = 0
    for (let t = 0; t < 30; t += 0.05) {
      const x = Math.round(cx + Math.cos(th) * t)
      const y = Math.round(cy + Math.sin(th) * t)
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) break
      if (l[y * img.width + x] < 128) last = t
    }
    r.push(last)
  }
  const ideal = 11.5 / 2 - 0.5
  const dev = r.map((v) => v - ideal)
  const mean = dev.reduce((s, v) => s + Math.abs(v), 0) / dev.length
  return { mean, max: Math.max(...dev.map(Math.abs)), r }
}

console.log('\nradial deviation of the small circle edge (px, vs the ideal radius)')
for (const f of [1, 2, 3, 6, 12]) {
  const img = await shoot(cases['small circle r=6 (fractional centre)'], f)
  const d = radial(img)
  console.log(`  ${f}x  mean |dev|=${d.mean.toFixed(3)}  max |dev|=${d.max.toFixed(3)}`)
}
