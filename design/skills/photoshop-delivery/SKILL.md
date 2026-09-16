---
name: photoshop-delivery
description: Use when a design must reach a human as a layered file, when a client expects a PSD, or when someone asks you to drive Photoshop. Covers the engine's own layered-PSD export with no Photoshop involved, what Photoshop is and is not for in this workflow, the verified ExtendScript recipes for the APIs that are widely believed to be unavailable, why `design_photoshop` hangs under the default sandbox and how to fix it, the adjustment-layer limitation in Photoshop 2026, and how to avoid leaking Adobe licensing processes. Load before promising a layered deliverable.
---

# Photoshop and layered delivery

## The correction that matters most

If you have read the project's original brief, it says that Photoshop's
automation interface is trimmed: that text colour, adjustment layers, layer
masks, clipping masks, gradient fills, `halftonePattern` and curves are all
unavailable, and that the only viable workflow is "a script builds the skeleton
and a human completes the tone in the GUI".

**That is wrong, and the conclusion drawn from it is wrong too.** Every one of
those was an ExtendScript **syntax** error, not a capability limit. All of them
work when written correctly:

| believed unavailable | the working form |
|---|---|
| text colour (`RGBColor` throws 内部错误) | `new SolidColor()` with `.rgb.hexValue` |
| adjustment layer (`Mk` + `adjustmentLayer`) | `Mk` + `Usng`:`contentLayer` + `Adjs` |
| layer mask from a selection | `Mk` + `Nw `:`Chnl` + `Usng`:`UserMaskEnabled` + `RvlS` |
| clipping mask (`GrpC`) | `groupEvent`, then `setd` with `putBoolean('group', true)` **directly on the descriptor** |
| gradient fill layer | `contentLayer` + `gradientForm` + a `colors` stop list |
| `halftonePattern` | works, but **grayscale documents only**; use `colorHalftone` for RGB |
| curves | `executeAction` on a raster layer |

**What was actually trimmed was the scripting, not Photoshop.** The lesson is
worth carrying: when an API "does not work", try at least two correct
formulations before concluding the capability is absent. The brief's own
anti-pattern list says this — "treating a self-check failure as a missing
feature" — and the case that produced it was this one.

## What Photoshop is for here — and what it is not for

**Use it for exactly one thing: handing a human a layered file they will refine.
And even that is now optional (see the next section).**

**Do not route the design loop through it.** Measured on this machine:

| | engine | Photoshop via COM |
|---|---|---|
| iteration round trip | **~1-2 seconds** | 30-60 seconds (cold start) |

Good design takes rounds. Spending the round budget on waiting is what stops a
composition reaching the number of iterations it needs, and the result is worse
for a reason that has nothing to do with tools. Develop in the engine; involve
Photoshop, if at all, at delivery.

## The engine writes layered PSDs itself

`design_render ... --psd` writes a real layered PSD — no Photoshop involved:

```powershell
node bin/design.mjs render scenes/kv.json --out out --name poster --psd
```

* One PSD layer per scene layer, named from the layer's `id`, in compositing
  order, with per-layer opacity and a `norm` blend key.
* Each layer carries its own RGBA channels, alpha as channel `-1` and RGB as
  `0/1/2` — PSD's layer channel order is alpha-first, the opposite of the
  composite.
* Channels are PackBits RLE-compressed; the composite preview is RLE with the
  shared row-count table the format requires.
* The layer pixels are captured **from the same buffers the renderer
  composited**, so the PSD's layers cannot disagree with the PNG beside it. That
  is a guarantee by construction, not by a second implementation agreeing with
  the first.
* Adjustment layers are deliberately **not** captured as raster layers: an
  adjustment layer has no pixels of its own, and their effect is already baked
  into the composite and into every layer beneath them in visual terms.

Verification: `node test/psd-roundtrip.mjs` — 24 checks covering the header, the
image-resource block, the consistency of the two enclosing length fields, the
layer count, names, geometry, opacity, channel declarations, and a composite
compared **byte-for-byte** against the rendered PNG. It does not decode every
layer channel; that limitation is stated in the test's own header rather than
hidden.

**Why write the format at all.** Two reasons. Layered delivery appeared to be the
one thing needing Photoshop, and the APIs that seemed missing were not missing —
so the premise for the dependency was gone. And on this machine Photoshop is not
dependable (below), so a delivery path that routes through it is a delivery path
that sometimes does not work. A design agent whose handover depends on a process
that may never start is not finished.

## When `up` hangs: it is almost always the sandbox

If `design_photoshop action:"up"` times out, **the first hypothesis is DSH's file
sandbox, not Photoshop.**

Photoshop writes its preferences, workspace and dialog settings into
`%APPDATA%\Adobe` on **every** start. Under the default `workspace-write` policy
those paths are denied — measured:

| target | confined shell |
|---|---|
| the session workspace | writable |
| the sandbox's own private temp | writable |
| `%APPDATA%\Adobe\Adobe Photoshop 2026\…` (settings) | **DENIED** |
| `%APPDATA%\Adobe` | **DENIED** |
| the ordinary user `%TEMP%` | **DENIED** |
| `%LOCALAPPDATA%\Adobe` | **DENIED** |

**Photoshop does not fail fast on a denied write — it blocks forever.** The
signature, measured from a confined shell over four full minutes:

```
MB=908   CPU=11.7s   Responding=False   threads=136     (and holding)
```

CPU frozen after roughly ten seconds, thread count stable, **no crash and no error
message** — indistinguishable from a dead application. The same launch, allowed
to write, reported `COM ready in 9.4s, version 27.6.0`.

**So:**
* **Fix:** invoke the bridge with wider file access (`danger-full-access`). The
  settings directory is outside the workspace, so there is no way to work around
  it by changing a working directory.
* **Do not** go looking at GPU drivers, `PSUserConfig.txt`, or a reinstall. An
  earlier version of this skill blamed an integrated-GPU fault on the strength of
  `imgraphcut.h` assertion lines in `PSErrorLog.txt` — **those entries were from
  2026/7/24 and the hang produced no new ones.** Always check a log's timestamp
  before reasoning from it.
* **If the user will not widen access, do not use Photoshop.** The engine writes
  layered PSDs itself and the design loop never needed Photoshop.

## Never launch Photoshop repeatedly

Each **failed** start makes Adobe's licensing subsystem spawn another
`adobe_licensing_wf.exe` that **never exits**. Measured in one session: **38
accumulated processes**, growing by roughly one per attempt.

Healthy is **0–1** of them, and a new one exits on its own about two minutes
later. The distinguishing test:

```
healthy : 0-1, and new instances EXIT
leaking : count climbing, single-threaded, ~116 handles, CPU accumulating, ZERO exits
```

`design_photoshop action:"status"` reports the count. If it is climbing, **stop
launching** and clear the backlog. `-Up` additionally refuses to launch while any
Photoshop process exists (exit 4), precisely so a retry loop cannot feed this.

## Adjustment layers cannot be created by automation in Photoshop 2026

This is a genuine version boundary and it cost a lot of time to establish, so do
not re-litigate it. **Eight formulations were tried and all failed**, including a
control on a different adjustment family:

| attempt | result |
|---|---|
| `Mk` + `adjustmentLayer` + `Type` | FAIL |
| `Mk` + `adjustmentLayer` + `Adjs` payload | FAIL |
| `Mk` + `contentLayer` + `Adjs` payload | FAIL |
| curves, same shapes | FAIL |
| levels (control, different family) | FAIL |
| eight adjustment types in a batch | none reachable |
| `Type` at top level, no `Usng` | FAIL |
| `brightnessContrast`, no `Usng` | FAIL |

Plus: **`LayerKind` enumerates ZERO constants** in this version, so the
adjustment-layer kinds are not exposed to ExtendScript at all.

Eight attempts, a control, and a missing API constant is a **version boundary,
not a syntax error.** Everything tonal belongs to the engine, which does curves,
hue/saturation, desaturate, duotone, grain and tone wipes **per-pixel and exactly**
— and does it without Photoshop at all.

**But keep the general lesson**, because it is the opposite conclusion and it is
also true: text colour, layer masks, clipping masks, gradient fills,
`halftonePattern`, and curves **on raster layers** all work. The earlier attempt
called those "unavailable" and they were syntax errors. **Try at least two correct
formulations before concluding a capability is missing, and say which you tried.**

**The consequence for how you work:** treat Photoshop as unavailable unless
`design_photoshop action:"status"` reports it up. Design and verify in the
engine, and deliver the layered PSD the engine writes. If a human specifically
needs Photoshop for a step, say plainly that it is not reachable on this machine
and let them decide.

## If you do need to drive Photoshop

```
design_photoshop action:"up"                            # once; slow, may time out
design_photoshop action:"status"                         # running? COM? open docs?
design_photoshop action:"run" script:"path/to/x.jsx"     # against the RUNNING instance
design_photoshop action:"down"
```

**The instance is reused**, so `run` costs seconds rather than a cold start. Two
things make this usable at all:

* **A hard timeout.** `DoJavaScript` is a blocking out-of-process COM call; if a
  modal dialog appears it never returns and the whole session hangs. The bridge
  runs it on a background runspace, waits with a timeout, and kills Photoshop
  rather than blocking. (The earlier attempt buffered all output and wrote it at
  the end, so a hang left no evidence at all.)
* **Append-as-you-go logging.** JSX should open its log file, append one line,
  and close, for every step. Then a timeout still tells you which step completed
  last and therefore where it hung. Write probes this way, not with an array
  accumulated in memory.

**Never trust a probe's negative result without checking the syntax.** Set
`DialogModes.NO` on every `executeAction`; verify a filter is available on the
document's colour mode before using it; and when something fails, try the other
standard formulation before recording it as unsupported.
