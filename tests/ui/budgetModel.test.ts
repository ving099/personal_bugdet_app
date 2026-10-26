import { describe, expect, it } from 'vitest'
import { seedCategories } from '../../src/seed/categories'
import type { Account, Transaction } from '../../src/domain/types'
import {
  buildBudgetRows, categoryTransactions, formatPeriod, monthChoices, monthLabel, similarTransactionIds,
  unassignedCredits,
} from '../../src/ui/screens/budget/budgetModel'

const accounts: Account[] = [
  { id: 'cur', name: 'Everyday', bank: 'B', kind: 'current' },
  { id: 'biz', name: 'Business', bank: 'B', kind: 'business' },
]
let n = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${n++}`, accountId: 'cur', date: '2026-10-10', amountPence: -1000, description: 'SHOP', fingerprint: `f${n}`,
  batchId: 'b', isTransfer: false, isRefund: false, ...p,
})

describe('buildBudgetRows', () => {
  const build = (spent: Record<string, number>, cats = seedCategories, monthTxs: Transaction[] = []) =>
    buildBudgetRows({ spentByCategory: spent, categories: cats, monthTxs, accounts })

  it('lists every category that is not excluded, and never the excluded ones', () => {
    const rows = build({})
    expect(rows).toHaveLength(seedCategories.length - 1)
    expect(rows.some((r) => r.name === 'Transfers')).toBe(false)
  })

  it('reports spent of limit, no limit, over and refund standings with exact text', () => {
    const cats = seedCategories.map((c) =>
      c.id === 'groceries-and-food' ? { ...c, monthlyLimitPence: 25000 } : c.id === 'eating-out' ? { ...c, monthlyLimitPence: 10000 } : c,
    )
    const rows = build({ 'groceries-and-food': 4000, 'eating-out': 12000, travel: 5000, gifts: -1200 }, cats)
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by['groceries-and-food']).toMatchObject({ standing: 'within', statusText: '£40.00 of £250.00', fill: 0.16 })
    expect(by['eating-out']).toMatchObject({ standing: 'over', statusText: '£120.00 of £100.00', overText: 'Over by £20.00', fill: 1 })
    expect(by.travel).toMatchObject({ standing: 'none', statusText: '£50.00 spent', fill: 0 })
    expect(by.gifts).toMatchObject({ standing: 'refunds', statusText: 'Refunds £12.00', fill: 0 })
  })

  it('puts Uncategorised first with a count, and keeps spending on a removed category visible', () => {
    const monthTxs = [tx({}), tx({}), tx({ isTransfer: true }), tx({ categoryId: 'travel' })]
    const rows = build({ uncategorised: 2000, gone: 700 }, seedCategories, monthTxs)
    expect(rows[0]).toMatchObject({ id: 'uncategorised', name: 'Uncategorised', count: 2 })
    expect(rows.find((r) => r.id === 'gone')?.name).toBe('Unknown category')
  })

  it('has no Uncategorised row when nothing is uncategorised', () => {
    expect(build({}).some((r) => r.id === 'uncategorised')).toBe(false)
  })
})

describe('similarTransactionIds', () => {
  it('matches on merchant key across any date and account, including the row itself', () => {
    const a = tx({ description: 'TESCO STORES 4412' })
    const b = tx({ description: 'Tesco Stores 9981', date: '2026-03-01', accountId: 'biz' })
    const c = tx({ description: 'ASDA 1' })
    expect(similarTransactionIds([a, b, c], a).sort()).toEqual([a.id, b.id].sort())
  })

  it('returns nothing when the description has no merchant text', () => {
    const a = tx({ description: '12345 678' })
    expect(similarTransactionIds([a, tx({ description: '99 99' })], a)).toEqual([])
  })

  it('narrows candidates with accept but always keeps the row itself', () => {
    const a = tx({ description: 'ACME PAY 1', amountPence: 5000 })
    const b = tx({ description: 'ACME PAY 2', amountPence: -5000 })
    expect(similarTransactionIds([a, b], a, (t) => t.amountPence > 0)).toEqual([a.id])
  })
})

describe('categoryTransactions and unassignedCredits', () => {
  it('lists outflows, refunds and transfers on personal accounts for one category, newest first', () => {
    const rows = [
      tx({ categoryId: 'travel', date: '2026-10-02' }),
      tx({ categoryId: 'travel', date: '2026-10-09' }),
      tx({ categoryId: 'travel', amountPence: 500, isRefund: true }),
      tx({ categoryId: 'travel', amountPence: 900 }),
      tx({ categoryId: 'travel', accountId: 'biz' }),
      tx({ categoryId: 'gifts' }),
    ]
    const out = categoryTransactions(rows, accounts, 'travel')
    expect(out).toHaveLength(3)
    expect(out[0].date >= out[1].date).toBe(true)
  })

  it('finds credits without a stream, ignoring refunds, transfers and business accounts', () => {
    const rows = [
      tx({ amountPence: 100000, description: 'PAYROLL' }),
      tx({ amountPence: 100000, incomeStreamId: 's' }),
      tx({ amountPence: 500, isRefund: true }),
      tx({ amountPence: 500, isTransfer: true }),
      tx({ amountPence: 500, accountId: 'biz' }),
    ]
    expect(unassignedCredits(rows, accounts).map((t) => t.description)).toEqual(['PAYROLL'])
  })
})

describe('months', () => {
  it('lists months from the earliest transaction to the current month with the start day applied', () => {
    const rows = [tx({ date: '2026-08-24' }), tx({ date: '2026-10-25' })]
    expect(monthChoices(rows, '2026-10', 25)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10'])
    expect(monthChoices([], '2026-10', 1)).toEqual(['2026-10'])
  })

  it('reaches a month after the current one when a row is dated later', () => {
    expect(monthChoices([tx({ date: '2026-12-02' })], '2026-10', 1)).toEqual(['2026-10', '2026-11', '2026-12'])
  })

  it('formats the real date range and the month label', () => {
    expect(formatPeriod('2026-09', 25)).toBe('25 Sep – 24 Oct 2026')
    expect(formatPeriod('2026-10', 1)).toBe('1 Oct – 31 Oct 2026')
    expect(formatPeriod('2026-12', 25)).toBe('25 Dec 2026 – 24 Jan 2027')
    expect(monthLabel('2026-10')).toBe('October 2026')
  })
})
