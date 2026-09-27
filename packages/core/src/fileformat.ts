import { createHash } from 'node:crypto'

/**
 * `.aifig` container (schema 1.x):
 *
 *   "AIFIG\0"        6-byte magic
 *   u32 LE           header length
 *   header           UTF-8 JSON: { format, schema, app, savedAt, board?, version?, assets?, payload: { encoding, bytes, sha256 } }
 *   payload          Yjs update (Y.encodeStateAsUpdate) of the board document
 *
 * The header is readable without decoding the document (version lists read only headers), and the payload
 * checksum catches truncated or damaged files before they reach Yjs. Files without the magic are schema 0:
 * a bare Yjs update, as written before the container existed.
 *
 * Since schema 2.0 the document holds no file bytes: `assets` lists the `<sha256>.<ext>` files it needs from
 * the assets folder next to it, so history, backups and copies can find (and keep) them from the header alone.
 */

export const MAGIC = Buffer.from('AIFIG\0', 'latin1')
export const APP_VERSION = '0.1.0'

export interface SchemaVersion {
  major: number
  minor: number
}

export const CURRENT_SCHEMA: SchemaVersion = { major: 2, minor: 0 }
export const LEGACY_SCHEMA: SchemaVersion = { major: 0, minor: 0 }

export const formatSchema = (v: SchemaVersion) => `${v.major}.${v.minor}`

export function parseSchema(s: unknown): SchemaVersion | null {
  const m = typeof s === 'string' ? s.match(/^(\d+)\.(\d+)$/) : null
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null
}

export function compareSchema(a: SchemaVersion, b: SchemaVersion) {
  return a.major - b.major || a.minor - b.minor
}

export interface ContainerHeader {
  format: 'aifig'
  schema: string
  app: string
  savedAt: number
  board?: string
  title?: string
  /** Present on version snapshots. */
  version?: Record<string, unknown>
  /** Asset files the document refers to (`<sha256>.<ext>`), schema 2.0+. */
  assets?: string[]
  payload: { encoding: 'yjs-update'; bytes: number; sha256: string }
}

/** The file is damaged: truncated, bit-flipped, or not an ai-figma file at all. */
export class CorruptFileError extends Error {
  constructor(
    readonly reason: string,
    readonly file?: string,
  ) {
    super(`${file ? `${file}: ` : ''}${reason}`)
  }
}

/** The file was written by a newer ai-figma whose format this build can't safely read. */
export class FutureVersionError extends Error {
  constructor(
    readonly schema: string,
    readonly app: string | undefined,
    readonly file?: string,
  ) {
    super(
      `This board was saved by a newer version of ai-figma${app ? ` (${app})` : ''} using file format ${schema}; this version reads format ${CURRENT_SCHEMA.major}.x and older. ` +
        `Update ai-figma to open it — the file has not been changed.`,
    )
  }
}

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

export function encodeContainer(payload: Uint8Array, meta: Omit<ContainerHeader, 'format' | 'payload' | 'schema' | 'app'> & { schema?: string }): Buffer {
  const header: ContainerHeader = {
    format: 'aifig',
    schema: meta.schema ?? formatSchema(CURRENT_SCHEMA),
    app: APP_VERSION,
    savedAt: meta.savedAt,
    ...(meta.board ? { board: meta.board } : {}),
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.version ? { version: meta.version } : {}),
    ...(meta.assets ? { assets: meta.assets } : {}),
    payload: { encoding: 'yjs-update', bytes: payload.byteLength, sha256: sha256(payload) },
  }
  const h = Buffer.from(JSON.stringify(header), 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32LE(h.byteLength)
  return Buffer.concat([MAGIC, len, h, payload])
}

export const isContainer = (data: Uint8Array) => data.byteLength >= MAGIC.byteLength && Buffer.from(data.buffer, data.byteOffset, MAGIC.byteLength).equals(MAGIC)

/** Parse only the header (for listings). Throws CorruptFileError. */
export function readHeader(data: Uint8Array, file?: string): { header: ContainerHeader; offset: number } {
  if (!isContainer(data)) throw new CorruptFileError('not an ai-figma container', file)
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (buf.byteLength < MAGIC.byteLength + 4) throw new CorruptFileError('file is truncated: no header', file)
  const len = buf.readUInt32LE(MAGIC.byteLength)
  const start = MAGIC.byteLength + 4
  if (len > 1_000_000 || start + len > buf.byteLength) throw new CorruptFileError('file is truncated: header cut off', file)
  let header: ContainerHeader
  try {
    header = JSON.parse(buf.subarray(start, start + len).toString('utf8'))
  } catch {
    throw new CorruptFileError('header is damaged', file)
  }
  if (header?.format !== 'aifig' || !parseSchema(header.schema) || !header.payload) throw new CorruptFileError('header is not an ai-figma header', file)
  return { header, offset: start + len }
}

export interface DecodedFile {
  schema: SchemaVersion
  header: ContainerHeader | null
  payload: Uint8Array
}

/**
 * Split a file into its schema version and verified payload. Throws FutureVersionError for a newer major
 * format (checked before the checksum, so the message is right even if the layout changed) and
 * CorruptFileError when the payload doesn't match its checksum.
 */
export function decodeContainer(data: Uint8Array, file?: string, supported: SchemaVersion = CURRENT_SCHEMA): DecodedFile {
  if (!isContainer(data)) {
    if (!data.byteLength) throw new CorruptFileError('file is empty', file)
    if (data.byteLength < MAGIC.byteLength && MAGIC.subarray(0, data.byteLength).equals(Buffer.from(data))) {
      throw new CorruptFileError('file is truncated: cut inside the header', file)
    }
    return { schema: LEGACY_SCHEMA, header: null, payload: data }
  }
  const { header, offset } = readHeader(data, file)
  const schema = parseSchema(header.schema)!
  if (schema.major > supported.major) throw new FutureVersionError(header.schema, header.app, file)
  const payload = data.subarray(offset)
  if (payload.byteLength !== header.payload.bytes) {
    throw new CorruptFileError(`file is truncated: ${payload.byteLength} of ${header.payload.bytes} bytes`, file)
  }
  if (sha256(payload) !== header.payload.sha256) throw new CorruptFileError('checksum mismatch — the file is damaged', file)
  return { schema, header, payload }
}
