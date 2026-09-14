---
name: design-foundations
description: Use when designing or evaluating any graphic design work — a key visual, poster, cover, brand sheet, or information layout. Covers the intent-before-form discipline, the four-layer understanding path (function, hierarchy, relation, form), the four verification questions, the anti-pattern list derived from a real failed attempt, and how to convert a reference image into a buildable specification. Also carries the design judgement that separates a correct page from a designed one — why a reference supplies vocabulary rather than style, why one generating rule beats a hundred placements, how markers differ from pointers, why difference is the mechanism rather than the trimming, and how to hold marks down against a wordmark. Load this before laying out a page, and again when a composition is not working and you cannot say why.
---

# Design foundations

## What this skill is for

Every other skill in this preset is about *how* to make something. This one is
about whether the thing should exist in the shape you are about to give it.

The material here is not general theory gathered from books. It comes from a
review of a real attempt at exactly the kind of work this preset does — a
single-page editorial key visual — that failed in specific, recorded ways. That
review's own conclusion is the reason this skill is first in the catalog:

> My environment explained 30% of the failures; my technique explained 30%; and
> **aesthetic and design understanding explained 40%**. The environment part only
> affected my ability to *rescue* a design — it never caused the initial design
> errors. Even with every API returned to me, the output would not suddenly be
> professional, because I did not know what it should look like to be good
> enough.

So the value here is not inspiration. It is a list of the ways this goes wrong,
in the order they go wrong, with the check that catches each one.

## The error that causes all the others: starting at the bottom layer

The attempt above made one structural mistake that produced everything else. It
described its own mistake precisely:

> I counted how many triangles the reference had, that it had halftone and
> monospace labels, and moved those features across. The result was a pile of
> features, not a design.

That is what happens when you begin at the level of shapes, colours and
typefaces. There are four levels, they have a required order, and starting at
the fourth makes the first three unrecoverable — because by the time you notice
the hierarchy is wrong, every element is already placed and sized.

| Level | Question | What it sounds like |
|---|---|---|
| **1. Function** | What must this layout accomplish? | "The reader must know what this is within three seconds." |
| **2. Hierarchy** | What is most important, and what order does the eye take? | "The title is the only first-level item. The name is second. Everything else is annotation." |
| **3. Relation** | What are the proportions, weights, positions, gaps? | "The title is 2.4× the next level and occupies 38% of the measure." |
| **4. Form** | Which shapes, colours, typefaces? | "A low-chroma olive, an outlined grotesque, a 24px module." |

**This is where aesthetics actually lives — at level 3, not level 4.** The
review's failure list is the evidence. Six errors, every one of them relational,
not one of them "the colour was ugly" or "the shape was unattractive":

| What was made | What it should have been | The error type |
|---|---|---|
| Subject at 90% of canvas height | about 60%, leaving room to breathe | **proportion** |
| Geometric blocks opaque and enormous | tiny, very pale, layered | **weight** |
| Grid at 24px spread evenly over everything | sparse, chosen, systematic | **density** |
| Name in solid white on a light ground | olive outline, and the visual lead | **order** |
| Halftone as a full-bleed background texture | a tonal tool, appearing locally | **material understanding** |
| Primary information (the name) overpowered by secondary (the class) | clear first and second levels | **hierarchy** |

Note what is absent. Not one entry is about a colour being wrong or a shape
being poorly drawn. **When your work looks amateur, look at the relationships
first — almost always before you look at the elements.**

## The one rule worth memorising

The review found this and called it more useful than ten reference images. It is
the single most transferable thing in this document:

> **The reference's richness comes from HIGH FREQUENCY, LOW CONTRAST — very many
> elements, each extremely faint. What I produced was LOW FREQUENCY, HIGH
> CONTRAST — few elements, each heavy. That is why mine looked clumsy.**

Practically, this means:

- Reach for **more marks at lower weight**, not fewer marks at higher weight.
- A busy page is not the same as a loud page. A hundred 6%-opacity hairlines
  read as *fine*; five 60%-opacity blocks read as *crude*.
- **The instinct to make something bigger, darker or more opaque to give it
  presence is the instinct to distrust.** Fix presence by adding smaller
  elements around it, or by giving it space.
- Both numbers are measurable. `design_critique` reports mean and peak local
  detail; if mean detail is near zero the surface is flat, and if detail is
  present in every cell at the same level your texture has stopped being a local
  event.

## The four questions

The review's operational test of whether a layout holds up. Two are answerable
by measurement, two are yours to answer honestly.

**1. Delete half the elements — is the information still complete?**
If removing half loses nothing, that half was decoration. The first move when a
composition is not working is *removal*, not addition. This never gets easier
and it is nearly always right.

**2. Squint — is the focus unique?**
Several focal points means no focal point. `design_critique` answers this from
salience and reports how many regions compete with the leader. **A non-unique
focus is a defect, not a warning.** Fix it by making one thing decisively
larger, or by weakening everything that competes — usually the second.

**3. Remove the colour — does the hierarchy still hold?**
Hierarchy carried by colour is the most fragile kind: it vanishes in single-ink
printing, in grayscale, and for any viewer who does not separate those hues.
Hierarchy must survive on size, weight and position. Colour is then
amplification, not structure. `design_verify` flags low-contrast text without an
outline for exactly this reason.

**4. Ignore the content — does the layout convey a character?**
This is the definition of "设计感". A layout has character when it has a
measurable grid, a consistent stroke vocabulary, and a controlled tone band —
independent of what the words say. `design_critique` answers this one directly
and tells you which of the three is missing.

## Turning a reference into a specification

The review drew a hard line here, and it is the difference between being able to
rebuild a look and merely being able to describe it:

```
A description:  "This image has halftone, olive green, geometric elements
                 and monospace labels."
                 — useless. It cannot be built from, and it is what copying
                 a look actually consists of.

A specification: "Ground luminance 0.84 (#EBEBEB); the tone band holding 90%
                 of the image spans 0.78; accent colour share 3.1% measured as
                 large flat fills; a 35px column grid, confidence 0.74;
                 dominant stroke weights 1px (59%) and 2px (33%); 27 resolved
                 regions, sizes from 0.1% to 4% of canvas; detail peaks at
                 0.061 in the figure area and falls to 0.001 in the ground
                 corners."
                 — buildable, and checkable afterwards.
```

**Run `design_analyze` on every reference before designing against it.** It
produces the second form directly. When you write your own intent statement,
write it in the same register.

## The anti-pattern list

Straight from the recorded failures. Treat these as hard constraints, not
suggestions.

### Composition

| Anti-pattern | Instead |
|---|---|
| Subject occupying more than 70% of the canvas | 50–65%, with breathing space |
| Every element heavy — high opacity, high contrast | many elements, each faint |
| Grid or texture spread evenly across the whole canvas | local, faded, chosen |
| Few elements, each large | many elements, or fewer but with layered supporting marks |
| Accent colour used in large areas | accent share stays within a few percent |
| The heaviest weight given to the least important information | the weight scale follows the information scale exactly |
| Hierarchy carried by colour | carried by size, weight, position; colour amplifies |
| Text in the same colour as the background | on a light ground, never solid white text |

### Process

| Anti-pattern | Instead |
|---|---|
| Writing the scene before answering the three intent questions | answer them first, in writing |
| Scaling up to many pages before one works | verify one, completely, then repeat |
| Asking "did my elements appear?" | ask "does this look like a designed page?" |
| Adding to fix a weak composition | subtracting |
| Iterating many rounds with no human input | surface it to a person every few rounds |
| Estimating a width, coverage or contrast | measure it with a tool |

### Technique (from the engine's own development)

These are worth knowing because they are the traps that *look* like design
problems and are not:

| Anti-pattern | Why it happens | Instead |
|---|---|---|
| Approximating a gradient with stacked translucent rectangles | the gradient tool was believed unavailable | use a real gradient; a `fade` paint with stops is one |
| A dot screen composited on top of a flat fill | the screen only ever *adds* ink, so the fill stays solid | halftone on a shape uses `replace` by default — the dots become the ink |
| A tone or coverage ramp evaluated across the whole canvas | tone operations run on a full-canvas buffer | shape-level `tone` runs over the shape's own box |
| Deriving a dot field's size from the ink colour | dark ink then produces enormous dots | dot size follows the tone, not the ink |
| Spreading a dot screen into the transparent area around a shape | transparent pixels have RGB 0,0,0 and read as maximum darkness | the engine skips unpainted pixels; a screen takes the subject's silhouette |
| A dropped or masked element left a visible rectangle | a gradient whose stops span the canvas finishes long before a small panel begins | a mask's box must be the shape's own box, not the full canvas |

## Design judgement

Everything above is either procedure or measurement. This section is neither: it is the
judgement that separates a **correct** page from a **designed** one. Every item was learned
from a specific failure, and the failure is given because the rule alone does not transfer —
the reason does.

### A reference supplies vocabulary, not style

The reference's radial instrument marks were there because **that page was itself a
fictional corporate dossier**. Lifting the marks into a page about ginkgo puts data readouts
on a document that has no data: the form survives, the justification does not.

So take the reference's *manner* — its density, its restraint, its reserve — and let **your
subject** decide which marks it needs. Ask of every borrowed element: *what in my subject
justifies this?* An element that cannot answer is decoration imported from someone else's
argument.

The same asset also reads differently in a different context. A ring is a ring: in the
reference it is a gauge, in your piece it may be a leaf or a blossom. **Name it honestly and
use it** — refusing to reuse a form because the reference used it first is as wrong as
copying it whole. What must not transfer is the reference's *subject*.

### One generating rule beats a hundred placements

Placing elements one at a time, without a rule that produces them, gives a page of
**well-arranged strangers**: every element individually fine, and none of them answering any
other. This is the most common way a page that passes every check still reads as unfinished.

The test is cheap: **state the rule that generated a group.** "The marks step out along the
line of sight, getting smaller and lighter as they go" is a rule. "I placed them where they
looked good" is not, and a group without a rule will not survive being moved.

### Difference is the mechanism, not the trimming

One page of identical marks at identical weight is a **texture, and texture has no
direction**. It registers as a surface, not as movement.

Movement needs variation *along the path the eye travels*, and it needs all three axes at
once: **which mark, how many, how heavy**. Varying only size leaves the texture flat —
larger identical marks are still identical marks.

### Marks divide by function, and the two kinds are not interchangeable

- A **marker** is radially symmetric with no axis. Its value is in **position**. Four of them
  define a rectangle, and the eye reads the enclosed area as one whole — so put them in the
  **corners, not scattered**. Scattering them destroys the only thing they do.
- A **pointer** has a head and a tail. Its value is in the **path it describes**, and its
  position matters only as a point on that path.

Using one as the other produces a page that is busy without being structured.

### Marks must never compete with the wordmark

Hold them down with **group opacity and a size ratio**, and the ratio is the part usually
forgotten. A 32px mark against a 218px wordmark is **1:7**, and that ratio is what keeps the
marks reading as a field rather than as small competitors. Lowering opacity alone leaves them
competing — faint competitors are still competitors.

### Two images on one page must share a craft

A photograph with one treatment beside a drawn element with a different one reads as **a
printed sheet with a sticker on it**, however good either half is alone. The page stops being
one object.

Bring them onto one process: one halftone, one duotone, one ink. If you cannot put them
through the same treatment without damaging one, that is information about the pairing, not a
reason to treat them differently.

### A photograph is a mass, not a texture

Type lands in the space a mass **gives up**; it does not sit on top of it. Placing a text
block over the middle of a photographic mass is the most common way a page loses its
legibility while every measurement still passes — the contrast check measures the average
under the text, and an average can be comfortable while the individual pixels are not.

### Material is drawn or reworked; it cannot be pasted

A copied shape carries no anatomy, so it **cannot be rotated into a different posture** — it
will always read as the same cut-out, at any angle. Reworking means rebuilding it from parts
you control, so the parts can move independently.

But **real material beats generated geometry, provided the subject is right.** A photograph
brings occlusion, overlap and fine twig structure that recursive geometry did not reach in
ten rounds of trying. The condition is the whole content of the rule: a real photograph of
the wrong subject is worse than a drawing of the right one, so **the subject is the veto, not
the technique.**

### Replacing material means deleting the old material in the same change

Adding without subtracting leaves **two generations on the page at once**, and the older one
is usually the approach the last round rejected. A half-replaced page is read by anyone who
saw the previous round as a regression, not as progress.

### Type can be material, not only a label

An enlarged outlined wordmark crossing the whole page is a **surface**, and can carry the
composition the way a shape would. Reach for this when the page needs a form and no shape is
available — and note that at that size it stops being read as a word first and as a form
first, which is a decision about what the piece is for.

## What measurement cannot reach

The review was honest about a real ceiling, and so should you be:

> There is a part of aesthetics I cannot obtain from tools: *why* this design
> pleases, what character this brand should have, whether this metaphor is
> appropriate. That part comes only from large-scale extraction of rules from
> real award-winning work, from generalising human feedback into reusable rules,
> and from **admitting my own ceiling**.

The honest formulation: **you can approach "correct"; "exquisite" is hard.** For
most deliverables — systems, specifications, corporate material — correct is
enough. Where genuine refinement is required, the right answer is to design the
work as a division of labour: you build the structure and the system to a
verified standard, and the human makes the final aesthetic call. Say so when you
reach that boundary, rather than substituting a confident guess for their
judgement.

## The working loop

```
0. Capability reconnaissance
   └─ does the engine render at the size I need? Verify with one small scene.
1. Reference analysis
   └─ design_analyze → specification: colours, shares, luminance band,
      scale ladder, grid pitch, element count and faintness.
2. Intent statement
   └─ write down: the single focus / the reading path / what is subordinate.
3. System
   └─ design_system → the type ladder and the colour ramp, before any element.
4. One page: build → render → critique → correct
   └─ expect 3–5 rounds. Look at the image every round.
5. Human confirmation
   └─ take the feedback and turn it into a rule, not just a fix to this page.
6. Systematic expansion
   └─ freeze the verified design as parameters, then generate the set.
7. Delivery
   └─ PNG for review; layered PSD through design_photoshop if a human will
      refine it.
```

Steps 0 and 3 are the ones most often skipped, and skipping them is the most
expensive mistake available. A scene built on an unverified assumption about the
engine, or on ad-hoc type sizes chosen per element, will need to be rebuilt
rather than corrected.
