---
name: colour-systems
description: Use when choosing or judging colour for a design — building a palette, a tint/shade ramp, a duotone treatment, or checking whether a colour scheme reads as designed rather than arbitrary. Covers OKLab interpolation, the accent budget measured against real references, contrast and legibility thresholds, tonal band control, and how to tone an illustration into a palette. Load before writing colour values into a scene.
---

# Colour systems

## The one rule that matters most

**Accent share is a budget, not a preference.** Measured across real references
in this visual language, the designed accent — the flat chromatic fills, not the
illustration — occupies **about 3% of the frame**. That number is what makes a
colour read as an accent. At 10% it is a colour field, and the page stops looking
restrained however good the hue is.

The previous attempt at this work measured **10.7%** on the same metric. The
difference between its result and the reference is not the hue; it is the
quantity.

```
design_verify scene:"scene.json" png:"render.png"    # reports flat-fill accent share
```

The metric to read is `accentFlatShare`, not `accentShare`. Raw chromatic share
counts every saturated pixel including an illustration's watercolour, so a
reference with a figure in it measures ~20% chromatic while its *designed* accent
is still 3%. The verifier reports both and judges on the flat-fill figure.

## Build ramps in OKLab, never in hex

Interpolating hex channels between two colours produces muddy midtones and
visibly uneven steps. That is the single most common reason a generated palette
looks machine made.

```
design_system what:"ramp" color:"#83923A" steps:9
```

The engine interpolates in **OKLab**, so steps are perceptually even — measured
at a max/min lightness-delta ratio of 1.03 across nine steps, i.e. as even as
nine steps can be. Each step also reports its **contrast ratio on white and on
black**, which is how you choose a step by legibility rather than by eye.

Why the domain exists: going through OKLab rather than sRGB matters for two
reasons. Lightness steps stay even (sRGB compresses the light end by design,
because it is a gamma curve), and a two-colour blend keeps its chroma instead of
collapsing toward grey — verified against the sRGB midpoint, which lands off the
perceptual halfway point.

**Use the ramp, not ad-hoc tints.** A palette whose light values are
`#ecf8cf, #cddba9, #aebe84, #91a25e, #76854b, #5d693a, #454e2a, #2e341a, #181d0c`
reads as one family. A palette hand-picked from a colour wheel does not.

## The tonal band

A designed surface usually keeps 90% of its pixels inside a **narrow luminance
band** — the reviews measured about 0.78 of range on the reference, but with the
mass of the image concentrated in a much narrower region around the ground.

Practical consequences:

* **A very wide band reads as uncontrolled contrast.** Near-full black to near-full
  white at large scale is exhausting and loses the low-contrast character.
* **The reference language has no true black.** Its darkest values sit around
  luminance 0.1-0.15, and its ground around 0.84-0.87. Setting `#000000` and
  `#FFFFFF` is the fastest way to make a page look like a default.
* **Prefer a tinted near-black to a neutral one.** An ink with a slight green or
  blue cast reads as chosen; pure black reads as unset.

```
design_verify scene:"scene.json" png:"render.png"   # tone band width + mean luminance
design_critique image:"render.png"                  # full luminance statistics
```

## Contrast: two different questions

**Legibility contrast** is about reading. WCAG's ratio (1:1 to 21:1, computed
from relative luminance) is the right measure for body text:

| ratio | enough for |
|---|---|
| 3:1 | large display type (24px+), and UI boundaries |
| 4.5:1 | body text — the normal requirement |
| 7:1 | small text and anything that must survive poor conditions |

**Compositional contrast** is about hierarchy, and here **less is usually more**.
A page where every element is at high contrast has no hierarchy at all — which is
the "low frequency, high contrast" failure this preset exists to avoid. The
reference keeps most of its marks at low contrast against the ground and spends
its high contrast on one or two things.

**The trap:** low-contrast text with no outline is invisible. `design_verify`
raises an error for text under 1.6:1 against the ground with no outline, and
notes when low-contrast text carries a stroke — because **outlined type is a
legitimate treatment here**, and the engine supports a true knockout outline
(`stroke` on a text layer), not a stroke drawn in the background colour, which
breaks the moment the ground is not flat.

## Toning an illustration into the palette

A placed illustration in full colour will fight any palette. The right treatment
is a **duotone** on the image layer, not a coloured rectangle laid over it:

```json
{
  "shape": "image",
  "src": "assets/figure.png",
  "effects": [{
    "type": "duotone",
    "shadows": "#2C3123",
    "midtones": "#6E7458",
    "highlights": "#EFEFE4",
    "strength": 0.82
  }]
}
```

* `shadows` / `highlights` pull the extremes toward the page's ink and paper.
* `midtones` is optional and is what stops a two-colour ramp passing through a
  desaturated average in the middle.
* `strength` under 1 keeps some of the original tonality; at 1 the image is fully
  remapped.

**Do not lay a translucent colour rectangle over an image to tint it.** That was
tried and it is a real defect: a rectangle cannot follow the subject, so wherever
it extends past the subject's ink it becomes a free-floating soft-edged box on
the page. The duotone affects only the subject's pixels, so there is no shape to
leak. The same principle applies to the dot screen: declared on the shape, it
takes the subject's silhouette; declared as a canvas-wide effect with a
transparent source, it fills the bounding box.

## Setting the ground

The ground is the largest area of colour on the page and therefore sets its
temperature. Rules that hold:

* **Do not use pure white.** A warm off-white (`#F1F1EC`, `#F6F6F1`) reads as
  paper; `#FFFFFF` reads as a screen.
* **A ground gradient should be almost invisible.** Two or three stops across a
  very short range. A visible gradient in the ground is a different design.
* **Give the ground a local event, not a uniform one.** The reference's richness
  comes from texture and tone that appear in *part* of the page. A gradient mask
  on a texture layer, or a tone wipe, is how that is done — and unlike a uniform
  fill it does not read as a flat plane.

## Working order

1. Fix the ground first — it constrains everything else.
2. Choose the ink: a tinted near-black, not `#000000`.
3. Build the ramp from one accent hue with `design_system what:"ramp"`.
4. Decide the **accent budget** before placing anything: 1-5% of the frame.
5. Tone any placed image with a duotone so it joins the palette.
6. Render, then read `accentFlatShare`, `dynamicRange` and `meanLuma` from
   `design_verify`. Adjust the ground and ink before adjusting the accent.
