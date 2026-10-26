import { base64ToBytes, bytesToBase64, secretBytes } from './crypto'
import type { ISODate } from '../domain/types'

/** PBKDF2 work factor for passcodes. The salt is stored; the count is implicit (change = re-set passcode). */
export const PASSCODE_PBKDF2_ITERATIONS = 600_000

async function derive(passcode: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle
  const material = await subtle.importKey('raw', secretBytes(passcode), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256)
  return new Uint8Array(bits)
}

/**
 * Hashes a passcode (PBKDF2-SHA-256, random 16-byte salt, 32-byte output). Salt and hash are base64.
 * NOTE: a short numeric passcode is brute-forceable offline from the stored hash, so this lock deters
 * casual access only and is not strong protection of data at rest. Minimum length is a UI concern.
 */
export async function hashPasscode(
  passcode: string,
  iterations: number = PASSCODE_PBKDF2_ITERATIONS,
): Promise<{ salt: string; hash: string }> {
  if (passcode.length === 0) throw new RangeError('Passcode must not be empty')
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return { salt: bytesToBase64(salt), hash: bytesToBase64(await derive(passcode, salt, iterations)) }
}

/**
 * Recomputes and compares in constant time. Malformed stored values give false. An empty passcode throws
 * RangeError, so the lock screen must guard empty submits.
 */
export async function verifyPasscode(
  passcode: string,
  stored: { salt: string; hash: string },
  iterations: number = PASSCODE_PBKDF2_ITERATIONS,
): Promise<boolean> {
  if (passcode.length === 0) throw new RangeError('Passcode must not be empty')
  let salt: Uint8Array<ArrayBuffer>
  let expected: Uint8Array
  try {
    salt = base64ToBytes(stored.salt)
    expected = base64ToBytes(stored.hash)
  } catch {
    return false
  }
  const actual = await derive(passcode, salt, iterations)
  let diff = actual.length ^ expected.length
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ (expected[i] ?? 0)
  return diff === 0
}

const DAY_MS = 86_400_000
const OVERDUE_AFTER_DAYS = 30

function utcDay(d: ISODate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) throw new RangeError(`Invalid date: ${d}`)
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, da)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== da) {
    throw new RangeError(`Invalid date: ${d}`)
  }
  return t / DAY_MS
}

/** True when never backed up or the last backup is more than 30 days before `today` (UTC date maths). */
export function backupIsOverdue(lastAt: ISODate | undefined, today: ISODate): boolean {
  const t = utcDay(today)
  if (lastAt === undefined) return true
  return t - utcDay(lastAt) > OVERDUE_AFTER_DAYS
}
