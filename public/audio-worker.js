// Audio conversion Web Worker — runs WebM→OGG remuxing off the main thread
// to prevent UI blocking during voice message processing.

// ─── EBML (WebM) parsing ────────────────────────────────────────────────────

function readVintSize(data, offset) {
  if (offset >= data.length) return { value: 0, length: 0, unknown: false }
  const first = data[offset]
  if (first === 0) return { value: 0, length: 0, unknown: false }
  let len = 1
  let mask = 0x80
  while (len <= 8 && (first & mask) === 0) { len++; mask >>= 1 }
  if (len > 8) return { value: 0, length: 0, unknown: false }
  let value = first & (mask - 1)
  const allOnes = (mask - 1) === value
  for (let i = 1; i < len; i++) {
    if (offset + i >= data.length) return { value: 0, length: 0, unknown: false }
    value = (value << 8) | data[offset + i]
    if (data[offset + i] !== 0xff) {
    } else if (!allOnes) {
    }
  }
  let unknown = false
  if (allOnes) {
    let check = true
    for (let i = 1; i < len; i++) { if (data[offset + i] !== 0xff) { check = false; break } }
    if (check) unknown = true
  }
  return { value, length: len, unknown }
}

function readVintId(data, offset) {
  if (offset >= data.length) return { value: 0, length: 0 }
  const first = data[offset]
  if (first === 0) return { value: 0, length: 0 }
  let len = 1
  let mask = 0x80
  while (len <= 4 && (first & mask) === 0) { len++; mask >>= 1 }
  if (len > 4) return { value: 0, length: 0 }
  let value = first
  for (let i = 1; i < len; i++) {
    if (offset + i >= data.length) return { value: 0, length: 0 }
    value = (value << 8) | data[offset + i]
  }
  return { value, length: len }
}

const EBML_IDS = {
  Segment: 0x18538067, Tracks: 0x1654AE6B, TrackEntry: 0xAE,
  CodecID: 0x86, CodecPrivate: 0x63A2,
  Cluster: 0x1F43B675, SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1,
  Timecode: 0xE7, TrackNumber: 0xD7,
}

function parseEbml(data) {
  const elements = []
  let pos = 0
  while (pos < data.length - 1) {
    const id = readVintId(data, pos)
    if (id.length === 0) break
    pos += id.length
    const size = readVintSize(data, pos)
    if (size.length === 0) break
    pos += size.length
    const dataStart = pos
    const dataEnd = size.unknown ? data.length : Math.min(pos + size.value, data.length)
    elements.push({ id: id.value, dataStart, dataEnd, size: dataEnd - dataStart })
    if ([EBML_IDS.Segment, EBML_IDS.Tracks, EBML_IDS.TrackEntry, EBML_IDS.Cluster, EBML_IDS.BlockGroup].includes(id.value)) {
      // container — descend
    } else {
      pos = dataEnd
    }
  }
  return elements
}

function extractOpusFromWebm(data) {
  const elements = parseEbml(data)
  let opusHead = null
  let opusTrackNumber = 1
  const packets = []

  for (const el of elements) {
    if (el.id === EBML_IDS.CodecID) {
      const codec = String.fromCharCode(...data.slice(el.dataStart, el.dataEnd))
      if (codec !== 'A_OPUS') throw new Error('Not an Opus WebM')
    }
    if (el.id === EBML_IDS.TrackNumber && el.size <= 8) {
      let v = 0
      for (let i = 0; i < el.size; i++) v = (v << 8) | data[el.dataStart + i]
      opusTrackNumber = v
    }
    if (el.id === EBML_IDS.CodecPrivate) {
      opusHead = data.slice(el.dataStart, el.dataEnd)
    }
    if (el.id === EBML_IDS.SimpleBlock || el.id === EBML_IDS.Block) {
      const trackVint = readVintSize(data, el.dataStart)
      const trackNum = trackVint.value
      if (trackNum !== opusTrackNumber) continue
      const headerSize = trackVint.length + 2 + (el.id === EBML_IDS.Block ? 0 : 0)
      const frameData = data.slice(el.dataStart + headerSize + 1, el.dataEnd)
      if (frameData.length > 0) packets.push(frameData)
    }
  }

  if (!opusHead) {
    opusHead = new Uint8Array([
      0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
      1, 1, 0x38, 0x01, 0x80, 0xBB, 0x00, 0x00, 0x00, 0x00, 0x00,
    ])
  }
  return { opusHead, packets }
}

// ─── OGG container ──────────────────────────────────────────────────────────

function crc32Ogg(data) {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1)
    table[i] = r >>> 0
  }
  let crc = 0
  for (let i = 0; i < data.length; i++) crc = ((crc << 8) ^ table[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0
  return crc
}

function buildOggPage(serial, pageSeq, granule, headerType, segments) {
  let totalData = 0
  for (const s of segments) totalData += s.length
  const numSegments = segments.length
  const segTable = new Uint8Array(numSegments)
  for (let i = 0; i < numSegments; i++) segTable[i] = segments[i].length
  const headerSize = 27 + numSegments
  const page = new Uint8Array(headerSize + totalData)
  const view = new DataView(page.buffer)
  page[0] = 0x4F; page[1] = 0x67; page[2] = 0x67; page[3] = 0x53 // OggS
  page[4] = 0 // version
  page[5] = headerType
  view.setUint32(6, granule & 0xFFFFFFFF, true)
  view.setUint32(10, Math.floor(granule / 0x100000000) & 0xFFFFFFFF, true)
  view.setUint32(14, serial, true)
  view.setUint32(18, pageSeq, true)
  view.setUint32(22, 0, true) // CRC placeholder
  page[26] = numSegments
  page.set(segTable, 27)
  let offset = headerSize
  for (const s of segments) { page.set(s, offset); offset += s.length }
  const crc = crc32Ogg(page)
  view.setUint32(22, crc, true)
  return page
}

function getOpusFrameDurationMs(frame) {
  if (frame.length === 0) return 20
  const toc = frame[0]
  const config = (toc >> 3) & 0x1F
  const durations = [10,20,40,60, 10,20,40,60, 10,20,40,60, 10,20, 10,20, 2.5,5,10,20, 2.5,5,10,20, 2.5,5,10,20, 2.5,5,10,20]
  return durations[config] || 20
}

function buildOgg(opusHead, packets) {
  const serial = (Math.random() * 0xFFFFFFFF) >>> 0
  let pageSeq = 0
  const pages = []
  pages.push(buildOggPage(serial, pageSeq++, 0, 0x02, [opusHead]))
  const opusTags = new Uint8Array([
    0x4F,0x70,0x75,0x73,0x54,0x61,0x67,0x73,
    0x05,0x00,0x00,0x00, 0x73,0x7A,0x65,0x70,0x74,
    0x00,0x00,0x00,0x00,
  ])
  pages.push(buildOggPage(serial, pageSeq++, 0, 0x00, [opusTags]))
  let granulePos = 0
  const PRE_SKIP = 312
  const SAMPLE_RATE = 48000
  for (let i = 0; i < packets.length; i++) {
    const pkt = packets[i]
    const durationMs = getOpusFrameDurationMs(pkt)
    const samples = (durationMs / 1000) * SAMPLE_RATE
    granulePos += samples
    const isLast = i === packets.length - 1
    const headerType = isLast ? 0x04 : 0x00
    const segmentList = []
    let remaining = pkt.length
    let off = 0
    while (remaining >= 255) { segmentList.push(pkt.slice(off, off + 255)); off += 255; remaining -= 255 }
    segmentList.push(pkt.slice(off, off + remaining))
    pages.push(buildOggPage(serial, pageSeq++, granulePos + PRE_SKIP, headerType, segmentList))
  }
  let totalLength = 0
  for (const p of pages) totalLength += p.length
  const result = new Uint8Array(totalLength)
  let writePos = 0
  for (const p of pages) { result.set(p, writePos); writePos += p.length }
  return result
}

// ─── Worker message handler ─────────────────────────────────────────────────

self.onmessage = function(e) {
  try {
    const data = new Uint8Array(e.data)
    const { opusHead, packets } = extractOpusFromWebm(data)
    const ogg = buildOgg(opusHead, packets)
    self.postMessage(ogg.buffer, [ogg.buffer])
  } catch (err) {
    self.postMessage({ error: err.message || 'Conversion failed' })
  }
}
