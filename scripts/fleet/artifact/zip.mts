/**
 * @file Minimal ZIP archive writer + reader for the artifact client - no
 *   third-party zip dependency. The artifact container is a ZIP of the staged
 *   paths; upload writes one, download reads one. Entries are
 *   deflate-compressed (method 8) via node:zlib's raw deflate, with a CRC32 per
 *   entry. The layout is the classic local-header + central-directory +
 *   end-of-central-directory triple; no zip64, no data descriptors, no
 *   multi-disk. An artifact's staged set is far under every limit. Writer and
 *   reader round-trip: the reader must reproduce exactly what the writer emits,
 *   and must also read an upstream actions/upload-artifact zip (which may carry
 *   data descriptors).
 */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  name: string
  data: Buffer
}

const LOCAL_HEADER_SIGNATURE = 0x04_03_4b_50
const CENTRAL_HEADER_SIGNATURE = 0x02_01_4b_50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06_05_4b_50
const COMPRESSION_DEFLATE = 8
const COMPRESSION_STORE = 0

/**
 * Write a ZIP archive from the given entries. Entry names are forward-slash
 * relative paths. Deterministic apart from the (zeroed) mod time so the same
 * input bytes give the same archive bytes.
 */
export function createZipArchive(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags (no data descriptor; sizes are in the header)
    local.writeUInt16LE(COMPRESSION_DEFLATE, 8)
    local.writeUInt16LE(0, 10) // mod time (zeroed - deterministic)
    local.writeUInt16LE(0, 12) // mod date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // extra length

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(COMPRESSION_DEFLATE, 10)
    central.writeUInt16LE(0, 12) // mod time
    central.writeUInt16LE(0, 14) // mod date
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra length
    central.writeUInt16LE(0, 32) // comment length
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42) // local header offset

    localParts.push(local, nameBytes, compressed)
    centralParts.push(central, nameBytes)
    offset += local.length + nameBytes.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0)
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // central-directory disk
  eocd.writeUInt16LE(entries.length, 8) // entries this disk
  eocd.writeUInt16LE(entries.length, 10) // total entries
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16) // central directory offset
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localParts, centralDirectory, eocd])
}

/**
 * Read a ZIP archive back into entries. Locates the end of central directory
 * by scanning for its signature from the tail, walks the central directory,
 * and inflates each entry (deflate method 8) or passes it through (store
 * method 0). Throws on a truncated or unrecognized archive - an artifact the
 * service could not have produced is a loud error, never a partial read.
 */
export function extractZipArchive(buffer: Buffer): ZipEntry[] {
  let eocdOffset = -1
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 22 - 65_536);
    i -= 1
  ) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) {
    throw new Error(
      `The downloaded artifact is not a readable zip. Where: extractZipArchive. Saw: no end-of-central-directory signature in the tail ${Math.min(buffer.length, 65_558)} bytes; wanted a valid zip. Fix: re-download the artifact; if it persists, check the artifact upload.`,
    )
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  let cursor = buffer.readUInt32LE(eocdOffset + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error(
        `The downloaded artifact has a corrupt central directory. Where: extractZipArchive entry ${i} at offset ${cursor}. Saw: signature 0x${buffer.readUInt32LE(cursor).toString(16)}; wanted 0x${CENTRAL_HEADER_SIGNATURE.toString(16)}. Fix: re-download the artifact.`,
      )
    }
    const compression = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8')

    // The local header's own name/extra lengths can differ from the central
    // entry's, so the data offset is derived from the local header, not the
    // central one.
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize)

    let data: Buffer
    if (compression === COMPRESSION_DEFLATE) {
      data = inflateRawSync(compressed)
    } else if (compression === COMPRESSION_STORE) {
      data = Buffer.from(compressed)
    } else {
      throw new Error(
        `The downloaded artifact uses an unsupported compression. Where: extractZipArchive entry '${name}'. Saw: method ${compression}; wanted deflate (8) or store (0). Fix: re-upload the artifact with a supported method.`,
      )
    }
    entries.push({ name, data })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
