/**
 * A layered PSD writer — minimal and explicit.
 *
 * This replaces an earlier attempt in which the same value appeared in two
 * consecutive length fields, so every reader landed four bytes early and
 * reported a file with no layers. The format is unforgiving here: a length
 * field is followed immediately by the data it measures, and the layer-info
 * length field measures the payload that follows it rather than itself.
 *
 * So this file is written the other way round from the first attempt: the
 * payload of each section is built FIRST as its own byte array, and the length
 * is then written as a separate, obvious prefix. Nothing is computed from a
 * running offset, because that is where the previous version went wrong.
 *
 * Layout produced (offsets for an 8x4 one-layer document, used by the tests):
 *
 *   0   header                       26 bytes
 *   26  colour mode data               4 bytes (length 0)
 *   30  image resources                4 + 26
 *   60  layer-and-mask section length  4 bytes
 *   64  layer-info length              4 bytes
 *   68  layer count                    2 bytes
 *   ... layer records ...
 *   ... channel data ...
 *   ... composite image data ...
 *
 * The invariant the tests check is simply:
 *   u32(60) === totalBytes - 64 - compositeLength
 *   u32(64) === (bytes from 68 to the end of the channel data)
 *   u16(68) === layerCount
 */

// ── PackBits ────────────────────────────────────────────────────────────────

/**
 * PackBits-compress a byte array.
 *
 * Two input shapes are needed. A highly repetitive channel (flat fills,
 * hairlines, type) compresses enormously, while photographic content does not.
 * For the composite image data PSD stores ONE compression word for all three
 * channels plus a single shared table of per-row byte counts, and that layout
 * exists only for RLE — so the composite must always be RLE even when it grows.
 * `forceRle` covers that; layer channels keep the raw fallback because each one
 * carries a complete record of its own and can legitimately decline.
 *
 * @param {Uint8Array} src
 * @param {boolean} [forceRle]
 * @returns {{body: Uint8Array, rowLengths: number[], rle: boolean}}
 */
export function packChannel(src, width, height, forceRle = false) {
  const rowLengths = []
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = src.subarray(y * width, (y + 1) * width)
    const packed = packRow(row)
    rows.push(packed)
    rowLengths.push(packed.length)
  }
  const packedTotal = rowLengths.reduce((a, b) => a + b, 0)
  if (!forceRle && packedTotal >= src.length) {
    return { body: src, rowLengths: null, rle: false }
  }
  const body = new Uint8Array(packedTotal)
  let o = 0
  for (const r of rows) { body.set(r, o); o += r.length }
  return { body, rowLengths, rle: true }
}

/** PackBits for a single scanline. */
function packRow(row) {
  const out = []
  const n = row.length
  let i = 0
  while (i < n) {
    let run = 1
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++
    if (run > 1) {
      out.push(257 - run, row[i])
      i += run
      continue
    }
    let lit = 1
    while (
      i + lit < n && lit < 128 &&
      !(i + lit + 2 < n && row[i + lit] === row[i + lit + 1] && row[i + lit] === row[i + lit + 2])
    ) lit++
    out.push(lit - 1)
    for (let k = 0; k < lit; k++) out.push(row[i + k])
    i += lit
  }
  return Uint8Array.from(out)
}

/** Decode PackBits, for the reader and the tests. */
export function unpackChannel(data, expected) {
  const out = new Uint8Array(expected)
  let o = 0
  let i = 0
  while (i < data.length && o < expected) {
    const h = data[i] < 128 ? data[i] : data[i] - 256
    i++
    if (h >= 0) {
      const count = h + 1
      for (let k = 0; k < count && o < expected; k++) out[o++] = data[i++]
    } else if (h > -128) {
      const count = 1 - h
      const v = data[i++]
      for (let k = 0; k < count && o < expected; k++) out[o++] = v
    }
  }
  return out
}

// ── byte helpers ────────────────────────────────────────────────────────────

/** Big-endian fixed-width unsigned value as a byte array. */
function be(value, width) {
  const out = new Uint8Array(width)
  for (let i = width - 1; i >= 0; i--) {
    out[i] = value & 0xff
    value = Math.floor(value / 256)
  }
  return out
}

/** Four-character code. */
function fourcc(s) {
  if (s.length !== 4) throw new Error(`fourcc needs 4 characters, got "${s}"`)
  return Uint8Array.from([...s].map((c) => c.charCodeAt(0)))
}

/**
 * Pascal string: length byte, bytes, then padding so the FIELD ends even.
 * PSD pads to two, not four.
 */
function pascal(s) {
  const body = [...Buffer.from(s, 'utf8')]
  if (body.length > 255) throw new Error(`PSD name too long: ${body.length} bytes`)
  const total = 1 + body.length
  const pad = total % 2 === 0 ? 0 : 1
  return Uint8Array.from([body.length, ...body, ...new Array(pad).fill(0)])
}

/**
 * Unicode string, as the PSD spec defines it: a 4-byte count of UTF-16 code
 * units, then the code units big-endian, then a two-byte null.
 *
 * NOT a Pascal string and NOT UTF-8. Photoshop stores every layer name in this
 * form inside the 'luni' additional-layer-information block, and a file whose
 * layers have no 'luni' is what Photoshop 2026 reports as
 * "与当前版本不兼容" — it cannot identify the document's layers at all.
 */
function unicodeString(s) {
  const units = []
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    if (cp > 0xffff) {
      const v = cp - 0x10000
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    } else {
      units.push(cp)
    }
  }
  // Count includes the terminating null, which is how Photoshop writes it.
  const body = new Uint8Array((units.length + 1) * 2)
  units.forEach((u, i) => { body[i * 2] = (u >> 8) & 0xff; body[i * 2 + 1] = u & 0xff })
  return cat(be(units.length + 1, 4), body)
}

/**
 * An Additional Layer Information block: '8BIM' + a 4-character key + a 4-byte
 * length of the data that follows, then the data. No padding.
 */
function addlInfo(key, data) {
  return cat(fourcc('8BIM'), fourcc(key), be(data.length, 4), data)
}

/**
 * An Image Resource block: '8BIM' + a 2-byte id + a Pascal name + a 4-byte
 * length + the data, padded so the block ends even.
 */
function imageResource(id, data) {
  const named = cat(fourcc('8BIM'), be(id, 2), pascal(''), be(data.length, 4), data)
  return named.length % 2 === 0 ? named : cat(named, Uint8Array.from([0]))
}

/** Concatenate byte arrays. */
/** Byte size of an RLE row-count table: two bytes per row. */
const rowCountBytes = (rowLengths) => (rowLengths === null || rowLengths === undefined ? 0 : rowLengths.length * 2)

function cat(...parts) {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** One channel of an RGBA buffer, planar. */
function channel(img, which) {
  const offset = which === 'r' ? 0 : which === 'g' ? 1 : which === 'b' ? 2 : 3
  const out = new Uint8Array(img.width * img.height)
  for (let i = 0, j = offset; i < out.length; i++, j += 4) out[i] = img.data[j]
  return out
}

// ── the writer ──────────────────────────────────────────────────────────────

/**
 * Write a layered PSD.
 *
 * @param {object} doc
 * @param {number} doc.width
 * @param {number} doc.height
 * @param {{name: string, x: number, y: number, width: number, height: number,
 *          rgba: Uint8ClampedArray, opacity?: number, visible?: boolean}[]} doc.layers
 *   bottom-to-top, each with its own box
 * @param {{width:number,height:number,data:Uint8ClampedArray}} doc.composite
 *   the flattened image, written as the preview channel
 * @returns {Buffer}
 */
export function writePsd(doc) {
  const { width, height, layers } = doc
  if (!(width > 0 && height > 0)) throw new Error(`canvas must be positive, got ${width}x${height}`)

  // 1. Header — fixed width, big-endian.
  const header = cat(
    fourcc('8BPS'),
    be(1, 2),            // version 1 = PSD
    new Uint8Array(6),   // reserved
    be(3, 2),            // channels: R, G, B
    be(height, 4),
    be(width, 4),
    be(8, 2),            // bits per channel
    be(3, 2),            // colour mode: RGB
  )

  // 2. Colour mode data — empty for RGB.
  const colorMode = be(0, 4)

  // 3. Image resources.
  //
  // A PSD with an EMPTY resource section is legal by the letter of the spec and
  // is still what a modern Photoshop may refuse: the resource section is where a
  // document declares what it is. Two blocks matter:
  //
  //   1005 ResolutionInfo — 16 bytes, big-endian: hRes (16.16 fixed), hResUnit
  //        (1 = pixels per inch), widthUnit (1 = inches), then the same for the
  //        vertical axis. 300 dpi in 16.16 is 300 * 65536 = 19660800.
  //   1057 VersionInfo — 4 bytes version, 1 byte hasRealMergedData, then two
  //        Unicode strings (writer, reader) and a 4-byte file version. Its
  //        presence is what makes the file a recognised Photoshop document
  //        rather than an anonymous bag of layers.
  //
  // `be(300 * 65536, 4)` is used rather than a literal so the DPI is a parameter
  // a caller can change without decoding hex.
  const resolutionInfo = cat(
    be(300 * 65536, 4), be(1, 2), be(1, 2),
    be(300 * 65536, 4), be(1, 2), be(1, 2),
  )
  const versionInfo = cat(
    be(1, 4),                    // version
    Uint8Array.from([1]),        // hasRealMergedData
    unicodeString('DSH design engine'),
    unicodeString('Adobe Photoshop'),
    be(1, 4),                    // file version
  )
  const resourceBlocks = cat(
    imageResource(1005, resolutionInfo),
    imageResource(1057, versionInfo),
  )
  const resources = cat(be(resourceBlocks.length, 4), resourceBlocks)

  // 4. Layer records and their channel data.
  const list = Array.isArray(layers) ? layers : []
  const channelDataParts = []
  const recordParts = [be(list.length, 2)]

  for (const layer of list) {
    const lw = Math.max(1, Math.round(layer.width))
    const lh = Math.max(1, Math.round(layer.height))
    const img = { width: lw, height: lh, data: layer.rgba }

    // PSD layer channels are alpha first (-1), then R(0), G(1), B(2) — the
    // opposite order from the composite, which is R, G, B.
    const order = [['a', -1], ['r', 0], ['g', 1], ['b', 2]]
    const encoded = order.map(([which]) => packChannel(channel(img, which), lw, lh))

    // Each channel's declared length is its compression word plus everything
    // that follows it — which for RLE includes the row-count table, not just the
    // PackBits body.
    //
    // Writing `2 + e.body.length` omits `height * 2` bytes, and at this canvas
    // size that is 6788 bytes per channel. The error is invisible to a writer
    // that also navigates by its own numbers, which is exactly what
    // `psd-roundtrip.mjs` did: its own reader trusted the declared lengths, so
    // writer and reader agreed with each other and both disagreed with the
    // format. Tools/psd-audit.mjs walks the stream the way Photoshop does —
    // compression word, `height` two-byte row counts, sum them — and found 89 of
    // 92 channels declaring a length 6788 bytes short. Every channel after the
    // first therefore landed mid-stream for any real reader.
    const channelHeaders = []
    for (let i = 0; i < encoded.length; i++) {
      const e = encoded[i]
      const countBytes = e.rle ? rowCountBytes(e.rowLengths) : 0
      channelHeaders.push(cat(
        be(order[i][1] < 0 ? 0xffff : order[i][1], 2), // -1 stored as 0xFFFF
        be(2 + countBytes + e.body.length, 4),
      ))
      channelDataParts.push(cat(be(e.rle ? 1 : 0, 2), e.rle ? cat(...e.rowLengths.map((n) => be(n, 2)), e.body) : e.body))
    }

    const layerName = layer.name === undefined ? 'Layer' : layer.name
    const name = pascal(layerName)

    // Additional Layer Information.
    //
    // The extra-data field is: layer mask, blending ranges, the Pascal name, and
    // then a series of tagged blocks. The Pascal name alone is a legal record by
    // the spec — and it is what this writer used to emit, with the result that
    // Photoshop 2026 refused the file as an incompatible version. Photoshop
    // identifies a document's layers through the Unicode name block and assigns
    // them ids from 'lyid'; without them the layers are anonymous records the
    // application will not adopt.
    //
    //   luni  Unicode layer name — a Unicode string (NOT a Pascal string, NOT
    //         UTF-8). This is the block whose absence produced the version error.
    //   lyid  Layer id, 4 bytes. Photoshop carries these so a layer keeps its
    //         identity across a save/open/flatten round trip.
    const addl = cat(
      addlInfo('luni', unicodeString(layerName)),
      addlInfo('lyid', be(1000 + list.indexOf(layer) + 1, 4)),
    )
    // Extra data: layer mask (0) + blending ranges (0) + name + tagged blocks.
    const extra = cat(be(0, 4), be(0, 4), name, addl)

    recordParts.push(cat(
      be(Math.round(layer.y), 4), be(Math.round(layer.x), 4),
      be(Math.round(layer.y) + lh, 4), be(Math.round(layer.x) + lw, 4),
      be(4, 2),                       // channel count
      ...channelHeaders,
      fourcc('8BIM'), fourcc('norm'),
      Uint8Array.from([Math.round((layer.opacity === undefined ? 1 : layer.opacity) * 255)]),
      Uint8Array.from([0]),           // clipping
      Uint8Array.from([layer.visible === false ? 0x02 : 0x00]), // flags
      Uint8Array.from([0]),           // filler
      be(extra.length, 4), extra,
    ))
  }

  // The channel data follows all records, in the same order.
  const channelData = cat(...channelDataParts)
  // A zero-length global layer mask closes the layer-info payload.
  const layerInfoPayload = cat(cat(...recordParts), be(0, 4), channelData)
  // NO trailing pad byte.
  //
  // An earlier version padded this payload to even and then wrote the UNPADDED
  // length in front of it, so the section was physically one byte longer than it
  // said it was and `layerAndMaskLen - layerInfoLen` came out 9 instead of the
  // 8 the format requires. Tools/psd-audit.mjs caught it; the engine's own
  // round-trip test did not, because writer and reader shared the mistake.
  // Layer-info payloads do not need even alignment — only the Pascal name
  // fields inside the records do, and `pascal()` handles those.
  const layerInfoSection = cat(be(layerInfoPayload.length, 4), layerInfoPayload)

  // The layer-and-mask section contains the layer-info section and a global
  // mask, and its length field measures what FOLLOWS it.
  const globalMask = be(0, 4)
  const layerAndMaskPayload = cat(layerInfoSection, globalMask)
  const layerAndMask = cat(be(layerAndMaskPayload.length, 4), layerAndMaskPayload)

  // 5. Composite image data — always RLE, because its shared row-count table is
  //    an RLE-only construct.
  const compositeSource = doc.composite === undefined
    ? { width, height, data: new Uint8ClampedArray(width * height * 4) }
    : doc.composite
  const compositeEncoded = ['r', 'g', 'b'].map((which) =>
    packChannel(channel(compositeSource, which), width, height, true))
  const composite = cat(
    be(1, 2), // RLE
    ...compositeEncoded.map((e) => cat(...e.rowLengths.map((n) => be(n, 2)))),
    ...compositeEncoded.map((e) => e.body),
  )

  return Buffer.from(cat(header, colorMode, resources, layerAndMask, composite))
}
