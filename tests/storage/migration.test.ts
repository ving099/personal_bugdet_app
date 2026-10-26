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

describe('schema v3', () => {
  it('marks the seeded Debt payments, Savings and investing and Income categories as not spending, keeping limits', async () => {
    const name = `migration-v3-${Date.now()}`
    names.push(name)
    const v2 = new Dexie(name)
    v2.version(2).stores({ categories: 'id, name', settings: 'id', investmentLog: 'id, month' })
    await v2.table('categories').bulkPut([
      { id: 'debt-payments', name: 'Debt payments', monthlyLimitPence: 30000, excludedFromSpending: false },
      { id: 'savings-and-investing', name: 'Savings and investing', monthlyLimitPence: 0, excludedFromSpending: false },
      { id: 'income', name: 'Income', monthlyLimitPence: 0, excludedFromSpending: false },
      { id: 'transfers', name: 'Transfers', monthlyLimitPence: 0, excludedFromSpending: true },
      { id: 'groceries-and-food', name: 'Groceries and food', monthlyLimitPence: 45000, excludedFromSpending: false },
    ])
    v2.close()

    const db = openDb(name)
    const rows = await db.categories.toArray()
    db.close()
    expect(Object.fromEntries(rows.map((r) => [r.id, [r.excludedFromSpending, r.monthlyLimitPence]]))).toEqual({
      'debt-payments': [true, 30000],
      'savings-and-investing': [true, 0],
      income: [true, 0],
      transfers: [true, 0],
      'groceries-and-food': [false, 45000],
    })
  })
})

const row = (id: string, description: string, categoryId: string | undefined, extra: object = {}) => ({
  id, accountId: 'cur', date: '2026-09-01', amountPence: 50000, description, categoryId, fingerprint: id, batchId: 'b',
  isTransfer: false, isRefund: false, ...extra,
})

describe('schema v4', () => {
  it('marks Transfers rows the owner must have filed by hand, and leaves rule-filed ones alone', async () => {
    const name = `migration-v4-${Date.now()}`
    names.push(name)
    const v3 = new Dexie(name)
    v3.version(3).stores({
      transactions: 'id, [accountId+date], fingerprint, batchId', rules: 'id', categories: 'id, name', settings: 'id', investmentLog: 'id, month',
    })
    await v3.table('rules').bulkPut([
      { id: 'learned:mum', matchText: 'transfer from mum', categoryId: 'transfers', source: 'learned' },
    ])
    await v3.table('transactions').bulkPut([
      row('hand', 'J SMITH ISA WITHDRAWAL', 'transfers'),
      row('default', 'TRANSFER FROM BIZ LTD', 'transfers'),
      row('learned', 'TRANSFER FROM MUM', 'transfers'),
      row('already', 'J SMITH ISA WITHDRAWAL', 'transfers', { categoryEditedByUser: true }),
      row('other', 'J SMITH ISA WITHDRAWAL', 'income'),
    ])
    v3.close()

    const db = openDb(name)
    const rows = await db.transactions.toArray()
    db.close()
    expect(Object.fromEntries(rows.map((r) => [r.id, r.categoryEditedByUser]))).toEqual({
      hand: true, default: undefined, learned: true, already: true, other: undefined,
    })
  })
})
