/**
 * video-probe — measure a screen RECORDING, not a screenshot.
 *
 * WHY THIS EXISTS. A screenshot is a COMPOSITE. If a panel is translucent its
 * rendered colour is a blend of the panel and whatever sits behind it, and one
 * frame cannot separate "mid-grey opaque panel" from "white 40% panel over a
 * dark backdrop" — the two produce identical pixels. Motion breaks the tie:
 * once the backdrop moves, a translucent element's reading TRACKS it and an
 * opaque one does not. Better still, the regression slope returns the alpha as
 * a NUMBER rather than a yes/no.
 *
 * THE ESTIMATOR, stated so it can be argued with:
 *     rendered = a*F + (1-a)*B
 * where F is the element's own colour (constant) and B the backdrop (varying).
 * Regressing the element reading on the backdrop reading gives
 *     slope     s = 1 - a    ->   a = 1 - s
 *     intercept c = a*F      ->   F = c / a
 * A LINEAR tone scaling applied to both series (e.g. limited->full range
 * conversion, which ffmpeg does on decode) cancels in the slope, so the alpha
 * estimate is invariant to it. NON-linear tone mapping is not, and would bias it.
 *
 * THE ASSUMPTION IT CANNOT DROP: the backdrop behind the element is not
 * observable (the element covers it), so B is sampled from a patch ADJACENT to
 * the element and assumed to vary the same way. For a moving camera over a 3D
 * scene that holds well. Through a hard cut it does not — the tool reports the
 * fit quality so a bad assumption is visible rather than silent.
 *
 * IT REFUSES TO GUESS. With too little backdrop variation the regression is
 * ill-conditioned; the tool then prints CANNOT DECIDE instead of a confident
 * number. An invented alpha inside a specification is worse than a missing one.
 *
 * Usage: node tools/video-probe.mjs info   <video>
 *        node tools/video-probe.mjs frames <video> <outdir> [opts]
 *        node tools/video-probe.mjs track  <video> <x> <y> <w> <h> [opts]
 *        node tools/video-probe.mjs alpha  <video> <hx> <hy> <hw> <hh> <bx> <by> <bw> <bh> [opts]
 *        node tools/video-probe.mjs motion <video> [--roi x y w h] [opts]
 *
 *        All coordinates are FRACTIONS of the frame, so they survive --scale.
 *        opts: --step N   sample every Nth frame (default 1)
 *              --max N    stop after N sampled frames (default 90)
 *              --scale W  decode at width W (default: native; odd widths are fixed)
 *              --ffmpeg D --ffprobe D   explicit binaries
 */
import { spawnSync } from 'node:child_process'
import {
  readFileSync, openSync, closeSync, unlinkSync, mkdirSync, rmSync,
  existsSync, readdirSync, statSync,
} from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// thresholds. Each one exists to stop a specific silent failure.
// ---------------------------------------------------------------------------
const EXCITATION_FLOOR = 0.03    // PER-CHANNEL backdrop stddev as a fraction of
                                 // 255. At 3% excitation with n≈30 the slope
                                 // error is ~0.03, so alpha lands within ~0.03.
                                 // Applied PER CHANNEL, never to luma: luma can
                                 // cancel while every channel moves. The synthetic
                                 // fixture has R ramping up and G ramping down, so
                                 // luma excitation is 1.97% against 5-8% per
                                 // channel — gating on luma rejected three
                                 // perfectly measurable fixtures.
const MIN_R2 = 0.50              // a slope that explains less than half the
                                 // variance is not a measurement. Enforced ONLY
                                 // when claiming TRANSLUCENT: an OPAQUE element
                                 // has no variance in y, so its R² is 0 by
                                 // construction and must not read as a failure.
const OPAQUE_SLOPE = 0.10        // slope < 0.10  -> element does not follow the
                                 // backdrop -> effectively opaque.
const LEAK_SLOPE = 0.90          // slope > 0.90  -> the "element" ROI is reading
                                 // the backdrop itself; the ROI is wrong.
const OPAQUE_RATIO = 0.15        // PRIMARY opacity test: std(element)/std(backdrop).
                                 // A translucent element with alpha a varies by
                                 // (1-a) of the backdrop, so ratio >= 1-a. A ratio
                                 // under 0.15 means alpha > 0.85 — the backdrop
                                 // barely shows through.
                                 // WHY THIS AND NOT THE SLOPE: the slope only
                                 // equals (1-a) when the backdrop proxy tracks the
                                 // true backdrop (rho=1). On real footage it does
                                 // not: the status pill has sigma_H=0.003 against
                                 // sigma_B=0.023, and the noise-vs-backdrop
                                 // regression produced a spurious slope of 0.45
                                 // with R²=0.37 — reported as CANNOT DECIDE when
                                 // the element is in fact opaque. The RATIO needs
                                 // no correlation to say "this thing does not
                                 // move": that is positive evidence, and it is
                                 // what the panning-camera case actually delivers.

// ---------------------------------------------------------------------------
// WHERE SCRATCH GOES
//
// Video work produces the largest regeneration garbage in this project: decoding a
// single 15-30s clip at native resolution writes 90 frames, and 948 frames / 1.06 GB
// was measured from one ordinary recording. That must never accumulate inside the
// repository — not even gitignored, because a gitignored cache in the tree still gets
// backed up, copied, and confused with deliverables.
//
// So scratch lives OUTSIDE the repository, one level up beside it, in `.cache/video/`,
// and DSH_VIDEO_CACHE overrides it. The dump/  frames/  tmp/  split keeps a decoded
// frame sequence distinguishable from a one-off ffmpeg report and from a fixture we
// deliberately want to keep.
// ---------------------------------------------------------------------------
const CACHE = process.env.DSH_VIDEO_CACHE
  ? resolve(process.env.DSH_VIDEO_CACHE)
  : resolve(HERE, '..', '..', '..', '.cache', 'video')

function cacheDir(kind) {
  const d = join(CACHE, kind)
  mkdirSync(d, { recursive: true })
  return d
}

// ---------------------------------------------------------------------------
// subprocess plumbing. stdio is redirected to FILE DESCRIPTORS, never pipes:
// under the DSH sandbox a piped child fails with EPERM, so capturing stdout the
// usual way would break inside the very environment this tool runs in.
// ---------------------------------------------------------------------------
function runTool(bin, args) {
  const td = cacheDir('tmp')
  const o = join(td, `o-${process.pid}-${Math.random().toString(36).slice(2)}.txt`)
  const e = join(td, `e-${process.pid}-${Math.random().toString(36).slice(2)}.txt`)
  const ofd = openSync(o, 'w'), efd = openSync(e, 'w')
  let r
  try {
    r = spawnSync(bin, args, { stdio: ['ignore', ofd, efd] })
  } finally {
    closeSync(ofd); closeSync(efd)
  }
  const out = existsSync(o) ? readFileSync(o, 'utf8') : ''
  const err = existsSync(e) ? readFileSync(e, 'utf8') : ''
  try { unlinkSync(o); unlinkSync(e) } catch {}
  return { status: r.status, out, err, error: r.error }
}

/**
 * Find ffmpeg/ffprobe without hard-coding this machine.
 *
 * The previous version carried `join('D:', '\\', 'DSH_GDT', 'tools', 'bin', ...)` — a
 * literal path on the author's drive. It was inert (existsSync failed and the PATH
 * fallback took over) but it still told the next reader a wrong fact about where the
 * binary is. Resolution order is now: explicit argument, DSH_FFMPEG/DSH_FFPROBE, a
 * `tools/bin` beside the repository, then PATH.
 */
function resolveBin(explicit, name) {
  const env = process.env[name === 'ffmpeg' ? 'DSH_FFMPEG' : 'DSH_FFPROBE']
  const cands = [
    explicit,
    env,
    join(HERE, '..', '..', '..', 'tools', 'bin', `${name}.exe`),   // beside the repo
    name,                                                          // PATH
  ].filter(Boolean)
  for (const c of cands) {
    if (c === name) return c
    if (existsSync(c)) return c
  }
  return name
}

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const cmd = argv[0]
const positional = []
const opt = {}
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const k = a.slice(2)
    const v = argv[i + 1]
    opt[k] = (v === undefined || v.startsWith('--')) ? true : (argv[++i])
  } else positional.push(a)
}
const num = (v, d) => (v === undefined ? d : Number(v))
const STEP = Math.max(1, Math.round(num(opt.step, 1)))
const MAXF = Math.max(1, Math.round(num(opt.max, 90)))
const SCALE = opt.scale ? Math.round(Number(opt.scale)) : 0
// --start N skips the first N source frames before sampling. Real gameplay is
// rarely one continuous take: a cutscene, a state change or a menu opening
// halfway through will mix two different worlds into one regression and produce
// a confident nonsense answer. Selecting the stable segment is not optional.
const START = Math.max(0, Math.round(num(opt.start, 0)))
const SKIP = Math.floor(START / STEP)
const FFMPEG = resolveBin(opt.ffmpeg, 'ffmpeg')
const FFPROBE = resolveBin(opt.ffprobe, 'ffprobe')

function fail(msg) { console.log(`ERROR: ${msg}`); process.exit(2) }

// ---------------------------------------------------------------------------
// decode
// ---------------------------------------------------------------------------
/**
 * Prefer ffprobe (structured JSON). Fall back to parsing `ffmpeg -i` stderr,
 * which reports the same facts and needs one binary instead of two — a real
 * convenience when only ffmpeg could be installed, which is how this machine
 * ended up. Neither path uses a pipe; both go through file descriptors.
 */
function probeRaw(input) {
  const r = runTool(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input])
  if (r.out && r.out.trim().startsWith('{')) {
    try { return { src: 'ffprobe', json: JSON.parse(r.out) } } catch { /* fall through */ }
  }
  const r2 = runTool(FFMPEG, ['-hide_banner', '-i', input])
  return { src: 'ffmpeg-stderr', text: (r2.err || '') + (r2.out || '') }
}

const frameDirCache = new Map()

const isDir = p => { try { return statSync(p).isDirectory() } catch { return false } }

/** 2 before 10. Lexical sort would put frame 10 between 1 and 2 and silently
 *  shuffle the time series, which would wreck every delta and every regression. */
function naturalSort(a, b) {
  const parts = s => String(s).match(/(\d+)|(\D+)/g) || []
  const A = parts(a), B = parts(b)
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const x = A[i], y = B[i], nx = /^\d/.test(x), ny = /^\d/.test(y)
    if (nx && ny) { const d = Number(x) - Number(y); if (d) return d }
    else if (x !== y) return x < y ? -1 : 1
  }
  return A.length - B.length
}

/**
 * Return the sampled frames in ORDER. Accepts either a video file (decoded with
 * ffmpeg) or a DIRECTORY of images already on disk — the second path needs no
 * decoder at all, which matters because a burst of screenshots is often easier
 * to obtain than a re-encoded video, and re-encoding damages exactly the colour
 * values this tool measures.
 */
function extract(input, tag = 'f') {
  const key = `${input}|${STEP}|${MAXF}|${SCALE}|${START}`
  if (frameDirCache.has(key)) return frameDirCache.get(key)
  let files = []

  if (isDir(input)) {
    files = readdirSync(input)
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort(naturalSort)
      .filter((_, i) => i % STEP === 0)
      .slice(SKIP, SKIP + MAXF)
      .map(f => join(input, f))
    if (!files.length) fail(`no image frames found in ${input}`)
    console.log(`# input is a FRAME SEQUENCE (no decoder needed): ${files.length} images from ${input}`)
    console.log(`# first=${files[0].split(/[\\/]/).pop()}  last=${files[files.length - 1].split(/[\\/]/).pop()}`)
  } else {
    const dir = join(cacheDir('frames'), `${tag}-${process.pid}-${frameDirCache.size}`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const vf = []
    if (STEP > 1) vf.push(`select=not(mod(n\\,${STEP}))`)
    if (SCALE > 0) vf.push(`scale=${SCALE}:-2:flags=area`)   // area = averaging, honest downscale
    const args = ['-v', 'error', '-i', input]
    if (vf.length) args.push('-vf', vf.join(','))
    args.push('-fps_mode', 'passthrough', '-frames:v', String(MAXF + SKIP),
              '-pix_fmt', 'rgb24', join(dir, '%06d.png'))
    const r = runTool(FFMPEG, args)
    files = existsSync(dir)
      ? readdirSync(dir).filter(f => f.endsWith('.png')).sort(naturalSort).map(f => join(dir, f))
      : []
    if (!files.length) {
      fail(`no frames decoded from ${input}\n${r.err.slice(0, 600)}\n`
        + `If no decoder is available, pass a DIRECTORY of PNG frames instead.`)
    }
    files = files.slice(SKIP, SKIP + MAXF)
    if (!files.length) fail(`--start ${START} skipped past every decoded frame`)
  }
  if (START > 0) console.log(`# segment: skipped first ${SKIP} sampled frame(s)  (--start ${START}, step ${STEP})`)
  frameDirCache.set(key, files)
  return files
}

async function pixels(p) {
  const img = await loadImage(readFileSync(p))
  const cv = createCanvas(img.width, img.height)
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return { w: img.width, h: img.height, d: ctx.getImageData(0, 0, img.width, img.height).data }
}

/** mean RGB + mean luma + modal colour over a fractional rect. */
function roiStats(px, fx, fy, fw, fh) {
  const X0 = Math.max(0, Math.round(fx * px.w)), Y0 = Math.max(0, Math.round(fy * px.h))
  const X1 = Math.min(px.w, Math.round((fx + fw) * px.w)), Y1 = Math.min(px.h, Math.round((fy + fh) * px.h))
  let sr = 0, sg = 0, sb = 0, sl = 0, n = 0
  const hist = new Map()
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const i = (y * px.w + x) * 4
      const r = px.d[i], g = px.d[i + 1], b = px.d[i + 2]
      sr += r; sg += g; sb += b
      sl += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      n++
      const k = (r << 16) | (g << 8) | b
      hist.set(k, (hist.get(k) || 0) + 1)
    }
  }
  if (!n) return null
  let mk = 0, mc = 0
  for (const [k, c] of hist) if (c > mc) { mc = c; mk = k }
  return {
    n,
    r: sr / n, g: sg / n, b: sb / n, luma: sl / n,
    modeR: (mk >> 16) & 255, modeG: (mk >> 8) & 255, modeB: mk & 255,
    modeShare: mc / n,
  }
}

/** ordinary least squares y = s*x + c, plus r² */
function regress(xs, ys) {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  if (sxx === 0) return null
  const s = sxy / sxx, c = my - s * mx
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy)
  return { s, c, r2, n, mx, my }
}
const mean = a => a.reduce((p, q) => p + q, 0) / a.length
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))) }
const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
async function cmdInfo(input) {
  if (isDir(input)) {
    const all = readdirSync(input).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort(naturalSort)
    if (!all.length) fail(`no image frames in ${input}`)
    const px = await pixels(join(input, all[0]))
    let bytes = 0
    for (const f of all) bytes += statSync(join(input, f)).size
    console.log(`input       FRAME SEQUENCE   ${input}`)
    console.log(`frames      ${all.length}`)
    console.log(`frame size  ${px.w}x${px.h}`)
    console.log(`total       ${(bytes / 1048576).toFixed(1)} MB`)
    console.log(`first/last  ${all[0]}  ..  ${all[all.length - 1]}`)
    console.log('NOTE        no codec metadata. Frame ORDER comes from the FILENAME (natural sort).')
    console.log('            If the names do not sort into capture order, every delta and every')
    console.log('            regression downstream is wrong. Name them 001,002,...,010 — not 1,2,10.')
    return
  }
  const pr = probeRaw(input)
  if (pr.json) {
    const p = pr.json
    const v = (p.streams || []).find(s => s.codec_type === 'video') || {}
    const f = p.format || {}
    const fr = (v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number)
    const fps = fr[1] ? fr[0] / fr[1] : 0
    const nb = Number(v.nb_frames) || (fps ? Math.round(fps * Number(f.duration || 0)) : 0)
    console.log(`file        ${input}`)
    console.log(`container   ${f.format_name || '?'}   size ${(Number(f.size || 0) / 1048576).toFixed(1)} MB`)
    console.log(`video       ${v.codec_name || '?'}  ${v.width}x${v.height}  ${v.pix_fmt || '?'}`)
    console.log(`fps         ${fps ? fps.toFixed(3) : '?'}`)
    console.log(`frames      ~${nb}   duration ${Number(f.duration || 0).toFixed(2)}s`)
    console.log(`colours     ${v.color_range || '?'} / ${v.color_space || '?'} / ${v.color_primaries || '?'}`)
    if (v.color_range === 'tv') {
      console.log('NOTE        limited-range source; alpha is unaffected (linear scaling cancels in the slope)')
    }
  } else {
    const t = pr.text || ''
    if (!/Stream #/.test(t)) {
      fail(`neither ffprobe nor ffmpeg could read ${input}\n`
        + `  ffprobe: ${FFPROBE}\n  ffmpeg : ${FFMPEG}\n  ${t.slice(0, 300)}`)
    }
    console.log(`file        ${input}`)
    console.log('probe       ffprobe unavailable — parsed from ffmpeg stderr')
    const dur = /Duration:\s*([\d:.]+)/.exec(t)
    if (dur) console.log(`duration    ${dur[1]}`)
    const vs = /Stream #\d+:\d+.*?: Video: ([^\n]+)/.exec(t)
    if (vs) {
      const line = vs[1].trim()
      console.log(`video       ${line}`)
      const dim = /(\d{2,5})x(\d{2,5})/.exec(line)
      if (dim) {
        const w = Number(dim[1]), h = Number(dim[2])
        console.log(`size        ${w}x${h}   aspect ${(w / h).toFixed(3)}`)
        if (w / h > 1.9) {
          console.log('NOTE        wider than 16:9 — check for letterbox bars. Black bars are a constant')
          console.log('            offset on every statistic; crop them before comparing shares.')
        }
      }
      const fps = /([\d.]+) fps/.exec(line)
      if (fps) console.log(`fps         ${fps[1]}`)
      if (/\(tv[,)]/.test(line)) {
        console.log('NOTE        limited-range source; alpha is unaffected (linear scaling cancels in the slope)')
      }
    }
    const nb = /frame=\s*(\d+)/.exec(t)
    if (nb) console.log(`frames      ${nb[1]}`)
  }
  console.log(`ffmpeg      ${FFMPEG}`)
  console.log(`ffprobe     ${FFPROBE}${pr.src === 'ffmpeg-stderr' ? '  (not used)' : ''}`)
}

async function cmdFrames(video, outdir) {
  if (!outdir) fail('frames needs an output directory')
  const files = extract(video, 'x')
  mkdirSync(outdir, { recursive: true })
  let w = 0, h = 0
  for (const f of files) {
    const px = await pixels(f)
    w = px.w; h = px.h
    const dst = join(outdir, f.split(/[\\/]/).pop())
    const buf = readFileSync(f)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(dst, buf)
  }
  const bytes = files.reduce((a, f) => a + statSync(f).size, 0)
  console.log(`wrote ${files.length} frames to ${outdir}`)
  console.log(`frame size ${w}x${h}   step ${STEP}   total ${(bytes / 1048576).toFixed(1)} MB`)
}

async function cmdTrack(video, rect) {
  const [fx, fy, fw, fh] = rect.map(Number)
  const files = extract(video, 't')
  console.log(`# ${video}  sampling every ${STEP} frame(s), ROI ${fx},${fy} ${fw}x${fh}`)
  console.log(`# idx  file          meanR meanG meanB  luma   modeRGB          mode%`)
  const series = []
  for (let i = 0; i < files.length; i++) {
    const px = await pixels(files[i])
    const s = roiStats(px, fx, fy, fw, fh)
    if (!s) continue
    series.push(s)
    console.log(`${String(i).padStart(5)}  ${files[i].split(/[\\/]/).pop()}  ${s.r.toFixed(1).padStart(5)} ${s.g.toFixed(1).padStart(5)} ${s.b.toFixed(1).padStart(5)}  ${s.luma.toFixed(3)}  ${hex(s.modeR, s.modeG, s.modeB)}  ${(s.modeShare * 100).toFixed(1)}%`)
  }
  console.log(`# samples ${series.length}`)
  console.log(`# luma mean ${mean(series.map(s => s.luma)).toFixed(4)}  std ${std(series.map(s => s.luma)).toFixed(4)}`)
}

async function cmdAlpha(video, hr, br, truth = null) {
  const files = extract(video, 'a')
  const rows = []
  for (const p of files) {
    const px = await pixels(p)
    const H = roiStats(px, ...hr), B = roiStats(px, ...br)
    if (H && B) rows.push({ H, B })
  }
  if (rows.length < 3) fail(`only ${rows.length} usable frames`)

  console.log(`# ${video}   step ${STEP}   frames ${rows.length}`)
  console.log(`# element ROI ${hr.join(',')}   backdrop ROI ${br.join(',')}`)
  console.log('')
  console.log('  i   H.luma   B.luma   H-B     H.mode           B.mode')
  rows.forEach((x, i) => {
    console.log(`${String(i).padStart(4)}  ${x.H.luma.toFixed(4)}  ${x.B.luma.toFixed(4)}  ${(x.H.luma - x.B.luma).toFixed(4).padStart(7)}  ${hex(x.H.modeR, x.H.modeG, x.H.modeB)} (${(x.H.modeShare * 100).toFixed(0)}%)  ${hex(x.B.modeR, x.B.modeG, x.B.modeB)}`)
  })

  const chans = [
    ['R', rows.map(x => x.B.r), rows.map(x => x.H.r)],
    ['G', rows.map(x => x.B.g), rows.map(x => x.H.g)],
    ['B', rows.map(x => x.B.b), rows.map(x => x.H.b)],
    ['luma', rows.map(x => x.B.luma * 255), rows.map(x => x.H.luma * 255)],
  ]
  console.log('')
  console.log('  chan   slope(1-a)   alpha     F(implied)   R²     bg std/255   excitation  ratio   usable')
  const fits = []
  for (const [name, xs, ys] of chans) {
    const exc = std(xs) / 255
    const g = regress(xs, ys)
    if (!g) { console.log(`  ${name.padEnd(5)}  (degenerate — the backdrop never moved)`); continue }
    const a = 1 - g.s
    const F = a > 0.02 ? g.c / a : NaN
    const usable = exc >= EXCITATION_FLOOR
    const sx = std(xs), sy = std(ys)
    const rat = sx > 0 ? sy / sx : NaN          // the correlation-free opacity test
    const aRat = Number.isFinite(rat) ? 1 - rat : NaN
    fits.push({ name, s: g.s, c: g.c, r2: g.r2, n: g.n, a, F, exc, usable, sx, sy, rat, aRat })
    console.log(`  ${name.padEnd(5)}  ${g.s.toFixed(4).padStart(9)}  ${a.toFixed(4).padStart(8)}  ${Number.isFinite(F) ? F.toFixed(1).padStart(9) : '      n/a'}  ${g.r2.toFixed(3)}  ${sx.toFixed(2).padStart(9)}   ${(exc * 100).toFixed(2).padStart(6)}%  ${Number.isFinite(rat) ? rat.toFixed(3).padStart(6) : '   n/a'}  ${usable ? 'yes' : 'no '}`)
  }

  // The verdict is driven by the CHANNELS, not by luma — see EXCITATION_FLOOR.
  const use = fits.filter(f => f.usable && f.name !== 'luma')
  const sortedA = [...use].sort((p, q) => p.a - q.a)
  const aMed = sortedA.length
    ? (sortedA.length % 2 ? sortedA[(sortedA.length - 1) / 2].a
      : (sortedA[sortedA.length / 2 - 1].a + sortedA[sortedA.length / 2].a) / 2)
    : NaN
  const sortedR = [...use].filter(f => Number.isFinite(f.rat)).sort((p, q) => p.rat - q.rat)
  const ratioMed = sortedR.length
    ? (sortedR.length % 2 ? sortedR[(sortedR.length - 1) / 2].rat
      : (sortedR[sortedR.length / 2 - 1].rat + sortedR[sortedR.length / 2].rat) / 2)
    : NaN
  const aRatio = Number.isFinite(ratioMed) ? 1 - ratioMed : NaN
  const r2Med = use.length ? [...use].sort((p, q) => p.r2 - q.r2)[Math.floor(use.length / 2)].r2 : 0
  const spread = use.length ? Math.max(...use.map(f => f.a)) - Math.min(...use.map(f => f.a)) : NaN
  const bestExc = fits.length ? Math.max(...fits.map(f => f.exc)) : 0

  // Classify ONCE and print from the classification, so a truth check can never
  // drift away from the verdict that was actually reported.
  // Two tests with DIFFERENT prerequisites, used for different conclusions:
  //   OPAQUE      <- the variance RATIO. Needs no correlation: "this does not
  //                  move while that does" is positive evidence on its own.
  //   TRANSLUCENT <- the regression SLOPE, which is only (1-a) when the proxy
  //                  tracks, so it is gated on R².
  const LEAK_RATIO = 0.92
  let verdict, reason
  if (use.length === 0) {
    verdict = 'CANNOT DECIDE'
    reason = `no channel's backdrop moved enough (best excitation ${(bestExc * 100).toFixed(2)}%, floor ${(EXCITATION_FLOOR * 100).toFixed(1)}%)`
  } else if (!Number.isFinite(ratioMed)) {
    verdict = 'CANNOT DECIDE'
    reason = 'the element ROI never varied, so the ratio is undefined'
  } else if (ratioMed < OPAQUE_RATIO) {
    verdict = 'OPAQUE'
    reason = `the element varies by only ${(ratioMed * 100).toFixed(1)}% of the backdrop's variation — alpha above ${(1 - OPAQUE_RATIO).toFixed(2)}`
  } else if (ratioMed > LEAK_RATIO) {
    verdict = 'ROI ERROR'
    reason = `the element varies by ${(ratioMed * 100).toFixed(1)}% of the backdrop — the element ROI is probably reading the backdrop itself`
  } else if (r2Med < MIN_R2) {
    verdict = 'CANNOT DECIDE'
    reason = `ratio ${ratioMed.toFixed(3)} hints at transparency (alpha≈${aRatio.toFixed(2)}) but the backdrop proxy does not track what is behind the element (median R²=${r2Med.toFixed(3)}), so alpha is not identifiable`
  } else {
    verdict = 'TRANSLUCENT'
    reason = `alpha = ${aMed.toFixed(3)} from the slope (variance-ratio cross-check ${aRatio.toFixed(3)}; median R²=${r2Med.toFixed(3)}, n=${use[0].n}, best excitation ${(bestExc * 100).toFixed(2)}%)`
  }

  console.log('')
  console.log(`VERDICT: ${verdict} — ${reason}`)
  if (verdict === 'CANNOT DECIDE' && use.length === 0) {
    console.log('         Re-record with the world moving past the element, or pick a backdrop ROI with more variation.')
  }
  if (verdict === 'CANNOT DECIDE' && use.length > 0) {
    console.log('         The backdrop proxy moved but does not track what is behind the element. Try a proxy')
    console.log('         closer to the element, directly above or below it, and check for cuts in the clip.')
  }
  if (verdict === 'ROI ERROR') {
    console.log('         Pick a patch of panel fill carrying no text and no transparency.')
  }
  if (verdict === 'OPAQUE') {
    console.log(`         alpha is at least ${(1 - ratioMed).toFixed(3)} — treated as opaque.`)
    console.log('         An OPAQUE verdict means the measured colour IS the designed colour.')
    console.log(`         CAVEAT: this says the element does not follow THIS proxy. If the world directly`)
    console.log(`         behind it happened to be flat while the proxy moved, OPAQUE would be wrong.`)
    console.log(`         The proxy sat adjacent to the element, which is the best available guard.`)
  }
  if (verdict === 'TRANSLUCENT') {
    const ch = n => use.find(f => f.name === n)
    const FR = ch('R') && ch('R').F, FG = ch('G') && ch('G').F, FB = ch('B') && ch('B').F
    console.log(`         per-channel alpha  ${use.map(f => `${f.name}=${f.a.toFixed(3)}`).join('   ')}`)
    console.log(`         element colour ≈ ${[FR, FG, FB].every(Number.isFinite) ? hex(FR, FG, FB) : 'n/a (not every channel usable)'}   (assumes the element layer is a flat colour)`)
    if (Math.abs(aMed - aRatio) > 0.10) {
      console.log(`         NOTE slope-basis ${aMed.toFixed(3)} and ratio-basis ${aRatio.toFixed(3)} differ by ${Math.abs(aMed - aRatio).toFixed(3)}.`)
      console.log('              The ratio basis is attenuated by imperfect tracking, so the slope basis is')
      console.log('              preferred here — but a large gap means the proxy is only a rough stand-in.')
    }
    if (spread > 0.20) {
      console.log(`         NOTE per-channel alphas spread ${spread.toFixed(3)} (>0.20) — the element is probably not`)
      console.log('              a flat colour, or the backdrop ROI does not track what is behind it.')
    }
  }

  if (truth) {
    console.log('')
    console.log(`TRUTH:  alpha=${truth.alpha}  colour=${truth.elementColour}  expected=${truth.expectedVerdict}`)
    const roiOk = hr.every((v, i) => Math.abs(v - truth.elementRoi[i]) < 1e-3)
      && br.every((v, i) => Math.abs(v - truth.backdropRoi[i]) < 1e-3)
    if (!roiOk) {
      console.log('CHECK:  ROIs do not match truth.json — this is NOT a validation run.')
    } else {
      const claimOk = verdict === truth.expectedVerdict
      console.log(`CHECK:  verdict ${claimOk ? 'MATCHES' : 'DIFFERS FROM'} truth  (${verdict} vs ${truth.expectedVerdict})`)
      if (truth.expectedVerdict === 'TRANSLUCENT') {
        const err = Math.abs(a - truth.alpha)
        console.log(`CHECK:  alpha error ${err.toFixed(4)} — ${err <= 0.05 ? 'PASS' : 'FAIL'} (tolerance 0.05)`)
      }
      if (!claimOk) console.log('CHECK:  FAIL')
    }
  }
}

async function cmdMotion(video) {
  const roi = opt.roi ? String(opt.roi).split(',').map(Number) : null
  const files = extract(video, 'm')
  let prev = null
  const diffs = []
  console.log(`# ${video}  step ${STEP}  frames ${files.length}${roi ? `  roi ${roi.join(',')}` : '  full frame'}`)
  console.log('# idx  meanLuma  |Δ| vs prev   bar')
  for (let i = 0; i < files.length; i++) {
    const px = await pixels(files[i])
    const s = roi ? roiStats(px, ...roi) : roiStats(px, 0, 0, 1, 1)
    let dl = 0
    if (prev) {
      let acc = 0, n = 0
      const X0 = roi ? Math.round(roi[0] * px.w) : 0, Y0 = roi ? Math.round(roi[1] * px.h) : 0
      const X1 = roi ? Math.round((roi[0] + roi[2]) * px.w) : px.w, Y1 = roi ? Math.round((roi[1] + roi[3]) * px.h) : px.h
      const stepX = Math.max(1, Math.floor((X1 - X0) / 200)), stepY = Math.max(1, Math.floor((Y1 - Y0) / 200))
      for (let y = Y0; y < Y1; y += stepY) for (let x = X0; x < X1; x += stepX) {
        const a = (y * px.w + x) * 4, b = (y * prev.w + x) * 4
        acc += Math.abs(px.d[a] - prev.d[b]); n++
      }
      dl = n ? acc / n : 0
    }
    diffs.push(dl)
    const bar = '#'.repeat(Math.min(50, Math.round(dl / 2)))
    console.log(`${String(i).padStart(5)}  ${s.luma.toFixed(4)}  ${dl.toFixed(2).padStart(10)}   ${bar}`)
    prev = px
  }
  const cuts = diffs.map((d, i) => [i, d]).filter(([, d]) => d > Math.max(12, mean(diffs) + 4 * (std(diffs) || 1)))
  console.log('')
  console.log(`# |Δ| mean ${mean(diffs).toFixed(2)}  std ${std(diffs).toFixed(2)}  max ${Math.max(...diffs).toFixed(2)}`)
  if (cuts.length) {
    console.log(`# candidate cuts/jumps at sampled index: ${cuts.map(([i, d]) => `${i}(${d.toFixed(0)})`).join(' ')}`)
    console.log('#   -> a cut breaks the adjacent-backdrop assumption. Run alpha on a segment BETWEEN cuts.')
  } else {
    console.log('# no cut detected — the whole clip is usable for alpha')
  }
  const stable = diffs.filter(d => d < 3).length
  console.log(`# frames with |Δ|<3 (near-static): ${stable}/${diffs.length}`)
  console.log('#   For an easing/transition measurement, near-static frames are the END STATE; the')
  console.log('#   frames in between carry the curve. Report duration as (last moving - first moving).')
}

// ---------------------------------------------------------------------------
const USAGE = `video-probe — measure a recording (needs ffmpeg/ffprobe for video; not for a frame sequence)
  info   <input>
  frames <input> <outdir> [opts]
  track  <input> <x> <y> <w> <h> [opts]
  alpha  <input> --rois hx,hy,hw,hh,bx,by,bw,bh [opts]
         (or 8 positional fractions; --rois avoids a long argument list)
  motion <input> [--roi x,y,w,h] [opts]
  <input> is a video file OR a directory of PNG/JPG frames — the frame-sequence
  path needs no decoder at all, and a burst of screenshots is often easier to get
  than a video (and avoids the re-encode that damages the colours being measured).
  coordinates are fractions of the frame, so they survive --scale
  opts: --step N --max N --scale W --ffmpeg D --ffprobe D
        --fixture DIR   read truth.json, use its ROIs, and check the answer
        --rois a,b,c,d,e,f,g,h   element ROI then backdrop ROI`

async function main() {
  if (!cmd || cmd === 'help' || opt.help) { console.log(USAGE); return }
  const video = positional[0]
  if (!video) fail('no input given\n' + USAGE)
  if (!existsSync(video)) fail(`no such file: ${video}`)
  switch (cmd) {
    case 'info':   return cmdInfo(video)
    case 'frames': return cmdFrames(video, positional[1])
    case 'track':  return cmdTrack(video, positional.slice(1, 5))
    case 'alpha': {
      // ROI from a single token by preference: a long positional list is easy to
      // mis-forward, and a mis-forwarded ROI silently measures the wrong patch.
      let truth = null
      if (opt.fixture) {
        const tp = join(String(opt.fixture), 'truth.json')
        if (!existsSync(tp)) fail(`--fixture: no truth.json in ${opt.fixture}`)
        truth = JSON.parse(readFileSync(tp, 'utf8'))
      }
      let n
      if (opt.rois) n = String(opt.rois).split(',').map(Number)
      else n = positional.slice(1, 9).map(Number)
      if (n.length !== 8 || n.some(v => !Number.isFinite(v))) {
        fail('alpha needs 8 ROI fractions: --rois hx,hy,hw,hh,bx,by,bw,bh')
      }
      return cmdAlpha(video, n.slice(0, 4), n.slice(4, 8), truth)
    }
    case 'motion': return cmdMotion(video)
    default: fail(`unknown command "${cmd}"\n${USAGE}`)
  }
}
main().catch(e => { console.log('ERROR: ' + (e && e.stack || e)); process.exit(1) })
