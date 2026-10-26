import { describe, expect, it } from 'vitest'
import { backupIsOverdue, hashPasscode, verifyPasscode } from '../../src/backup/lock'

describe('passcode', () => {
  it('verifies right and rejects wrong', async () => {
    const stored = await hashPasscode('123456', 1000)
    expect(await verifyPasscode('123456', stored, 1000)).toBe(true)
    expect(await verifyPasscode('654321', stored, 1000)).toBe(false)
  })
  it('treats NFC and NFD passcodes as equal', async () => {
    const stored = await hashPasscode('caf\u00e9', 1000)
    expect(await verifyPasscode('cafe\u0301', stored, 1000)).toBe(true)
  })
  it('uses a fresh salt each time', async () => {
    const a = await hashPasscode('123456', 1000)
    const b = await hashPasscode('123456', 1000)
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })
  it('rejects empty passcode', async () => {
    await expect(hashPasscode('')).rejects.toBeInstanceOf(RangeError)
    await expect(verifyPasscode('', { salt: 'AA==', hash: 'AA==' })).rejects.toBeInstanceOf(RangeError)
  })
  it('returns false for malformed stored values', async () => {
    expect(await verifyPasscode('1234', { salt: '!!', hash: '??' }, 1000)).toBe(false)
  })
  it('works with the production default', async () => {
    const stored = await hashPasscode('1234')
    expect(await verifyPasscode('1234', stored)).toBe(true)
  }, 20000)
})

describe('backupIsOverdue', () => {
  it('true when never backed up', () => expect(backupIsOverdue(undefined, '2026-10-26')).toBe(true))
  it('true at 31 days, false at 30', () => {
    expect(backupIsOverdue('2026-09-25', '2026-10-26')).toBe(true)
    expect(backupIsOverdue('2026-09-26', '2026-10-26')).toBe(false)
  })
  it('false for same day and future dates', () => {
    expect(backupIsOverdue('2026-10-26', '2026-10-26')).toBe(false)
    expect(backupIsOverdue('2027-01-01', '2026-10-26')).toBe(false)
  })
  it('is stable across month and leap boundaries', () => {
    expect(backupIsOverdue('2024-01-30', '2024-03-01')).toBe(true)
    expect(backupIsOverdue('2024-01-31', '2024-03-01')).toBe(false)
  })
  it('throws on garbage', () => {
    expect(() => backupIsOverdue('nope', '2026-10-26')).toThrow(RangeError)
    expect(() => backupIsOverdue('2026-10-26', '2026-13-45')).toThrow(RangeError)
    expect(() => backupIsOverdue('2026-02-30', '2026-10-26')).toThrow(RangeError)
  })
})
