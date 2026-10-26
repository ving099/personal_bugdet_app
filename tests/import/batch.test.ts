import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BudgetDB } from '../../src/storage/db'
import { assignFingerprints } from '../../src/import/fingerprint'
import { importBatch, undoBatch } from '../../src/import/batch'
import type { ParsedTx } from '../../src/import/profile'

const tx = (over: Partial<ParsedTx> = {}): ParsedTx => ({
  accountId: 'a1', date: '2026-04-03', amountPence: -450, description: 'Coffee', ...over,
})

let db: BudgetDB
let n = 0
beforeEach(() => { db = new BudgetDB(`batch-test-${n++}`) })
afterEach(async () => { db.close(); await db.delete() })

describe('assignFingerprints', () => {
  it('gives identical same-day rows different fingerprints, stable across calls', () => {
    const a = assignFingerprints([tx(), tx()])
    expect(a[0].fingerprint).not.toBe(a[1].fingerprint)
    expect(assignFingerprints([tx(), tx()]).map((t) => t.fingerprint)).toEqual(a.map((t) => t.fingerprint))
  })

  it('normalises description whitespace and case', () => {
    const [x] = assignFingerprints([tx({ description: '  COFFE  Shop ' })])
    const [y] = assignFingerprints([tx({ description: 'coffe shop' })])
    expect(x.fingerprint).toBe(y.fingerprint)
  })

  it('differs by account, date and amount', () => {
    const fps = assignFingerprints([tx(), tx({ accountId: 'a2' }), tx({ date: '2026-04-04' }), tx({ amountPence: -451 })])
    expect(new Set(fps.map((t) => t.fingerprint)).size).toBe(4)
  })
})

describe('importBatch', () => {
  it('imports two identical same-day rows as two rows', async () => {
    const r = await importBatch(db, [tx(), tx()])
    expect(r).toMatchObject({ added: 2, skipped: 0 })
    expect(await db.transactions.count()).toBe(2)
  })

  it('stores batch id, fingerprint, category and flags', async () => {
    const r = await importBatch(db, [{ ...tx(), categoryId: 'c1' }])
    const [row] = await db.transactions.toArray()
    expect(row).toMatchObject({ batchId: r.batchId, categoryId: 'c1', isTransfer: false, isRefund: false })
    expect(row.id).toBeTruthy()
    expect(row.fingerprint).toBeTruthy()
  })

  it('re-importing the same file adds nothing', async () => {
    const file = [tx(), tx(), tx({ description: 'Tesco' })]
    await importBatch(db, file)
    const r = await importBatch(db, file)
    expect(r).toMatchObject({ added: 0, skipped: 3 })
    expect(await db.transactions.count()).toBe(3)
  })

  it('overlapping statement adds only new rows, keeping duplicate counts aligned', async () => {
    await importBatch(db, [tx(), tx(), tx({ date: '2026-04-04' })])
    const r = await importBatch(db, [tx(), tx(), tx({ date: '2026-04-04' }), tx({ date: '2026-04-05' })])
    expect(r).toMatchObject({ added: 1, skipped: 3 })
    expect(await db.transactions.count()).toBe(4)
  })

  it('a third identical row in a later file is added', async () => {
    await importBatch(db, [tx(), tx()])
    const r = await importBatch(db, [tx(), tx(), tx()])
    expect(r).toMatchObject({ added: 1, skipped: 2 })
  })

  it('rolls back everything when a later row has an invalid date', async () => {
    await expect(importBatch(db, [tx(), tx({ date: '2026-02-30' })])).rejects.toThrow(/row 2/)
    expect(await db.transactions.count()).toBe(0)
  })

  it('rejects malformed dates, non-integer amounts and empty accounts', async () => {
    await expect(importBatch(db, [tx({ date: '03/04/2026' })])).rejects.toThrow(/row 1/)
    await expect(importBatch(db, [tx({ amountPence: 1.5 })])).rejects.toThrow(/row 1/)
    await expect(importBatch(db, [tx({ accountId: '' })])).rejects.toThrow(/row 1/)
    expect(await db.transactions.count()).toBe(0)
  })

  it('leaves existing rows unchanged when a batch fails', async () => {
    await importBatch(db, [tx()])
    await expect(importBatch(db, [tx({ date: '2026-04-09' }), tx({ date: 'bad' })])).rejects.toThrow()
    expect(await db.transactions.count()).toBe(1)
  })
})

describe('undoBatch', () => {
  it('removes exactly that batch and returns the count', async () => {
    const a = await importBatch(db, [tx(), tx({ description: 'Tesco' })])
    const b = await importBatch(db, [tx({ date: '2026-05-01' })])
    expect(await undoBatch(db, a.batchId)).toBe(2)
    const left = await db.transactions.toArray()
    expect(left).toHaveLength(1)
    expect(left[0].batchId).toBe(b.batchId)
  })

  it('returns 0 for an unknown batch', async () => {
    expect(await undoBatch(db, 'nope')).toBe(0)
  })
})
