import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, deleteAllData } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import type { BudgetDB } from '../../src/storage/db'

let db: BudgetDB

beforeEach(async () => {
  db = openDb(`budget-test-${Math.random()}`)
  await seedDefaults(db)
  await seedDefaults(db)
})

describe('seedDefaults', () => {
  it('seeds the 19 default categories once', async () => {
    expect(await db.categories.count()).toBe(19)
    const transfers = await db.categories.where('name').equals('Transfers').first()
    expect(transfers?.excludedFromSpending).toBe(true)
  })

  it('seeds the main settings row', async () => {
    expect(await db.settings.count()).toBe(1)
    const s = await db.settings.get('main')
    expect(s?.aprThresholdPercent).toBe(7)
    expect(s?.bufferPercent).toBe(10)
    expect(s?.bucketSplit).toEqual({ growth: 70, aggressive: 30 })
    expect(s?.budgetMonthStartDay).toBe(1)
    expect(s?.emergencyTopUpSharePercent).toBe(30)
    expect(s?.wrapperShares.pension).toBe(25)
    expect(s?.wrapperOrder).toEqual(['pension', 'isa', 'lisa', 'gia'])
    expect(s?.allowances['2026/27']).toEqual({ isa: 2000000, lisa: 400000, pension: 6000000 })
  })

  it('does not overwrite settings the user changed', async () => {
    await db.settings.update('main', { bufferPercent: 15 })
    await seedDefaults(db)
    expect((await db.settings.get('main'))?.bufferPercent).toBe(15)
  })

  it('seeds the five holdings with relative weights', async () => {
    const rows = await db.holdings.toArray()
    expect(rows).toHaveLength(5)
    const growth = rows.filter((r) => r.bucket === 'growth')
    const aggressive = rows.filter((r) => r.bucket === 'aggressive')
    expect(growth.map((r) => r.weight).sort()).toEqual([1, 2])
    expect(aggressive.map((r) => r.weight)).toEqual([1, 1, 1])
    for (const r of rows) {
      expect(r.platforms).toEqual(['trading212', 'ibkr', 'ig'])
      expect(r.platforms).not.toContain('robinhood')
    }
  })

  it('seeds the four platforms with last-checked date', async () => {
    const rows = await db.platforms.toArray()
    expect(rows.map((r) => r.id).sort()).toEqual(['ibkr', 'ig', 'robinhood', 'trading212'])
    for (const r of rows) expect(r.lastChecked).toBe('2026-10-26')
    expect((await db.platforms.get('trading212'))?.wrappersSupported).toEqual(['isa', 'pension', 'gia'])
    expect((await db.platforms.get('ibkr'))?.wrappersSupported).toEqual(['isa', 'gia'])
    expect((await db.platforms.get('ig'))?.wrappersSupported).toEqual(['isa', 'pension', 'gia'])
    expect((await db.platforms.get('robinhood'))?.wrappersSupported).toEqual(['isa'])
  })
})

describe('deleteAllData', () => {
  it('empties every table', async () => {
    await db.accounts.add({ id: 'a1', name: 'Main', bank: 'X', kind: 'current' })
    await db.transactions.add({
      id: 't1', accountId: 'a1', date: '2026-10-01', amountPence: -100, description: 'x',
      fingerprint: 'f', batchId: 'b', isTransfer: false, isRefund: false,
    })
    await deleteAllData(db)
    for (const table of db.tables) expect(await table.count()).toBe(0)
  })
})
