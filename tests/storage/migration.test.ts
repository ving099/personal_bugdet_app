import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../../src/storage/db'

const names: string[] = []
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

describe('schema v2', () => {
  it('gives existing investment log rows the tax year their budget month starts in', async () => {
    const name = `migration-test-${Date.now()}`
    names.push(name)
    const v1 = new Dexie(name)
    v1.version(1).stores({ settings: 'id', investmentLog: 'id, month' })
    await v1.table('settings').put({ id: 'main', budgetMonthStartDay: 6 })
    await v1.table('investmentLog').bulkPut([
      { id: 'a', month: '2026-04', wrapper: 'isa', holdingId: 'h', plannedPence: 1, actualPence: 1, platformId: 'p' },
      { id: 'b', month: '2026-03', wrapper: 'isa', holdingId: 'h', plannedPence: 1, actualPence: 1, platformId: 'p' },
      { id: 'c', month: '2026-03', taxYear: '2030/31', wrapper: 'isa', holdingId: 'h', plannedPence: 1, actualPence: 1, platformId: 'p' },
    ])
    v1.close()

    const db = openDb(name)
    const rows = await db.investmentLog.toArray()
    db.close()
    expect(Object.fromEntries(rows.map((r) => [r.id, r.taxYear]))).toEqual({ a: '2026/27', b: '2025/26', c: '2030/31' })
  })
})
