---
name: filters-and-palette
description: Use when the effect you want is not in the render vocabulary, or when a treatment must be confined to part of a layer. Covers the palette operator graph (spatial kernels, pointwise OKLab ops, blending, masks), the seven named presets, effect `scope` for confining a treatment, and how to check that a filter actually did something.
---

# Filters and the palette

## The one idea

**Almost every spatial filter is the same operation with a different kernel.**

A Gaussian blur, a lens blur, a motion streak, an unsharp mask, a surface blur, an emboss,
a find-edges and a median are all "combine a neighbourhood". They differ only in *which*
neighbourhood and *with what weights*. So the kernel is a **parameter**, not an
implementation — and a filter nobody has written is a **list of operators**, not new code.

That is what `design_palette` hands you. Use it when the effect you want is not in the
render vocabulary.

## Four kinds of operator

| Kind | Math | Operators |
|---|---|---|
| **spatial** | `out(p) = Σ w(k)·src(p+k)` | `sample` (kernel) · `rank` (percentile) |
| **pointwise** | `out(p) = f(src(p))` | `lightness` `contrast` `exposure` `hueRotate` `chroma` `invert` `threshold` `posterize` `curve` `gradientMap` `duotone` |
| **mixing** | `out = base + (over−base)·amount` | `blend` · `similarityMask` · `luminanceMask` |
| **source** | produces a constant, does not advance the image | `solid` · `noise` |

**Pointwise operators all work in OKLab.** This is not a detail: in HSL, rotating hue at
constant "lightness" changes perceived brightness differently at every hue, so the same
parameter would do visibly different things to a red and to a blue. In OKLab, a lightness
step is the same perceptual step everywhere. Measured: twelve hues rotated 47° shift OKLab
L by at most 0.006.

## Kernels, and what they cost

| shape | support | cost |
|---|---|---|
| `box` | square | **constant in radius** (summed-area table) |
| `gaussian` | Gaussian | **constant in radius** |
| `line` | segment at an angle | **constant in length** |
| `disc` | circle, `falloff` 0 = flat like a real aperture | grows with radius |
| `ring` · `cross` | ring, cross | grows |
| `custom` | a weight table you supply | grows with area |

**Radius is nearly free for the first three.** That matters for design: you can open a glow
or a blur much wider without paying for it, so the choice should be made on how it looks,
not on how long it takes. `describeGraph()` reports `mayBeSlow` before you run anything.

`rank` is the only **non-linear** operator. It takes a percentile of the neighbourhood, so
it removes isolated speckles while keeping edges — a median. Every weighted sum only dilutes
a speckle; none removes it. Reach for it on scanned or compressed material.

## Writing a graph

A graph is an array of records, run in order.

```json
[
  { "op": "sample", "kernel": { "shape": "gaussian", "radius": 6 }, "as": "blurred" },
  { "op": "similarityMask", "from": "input", "against": "blurred", "maxDelta": 12, "softness": 8, "as": "flat" },
  { "op": "blend", "base": "input", "over": "blurred", "amount": 1, "mask": "flat" }
]
```

Three names refer to images:

- **`input`** — the image the graph started with. Never changes.
- **`current`** — the previous step's output. The default operand.
- **`as: "name"`** — any step may store its result for a later step to reference.

`as` is what makes multi-step chains expressible at all. Without it, "blend the blurred
version back over the **original**" cannot be written — and that single phrase *is* an
unsharp mask.

Two-image operators take `base`/`over` (for `blend`) or `from`/`against` (for the mask
builders).

## Two mask builders, and why there are two

This distinction has cost real time, so state it plainly:

- **`similarityMask`** compares **two images** and reports where they agree. It is what a
  surface blur needs: *which pixels resemble their own neighbourhood*.
- **`luminanceMask`** reads **one image** and reports how bright each pixel is. It is what
  film grain needs: *where are the midtones*. A comparison mask cannot express it, because
  there is nothing to compare against.

A mask is emitted into the **alpha** channel and its colour channels carry the same level,
so it is legible in any viewer. **Coverage comes from a stop's luminance, not its alpha** —
`#FFFFFF` is full coverage, `#000000` is none.

## Filters worth knowing, built from these parts

| What | How |
|---|---|
| **Unsharp mask** | `blend(input, blurred, -amount)` — a negative amount *is* the filter |
| **Surface blur** | blur, `similarityMask`, then `blend` through it |
| **High pass** | `blend(midgrey, blurred, -1)` then `blend(that, input, 0.5)`; flat areas land on mid grey |
| **Film grain** | `noise` + `luminanceMask` (a midtone hump) + `blend` |
| **Dissolve** | `blend(a, b, 0.5)` |
| **Speckle removal** | `rank` at percentile 0.5 |

The first four are also **named presets**, so check `design_palette what:"presets"` before
writing a graph by hand. Their parameters keep the names and ranges their documentation
uses — `unsharp` is radius 0–1500, amount 0–300% (so `1.5`), threshold 0–1, exactly as GIMP
documents them, so a description written for another tool transfers.

## `scope`: confining a treatment

**Every effect acts on the whole layer by default, and strength cannot express "only here".**
This has been measured: a full-strength duotone turned a character into a flat silhouette
with no face, and lowering the strength produced a half-erased character, which is worse.
The missing axis was never strength — it was **extent**.

Any effect may declare `scope`, and the pipeline applies one rule to all of them:

```
after = before + (effected − before) × scope
```

Where the mask is 1 the effect's result is used, where it is 0 the original survives
**byte for byte**, and in between they are interpolated. Forms:

```json
"scope": { "type": "ramp", "angle": 90, "stops": ["#000000", "#FFFFFF"] }
"scope": { "shape": "ellipse", "x": 0.60, "y": 0.03, "w": 0.36, "h": 0.50, "invert": true }
"scope": [ {...}, {...} ]        // multiply: inside every scope
```

`invert: true` is how "abstract everything **except** the face" is written.

Measured result: with an inverted ellipse protecting the head and torso, olive share inside
it went from **0.867 to 0.006** and red from **0.000 to 0.747**, while everything outside
stayed **0.911 → 0.911, untouched**.

**A ramp is normalised to its own box**, not the canvas, so `at`/`size` position it without
recomputing angles.

## Check that it did something

**An operator that runs and changes nothing is the failure this system exists to catch**,
and it has happened repeatedly — a halftone that reported 7007 dots while drawing none; a
mask that selected the whole image because it read the wrong channel.

So the result carries per-step figures:

```json
{ "steps": [ { "op": "sample", "changedFraction": 0.042 },
             { "op": "similarityMask", "selectedFraction": 0.989 } ],
  "inertSteps": 0 }
```

- **`changedFraction` 0** means it did nothing. Read it.
- **`inertSteps`** counts flagged steps; each carries a `problem` string.
- **`selectedFraction`** shows what a mask actually selected. If a mask meant to cover a
  third reports 1, the mask is wrong, not the effect.

**Believe the numbers over the picture, and the picture over the numbers — but check both.**
Every measurement in this engine has been wrong at least once: a fixture that ignored its own
argument, a statistic that could not distinguish the two cases it was asked about, a band too
narrow for a random field. When a number and a 1:1 crop disagree, **crop and look**.

## Precision is enforced

Parameters must be numbers. `"warmer"` is rejected; `hueRotate degrees: -8` is accepted.
That is deliberate: two people given the same numbers build the same picture, and two people
given "warmer" do not. When something qualitative is wanted, translate it into numbers
first and say which numbers you chose and why.

## Presets are not black boxes

A preset is a **named operator graph plus the measurements it produced when captured**.
`what:"show"` prints the graph it will build, so you can read it, edit it, and paste it back
as a `{ graph: [...] }` effect with your own changes.
