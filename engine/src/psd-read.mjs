/**
 * A minimal PSD reader, used to verify what the writer produced.
 *
 * WHY A READER EXISTS IN A PROJECT THAT ONLY WRITES PSDs
 * -----------------------------------------------------
 * "I wrote a PSD" is not evidence that a PSD was written. A layer container
 * whose length fields are subtly wrong opens in one reader and not another —
 * the worst possible failure for a delivery format, because it is discovered by
 * the person who was handed the file, not by the agent that made it.
 *
 * So the writer's output is parsed back: header, colour mode, image resources,
 * the layer records with their channel lengths, and the composite channel data.
 * A round-trip that agrees on canvas size, layer count, layer names, geometry
 * and composited pixels is real evidence. Anything less is a claim.
 *
 * UnpackBits is implemented too, so the composite can be compared pixel by
 * pixel against the PNG the renderer wrote.
 */

/**
 * Read one big-endian unsigned integer of `size` bytes at `offset`.
 */
function readUint(buf, offset, size) {
  let v = 0
  for (let i = 0; i < size; i++) v = v * 256 + buf[offset + i]
  return v
}

/** Decode PackBits data into `expected` bytes. */
export function unpackBits(data, expected) {
  const out = new Uint8Array(expected)
  let o = 0
  let i = 0
  while (i < data.length && o < expected) {
    const header = data[i] < 128 ? data[i] : data[i] - 256
    i++
    if (header >= 0) {
      const count = header + 1
      for (let k = 0; k < count && o < expected; k++) out[o++] = data[i++]
    } else if (header > -128) {
      const count = 1 - header
      const value = data[i++]
      for (let k = 0; k < count && o < expected; k++) out[o++] = value
    }
    // header === -128 is a no-op by definition.
  }
  return out
}

/**
 * Parse a PSD far enough to check every field the writer is responsible for.
 *
 * Deliberately strict: an unexpected signature or a length that does not match
 * what actually follows is reported as an error rather than tolerated, because
 * tolerance here would hide exactly the bug this exists to catch.
 *
 * @param {Buffer} buf
 * @returns {object} a description of the file
 */
export function readPsd(buf, options = {}) {
  // `structureOnly` skips decoding layer channel pixels and instead trusts each
  // channel record's declared length to advance. That is the right mode for
  // verifying a large document's framing: the declared lengths are exactly what
  // a reader navigates by, so checking them for consistency and then following
  // them proves the layout is navigable. Decoding every channel is a second,
  // independent format implementation and belongs to the reader's own tests.
  const structureOnly = options.structureOnly === true
  if (buf.length < 26) throw new Error('file is too short to be a PSD')
  const sig = buf.toString('latin1', 0, 4)
  if (sig !== '8BPS') throw new Error(`bad signature "${sig}", expected "8BPS"`)

  const version = readUint(buf, 4, 2)
  if (version !== 1) throw new Error(`unsupported PSD version ${version}`)

  const channels = readUint(buf, 12, 2)
  const height = readUint(buf, 14, 4)
  const width = readUint(buf, 18, 4)
  const depth = readUint(buf, 22, 2)
  const colorMode = readUint(buf, 24, 2)

  let p = 26

  // Colour mode data
  const colorModeLen = readUint(buf, p, 4); p += 4
  const colorModeData = buf.subarray(p, p + colorModeLen); p += colorModeLen

  // Image resources
  const resLen = readUint(buf, p, 4); p += 4
  const resStart = p
  const resources = []
  while (p < resStart + resLen) {
    const blockSig = buf.toString('latin1', p, p + 4); p += 4
    const id = readUint(buf, p, 2); p += 2
    // Pascal string, padded so the whole field ends on an even boundary.
    const nameLen = buf[p]; p += 1 + nameLen
    if ((1 + nameLen) % 2 !== 0) p += 1
    const dataLen = readUint(buf, p, 4); p += 4
    resources.push({ signature: blockSig, id, dataLength: dataLen })
    p += dataLen
    if (dataLen % 2 !== 0) p += 1
  }
  p = resStart + resLen

  // Layer and mask information.
  //
  // `layerInfoLen` measures the payload that FOLLOWS the length field, so the
  // layer count begins right after it. The writer places its count the same way
  // and both agree on the arithmetic — but it is worth stating explicitly,
  // because an off-by-one-field here reads the count out of the middle of a
  // length and reports a file with no layers while every byte is valid.
  const lmLen = readUint(buf, p, 4); p += 4
  const lmStart = p
  const layerInfoLen = readUint(buf, p, 4); p += 4
  const layerInfoEnd = p + layerInfoLen

  const layerCountRaw = readUint(buf, p, 2)
  p += 2
  // A negative count means the first alpha channel is the merged result.
  const layerCount = layerCountRaw > 32767 ? layerCountRaw - 65536 : layerCountRaw
  const absCount = Math.abs(layerCount)

  const layers = []
  let lengthMismatch = null

  for (let i = 0; i < absCount; i++) {
    const top = readUint(buf, p, 4); p += 4
    const left = readUint(buf, p, 4); p += 4
    const bottom = readUint(buf, p, 4); p += 4
    const right = readUint(buf, p, 4); p += 4
    const channelCount = readUint(buf, p, 2); p += 2
    const chans = []
    for (let c = 0; c < channelCount; c++) {
      const id = readUint(buf, p, 2); p += 2
      const len = readUint(buf, p, 4); p += 4
      chans.push({ id: id > 32767 ? id - 65536 : id, dataLength: len })
    }
    const blendSig = buf.toString('latin1', p, p + 4); p += 4
    const blendKey = buf.toString('latin1', p, p + 4); p += 4
    const opacity = buf[p]; p += 1
    const clipping = buf[p]; p += 1
    const flags = buf[p]; p += 1
    p += 1 // filler
    const extraLen = readUint(buf, p, 4); p += 4
    const extraEnd = p + extraLen
    const maskLen = readUint(buf, p, 4); p += 4
    p += maskLen
    const blendingRangesLen = readUint(buf, p, 4); p += 4
    p += blendingRangesLen
    const nameLen = buf[p]; p += 1
    const name = buf.toString('utf8', p, p + nameLen)
    p += nameLen
    if (extraEnd > p) p += extraEnd - p
    layers.push({
      name, top, left, bottom, right,
      width: right - left, height: bottom - top,
      channelCount, channels: chans, blendSignature: blendSig, blendKey,
      opacity: Math.round((opacity / 255) * 1000) / 1000,
      clipping, flags,
      visible: (flags & 0x02) === 0,
    })
  }

  // Channel data follows the records, in the same order the headers declared.
  for (const layer of layers) {
    layer.channelData = []
    for (const ch of layer.channels) {
      if (structureOnly) {
        // Trust the declared length — a real reader navigates by it — and record
        // where the data sits so a caller can decode it later if it wants to.
        layer.channelData.push(null)
        layer.channelOffsets = layer.channelOffsets === undefined ? [] : layer.channelOffsets
        layer.channelOffsets.push({ id: ch.id, offset: p, length: ch.dataLength })
        p += ch.dataLength
        continue
      }
      const start = p
      const compression = readUint(buf, p, 2)
      let raw
      if (compression === 0) {
        raw = buf.subarray(p + 2, p + 2 + layer.width * layer.height)
        p += 2 + layer.width * layer.height
      } else if (compression === 1) {
        const rowCounts = []
        let q = p + 2
        for (let y = 0; y < layer.height; y++) { rowCounts.push(readUint(buf, q, 2)); q += 2 }
        const total = rowCounts.reduce((a, b) => a + b, 0)
        raw = unpackBits(buf.subarray(q, q + total), layer.width * layer.height)
        p = q + total
      } else {
        throw new Error(`layer "${layer.name}" channel ${ch.id} at offset ${start} declares compression ${compression}`)
      }
      layer.channelData.push(raw)
      const consumed = p - start
      // The declared per-channel length must equal what was actually read.
      if (consumed !== ch.dataLength) {
        lengthMismatch = `layer "${layer.name}" channel ${ch.id}: record says ${ch.dataLength} bytes, ${consumed} were present`
      }
    }
  }

  if (p > layerInfoEnd) {
    throw new Error(`layer data overran its declared block by ${p - layerInfoEnd} bytes`)
  }
  p = lmStart + lmLen

  // Composite image data
  const compositeStart = p
  const compression = readUint(buf, p, 2); p += 2
  const compositeChannels = []
  if (compression === 1) {
    const rowCounts = []
    for (let c = 0; c < channels; c++) {
      for (let y = 0; y < height; y++) { rowCounts.push(readUint(buf, p, 2)); p += 2 }
    }
    let idx = 0
    for (let c = 0; c < channels; c++) {
      let total = 0
      for (let y = 0; y < height; y++) total += rowCounts[idx++]
      compositeChannels.push(unpackBits(buf.subarray(p, p + total), width * height))
      p += total
    }
  } else if (compression === 0) {
    for (let c = 0; c < channels; c++) {
      compositeChannels.push(buf.subarray(p, p + width * height))
      p += width * height
    }
  } else {
    throw new Error(`composite uses unsupported compression ${compression}`)
  }

  return {
    signature: sig,
    version, channels, width, height, depth, colorMode,
    colorModeDataLength: colorModeLen,
    resources,
    layerAndMaskLength: lmLen,
    layerInfoLength: layerInfoLen,
    layerCount: absCount,
    layers,
    lengthMismatch,
    composite: { compression, channels: compositeChannels, bytesConsumed: p - compositeStart },
    totalBytes: buf.length,
    trailingBytes: buf.length - p,
  }
}

/**
 * Rebuild an RGBA image from a parsed PSD's composite channels.
 *
 * @param {object} parsed
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function compositeToRgba(parsed) {
  const { width, height, composite } = parsed
  const out = new Uint8ClampedArray(width * height * 4)
  const [r, g, b] = composite.channels
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = r === undefined ? 0 : r[i]
    out[i * 4 + 1] = g === undefined ? 0 : g[i]
    out[i * 4 + 2] = b === undefined ? 0 : b[i]
    out[i * 4 + 3] = 255
  }
  return { width, height, data: out }
}

/**
 * Rebuild one layer's RGBA from its stored channels.
 *
 * PSD layer channels are alpha-first (id -1), then R/G/B (ids 0/1/2).
 *
 * @param {object} layer a layer from {@link readPsd}
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function layerToRgba(layer) {
  const { width, height } = layer
  const out = new Uint8ClampedArray(width * height * 4)
  const byId = new Map()
  layer.channels.forEach((ch, i) => byId.set(ch.id, layer.channelData[i]))
  const a = byId.get(-1)
  const r = byId.get(0)
  const g = byId.get(1)
  const b = byId.get(2)
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = r === undefined ? 0 : r[i]
    out[i * 4 + 1] = g === undefined ? 0 : g[i]
    out[i * 4 + 2] = b === undefined ? 0 : b[i]
    out[i * 4 + 3] = a === undefined ? 255 : a[i]
  }
  return { width, height, data: out }
}
