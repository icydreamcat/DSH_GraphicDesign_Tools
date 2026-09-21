---
name: craft-and-material
description: Use when the work needs to look MADE rather than drawn — paper, leather, metal, cloth, tape, ink, embossing, composite/collage pieces, or any surface that has to read as a physical material. Covers the four-course synthesis method (one craft chain rather than a recipes library), where complexity actually comes from in a composite, why transparency is the wrong way to build layers and what to do instead, why elements must be physically connected rather than merely evenly distributed, the supersample/curve quality settings, and the ink-and-material settings that the engine can and cannot reach. Load this before building anything that depicts physical objects, and again when a piece looks flat, plasticky, or like "a page with things arranged on it".
---

# Craft and material

## What this skill is for

The failure it prevents has one shape: **a page whose elements are all correct and
none of which touch each other.** Everything is measured, nothing is physically
connected, and the result reads as a layout rather than as an object.

### The rule everything below serves

**Every graphic drawn by hand is a finished object, and the objects relate.**

Two tests, and a graphic must pass both:

- **STANDALONE** — pull it out of the page, scale it up, look at it on its own. It still holds.
  If it only works as one entry in a row of identical marks, it is not a graphic, it is a tally.
- **RELATED** — it has a reason to sit where it sits and to touch what it touches. Objects that
  share a world occlude, rest on, clip to and overlap each other. A set of things that merely fail
  to collide is a table of contents, not a picture.

**Why this is the rule and not a preference.** When the graphics carry no content, content has to
come from somewhere, and it comes from large flat shapes and long runs of type. That is the exact
mechanism by which a design turns into a form. Real objects carry the content themselves, and then
the page has something to be *about*.

**And the consequence for size:** make **fewer, bigger, more finished** things. Forty abstract marks
are weaker than six objects that each look like something. An object with form, material and
thickness earns a size at which a reader can actually see it — it is allowed to be one of the
largest things on the page. A 20px glyph is not a small graphic, it is a marker, and markers do not
count as craft.

**Unity comes from shared process, not shared styling.** Matching stroke colours unifies an
*appearance*; running every object through one chain — the same bevel, the same light, the same
shadow direction, the same paper — unifies a *world*. This is why the recipes below are chains
rather than presets: two objects built through the same chain belong together even when they share
no colour.

That failure comes from treating material as a **library of recipes** — "leather
is done like this, metal like that". Four courses' worth of production material
says the opposite, and the correction is worth stating first because everything
else in this file follows from it:

> **One craft chain, one unifying target — not a materials list.**

The courses never actually teach "how to make leather". They teach that these
things can be made, with a shared set of operations: `filter gallery`,
`halftone screen`, `add noise`, `bevel and emboss`, `colour overlay`. Those are
**ways of processing existing material**, and the skill is choosing which chain to
run, not which preset to apply.

## Make it first — the default is to build, not to fetch

**This is the standing move, not an option.** When a piece needs a mark, a surface
or a fastener, the reflex is to go and find an image. That reflex is wrong most of
the time, and it is the slowest of the available paths.

| | Built | Found |
|---|---|---|
| Reproducible | exactly — it is geometry or a seeded render | no |
| Licensing | none | a question every time |
| Scales | re-render at any size | resampling, and it shows |
| Fits the page | on the grid, in the palette, by construction | by luck, then by hand |
| Revises when the light axis moves | change the parameter | start over |
| Time | one build, one look | search, judge, discover it does not belong |

**So: try to make it. Go looking only when making has genuinely failed.**

### How "made" is done here

1. **As geometry in the scene** — the fastest path, and the one that keeps the
   asset inside the page's own system. A mark is rectangles and ellipses on the
   declared grid; an array of them is a loop with a rule.
2. **As a generator** — when the asset has its own internal structure (a crest, a
   paper surface, a metal clip, a light pass), write it as a generator and render
   it. **It goes under a generator directory rather than into a one-off script**, so
   the next piece starts from it instead of from nothing. This is how a library
   accumulates: by building, not by collecting.
3. **Look at it before keeping it.** A build that has not been seen is not an
   asset yet. Render it, view it at 1:1, and keep it only if it reads as the thing
   it stands for.

### What is worth building rather than finding

| Need | Build it as |
|---|---|
| Crest / badge / stamp | outline family + inner field + mark + double stroke + toothing |
| Paper surface | fibre + cockle relief + torn edge + pigment bleed, each its own layer |
| Fastener / clip / eyelet | rectangle + bevel + paired inner shadow + a pressed slot |
| Light | a white-plus-source-colour plate on black, screen-blended; direction stated |
| Tape / band | texture + directional gradient + lit and shaded edges + end caps |
| Ink / pigment | radial bleed + a darker pressed rim + one layer of deliberate imperfection |

### When a build does not work

Report it as a finding, not as a dead end: **say what was tried and what it looked
like**, then try the next construction. Two rules about this, both learned the hard
way:

- **A capability that was never attempted is not a missing capability.** The one
  thing that actually blocked a delivered piece was an assumption — that a
  watercolour treatment could not be built — and it was false. Before recording a
  limit as real, ask whether it is the medium's or the method's.
- **"I cannot make this" is a claim that needs a build behind it.** Otherwise it is
  the same shape of error as reporting a pass nobody measured.


Two recorded corrections from a real session, both from the person who owns the
work, both pointing at the same mistake:

> "You don't need to hand-paint — you can make *other* material have that
> hand-painted quality."

> "Learn the basic design principles and one unified practice. Don't memorise
> materials one by one and copy them."

The first correction is about capability (it was believed to be missing and was
not). The second is about form: after the first correction the work became a
materials catalogue, which is the same error wearing better clothes.

## The core lesson is not the operations

Four courses' worth of material, and the thing the owner said was the most important part of all of it
is not any of the techniques:

> "The most core thing I wanted you to learn from that course is not how to do the operations — it is
> that so many of these things can be **made by ourselves**. You have to learn the basic design
> principles and ONE unified practice method, not memorise materials one by one and copy them. And you
> even wrote them down and still couldn't use them, and ended up fiddling with parameters."

So the deliverable of this skill is **a method, not a library**. Two consequences, both of which were
learned by failing at them:

**A recipe you cannot apply is not knowledge.** The failure was not that the material recipes were
wrong; it was that they were *recorded and then not used*, and the session ended up adjusting numbers
anyway. If this file's practical sections are being read as a menu to select from, it is being read
wrong — the point is that the chain is yours to build.

**Do not mistake a capability gap for a real one.** The owner's correction on this is worth keeping
verbatim: *"You don't need to hand-draw — you can take other material and process it into that
hand-drawn quality."* It had been recorded as "I cannot change the watercolour brushstrokes", which is
a statement about a limit that did not exist. **Before accepting a limit, ask whether it is a limit of
the medium or of your method** — most of the ones that look like the first are the second.

## Repetition is not a system

*"A base shape plus a copy"* is a failure, not a method. It appears in the course material as something
the demonstrator does while working, and it was adopted as a technique for building a set — which
produced *"a heap of base shapes with no texture and no relation between them"*.

The distinction is the one in `design-judgement`: **reuse the CONTENT and the COMPLEXITY, do not copy
the form.** In practice that means one construction and many derivatives of it, varied along the axes
the eye actually reads (which form, how many, how heavy), plus density by position — not the same shape
placed repeatedly at different sizes. The owner's line on the reverse error is exact: *"you should
compare their complexity and their technique, then think separately about what YOUR image needs — not
copy it over."*

## Where complexity actually comes from

Not from gradients. Not from opacity. A composite gets its complexity from
physical facts:

| Source | What it means on the page |
|---|---|
| **Paper's fibre and cockle** | The sheet has a grain direction and a surface that catches light unevenly. |
| **Shadow varying with height** | A piece lying flat casts a tight, dark shadow; one curled up casts a wide, faint one. Height is legible through the shadow even when the piece is small. |
| **Physical attachment between elements** | String, pins, tape, stitching, a staple, a stamp crossing a fold. This is what makes a set of loose items read as **one document**. |
| **A shared process across materials** | One halftone, one duotone, one ink, one light. Without this, a photograph beside a drawn element reads as a printed sheet with a sticker on it. |

The single most useful correction here, again in the owner's words:

> "They are not textures — they are us simulating things in the real world. They
> should stack the way real things stack, not use transparency to make layers."

**This is the technical core of the skill.** Building depth with opacity turns
paper into tracing paper. Real paper is opaque, so stacking is **occlusion**.
When a sheet needs to sit back, lower its VALUE, not its opacity.

## The connections are the design

A recorded example of the failure, from the same session: tape that sticks to
nothing, ticket stubs with no journey, a stamp that is not stamped on any
document, a timer that times nothing. Each object was individually plausible and
placed at the correct density. The page still failed, because **density is not
structure**.

The version that worked organised the page as one object: a packing list for a
journey — a letter, a receipt with six line items and a total, a postmark
crossing the fold, labels attached to the objects they name, and **a line from
every row to its own item**. Same elements. Same density. The difference is that
every element now has a reason to be where it is.

So: before adding material, answer **what connects to what**. If the answer is
"they are distributed nicely", the page is not designed yet.

## Making curves and edges that do not staircase

The engine renders at the declared size. Curves drawn directly at final
resolution come out aliased — a wire reads as a gear-toothed band, an ink circle
as a polygon, a connector as a polyline. This was a real, measured defect.

Two settings settle it, and both are engine-side:

- **Render supersampled.** Draw at 3× and downsample. The engine accepts a
  supersample factor on the render; a hand-rolled 3× board was the workaround
  before it did, and it turned a polygon into a genuine curve.
- **Curves need dense sampling.** A polyline through control points stays a
  polyline no matter how the canvas is scaled. Catmull-Rom (or equivalent) dense
  sampling is what makes a line a curve.

And for anything metallic: **build the shading from gradients, not from segments.**
A recorded failure — a wire built by stamping a circle along a path and filling
each segment with a flat colour — produced visible hard-edged bands. Replacing the
segments with one gradient removed them. The five-tone ramp (highlight, light,
mid, dark, reflected) is what makes metal read as metal, and it has to be
continuous.

## What the engine can do, and what it cannot

Checked against the source, because a previous handover listed capabilities that
were already present and capabilities that still are not:

| Capability | State | Where |
|---|---|---|
| Controllable bevel/emboss | **Present.** Styles `innerBevel` / `outerBevel` / `emboss` / `pillow` / `stroke`; parameters `depth`, `size`, `soften`, `angle`, `altitude`, `highlight`, `highlightOpacity`, `shadow`, `shadowOpacity`. | `src/effects.mjs`, the `bevel` entry |
| Supersampled rendering | **Present** (see above). | `src/render.mjs` |
| Mask dissolve | **One correct form only.** A single shape covering the whole box, pure alpha, `gamma` to place the dissolve, and `color` is required. | see below |
| Sweep/stroke-along-path primitive | **Absent.** A wire has to be built from a path plus gradients by hand. | — |
| Uniform noise on near-black or near-white | **Absent.** The `filmGrain` preset masks noise to the midtones, so it does nothing at the extremes. Write the graph yourself. | `src/presets.mjs` |

### The mask dissolve, which has exactly one correct form

```json
"mask": { "shapes": [
  { "shape": "rect", "x": X, "y": Y, "w": W, "h": H,
    "paint": { "type": "fade", "angle": 90, "from": 1, "to": 0,
               "gamma": 2.6, "color": "#FFFFFF" } }
] }
```

Three ways it was got wrong, all of which leave the defect visible:

1. **`blend: 'multiply'` used as a dissolve.** That darkens, it does not make
   transparent — the edge is still there. Worse, `maskRetained` drops, so the
   number looks like the dissolve worked.
2. **Several partial rectangles each carrying a bit of mask.** They fight, and
   the result washes out whatever is in the middle — in the recorded case, a face.
3. **Placing the cut where the content is.** If the source is one solid block of
   ink (verified with `region-ink`: no column has under 1% ink), the bottom edge
   can only be solved by alpha, not by finding a natural boundary.

## The order to work in

1. Decide **what the object is**, and what physically connects its parts.
2. Choose **one craft chain** and one unifying target — one ink, one screen, one
   light.
3. Settle the material families you actually need, from the reference, not from
   taste. A reference with leather, a transparent mat, white paper, fluorescent
   tape, metal staples and a PVC lanyard is asking for six families; delivering
   two of them is a shortfall a reviewer will see.
4. Build, render supersampled, and crop at 1:1 before judging any edge, any
   curve, or any material.

## What this skill does not cover

Whether the object should be a packing list rather than a shop window is a
**design** judgement — see `design-foundations`. Whether the result is genuinely
pleasing rather than merely correct is not something this file can settle, and
neither can any tool here; that boundary is named in the working policy and
belongs to the person who owns the work.
