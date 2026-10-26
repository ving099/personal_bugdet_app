/**
 * Encrypted backup file: PBKDF2-SHA-256 -> AES-GCM-256.
 *
 * Layout: 'BGT1' (4) | version (1, =1) | iterations (uint32 BE) | salt (16) | iv (12) | ciphertext.
 * The header bytes are used as AES-GCM additional data, so tampering with them fails authentication.
 * Uses only `globalThis.crypto`; never logs secrets.
 */

/** Default PBKDF2 work factor. Stored in each file's header so it can be raised later. */
export const BACKUP_PBKDF2_ITERATIONS = 600_000

const MAGIC = [0x42, 0x47, 0x54, 0x31] // 'BGT1'
const FORMAT_VERSION = 1
const SALT_LEN = 16
const IV_LEN = 12
const HEADER_LEN = 4 + 1 + 4 + SALT_LEN + IV_LEN
const TAG_LEN = 16
const MAX_ITERATIONS = 10_000_000 // sanity cap so a hostile header cannot hang the device

/** Authentication failed: wrong passphrase, or the file was altered or truncated. */
export class WrongPassphraseError extends Error {
  constructor(message = 'Wrong passphrase, or the backup file is damaged') {
    super(message)
    this.name = 'WrongPassphraseError'
  }
}

/** The bytes are not a backup this app can read (bad magic, unsupported version, too short). */
export class InvalidBackupError extends Error {
  constructor(message = 'Not a backup file') {
    super(message)
    this.name = 'InvalidBackupError'
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

/** Throws if `b64` is not valid base64. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Derives an AES-GCM-256 key from a secret with PBKDF2-SHA-256. */
export async function deriveKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle
  const material = await subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBackup(
  json: string,
  passphrase: string,
  iterations: number = BACKUP_PBKDF2_ITERATIONS,
): Promise<Uint8Array> {
  if (passphrase.length === 0) throw new RangeError('Passphrase must not be empty')
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new RangeError('Invalid iteration count')
  }
  const c = globalThis.crypto
  const salt = c.getRandomValues(new Uint8Array(SALT_LEN))
  const iv = c.getRandomValues(new Uint8Array(IV_LEN))
  const header = new Uint8Array(HEADER_LEN)
  header.set(MAGIC, 0)
  header[4] = FORMAT_VERSION
  new DataView(header.buffer).setUint32(5, iterations, false)
  header.set(salt, 9)
  header.set(iv, 9 + SALT_LEN)

  const key = await deriveKey(passphrase, salt, iterations)
  const ct = new Uint8Array(
    await c.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, new TextEncoder().encode(json)),
  )
  const out = new Uint8Array(HEADER_LEN + ct.length)
  out.set(header, 0)
  out.set(ct, HEADER_LEN)
  return out
}

export async function decryptBackup(bytes: Uint8Array, passphrase: string): Promise<string> {
  if (passphrase.length === 0) throw new RangeError('Passphrase must not be empty')
  if (bytes.length < HEADER_LEN + TAG_LEN) throw new InvalidBackupError()
  if (MAGIC.some((m, i) => bytes[i] !== m)) throw new InvalidBackupError()
  if (bytes[4] !== FORMAT_VERSION) throw new InvalidBackupError('Unsupported backup version')
  const header = bytes.slice(0, HEADER_LEN)
  const iterations = new DataView(header.buffer).getUint32(5, false)
  if (iterations < 1 || iterations > MAX_ITERATIONS) throw new WrongPassphraseError()
  const salt = header.slice(9, 9 + SALT_LEN)
  const iv = header.slice(9 + SALT_LEN, HEADER_LEN)
  try {
    const key = await deriveKey(passphrase, salt, iterations)
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: header },
      key,
      bytes.slice(HEADER_LEN),
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new WrongPassphraseError()
  }
}
