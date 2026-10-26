import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../../src/storage/db'
import type { BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import { exportSnapshot, restoreSnapshot, SnapshotError } from '../../src/backup/snapshot'
import type { Transaction } from '../../src/domain/types'

const tx = (i: number): Transaction => ({
  id: `t${i}`, accountId: 'a1', date: '2026-10-01', amountPence: -1000 - i, description: `Shop £${i} ☕`,
  fingerprint: `fp${i}`, batchId: 'b1', isTransfer: false, isRefund: false,
})

let src: BudgetDB
let dst: BudgetDB
const dump = async (db: BudgetDB) =>
  Object.fromEntries(await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()])))

beforeEach(async () => {
  src = openDb(`bk-src-${Math.random()}`)
  dst = openDb(`bk-dst-${Math.random()}`)
  await seedDefaults(src)
  await src.transactions.bulkAdd([tx(1), tx(2), tx(3)])
  await src.allowancesUsed.add({ taxYear: '2026/27', wrapper: 'isa', usedPence: 500 } as never)
})

describe('snapshot', () => {
  it('covers every table with the expected envelope', async () => {
    const snap = JSON.parse(await exportSnapshot(src))
    expect(snap.app).toBe('budget')
    expect(snap.version).toBe(1)
    expect(typeof snap.exportedAt).toBe('string')
    expect(Object.keys(snap.tables).sort()).toEqual(src.tables.map((t) => t.name).sort())
    expect(src.tables.length).toBe(15)
  })

  it('restores into a fresh db with identical contents', async () => {
    await restoreSnapshot(dst, await exportSnapshot(src))
    expect(await dump(dst)).toEqual(await dump(src))
    expect((await dst.transactions.get('t1'))?.description).toBe('Shop £1 ☕')
  })

  it('replaces existing data entirely, including settings', async () => {
    await seedDefaults(dst)
    await dst.transactions.add(tx(99))
    await dst.settings.update('main', { appLock: { salt: 'x', hash: 'y' } })
    await restoreSnapshot(dst, await exportSnapshot(src))
    expect(await dst.transactions.get('t99')).toBeUndefined()
    expect((await dst.settings.get('main'))?.appLock).toBeNull()
  })

  it('round-trips an empty db', async () => {
    const empty = openDb(`bk-empty-${Math.random()}`)
    await restoreSnapshot(dst, await exportSnapshot(empty))
    expect(await dump(dst)).toEqual(await dump(empty))
  })

  it('treats missing known tables as empty and ignores unknown tables', async () => {
    await dst.transactions.add(tx(99))
    await restoreSnapshot(dst, JSON.stringify({
      app: 'budget', version: 1, exportedAt: 'x', tables: { transactions: [tx(1)], mystery: [{ id: 1 }] },
    }))
    expect(await dst.transactions.count()).toBe(1)
    expect(await dst.categories.count()).toBe(0)
  })

  it('rejects bad input with SnapshotError and leaves the target unchanged', async () => {
    await seedDefaults(dst)
    await dst.transactions.add(tx(99))
    const before = await dump(dst)
    const ok = { app: 'budget', version: 1, exportedAt: 'x', tables: {} }
    const bad = [
      '{not json',
      'null',
      '[]',
      JSON.stringify({ ...ok, app: 'other' }),
      JSON.stringify({ ...ok, version: 2 }),
      JSON.stringify({ ...ok, tables: undefined }),
      JSON.stringify({ ...ok, tables: { transactions: 'nope' } }),
      JSON.stringify({ ...ok, tables: { transactions: [5] } }),
    ]
    for (const b of bad) {
      await expect(restoreSnapshot(dst, b)).rejects.toBeInstanceOf(SnapshotError)
      expect(await dump(dst)).toEqual(before)
    }
  })

  it('rolls back when a table payload fails mid-restore', async () => {
    await seedDefaults(dst)
    await dst.transactions.add(tx(99))
    const before = await dump(dst)
    const json = JSON.stringify({
      app: 'budget', version: 1, exportedAt: 'x',
      tables: { accounts: [], categories: [], transactions: [tx(1), tx(2), tx(1)] },
    })
    await expect(restoreSnapshot(dst, json)).rejects.toThrow()
    expect(await dump(dst)).toEqual(before)
  })
})
