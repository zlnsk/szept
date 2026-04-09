/**
 * Minimal WebM/Opus → OGG/Opus remuxer.
 *
 * Extracts raw Opus packets from a WebM (EBML/Matroska) container produced
 * by MediaRecorder and wraps them in an OGG container. The audio data is
 * NOT re-encoded — Opus frames are copied verbatim between containers.
 *
 * This is needed because Chrome records audio/webm but many Matrix bridges
 * (Signal, WhatsApp) only accept audio/ogg for voice messages.
 */

// ─── EBML (WebM) parsing ────────────────────────────────────────────────────

/** Read a VINT (variable-length integer) used for element sizes. Strips length descriptor bits. */
function readVintSize(data: Uint8Array, offset: number): { value: number; length: number; unknown: boolean } {
  if (offset >= data.length) throw new Error('VINT: out of bounds')
  const first = data[offset]
  if (first === 0) throw new Error('VINT: zero first byte')

  let len = 1
  let mask = 0x80
  while ((first & mask) === 0 && mask > 0) { len++; mask >>= 1 }

  let value = first & (mask - 1)
  let allOnes = value === (mask - 1)

  for (let i = 1; i < len; i++) {
    if (offset + i >= data.length) throw new Error('VINT: truncated')
    value = (value * 256) + data[offset + i]
    if (data[offset + i] !== 0xFF) allOnes = false
  }

  return { value, length: len, unknown: allOnes }
}

/** Read a VINT keeping descriptor bits (for element IDs). */
function readVintId(data: Uint8Array, offset: number): { value: number; length: number } {
  if (offset >= data.length) throw new Error('VINT ID: out of bounds')
  const first = data[offset]
  if (first === 0) throw new Error('VINT ID: zero first byte')

  let len = 1
  let mask = 0x80
  while ((first & mask) === 0 && mask > 0) { len++; mask >>= 1 }

  let value = first
  for (let i = 1; i < len; i++) {
    if (offset + i >= data.length) throw new Error('VINT ID: truncated')
    value = (value * 256) + data[offset + i]
  }

  return { value, length: len }
}

// EBML element IDs we care about
const CONTAINER_IDS = new Set([
  0x1A45DFA3, // EBML Header
  0x18538067, // Segment
  0x1F43B675, // Cluster
  0x1654AE6B, // Tracks
  0xAE,       // TrackEntry
  0xA0,       // BlockGroup
])

const CODEC_PRIVATE_ID = 0x63A2
const SIMPLE_BLOCK_ID = 0xA3
const BLOCK_ID = 0xA1

interface ExtractResult {
  opusHead: Uint8Array
  packets: Uint8Array[]
}

/** Walk the EBML tree and extract the OpusHead (from CodecPrivate) and Opus frame packets. */
function extractOpusFromWebm(data: Uint8Array): ExtractResult {
  let opusHead: Uint8Array | null = null
  const packets: Uint8Array[] = []
  let pos = 0

  while (pos < data.length - 2) {
    let id: { value: number; length: number }
    let size: { value: number; length: number; unknown: boolean }
    try {
      id = readVintId(data, pos)
      size = readVintSize(data, pos + id.length)
    } catch {
      break
    }

    const dataStart = pos + id.length + size.length

    if (CONTAINER_IDS.has(id.value)) {
      // Enter container — parse children directly
      pos = dataStart
      continue
    }

    if (id.value === CODEC_PRIVATE_ID && !size.unknown && size.value > 0 && size.value < 1000) {
      opusHead = data.slice(dataStart, dataStart + size.value)
      pos = dataStart + size.value
      continue
    }

    if ((id.value === SIMPLE_BLOCK_ID || id.value === BLOCK_ID) && !size.unknown) {
      // Block format: trackNum(vint) + timestamp(int16) + flags(uint8) + frame_data
      try {
        const trackVint = readVintSize(data, dataStart)
        const frameStart = dataStart + trackVint.length + 3
        const frameEnd = dataStart + size.value
        if (frameEnd > frameStart && frameEnd <= data.length) {
          packets.push(data.slice(frameStart, frameEnd))
        }
      } catch { /* skip malformed block */ }
      pos = dataStart + size.value
      continue
    }

    // Skip unknown/uninteresting elements
    if (!size.unknown && size.value >= 0 && dataStart + size.value <= data.length) {
      pos = dataStart + size.value
    } else {
      pos++
    }
  }

  if (!opusHead) {
    // Build a default OpusHead (mono, 48kHz, no pre-skip)
    opusHead = new Uint8Array([
      0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
      0x01,       // version 1
      0x01,       // 1 channel
      0x00, 0x00, // pre-skip (0)
      0x80, 0xBB, 0x00, 0x00, // 48000 Hz (LE)
      0x00, 0x00, // output gain (0)
      0x00,       // channel mapping family 0
    ])
  }

  return { opusHead, packets }
}

// ─── OGG muxing ─────────────────────────────────────────────────────────────

/** CRC-32 lookup table for OGG (polynomial 0x04C11DB7, direct/unreflected). */
const CRC_TABLE = new Uint32Array(256)
;(() => {
  for (let i = 0; i < 256; i++) {
    let crc = (i << 24) >>> 0
    for (let j = 0; j < 8; j++) {
      crc = ((crc << 1) ^ ((crc & 0x80000000) ? 0x04C11DB7 : 0)) >>> 0
    }
    CRC_TABLE[i] = crc
  }
})()

function oggCrc32(data: Uint8Array): number {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xFF]) >>> 0
  }
  return crc
}

/** Build a segment table for OGG: each packet is encoded as ceil(len/255) segments. */
function buildSegmentTable(packetSizes: number[]): Uint8Array {
  const segments: number[] = []
  for (const size of packetSizes) {
    let remaining = size
    while (remaining >= 255) {
      segments.push(255)
      remaining -= 255
    }
    segments.push(remaining) // final segment < 255 (can be 0)
  }
  return new Uint8Array(segments)
}

function createOggPage(
  headerType: number,
  granulePosition: bigint,
  serialNumber: number,
  pageSequence: number,
  packetData: Uint8Array[],
): Uint8Array {
  const segmentTable = buildSegmentTable(packetData.map(p => p.length))
  const totalDataSize = packetData.reduce((sum, p) => sum + p.length, 0)

  // Page header: 27 bytes + segment_table + data
  const pageSize = 27 + segmentTable.length + totalDataSize
  const page = new Uint8Array(pageSize)
  const view = new DataView(page.buffer)

  // "OggS"
  page[0] = 0x4F; page[1] = 0x67; page[2] = 0x67; page[3] = 0x53
  page[4] = 0 // version
  page[5] = headerType
  // Granule position (int64 LE)
  view.setUint32(6, Number(granulePosition & BigInt(0xFFFFFFFF)), true)
  view.setUint32(10, Number((granulePosition >> BigInt(32)) & BigInt(0xFFFFFFFF)), true)
  view.setUint32(14, serialNumber, true)
  view.setUint32(18, pageSequence, true)
  // CRC placeholder (0 for now, computed below)
  view.setUint32(22, 0, true)
  page[26] = segmentTable.length

  // Segment table
  page.set(segmentTable, 27)

  // Data
  let offset = 27 + segmentTable.length
  for (const packet of packetData) {
    page.set(packet, offset)
    offset += packet.length
  }

  // Compute and set CRC
  view.setUint32(22, oggCrc32(page), true)

  return page
}

// ─── Opus frame duration ────────────────────────────────────────────────────

/** Samples per frame at 48kHz for each Opus TOC config (0-31). */
const OPUS_FRAME_SAMPLES = [
  480, 960, 1920, 2880, // SILK NB
  480, 960, 1920, 2880, // SILK MB
  480, 960, 1920, 2880, // SILK WB
  480, 960,             // Hybrid SWB
  480, 960,             // Hybrid FB
  120, 240, 480, 960,   // CELT NB
  120, 240, 480, 960,   // CELT WB
  120, 240, 480, 960,   // CELT SWB
  120, 240, 480, 960,   // CELT FB
]

/** Get the number of 48kHz samples represented by an Opus packet. */
function getOpusSamples(packet: Uint8Array): number {
  if (packet.length < 1) return 960
  const toc = packet[0]
  const config = (toc >> 3) & 0x1F
  const code = toc & 0x03
  const frameSamples = OPUS_FRAME_SAMPLES[config] ?? 960

  switch (code) {
    case 0: return frameSamples
    case 1: return frameSamples * 2
    case 2: return frameSamples * 2
    case 3: {
      if (packet.length < 2) return frameSamples
      return frameSamples * (packet[1] & 0x3F)
    }
    default: return frameSamples
  }
}

// ─── Main conversion ────────────────────────────────────────────────────────

const MAX_PACKETS_PER_PAGE = 50
const SERIAL_NUMBER = 0x4D617478 // "Matx"

function buildOgg(opusHead: Uint8Array, packets: Uint8Array[]): Uint8Array {
  const pages: Uint8Array[] = []
  let pageSeq = 0

  // Page 0: BOS + OpusHead
  pages.push(createOggPage(0x02, BigInt(0), SERIAL_NUMBER, pageSeq++, [opusHead]))

  // Page 1: OpusTags
  const vendor = new TextEncoder().encode('MatrixClient')
  const tagsSize = 8 + 4 + vendor.length + 4
  const tags = new Uint8Array(tagsSize)
  const tagsView = new DataView(tags.buffer)
  tags.set(new TextEncoder().encode('OpusTags'), 0)
  tagsView.setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  tagsView.setUint32(12 + vendor.length, 0, true) // 0 comments
  pages.push(createOggPage(0x00, BigInt(0), SERIAL_NUMBER, pageSeq++, [tags]))

  // Audio pages
  let granule = BigInt(0)
  for (let i = 0; i < packets.length; ) {
    const pagePackets: Uint8Array[] = []
    let j = i
    while (j < packets.length && pagePackets.length < MAX_PACKETS_PER_PAGE) {
      pagePackets.push(packets[j])
      granule += BigInt(getOpusSamples(packets[j]))
      j++
    }
    const isLast = j >= packets.length
    pages.push(createOggPage(
      isLast ? 0x04 : 0x00,
      granule,
      SERIAL_NUMBER,
      pageSeq++,
      pagePackets,
    ))
    i = j
  }

  // If no audio packets, write an empty EOS page
  if (packets.length === 0) {
    pages.push(createOggPage(0x04, BigInt(0), SERIAL_NUMBER, pageSeq++, []))
  }

  // Concatenate all pages
  const totalSize = pages.reduce((s, p) => s + p.length, 0)
  const result = new Uint8Array(totalSize)
  let offset = 0
  for (const page of pages) {
    result.set(page, offset)
    offset += page.length
  }
  return result
}

/**
 * Convert a WebM/Opus audio Blob to OGG/Opus.
 * Runs in a Web Worker to avoid blocking the UI thread.
 * Falls back to main-thread processing if Workers are unavailable.
 */
export async function convertWebmToOgg(webmBlob: Blob): Promise<Blob> {
  const arrayBuffer = await webmBlob.arrayBuffer()

  // Try Web Worker first to keep main thread responsive
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise<Blob>((resolve, reject) => {
        const worker = new Worker('/Messages/audio-worker.js')
        const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Worker timeout')) }, 30_000)
        worker.onmessage = (e) => {
          clearTimeout(timeout)
          worker.terminate()
          if (e.data?.error) { reject(new Error(e.data.error)); return }
          resolve(new Blob([e.data], { type: 'audio/ogg; codecs=opus' }))
        }
        worker.onerror = (err) => { clearTimeout(timeout); worker.terminate(); reject(err) }
        worker.postMessage(arrayBuffer, [arrayBuffer])
      })
    } catch {
      // Fall through to main-thread conversion
    }
  }

  // Fallback: main-thread conversion
  const data = new Uint8Array(await webmBlob.arrayBuffer())
  const { opusHead, packets } = extractOpusFromWebm(data)
  const ogg = buildOgg(opusHead, packets)
  return new Blob([ogg.buffer as ArrayBuffer], { type: 'audio/ogg; codecs=opus' })
}
