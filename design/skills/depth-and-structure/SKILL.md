---
name: depth-and-structure
description: Use before composing ANY page, and again whenever a design reads thin, flat, or "close in the numbers but ugly in the eye" — and whenever an element seems to exist only as an area with a contrast value. Covers the four ordering layers (function, hierarchy, relation, form) and why starting at form is unrecoverable; the depth axis (3-4 stacked layers, one job each, focus by inversion, opaque where readability matters); why a filled mass is not an organised surface (dominant flat colour share and distinct colour count, and the thresholds that separate the two); why detail is not hierarchy; built order as layers-then-density; the grayscale check; and how to read a measurement without mistaking a composite value for a design value. This is the dimension that flat metrics like area, element count and stroke width cannot see, and the one most often skipped.
---

# Depth and structure

Most bad output from this agent is not badly coloured or badly kerned. It is **thin**: one
flat mass where the reference had an organised surface, and a set of numbers that match a
reference while the picture does not. This skill is the missing dimension. Read it before
composing anything; apply §5 before adding a single element.

## What this skill is for

Sources: the repository's rule set, in `docs/rules/` — plus two methodology documents in `docs/`:

| File | What it is |
|---|---|
| `docs/rules/深色界面-完整做法.md` | The specification, as rules: surfaces, colour and accent budget, type, form, depth, density, layout, prohibitions. |
| `docs/rules/测量与清点.md` | The order that precedes measuring, and what only video can decide (alpha, motion). |
| `docs/设计方法原理-给agent.md` | The method. Four ordering layers, depth axis, the fill-vs-organisation rule. |
| `docs/设计问题与技术问题-给agent.md` | A real delivery's failure list, with the numbers. |

The case studies behind these — the full breakdowns, the measurements, the claims that were
overturned — are **not shipped**. They are local reading material: this skill cites them by
name in its prose, and a fresh clone gets the rules rather than the cases.

Every threshold below is a **measured anchor from one design language**, not a target to
reproduce. They are calibration, and they are the difference between a number and a guess.

---

## 1. The failure this skill exists to stop

> "像素占比上近似，但不存在设计性。" — the user, on a cover whose big area matched the
> reference's 42% exactly.

A region occupied 42% of the canvas, so a 42% block was placed there. **The proportion
matched and the design was zero**, because the reference's 42% was not one colour — it was
an organised surface with internal hierarchy. A fill had been substituted for an
organisation.

That is the same error as "moving closer in the parameters and uglier in the eye". Three
named symptoms, all one mistake:

| Symptom | What is actually wrong |
|---|---|
| "占比对了但没设计性" | Area matched; internal organisation absent (§4) |
| "参数接近了但视觉上很难看" | Measurement optimised; the picture never looked at (§3) |
| "画面薄、没有复杂度" | One plane where the reference had 3–4 depth layers (§5) |

**The bounding error, stated once: every metric in this workspace is FLAT.** Area share,
element count, stroke width, contrast, whitespace — none of them has a depth axis. A
stacked structure read with flat metrics produces a confident wrong answer.

---

## 2. The four layers, and why order is not negotiable

| Layer | The question | Sounds like |
|---|---|---|
| **1. Function** | What must this surface accomplish? | "The reader must know what this is in three seconds." |
| **2. Hierarchy** | What matters most, in what order does the eye travel? | "The title is the only A. The name is B. Everything else is annotation." |
| **3. Relation** | Proportion, weight, position, spacing — relative to what? | "The title is 2.4× the secondary and takes 38% of the measure." |
| **4. Form** | Which shapes, colours, faces? | "Low-saturation olive, outlined sans, 24px module." |

**Aesthetics live in layer 3, not layer 4.** In the recorded failure list, six errors, and
**not one was "the colour was ugly" or "the shape was unbeautiful"** — every single one was
relational:

| Was built | Should have been | Kind of error |
|---|---|---|
| Subject at 90% of canvas height | ≈60%, leaving air | proportion |
| Geometry opaque and huge | small, very faint, layered | weight |
| 24px grid across the whole canvas | sparse, selective, systematic | density |
| Name in solid white on a pale ground | olive outline, and visually dominant | order |
| Halftone screen as a full-bleed background | a tonal tool, used locally | material |
| Primary information overruled by secondary | a clean first and second level | hierarchy |

> **When work looks amateur, look at the relations first. Almost always before the elements.**

### Starting at layer 4 is the root error

Once forms are placed and sized, layers 1–3 are unrecoverable — every element already has a
size and a position, and the discovery that the hierarchy was wrong arrives after the fact.
This is why it is skipped: layer 4 feels like work and layer 1–3 feels like thinking.

---

## 3. Measure, do not estimate — and then look anyway

### 3.1 Three sentences before any element exists

Write these down, in words, before placing anything:

1. **What the reader must see first — and only that one.** Not "the title": "X, and it
   competes with nothing."
2. **The path the eye takes.** Where it starts, what it passes, where it stops.
3. **Which elements are secondary and must give way.** Giving way means smaller, fainter,
   nearer the edge — not "also acceptable".

> Beginning to place shapes without these three written is decoration, however skilled the
> execution. This omission is the least visible afterwards and the most expensive.

### 3.2 Every value carries its reference

- ❌ "The title is 148px" — no information.
- ✅ "The title is 2.4× the secondary and takes 38% of the measure" — a decision.

The reason is not formalism. Measured: the same yellow `#FFFA00` reads **15.26:1** on a dark
ground and **1.07:1** on cream paper — **erasure**. One token, two surfaces, one emphasis and
one disappearance. **A ground system and a text system that do not know about each other are
the crack where this fails.**

### 3.3 Measurement is the start of a specification, not the end

```
Description (useless):
  "The reference has a halftone screen, olive green, geometric elements and mono labels."
  — Nothing can be built from this, and "copying a look" is made of exactly these sentences.

Specification (buildable):
  "Ground luminance 0.84 (#EBEBEB); the band holding 90% of pixels spans 0.78, sitting near
   the ground; accent 3.1% counted as large flat fills; leaders are a 1.1% pale cream and a
   2.6% olive family; a 35px column grid at confidence 0.74, no row grid resolved; dominant
   stroke 1px (59%) and 2px (33%); 27 regions from 0.1% to 4% of the canvas; local detail
   peaks at 0.061 in the figure area and falls to 0.001 in the ground's corners."
  — Buildable, and checkable afterwards.
```

### 3.4 The two meta-rules that beat every rule below

**① A metric is a means, not the goal.**

To match a reference's distinct-colour count, 300 specks of 2–3px were scattered on a near-black
ground. The count rose 234 → 553. But the positions came from `x = (i*977+137) % 1920` — an
**arithmetic sequence, not random** — which produced a visible periodic dot lattice and moiré,
and the specks were 16 levels brighter than the ground, not sub-threshold.

Removing the lattice: **553 → 549.** The loudest thing on the page barely existed in the metric.

- Any change made to raise a metric **must be looked at**. An unviewed metric improvement is
  not an improvement.
- When a number improves and the picture worsens, **believe the picture.**
- Chasing a number you cannot verify is how you start fabricating.

**② Ask what the element is FOR here before applying a technique.**

A toolkit contained "fold an illustration into the palette" (duotone). It was applied to nine
reference images — and the subject of that deck **was colour**: one page argued "the whole game
has exactly one yellow", another covered accent budget. After the duotone, the page proving
"only one yellow" had a grey illustration.

- **A unifying technique must not eat the content.** To blend an image with the page use its
  **edges** (feather, frame), not its **tone** — unless the image's colour is not information.
- Before taking a technique off the list: *what information does this element carry, and does
  the technique touch it?*

---

## 4. Complexity: a filled mass is not an organised surface

### 4.1 The measurement

For the rectangle you are judging, compute two things:

```
dominantFlatShare = the most frequent single RGB, as a share of the rectangle
distinctColours   = how many different RGB values appear in it
```

### 4.2 The thresholds (measured anchors)

| Metric | Passing |
|---|---|
| Large region, `dominantFlatShare` | **< 25%** (reference UI surfaces measured 3.0%–20.8%) |
| Large region, `distinctColours` | **200–7000**, by the region's job: a quiet carrying surface 188–200; the richest cartographic ground 1383–7032 |

Measured pairs — the two failures are a fill substituted for an organisation:

| Sample | dominantFlat | distinctColours |
|---|---|---|
| reference: main-screen left UI ground | **3.0%** | **1383** |
| reference: main-screen lower-right UI ground | 20.8% | 196 |
| reference: empty mailbox panel | 19.6% | 188 |
| reference: inventory under-panel | 14.5% | 7032 |
| **failed**: own cover ground, before | **42.8%** | **327** |
| **failed**: own pale panel, before | **87.6%** | **191** |
| after: cover ground | 3.5% | 234 |
| after: focus panel | 29.0% | 417 |

### 4.3 Two traps in reading this

**Apply it to surfaces, not to pictures.** A duotone-treated illustration, a gradient, a
photograph or any rendered mass will often show a **high** dominant-flat share, because the
most-populated 5-bit bucket of a continuous tone range is not a flat fill. Measured on one
real render: a 45%-of-canvas photographic band read `dominantFlat` 0.408 with 4346 colours —
high dominant-flat **and** high colour count, which is the signature of continuous tone, not of
a filled block. The question this metric answers is *"is the area that should have been
organised actually organised"* — so judge it on grounds, panels, bands and blocks you placed.
Today it is reported per detected region and per point-sample; **it is not yet reported for an
arbitrary rectangle you choose**, so for a specific panel measure that rectangle directly.

**Compare like with like.** A UI surface may only be compared with a UI surface, never with
**picture content**. Comparing one's own ground against a **terrain render inside a dial**
(2926 colours) produced "nine times less designed" — that was rendered content, not a designed
surface. Against real UI grounds the reference range is 188–7032, and 234/417 sits inside it.

**Do not chase the colour count as a target.** Much of the reference's higher count comes from
its **medium** — 3D rendering, a photographic world behind translucent panels, antialiased text
at many sizes. Chasing it is how you start **forging a medium you are not in**. One reference
screen measured 18071, and most of it was the terrain inside a dial.

### 4.4 A high dominant-flat share can be a composition consequence, not a defect

One page's pale paper covered 48.9% of the canvas with `dominantFlat` 31.8%. The reference's
paper page held 10.1% because it was broken up by six large figures, a row of ghost numerals
and a scale rule — **and because that page's function was an index.**

> **When "make it richer" means "turn it into a different page", stop.** Ask the region's job
> before judging its dominant flat. A quiet large paper may be right; a quiet large block that
> should have been carrying information is always wrong.

### 4.5 The unit trap that silently destroys a page

**In this engine, a length ≤ 1 is a canvas FRACTION; > 1 is pixels.**

```js
rect(x, y, 1, 1, '#0F1213')   // intending a 1px speck
// actually: an opaque rectangle covering the whole canvas (1 = 100%)
```

300 "specks" were written; 200 of them were full-bleed, washing the ground grey:
**dominantFlat 3.5% → 54.4%, distinctColours 234 → 118, and the engine reported nothing.**

**Any "1px" mark must be written ≥ 2.** Use pixel values for bleed (`-20`, `W + 40`), never 1.
Re-run the page statistics after rendering: on a thumbnail this looks like nothing worse than
"a bit dirty".

### 4.6 Detail ≠ hierarchy

Detail fixes `distinctColours`; it does not make the region read as **designed**. The five
things that do, cheapest first:

1. A 1px top-edge highlight — "this is a lit solid"
2. Corner registration brackets — "this is a framed column"
3. One line of small Latin micro-label + a hairline — "this column has a name"
4. Three weights of internal text (label / value / unit)
5. One local fade — "the texture appears here and disappears", not laid on evenly

> **Test: delete all the text from this region. Does it still read as "a panel someone
> designed" rather than "a block of colour"?** If only a block, you are missing some of the five.

Detail *sources*, by cost: sub-threshold grain (a `noise` source + `blend`, very low amount);
fine horizontal ruling (a dozen 1px hairlines at 1.06–1.1:1); a speck field (1–2px, alternating
one step lighter and darker). **The speck field must be genuinely random** — see §3.4 ①.

⚠️ `filmGrain`'s preset masks grain to the **midtones**, so on a near-black ground the mask is
≈0 and **nothing happens**. Write the graph yourself and drop the mask.

### 4.7 Density targets, and the order that makes them work

| Metric | Target |
|---|---|
| independent regions | **40+** (a fine page can reach 300) |
| largest single region | **≤ 15%** of the canvas |
| 1px stroke share | dark surface **38%–55%**; on pale paper 2px overtakes 1px |
| local detail peak ÷ minimum | **5–8×** — it must be localised, not uniform |

**Detail must be localised.** Measured on one key visual: mid-frame 0.079, bottom corners
0.010 — nearly 8×. Uniform texture reads as **wallpaper**; localised texture reads as
**drafting**.

---

## 5. Build order: layers first, then density

This is the section to follow literally. It is the step that gets skipped.

**"Many elements, each very faint" is an incomplete prescription — it supplies density and no
structure.** A hundred 6% marks scattered on one plane is **mush**. Distributed across four
depth layers they read as a **system**.

> **Decide the layers first, then the density.**

### Step 1 — Decide the surface

Paper (light) or charcoal (dark)? Judge by function: content to be **read at length** → paper;
a surface that must **hold down a 3D scene or carry dense live data** → charcoal.

- Ground: paper `#E3E3E3`, **not pure white** (white reads as a screen, pale grey reads as
  paper). Charcoal near-black, **not pure black** (pure black is "unset"); ink `#191919`.
- Both surfaces may coexist in one product — **one screen is one surface.**

### Step 2 — Declare 3–4 depth layers, each with one job

Measured charcoal stack:

| Layer | Value | Job |
|---|---|---|
| ground | near-black | hold down the scene, push the interface back |
| carrying surface | `#2B2929` | lists, live data, status readings |
| operable surface | `#C3C3BF`–`#CDCBCB` | buttons, clickable areas |
| focus | `#FDFCFC` | **the one focus, inverted** |

**3–4 layers, one job each. More layers means there is no layer position left.**

**Focus by inversion, and only one.** The brightest element on that screen was neither the
largest, nor the highest contrast, nor at the visual centre — it was the **only element that
flipped the light/dark register**. This is cheaper than a border, a shadow, a size increase or
an animation. **The cost is explicit: a second one cancels it.** Two inverted elements means no
inversion.

**Layering ≠ translucency.** Both HUD capsules measured **opaque** (α ≥ 0.942 and ≥ 0.997).
**Where readability must be guaranteed, do not let the ground through** — the opposite of the
current frosted-glass fashion, and a measurable trade: world-feel traded for reading stability.
**Criterion: data that must be read sits on an opaque or near-opaque surface (α ≥ 0.9).**

### Step 3 — Declare the colour budget against those layers

- Every colour value is recorded **with the layer it lands on** (§3.2).
- One accent. Counted as large flat fills: **0%–2%**, one outlier at 3.1%; **hue presence
  3%–5.5%**. 10% is not an accent, it is a field of colour.
- Distinct roles are not interchangeable: brand signal, "new/unread/pending" marker, and
  "urgent" badge are three different colours; using one for another's job collapses the system.
- **The signal colour should come from something the world already contains** — establish it in
  the artwork or asset library, then let the interface use it. Choosing a saturated colour off a
  palette and painting it on produces **a plastic panel**.

### Step 4 — Declare the generating rule, then the density

State the rule that generates the set of elements. The test is cheap: **say the rule out loud.**

- ✅ "These marks step back along the line of sight — smaller and fainter with distance."
- ❌ "I put them where it looked good."

Then apply §4.7's density numbers. **Primitives are assembled, and corner points snap to grid
intersections** — that is why the reference's figures read as *engineering symbols* rather than
icons. Set the grid first, then snap.

### Step 5 — Only now choose form

Shapes follow the nature of the object: a point that is physically round is drawn round; a panel
that is sheet metal is drawn square. Do not round a panel for softness, and do not square a dot
for consistency. **The rule is not "all right angles" — that is a common misreading of this
language.**

### Step 6 — Pass it through grayscale

**Layering is a screen-native technique; it collapses in print and in monochrome.** `#2B2929`
on near-black measures **1.144:1** — its visibility depends entirely on a controllable ground.

> **Any structure built from luminance difference must be asked: how much of it survives in
> grey?** Structure carried by shape, position and size survives print; structure carried by
> luminance difference may not.

Same physical cause, another observation: lines on a dark ground are thinner (1px dominant,
38%–55%); lines on pale paper are heavier (2px 34.7% vs 1px 27.5%). On near-black a 1px light
line is already visible; on bright paper a 1px line disappears.

---

## 6. Reading a measurement without fooling yourself

### 6.1 Every number is either a **composite** value or a **design** value

**A screenshot is not a plane; it is a composite.** Reading layered design with flat metrics
gives confident wrong answers.

| Layering mechanism | Why it breaks flat measurement | What it poisons | How to detect it |
|---|---|---|---|
| **translucent compositing** | reading = α·element + (1−α)·background. A **mid-grey opaque panel** and a **translucent white panel on a dark ground** are mathematically indistinguishable in one frame | every opacity reading, cross-region tone comparison | **fix the element, vary the background, watch the reading** |
| **emission / glow** | soft edges form no flat region; glow filaments manufacture 1px runs | `flatShare` (systematically low) | find the same element unlit |
| **global post** (vignette, grade, grain, DoF, sharpen) | one token reads differently at different screen positions | cross-position colour comparison | **sample one element at several positions** |
| **letterbox black** | constant contamination | histogram, darkest-band share, mean luminance | measure it first, remove it, then compute |
| **occlusion order** | you think you measured layer A, you measured B on top of it | any bbox-averaged colour | 1:1 crop |

**A composite value may be compared, located and used as a constraint. The moment it is written
into a specification as a design value — "large masses sit at opacity ≤0.5" — you are calibrating
your canvas to someone else's monitor.**

### 6.2 Named readings that are wrong

| Reading | Reality |
|---|---|
| "the large mass is faint, implied opacity 0.33–0.46, so large masses are faint" | true only as **composited brightness coverage**; it was **four stacked layers**, not a design decision |
| "`flatShare` = the accent budget" | it measures **flat-fill survival**. A full-width yellow band scored 1.0% while its hue cluster was 4.55%, because the band is interrupted by the wordmark, grey blocks and glow |
| "`flatShare` = 0, so there is no yellow" | the yellow existed as **emission**, forming no flat region. On glow-driven surfaces `flatShare` **systematically under-reads**; read the hue cluster too |
| "`columnPitch: null` means there is no grid" | **wrong.** The detector finds the periodicity of **drawn lines**, not of **tiled cells** — a visually obvious tile grid also reports null. **null reads only as "not detected", never as "does not exist"** |
| "the darkest band went 48.1% → 48.0% over four years, unchanged" | **wrong.** After removing 10% letterbox black it is 48.1% → **≈42%** |
| "`flatColors` reports two different yellows, so there are two palette values" | they are **one band composited over two different grounds** (R−G flipped +8 → −5 across the band) |

### 6.3 The criterion that catches the missed layer

> **If the only thing you can say about an element is its area and its contrast — if you cannot
> state its layer position — the analysis is not finished.**

### 6.4 What measurement cannot reach

Measurement gets you to **correct**. **Refinement is hard.** These are not reachable, and must
not be replaced by a confident guess:

- whether the metaphor is apt;
- whether the brand's character suits its audience;
- whether the composition is genuinely pleasurable rather than only correct;
- whether a trade-off (world-feel for reading stability) is worth it in this product.

**Organise the work as a division of labour: build the structure and the system to "correct"
by verifiable standards, and leave the final aesthetic judgement to the person who owns it.**

---

## 7. Delivery checklist

**Before composing**
- [ ] The three sentences are written (§3.1)
- [ ] Surface decided: paper or charcoal — one screen, one surface
- [ ] 3–4 depth layers declared, each with one job (§5 step 2)
- [ ] Exactly one focus, obtained by inversion
- [ ] Generating rule stated out loud (§5 step 4)

**On the page**
- [ ] No element exists only as area + contrast — every one has a layer position
- [ ] `dominantFlatShare` < 25% for any large region; `distinctColours` inside 200–7000
- [ ] No "1px" mark written as `1` (§4.5) — all are ≥ 2
- [ ] Detail localised, peak ÷ minimum 5–8×; regions 40+, largest ≤ 15%
- [ ] Reading data sits on α ≥ 0.9
- [ ] Ground is not `#FFFFFF` and not `#000000`

**Machine-checkable**
- [ ] `design_verify` / `design_critique`: `overflow` and `fontFallback` are **0**; any
  "layer failed" is read for its reason (a clean-looking report can be missing a whole layer)
- [ ] `accentFlatShare` 0–2%; `primaryTypeRatio` adjacent steps **≥ 1.25×**
- [ ] Focus unique — exactly one region within ±15% of the leader
- [ ] Page statistics re-run after rendering (this is what catches §4.5)

**The three the tools cannot do**
- [ ] **Looked at the render.** Not only the numbers (§3.4 ①)
- [ ] Deleted half the elements in your head — is the information still complete?
- [ ] Squinted — is the focus still unique? *Multiple foci is a defect, not a warning.*
- [ ] Removed colour — does the hierarchy still hold? *Colour is amplification, not structure; a
  static contrast checker measures text against the **ground**, so it cannot see layering.*

---

## 8. If you remember only one thing

> **Proportion correct is not design correct. A metric improving is not the picture improving.
> Before applying a technique, ask what the element is doing here.**
>
> **Decide the layers before the density. Measure and look — missing either one, you will
> confidently deliver something wrong.**
