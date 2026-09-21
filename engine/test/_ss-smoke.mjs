/**
 * Temporary smoke test for the supersample option. Not a suite.
 */
import { renderScene, readBuffer } from '../src/render.mjs'

const W = 200
const H = 160

const scene = () => ({
  canvas: { width: W, height: H },
  ground: '#FFFFFF',
  layers: [
    { id: 'bg', shape: 'rect', x: 20, y: 20, w: 160, h: 120, paint: '#202020' },
    { id: 'ring', shape: 'ellipse', x: 60.5, y: 40.25, w: 60.5, h: 60.5, paint: 'none', stroke: { color: '#E8E8E8', width: 1 } },
    { id: 'wire', shape: 'line', x1: 20, y1: 100.4, x2: 180, y2: 118.6, width: 1, paint: '#E8E8E8' },
    { id: 'curve', shape: 'path', d: 'M 30 120 C 70 40, 140 150, 175 60', paint: 'none', stroke: { color: '#F0C040', width: 1 } },
    { id: 'frac', shape: 'rect', x: 0.5, y: 0.25, w: 0.25, h: 0.5, paint: '#8AB4F8' },
    {
      id: 'fx', shape: 'rect', x: 40, y: 30, w: 40, h: 30, paint: '#C08040',
      effects: [{ type: 'dropShadow' }, { type: 'blur' }],
    },
    { id: 'group', shape: 'group', opacity: 0.6, children: [
      { id: 'gr', shape: 'polygon', points: [[30.4, 160.2], [100.3, 30.7], [170.6, 150.4]], paint: '#4060C0' },
    ] },
  ],
})

const one = await renderScene(scene())
console.log('ss=1 canvas', one.canvas.width + 'x' + one.canvas.height, 'report.canvas', JSON.stringify(one.report.canvas), 'report.supersample', one.report.supersample)
console.log('  log steps:', one.report.log.map((l) => l.step).join(','))
console.log('  warnings:', one.report.warnings)

const three = await renderScene(scene(), { supersample: 3 })
console.log('ss=3 canvas', three.canvas.width + 'x' + three.canvas.height, 'report.canvas', JSON.stringify(three.report.canvas), 'report.supersample', three.report.supersample)
console.log('  log steps:', three.report.log.map((l) => l.step).join(','))
console.log('  warnings:', three.report.warnings)
console.log('  stats ss1', JSON.stringify(one.report.stats), '\n  stats ss3', JSON.stringify(three.report.stats))

// geometry check: where is the ink centroid of the fractionally placed rect?
function centroidOf(canvas, colour) {
  const d = readBuffer(canvas).data
  let sx = 0, sy = 0, n = 0
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      if (Math.abs(d[i] - colour[0]) < 30 && Math.abs(d[i + 1] - colour[1]) < 30 && Math.abs(d[i + 2] - colour[2]) < 30) { sx += x; sy += y; n++ }
    }
  }
  return { x: sx / n, y: sy / n, n }
}
const c1 = centroidOf(one.canvas, [138, 180, 248])
const c3 = centroidOf(three.canvas, [138, 180, 248])
console.log('frac rect centroid ss=1', JSON.stringify(c1), ' ss=3', JSON.stringify(c3))

// capture policy
const cap = await renderScene(scene(), { supersample: 3, captureLayers: true })
console.log('captured layers:', cap.layers.length, 'first:', cap.layers[0].width + 'x' + cap.layers[0].height,
  'rgba length', cap.layers[0].rgba.length, 'expected', W * H * 4)

// bytes identical at ss=1?
const a = await renderScene(scene())
const b = await renderScene(scene(), { supersample: 1 })
console.log('ss=1 explicit is byte-identical:', Buffer.compare(a.canvas.encodeSync('png'), b.canvas.encodeSync('png')) === 0)

// scene must not be mutated
const s = scene()
await renderScene(s, { supersample: 3 })
console.log('scene canvas after ss=3 render:', JSON.stringify(s.canvas), 'layer0 w:', s.layers[0].w, 'wire width:', s.layers[2].width)

// path layer at 3x must land in the same place, not a third of the size
function bbox(canvas, isInk) {
  const d = readBuffer(canvas).data
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      if (!isInk(d[i], d[i + 1], d[i + 2])) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  return { x0, y0, x1, y1 }
}
const gold = (r, g, b) => r > 150 && g > 120 && b < 140
console.log('curve bbox ss=1', JSON.stringify(bbox(one.canvas, gold)), ' ss=3', JSON.stringify(bbox(three.canvas, gold)))
