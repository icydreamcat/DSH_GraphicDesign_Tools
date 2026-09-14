/**
 * Colour parsing, conversion, and gradient construction.
 *
 * The engine's contract with its caller is that every colour is a hex string
 * with optional alpha (`#RRGGBB` or `#RRGGBBAA`). Hex is deliberate: it is the
 * one notation that cannot be misread, and it is what a designer reading a
 * spec sheet or sampling Photoshop writes down. Named colours and CSS
 * functions are accepted only because they appear inside SVG assets we load,
 * never as the recommended scene format.
 *
 * The conversions here exist for two reasons:
 *
 *   * **Luminance** (`relativeLuminance`) is the measurement side — tone
 *     analysis, contrast ratios, "is the accent dark enough to read on this
 *     ground". It must be WCAG-correct, not a channel average, or every
 *     contrast judgement the agent makes is wrong.
 *
 *   * **OKLab / OKLCH** is the perceptual side. A scale ladder built by
 *     interpolating hex channels produces muddy midtones and uneven steps,
 *     which is the single most common way a generated palette looks machine
 *     made. Interpolating in OKLab keeps lightness steps perceptually even,
 *     and `chroma` in OKLCH is what lets the engine build a harmonious tint
 *     ramp rather than just a darker one.
 */

/** Clamp to [0,1]. */
function unit(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Clamp to [lo,hi]. */
export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x
}

/**
 * Parse a colour into `{r,g,b,a}` with 0-255 channels and 0-1 alpha.
 *
 * Throws on anything unrecognised. A silent fallback to black is worse than a
 * crash here: a mistyped colour that renders black looks like a design
 * decision, and the agent would then reason about it as one.
 *
 * @param {string} input
 * @returns {{r: number, g: number, b: number, a: number}}
 */
export function parseColor(input) {
  if (typeof input !== 'string') {
    throw new Error(`colour must be a string, got ${typeof input}`)
  }
  const s = input.trim()

  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  if (s.startsWith('#')) {
    const h = s.slice(1)
    const hex = (from, len) => {
      const part = len === 1 ? h[from] + h[from] : h.slice(from, from + len)
      return parseInt(part, 16)
    }
    if (h.length === 3 || h.length === 4) {
      return {
        r: hex(0, 1), g: hex(1, 1), b: hex(2, 1),
        a: h.length === 4 ? hex(3, 1) / 255 : 1,
      }
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: hex(0, 2), g: hex(2, 2), b: hex(4, 2),
        a: h.length === 8 ? hex(6, 2) / 255 : 1,
      }
    }
    throw new Error(`malformed hex colour "${input}" (expected #RGB, #RGBA, #RRGGBB or #RRGGBBAA)`)
  }

  const m = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (m !== null) {
    const parts = m[1].split(/[,\s/]+/).filter((p) => p !== '').map(Number)
    if (parts.length < 3 || parts.some(Number.isNaN)) {
      throw new Error(`malformed rgb() colour "${input}"`)
    }
    return { r: clamp(parts[0], 0, 255), g: clamp(parts[1], 0, 255), b: clamp(parts[2], 0, 255), a: parts.length > 3 ? unit(parts[3]) : 1 }
  }

  throw new Error(`unrecognised colour "${input}" — use "#RRGGBB" or "#RRGGBBAA"`)
}

/**
 * Render a parsed colour back to a CSS string the canvas accepts.
 *
 * Alpha is carried as a separate value rather than folded into `rgba()`
 * because layer opacity is applied through `globalAlpha`, and multiplying the
 * same alpha into both would square it.
 *
 * @param {{r:number,g:number,b:number}} c
 * @returns {string}
 */
export function cssColor(c) {
  return `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`
}

/**
 * Normalise any accepted colour form to `#RRGGBBAA` uppercase.
 *
 * @param {string} input
 * @returns {string}
 */
export function toHex8(input) {
  const c = parseColor(input)
  const h = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0').toUpperCase()
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${h(c.a * 255)}`
}

/**
 * WCAG relative luminance, 0 (black) to 1 (white).
 *
 * This is the correct measure of "how light does this read", and it is what
 * all tone analysis in the engine reports. A plain channel average is
 * perceptually wrong by a wide margin — pure blue averages 85/255 but has a
 * relative luminance near 0.07 — so using one would make every darkness
 * judgement the agent makes unreliable.
 *
 * @param {string|{r:number,g:number,b:number}} colour
 * @returns {number}
 */
export function relativeLuminance(colour) {
  const c = typeof colour === 'string' ? parseColor(colour) : colour
  const lin = (v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/**
 * WCAG contrast ratio between two colours, 1:1 to 21:1.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** sRGB -> OKLab (Björn Ottosson). */
export function toOklab(colour) {
  const c = typeof colour === 'string' ? parseColor(colour) : colour
  const lin = (v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const r = lin(c.r), g = lin(c.g), b = lin(c.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** OKLab -> `{r,g,b}` in 0-255, clamped to the sRGB gamut. */
export function fromOklab(lab) {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
  const enc = (v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    return clamp(c * 255, 0, 255)
  }
  return {
    r: enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

/** OKLab -> OKLCH `{L, C, h}` with h in degrees. */
export function toOklch(colour) {
  const lab = toOklab(colour)
  const C = Math.hypot(lab.a, lab.b)
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  if (h < 0) h += 360
  return { L: lab.L, C, h }
}

/** OKLCH -> `{r,g,b}` in 0-255. */
export function fromOklch(lch) {
  const rad = (lch.h * Math.PI) / 180
  return fromOklab({ L: lch.L, a: Math.cos(rad) * lch.C, b: Math.sin(rad) * lch.C })
}

/**
 * Interpolate two colours in OKLab and return `#RRGGBB`.
 *
 * `t` is 0 at `a` and 1 at `b`. Interpolating here rather than per-channel is
 * what keeps a two-colour ramp from going grey in the middle: sRGB midpoint of
 * a saturated blue and a saturated yellow is a muddy olive, while the OKLab
 * midpoint stays chromatic.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} t
 * @returns {string}
 */
export function mixOklab(a, b, t) {
  const ca = toOklab(a), cb = toOklab(b)
  const out = fromOklab({
    L: ca.L + (cb.L - ca.L) * t,
    a: ca.a + (cb.a - ca.a) * t,
    b: ca.b + (cb.b - ca.b) * t,
  })
  const h = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
  return `#${h(out.r)}${h(out.g)}${h(out.b)}`
}

/**
 * Build a perceptually even tint/shade ramp from one colour.
 *
 * This is the "scale ladder" primitive. A designer's 100/200/…/900 ramp is
 * characterised by even *perceived* steps, which is exactly what OKLCH
 * lightness gives and what naive `mix(white, black)` does not.
 *
 * `steps` colours are returned from lightest to darkest. Each step holds the
 * source hue and scales chroma with lightness — a pure lightness ramp to white
 * bleaches the hue and reads as "washed out", while holding chroma to the end
 * keeps the ramp reading as one family.
 *
 * @param {string} base
 * @param {{steps?: number, lightL?: number, darkL?: number, chromaHold?: number}} [options]
 * @returns {string[]}
 */
export function scaleRamp(base, options = {}) {
  const steps = options.steps === undefined ? 9 : options.steps
  // Default span covers a real design range rather than the full 0-1: a step at
  // L=0.99 is invisible against paper and one at L=0.05 cannot hold a hue, so
  // both ends of a naive ramp are wasted steps. 0.96..0.22 is the band a
  // printed design actually uses.
  const lightL = options.lightL === undefined ? 0.96 : options.lightL
  const darkL = options.darkL === undefined ? 0.22 : options.darkL
  const chromaHold = options.chromaHold === undefined ? 0.72 : options.chromaHold
  const src = toOklch(base)
  const out = []
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1)
    const L = lightL + (darkL - lightL) * t
    // Chroma peaks near the source's own lightness and falls off toward the
    // extremes, so the lightest step is a clean tint rather than a pastel
    // smear and the darkest still reads as the same hue.
    const proximity = 1 - Math.abs(L - src.L) / Math.max(0.35, Math.max(src.L, 1 - src.L))
    const C = src.C * chromaHold * clamp(proximity, 0.25, 1)
    out.push(rgbToHex(fromOklch({ L, C, h: src.h })))
  }
  return out
}

/** `{r,g,b}` 0-255 -> `#RRGGBB`. */
export function rgbToHex(c) {
  const h = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

/**
 * Turn a scene gradient spec into a canvas gradient.
 *
 * Two kinds are supported beyond plain linear/radial, because they cover most
 * of what a designed surface actually needs and both are painful to fake:
 *
 *   * `linear` with a `repeating` flag — the hairline and hatch fields that
 *     the reference language is full of.
 *   * `fade` — a single colour at varying alpha, which is the workhorse for
 *     "high-frequency low-contrast" tone: it is how a field is made to appear
 *     only in part of the canvas instead of uniformly covering it.
 *
 * Stops may be given as `{at, color}` or bare colours, in which case they are
 * spread evenly. `at` is 0-1.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} spec
 * @param {{x:number,y:number,width:number,height:number}} box
 * @returns {CanvasGradient}
 */
export function buildGradient(ctx, spec, box) {
  const stops = normaliseStops(spec)
  let grad

  if (spec.type === 'radial') {
    const cx = box.x + (spec.cx === undefined ? 0.5 : spec.cx) * box.width
    const cy = box.y + (spec.cy === undefined ? 0.5 : spec.cy) * box.height
    const r = (spec.r === undefined ? 0.5 : spec.r) * Math.min(box.width, box.height)
    const r0 = spec.r0 === undefined ? 0 : spec.r0 * Math.min(box.width, box.height)
    grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, Math.max(r, r0 + 1e-6))
  } else {
    // Angle in degrees, 0 = left-to-right, 90 = top-to-bottom (CSS-style).
    const angle = spec.angle === undefined ? 90 : spec.angle
    const rad = (angle * Math.PI) / 180
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    // Half-extent of the box along the gradient direction, so 0-100% always
    // spans the whole shape regardless of aspect — otherwise a wide box makes
    // a 90-degree gradient band across the middle only.
    const half = (Math.abs(Math.cos(rad)) * box.width + Math.abs(Math.sin(rad)) * box.height) / 2
    grad = ctx.createLinearGradient(
      cx - Math.cos(rad) * half,
      cy - Math.sin(rad) * half,
      cx + Math.cos(rad) * half,
      cy + Math.sin(rad) * half,
    )
  }

  for (const s of stops) grad.addColorStop(clamp(s.at, 0, 1), s.color)
  return grad
}

/**
 * Expand a scene gradient spec into concrete `{at, color}` stops.
 *
 * @param {object} spec
 * @returns {{at: number, color: string}[]}
 */
function normaliseStops(spec) {
  if (spec.type === 'fade') {
    // A fade is a flat colour whose alpha is modulated. Given `from`/`to`
    // alphas and an optional easing, it produces the soft local appearance
    // that a uniform fill cannot.
    const base = parseColor(spec.color)
    const from = spec.from === undefined ? 0 : spec.from
    const to = spec.to === undefined ? 1 : spec.to
    const gamma = spec.gamma === undefined ? 1 : spec.gamma
    const n = 16
    const out = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const eased = gamma === 1 ? t : Math.pow(t, gamma)
      const a = from + (to - from) * eased
      out.push({ at: t, color: rgbaString(base, a) })
    }
    return out
  }

  const raw = spec.stops
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error(`gradient "${spec.type}" needs at least 2 stops`)
  }
  return raw.map((s, i) => {
    if (typeof s === 'string') {
      return { at: raw.length === 1 ? 0 : i / (raw.length - 1), color: s }
    }
    if (typeof s !== 'object' || s === null) {
      throw new Error(`gradient stop ${i} must be a colour string or {at, color}`)
    }
    const parsed = parseColor(s.color)
    const alpha = s.alpha === undefined ? parsed.a : s.alpha
    return {
      at: s.at === undefined ? i / Math.max(1, raw.length - 1) : s.at,
      color: rgbaString(parsed, alpha),
    }
  })
}

/** Parsed colour + alpha -> a canvas-accepted `rgba()` string. */
function rgbaString(c, alpha) {
  const a = clamp(alpha === undefined ? c.a : alpha, 0, 1)
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${a})`
}

/**
 * Resolve the paint for a shape: a flat colour or a gradient.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string|object|undefined} paint
 * @param {{x:number,y:number,width:number,height:number}} box
 * @param {string} fallback
 * @returns {string|CanvasGradient}
 */
export function resolvePaint(ctx, paint, box, fallback) {
  if (paint === undefined || paint === null) return fallback
  if (typeof paint === 'string') {
    const c = parseColor(paint)
    return rgbaString(c, c.a)
  }
  if (typeof paint === 'object' && typeof paint.type === 'string') {
    return buildGradient(ctx, paint, box)
  }
  throw new Error(`paint must be a colour string or a gradient object, got ${typeof paint}`)
}
