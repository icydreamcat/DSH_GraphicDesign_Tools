/**
 * The C-press direction, rebuilt with scope — the test of whether the feature
 * actually solves the problem it was built for.
 *
 * WHAT WAS WRONG BEFORE
 * ---------------------
 * The first `poster-c-press` applied a full-strength duotone to the whole subject
 * and turned a character into a flat olive silhouette: the face, the hair colour and
 * every internal detail gone. Measured, the subject's olive share went to 0.85+ in
 * every band. Lowering `strength` did not fix it — it produced a half-erased
 * character instead, which is worse.
 *
 * WHAT SCOPE CHANGES
 * ------------------
 * The duotone can now be confined to the OUTERMOST part of the subject, so the face
 * and body keep their colour and only the silhouette's edge takes the press
 * treatment. That is how the screen-print reference actually behaves, and it is the
 * thing uniform strength could never express.
 *
 * The two scopes here do different jobs:
 *
 *   duotone   an ELLIPSE over the lower body and skirt, inverted — so the treatment
 *             lands on everything except the oval containing the face and torso
 *   halftone  a RAMP across the lower third, so the dot screen fades UP into the
 *             figure instead of stopping at a hard line
 *
 * The halftone ramp is the second half of the idea: an effect with a hard edge reads
 * as a crop; an effect whose influence fades reads as a press that ran light.
 *
 * Run: node scenes/build-press-scoped.mjs
 */
import { writeFileSync } from 'node:fs'

const W = 2400
const H = 1350
const M = 96
const INK = '#20241C'
const OLIVE = '#83923A'
const PAPER = '#F1F1EC'
const SUBJECT = 'D:/DSH_GDT/DSH_GraphicDesign_Tools/engine/assets/haruka-figure.png'

const scene = {
  canvas: { width: W, height: H },
  ground: PAPER,
  layers: [
    {
      id: '01-ground', shape: 'rect', x: 0, y: 0, w: 1, h: 1,
      paint: { type: 'linear', angle: 108, stops: ['#F6F6EE', '#EDEDE0', '#E4E4D4'] },
    },

    // The band keeps its screen: a halftone dot field is the press signature, and on
    // a large flat area it reads as tone rather than as texture.
    {
      id: '02-band', shape: 'rect',
      x: -M * 2, y: H * 0.34, w: W + M * 4, h: H * 0.40,
      paint: '#D8DCC4',
      effects: [
        { type: 'duotone', shadows: '#5C6438', midtones: '#9AA364', highlights: '#E9EBD8', strength: 0.9 },
        { type: 'halftone', size: 15, angle: 22, tone: 'source', maxTone: 0.38, color: '#3A4028', respectAlpha: true },
      ],
    },

    {
      id: '03-subject', shape: 'image', src: SUBJECT,
      x: W * 0.54, y: H * 0.04, w: W * 0.42, h: H * 0.94,
      fit: 'contain', anchorX: 0.5, anchorY: 0.5, quality: 'high',
      effects: [
        // The press treatment, held OFF the face and torso by an inverted ellipse.
        //
        // The ellipse is positioned against the SUBJECT'S OWN BOX, not guessed in
        // canvas fractions. The subject is placed at x = W*0.54, y = H*0.04 with
        // w = W*0.42, h = H*0.94 and fitted `contain`, so the figure's head sits in
        // the top ~22% of that box and the torso below it. The first attempt put the
        // oval at canvas x 0.30-0.72 — mostly off the figure to the left — and the
        // top band's olive share came back at 0.975, i.e. the face was not protected
        // at all. A scope is a geometric claim and has to be measured like any other.
        {
          type: 'duotone',
          shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2', strength: 1,
          scope: { shape: 'ellipse', x: 0.60, y: 0.03, w: 0.36, h: 0.50, paint: '#FFFFFF', invert: true },
        },
        // A soft dot screen rising from the bottom edge, through a ramp so it has no
        // crop line.
        {
          type: 'halftone',
          size: 12, angle: 22, tone: 'source', maxTone: 0.34, color: '#3A4028',
          replace: true, respectAlpha: true,
          scope: { type: 'ramp', angle: 90, stops: ['#000000', '#000000', '#FFFFFF'], at: [0, 0.05], size: [1, 1.5] },
        },
        // A hard offset plate shadow in olive: the flat-colour registration mark a
        // screen print leaves.
        //
        // SCOPE IT. An unscoped drop shadow is the whole silhouette, offset, at
        // opacity — so it covers the layer it belongs to, including everything an
        // earlier effect in the stack preserved. Measured along the subject's axis,
        // adding an unscoped olive shadow moved the start of the olive treatment from
        // y=708 — exactly the protecting ellipse's edge — up to y=276: the shadow had
        // painted over the protected face.
        //
        // The same inverted ellipse the duotone uses keeps the plate mark on the
        // outlying figure, where a registration offset belongs, and off the face.
        {
          type: 'dropShadow', angle: 135, distance: 20, size: 0, opacity: 0.85, color: OLIVE,
          scope: { shape: 'ellipse', x: 0.60, y: 0.03, w: 0.36, h: 0.50, paint: '#FFFFFF', invert: true },
        },
      ],
    },

    {
      id: '04-rule-top', shape: 'line', x1: M, y1: M * 1.5, x2: W - M, y2: M * 1.5,
      stroke: '#3A4028', width: 1.5, opacity: 0.5,
    },
    {
      id: '05-rule-bottom', shape: 'line', x1: M, y1: H - M * 1.4, x2: W - M, y2: H - M * 1.4,
      stroke: '#3A4028', width: 1.5, opacity: 0.5,
    },

    {
      id: '06-title', shape: 'text',
      x: M, y: H * 0.36, w: W * 0.46,
      text: 'GINKGO', size: 214, font: 'Grotesk', weight: 600,
      letterSpacing: -4, color: INK, align: 'left', wrap: false,
      effects: [
        { type: 'dropShadow', angle: 135, distance: 7, size: 0, opacity: 1, color: OLIVE },
        // A faint dot screen over the letters, which is how a large solid letterform
        // would actually print.
        { type: 'halftone', size: 10, angle: 22, tone: 'source', maxTone: 0.14, color: '#2A2E22', respectAlpha: true },
      ],
    },
    {
      id: '07-sub', shape: 'text',
      x: M + 4, y: H * 0.36 + 208, w: W * 0.42,
      text: 'MUELSYSE · 银杏计划', size: 34, font: 'SansSC', weight: 500,
      letterSpacing: 10, color: '#5C6438', align: 'left', wrap: false,
    },
    {
      id: '08-body', shape: 'text',
      x: M, y: H - M * 3.2, w: W * 0.42,
      text: 'A study in accumulation — many faint marks, one focus, a grid that never announces itself.',
      size: 21, font: 'SansSC', weight: 400,
      color: INK, opacity: 0.72, align: 'left', wrap: false,
    },
    {
      id: '09-meta', shape: 'text',
      x: W - M - 320, y: H - M * 1.05, w: 320,
      text: 'GINKGO / PRESS / 2026', size: 16, font: 'Mono',
      color: INK, opacity: 0.5, align: 'right', wrap: false,
    },
  ],
}

writeFileSync('scenes/press-scoped.json', JSON.stringify(scene, null, 2), 'utf8')
console.log(`scenes/press-scoped.json  ${scene.layers.length} layers`)
