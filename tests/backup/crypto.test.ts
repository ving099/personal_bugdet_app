import { describe, expect, it } from 'vitest'
import {
  BACKUP_PBKDF2_ITERATIONS, InvalidBackupError, WrongPassphraseError, decryptBackup, deriveKey, encryptBackup,
} from '../../src/backup/crypto'

const ITER = 1000
const text = JSON.stringify({ note: 'Costs £12.50 🎉 café', n: [1, 2, 3] })

describe('backup crypto', () => {
  it('round-trips including non-ASCII', async () => {
    const enc = await encryptBackup(text, 'correct horse', ITER)
    expect(await decryptBackup(enc, 'correct horse')).toBe(text)
  })

  it('rejects a wrong passphrase', async () => {
    const enc = await encryptBackup(text, 'correct horse', ITER)
    await expect(decryptBackup(enc, 'wrong')).rejects.toBeInstanceOf(WrongPassphraseError)
    expect(new WrongPassphraseError().name).toBe('WrongPassphraseError')
  })

  it('rejects a flipped ciphertext byte', async () => {
    const enc = await encryptBackup(text, 'pw', ITER)
    enc[enc.length - 20] ^= 1
    await expect(decryptBackup(enc, 'pw')).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('rejects a flipped byte in iterations, salt or iv', async () => {
    // header: magic 0-3, version 4, iterations 5-8, salt 9-24, iv 25-36, ciphertext from 37
    for (const i of [8, 10, 20, 30]) {
      const enc = await encryptBackup(text, 'pw', ITER)
      enc[i] ^= 1
      await expect(decryptBackup(enc, 'pw')).rejects.toBeInstanceOf(WrongPassphraseError)
    }
  })

  it('binds the header as AAD', async () => {
    const enc = await encryptBackup(text, 'pw', ITER)
    const key = await deriveKey('pw', enc.slice(9, 25), ITER)
    const iv = enc.slice(25, 37)
    const ct = enc.slice(37)
    const header = enc.slice(0, 37)
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)).rejects.toThrow()
    const withAad = { name: 'AES-GCM', iv, additionalData: header }
    await expect(crypto.subtle.decrypt(withAad, key, ct)).resolves.toBeDefined()
  })

  it('treats NFC and NFD passphrases as equal', async () => {
    const nfc = 'caf\u00e9'
    const nfd = 'cafe\u0301'
    expect(nfc).not.toBe(nfd)
    expect(await decryptBackup(await encryptBackup(text, nfc, ITER), nfd)).toBe(text)
    expect(await decryptBackup(await encryptBackup(text, nfd, ITER), nfc)).toBe(text)
  })

  it('rejects out-of-range header iterations as invalid', async () => {
    const setIter = async (n: number) => {
      const enc = await encryptBackup(text, 'pw', ITER)
      new DataView(enc.buffer).setUint32(5, n, false)
      return enc
    }
    await expect(decryptBackup(await setIter(0), 'pw')).rejects.toBeInstanceOf(InvalidBackupError)
    await expect(decryptBackup(await setIter(5_000_001), 'pw')).rejects.toBeInstanceOf(InvalidBackupError)
  })

  it('rejects a truncated file', async () => {
    const enc = await encryptBackup(text, 'pw', ITER)
    await expect(decryptBackup(enc.slice(0, enc.length - 5), 'pw')).rejects.toBeInstanceOf(WrongPassphraseError)
    await expect(decryptBackup(enc.slice(0, 20), 'pw')).rejects.toBeInstanceOf(InvalidBackupError)
    await expect(decryptBackup(new Uint8Array(0), 'pw')).rejects.toBeInstanceOf(InvalidBackupError)
  })

  it('rejects bad magic and unsupported version', async () => {
    const enc = await encryptBackup(text, 'pw', ITER)
    const bad = enc.slice()
    bad[0] = 0x58
    await expect(decryptBackup(bad, 'pw')).rejects.toBeInstanceOf(InvalidBackupError)
    const ver = enc.slice()
    ver[4] = 2
    await expect(decryptBackup(ver, 'pw')).rejects.toBeInstanceOf(InvalidBackupError)
  })

  it('produces different output each time', async () => {
    const a = await encryptBackup(text, 'pw', ITER)
    const b = await encryptBackup(text, 'pw', ITER)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  it('rejects an empty passphrase', async () => {
    await expect(encryptBackup(text, '', ITER)).rejects.toBeInstanceOf(RangeError)
    const enc = await encryptBackup(text, 'pw', ITER)
    await expect(decryptBackup(enc, '')).rejects.toBeInstanceOf(RangeError)
  })

  it('defaults to 600000 iterations and stores them in the header', async () => {
    expect(BACKUP_PBKDF2_ITERATIONS).toBe(600_000)
    const enc = await encryptBackup(text, 'pw')
    expect(Array.from(enc.slice(0, 4))).toEqual([0x42, 0x47, 0x54, 0x31])
    expect(enc[4]).toBe(1)
    expect(new DataView(enc.buffer, enc.byteOffset).getUint32(5, false)).toBe(600_000)
  }, 20000)
})
