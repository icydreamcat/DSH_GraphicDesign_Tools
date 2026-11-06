---
name: reference-analysis
description: Use when a design has to match or learn from a reference image, or when you need to justify a design decision with a number instead of an impression. Covers converting a reference into an actionable specification, reading the specification fields the analyser returns, the measured baseline for this visual language, and how to compare your own render against a reference honestly. Load when handed a reference, a brand board, or a "make it look like this".
---

# Reference analysis

## The distinction the whole skill rests on

There are two ways to describe a reference, and only one of them can be built
from.

```
A description — useless:
  "This reference has halftone, olive green, geometric elements and monospace
   labels."

A specification — buildable:
  "Ground luminance 0.84 (#EBEBEB). The band holding 90% of the image spans
   0.78, concentrated near the ground. Accent 3.1% measured as flat chromatic
   fills; the dominant flat colour is a pale cream at 1.1%, the olive family at
   2.6% combined. A 35px column grid, confidence 0.74; no row grid resolved.
   Dominant stroke weights 1px (59%) and 2px (33%). 27 resolved regions, from
   0.1% to 4% of the canvas. Local detail peaks at 0.061 in the figure area and
   falls to 0.001 in the ground corners."
```

The failure this preset exists to correct was recorded as: *"I counted the
triangles, the halftone, the monospace labels, and moved those features across.
The result was a pile of features, not a design."* Every feature it copied was a
description. Nothing it copied was a specification.

**Never design against a reference you have not measured.**

```
design_analyze image:"refs/reference.png"
```

## Reading the specification

The analyser reports a lot. These are the fields that change decisions, in the
order to read them.

### `tone` — the ground and the band

| field | what it decides |
|---|---|
| `groundLuminance` / `groundHex` | the ground colour to start from |
| `p05` / `p50` / `p95` | where the darks, midtones and lights actually sit |
| `dynamicRange` | how wide a tonal range the piece uses. Wide = higher contrast |
| `histogram` | the shape of the distribution; where the mass is |

The ground is the largest colour on the page, so it is the first decision, and
this is the only field that gives it to you as a number.

### `accent` — the budget

* `flatShare` — **this is the accent figure.** Chromatic pixels belonging to
  large flat fills, i.e. designed colour.
* `share` — every chromatic pixel, illustration included. A reference with a
  watercolour figure measures ~0.2 here and ~0.03 on `flatShare`; the two differ
  by an order of magnitude, and judging by `share` would condemn every
  illustrated reference.
* `flatColors` — the actual flat colours with their shares. This is the palette.
* `mostChromatic` — the single most saturated pixel, useful for finding the hue
  family even when the accent area is tiny.

### `grid` — the layout's rhythm

* `columnPitch` / `rowPitch` in **pixels of the analysis image**, plus
  `*PitchFraction` as a fraction of the canvas. `null` means no grid.
* `columnStrength` — confidence. Below about 0.45 the pitch is not reported at
  all, deliberately: an invented number inside a specification is worse than a
  missing one.

Detected on values, not on tone profile, because tone autocorrelation locks onto
a halftone screen instead of a layout grid — an early version of this analyser
confidently reported a "6px grid" that was the dot screen.

### `structure` — element count and faintness

* `elementCount` — how many distinct regions were resolved.
* `regions[]` — each region's box as a fraction of the canvas, its share, and its
  `impliedOpacity` (how far its tone sits from the ground).
* `strokeWeights[]` — the run-length distribution of ink. **`1px` dominating is
  the signature of this visual language**; the reference measures 59% at 1px.

The element count and mean opacity together are the measured form of the rule
that matters most: *many elements, each faint*.

### `spatial` — where things are

An 8x5 grid of cells, each with `meanLuma`, `meanSaturation` and **`detail`**
(mean absolute luminance gradient inside the cell).

**This is the field that is most often skipped and most often decisive.** "A
halftone at 22% opacity" is not a specification; "a halftone at 22% on the left
third and absent on the right" is. Only the per-cell breakdown distinguishes
them, and the recorded failure was exactly a field spread uniformly where the
reference had it appear locally and fade.

### `contrast`

`groundToDarkest` and `groundToLightest`, as WCAG ratios. Both are usually
**low** in this language — the reference measures 1.9 and 1.1. That is not a
mistake in the reference; it is what "high frequency, low contrast" means
numerically.

## The measured baseline

Reference values from this project's own analysis, for orientation. Treat them
as a starting hypothesis, not a target to hit mechanically.

| field | reference | the failed attempt |
|---|---|---|
| grid | **35px columns, strength 0.74** | **none detected** |
| focus unique | yes | **no — 4 regions competing** |
| layout carries character | yes | no |
| flat accent share | **0.031** | 0.107 |
| peak local detail | 0.061 | 0.082 |
| stroke weights | 1px 59%, 2px 33% | 1px 40%, 2px 39% |

The failed attempt's two structural defects — **no grid** and **no unique
focus** — are exactly the two the analyser reports as answered questions. That is
not a coincidence; those checks were written from this comparison.

## Comparing your render against a reference

The honest method is to run the same measurement on both and compare, rather
than to look at them side by side and decide they are "close".

```powershell
node bin/design.mjs analyze refs/reference.png > out/ref.json
node bin/design.mjs analyze out/mine.png        > out/mine.json
node bin/design.mjs critique out/mine.png
```

Compare in this order, and stop at the first large disagreement — later
differences are usually consequences of earlier ones:

1. **Grid present?** If the reference has one and yours does not, nothing
   downstream is comparable.
2. **Focus unique?** A competing focus cannot be fixed by adjusting colour.
3. **Element count and mean opacity.** This is the frequency/contrast signature.
4. **Accent flat share.**
5. **Tone band and ground luminance.**
6. **Peak and mean local detail.**
7. Stroke-weight distribution.

`detail` is the one field whose *absolute* value is hard to interpret — a
mostly-empty page legitimately has a low mean. What matters is the **peak** (is
there real detail anywhere?) and the **distribution** (is it localised or
uniform?). A design that is flat everywhere and a design that is detailed in one
region and empty elsewhere can share a mean.

## Do not over-fit

A specification is a set of constraints, not a target to be minimised like a loss
function. Two cautions:

* **Matching every number is not the goal.** A grid at a different pitch that
  suits your format is correct; a 35px grid copied onto a 2400px canvas because
  the reference had one at 2560px is not.
* **A reference's numbers describe a solution to *its* problem.** Take the
  structural facts — the accent budget, the tonal band, the frequency/contrast
  signature, the element count — and take them as ranges. Take the specific
  colours, the grid pitch and the type sizes as *its* answers, and derive yours
  from your own format.

The most transferable thing to extract is not a value but a **relationship**:
what proportion of the page the accent occupies, how many elements carry the
detail, how far the subject fills the frame. Relationships survive a change of
format; values do not.
