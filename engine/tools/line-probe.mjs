/**
 * line-probe — measure where a multi-line text layer actually puts its lines.
 *
 * Two full-resolution crops of this poster showed multi-line text drawn as one
 * mangled line: every character of the second line superimposed on the first.
 * The render report was no help — it reported `lines: 2` and a box height of
 * 22px for two 14px lines, which is self-consistent and wrong.
 *
 * So this measures the ink directly: it writes a one-layer scene, you render it
 * with the CLI, then it reads the row profile of non-background pixels and
 * reports each contiguous band. Bands = lines. Band count and spacing are the
 * only trustworthy answer, and they come from pixels rather than from a formula.
 *
 * Usage:
 *   node tools/line-probe.mjs write <out.json> [size] [lineHeight|none]
 *   node tools/line-probe.mjs read  <in.png>  [report.json]
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const mode = process.argv[2]

if (mode === 'write') {
  const out = process.argv[3]
  const size = Number(process.argv[4] ?? 14)
  const lhArg = process.argv[5] ?? 'none'
  const lh = lhArg === 'none' ? undefined : Number(lhArg)
  mkdirSync('out', { recursive: true })
  writeFileSync(out, JSON.stringify({
    canvas: { width: 1200, height: 300 },
    ground: '#FFFFFF',
    layers: [{
      id: 'probe',
      shape: 'text',
      text: '第一行文字 ABC\n第二行文字 DEF',
      font: { family: ['SansSC'], size, weight: 400, ...(lh === undefined ? {} : { lineHeight: lh }) },
      color: '#000000',
      x: 40, y: 40, w: 1100,
    }],
  }, null, 2))
  console.log(`wrote ${out} (size ${size}, lineHeight ${lhArg})`)
} else {
  const png = process.argv[3]
  const reportPath = process.argv[4]
  if (reportPath) {
    const rep = JSON.parse(readFileSync(reportPath, 'utf8'))
    const drawn = rep.report.log.find((l) => l.step === 'layer').drawn
    console.log('report  :', JSON.stringify({ lines: drawn.lines, block: drawn.block }))
  }
  const img = await loadImage(readFileSync(png))
  const cv = createCanvas(img.width, img.height)
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data

  const rowHasInk = []
  for (let y = 0; y < img.height; y++) {
    let n = 0
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4
      if (d[o] < 200 || d[o + 1] < 200 || d[o + 2] < 200) n++
    }
    rowHasInk.push(n)
  }
  const bands = []
  let start = -1
  for (let y = 0; y < img.height; y++) {
    if (rowHasInk[y] > 0 && start < 0) start = y
    if (rowHasInk[y] === 0 && start >= 0) { bands.push([start, y - 1]); start = -1 }
  }
  if (start >= 0) bands.push([start, img.height - 1])

  console.log(`ink bands: ${bands.length}`)
  for (const [a, b] of bands) console.log(`   y ${a}-${b}  (height ${b - a + 1})`)
  if (bands.length === 2) console.log(`line-to-line pitch: ${bands[1][0] - bands[0][0]}px`)
}
