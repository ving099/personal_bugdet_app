import { describe, expect, it } from 'vitest'
import { previousMonths } from '../../src/budget/months'
import {
  countsAsIncome, monthSummary, monthDebtPayments, sinkingMonthlyPence, smoothedIncome, trailingDebtPayments, trailingSpend,
  trailingUnmatchedRepayments,
} from '../../src/budget/summary'
import type { Account, Category, IncomeStream, Transaction } from '../../src/domain/types'
import { seedCategories } from '../../src/seed/categories'

const accounts: Account[] = [
  { id: 'cur', name: 'Current', bank: 'A', kind: 'current' },
  { id: 'biz', name: 'Business', bank: 'D', kind: 'business' },
]
const categories: Category[] = [
  { id: 'groc', name: 'Groceries', monthlyLimitPence: 0, excludedFromSpending: false },
  { id: 'fun', name: 'Fun', monthlyLimitPence: 0, excludedFromSpending: false },
]
const streams: IncomeStream[] = [{ id: 's1', label: 'Salary', expectedMonthlyNetPence: 200000 }]

let n = 0
const tx = (date: string, amountPence: number, o: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  accountId: 'cur',
  date,
  amountPence,
  description: 'X',
  fingerprint: `f${n}`,
  batchId: 'b',
  isTransfer: false,
  isRefund: false,
  ...o,
})
const base = { startDay: 1, accounts, categories, streams }

describe('monthSummary', () => {
  it('sums spend by category and income by stream', () => {
    const r = monthSummary({
      ...base,
      month: '2026-10',
      txs: [
        tx('2026-10-03', -5000, { categoryId: 'groc' }),
        tx('2026-10-04', -2500, { categoryId: 'groc' }),
        tx('2026-10-05', -1000, { categoryId: 'fun' }),
        tx('2026-10-06', 200000, { incomeStreamId: 's1' }),
        tx('2026-09-30', -9999, { categoryId: 'groc' }),
      ],
    })
    expect(r.spentByCategory).toEqual({ groc: 7500, fun: 1000 })
    expect(r.totalSpentPence).toBe(8500)
    expect(r.incomeByStream).toEqual({ s1: 200000 })
    expect(r.totalIncomePence).toBe(200000)
    expect(r.leftPence).toBe(191500)
  })

  it('puts Oct 25 in the October period when startDay is 25', () => {
    const txs = [tx('2026-10-25', -1000, { categoryId: 'groc' }), tx('2026-10-24', -400, { categoryId: 'groc' })]
    expect(monthSummary({ ...base, startDay: 25, month: '2026-10', txs }).totalSpentPence).toBe(1000)
    expect(monthSummary({ ...base, startDay: 25, month: '2026-09', txs }).totalSpentPence).toBe(400)
  })

  it('nets refunds against their category and does not count them as income', () => {
    const r = monthSummary({
      ...base,
      month: '2026-10',
      txs: [tx('2026-10-03', -5000, { categoryId: 'groc' }), tx('2026-10-04', 1500, { categoryId: 'groc', isRefund: true })],
    })
    expect(r.spentByCategory.groc).toBe(3500)
    expect(r.totalIncomePence).toBe(0)
    expect(r.leftPence).toBe(-3500)
  })

  it('excludes transfers and business-account rows from spend and income', () => {
    const r = monthSummary({
      ...base,
      month: '2026-10',
      txs: [
        tx('2026-10-03', -5000, { categoryId: 'groc', isTransfer: true }),
        tx('2026-10-03', 7000, { isTransfer: true }),
        tx('2026-10-04', -3000, { accountId: 'biz', categoryId: 'groc' }),
        tx('2026-10-04', 9000, { accountId: 'biz' }),
      ],
    })
    expect(r.totalSpentPence).toBe(0)
    expect(r.totalIncomePence).toBe(0)
    expect(r.incomeByStream).toEqual({})
  })

  it('files unstreamed income under unassigned and uncategorised spend under uncategorised', () => {
    const r = monthSummary({ ...base, month: '2026-10', txs: [tx('2026-10-03', 1200), tx('2026-10-04', -300)] })
    expect(r.incomeByStream).toEqual({ unassigned: 1200 })
    expect(r.spentByCategory).toEqual({ uncategorised: 300 })
  })

  it('skips categories excluded from spending', () => {
    const cats = [...categories, { id: 'tr', name: 'Transfers', monthlyLimitPence: 0, excludedFromSpending: true }]
    const r = monthSummary({ ...base, categories: cats, month: '2026-10', txs: [tx('2026-10-03', -800, { categoryId: 'tr' })] })
    expect(r.totalSpentPence).toBe(0)
  })

  it('throws on an invalid month', () => {
    expect(() => monthSummary({ ...base, month: '2026-13', txs: [] })).toThrow(/Invalid budget month/)
  })
})

describe('trailingSpend', () => {
  it('averages months that have data', () => {
    const txs = [tx('2026-09-10', -10000), tx('2026-08-10', -20001)]
    expect(trailingSpend({ asOfMonth: '2026-10', startDay: 1, txs, accounts })).toEqual({ averagePence: 15001, monthsUsed: 2 })
  })
  it('returns zero, not NaN, with no history', () => {
    expect(trailingSpend({ asOfMonth: '2026-10', startDay: 1, txs: [], accounts })).toEqual({ averagePence: 0, monthsUsed: 0 })
  })
  it('excludes the as-of month itself and months beyond the window', () => {
    const txs = [tx('2026-10-10', -99999), tx('2026-09-10', -3000), tx('2026-05-10', -99999)]
    expect(trailingSpend({ asOfMonth: '2026-10', startDay: 1, txs, accounts })).toEqual({ averagePence: 3000, monthsUsed: 1 })
  })
  it('crosses the year boundary', () => {
    expect(previousMonths('2026-01', 3)).toEqual(['2025-12', '2025-11', '2025-10'])
    const txs = [tx('2025-12-10', -3000), tx('2025-10-10', -6000)]
    expect(trailingSpend({ asOfMonth: '2026-01', startDay: 1, txs, accounts })).toEqual({ averagePence: 4500, monthsUsed: 2 })
  })
  it('ignores transfers and business rows', () => {
    const txs = [tx('2026-09-10', -5000, { isTransfer: true }), tx('2026-09-11', -5000, { accountId: 'biz' })]
    expect(trailingSpend({ asOfMonth: '2026-10', startDay: 1, txs, accounts }).monthsUsed).toBe(0)
  })
})

describe('smoothedIncome', () => {
  it('uses the lower of expected and trailing actual average', () => {
    const txs = [tx('2026-09-28', 170000, { incomeStreamId: 's1' }), tx('2026-08-28', 170000, { incomeStreamId: 's1' })]
    const r = smoothedIncome({ asOfMonth: '2026-10', startDay: 1, txs, accounts, streams })
    expect(r).toEqual({ totalPence: 170000, perStream: { s1: 170000 }, monthsUsed: 2, unassignedAveragePence: 0 })
  })
  it('caps at expected when actual is higher', () => {
    const txs = [tx('2026-09-28', 250000, { incomeStreamId: 's1' })]
    expect(smoothedIncome({ asOfMonth: '2026-10', startDay: 1, txs, accounts, streams }).perStream.s1).toBe(200000)
  })
  it('uses expected when there is no history', () => {
    expect(smoothedIncome({ asOfMonth: '2026-10', startDay: 1, txs: [], accounts, streams })).toEqual({
      totalPence: 200000,
      perStream: { s1: 200000 },
      monthsUsed: 0,
      unassignedAveragePence: 0,
    })
  })
})

describe('sinkingMonthlyPence', () => {
  it('divides yearly amounts by 12, rounding per fund', () => {
    expect(sinkingMonthlyPence([{ id: 'a', name: 'Car', yearlyAmountPence: 120000, dueMonth: 3 }])).toBe(10000)
    expect(
      sinkingMonthlyPence([
        { id: 'a', name: 'A', yearlyAmountPence: 1000, dueMonth: 1 },
        { id: 'b', name: 'B', yearlyAmountPence: 1000, dueMonth: 2 },
      ]),
    ).toBe(166)
  })
  it('is zero for no funds', () => {
    expect(sinkingMonthlyPence([])).toBe(0)
  })
})

describe('review fixes', () => {
  const exCats: Category[] = [...categories, { id: 'tr', name: 'Transfers', monthlyLimitPence: 0, excludedFromSpending: true }]

  it('trailingSpend with startDay 25 across a year boundary', () => {
    // period 2025-12 = Dec 25 - Jan 24; 2025-11 = Nov 25 - Dec 24
    const txs = [tx('2026-01-10', -4000), tx('2025-12-26', -2000), tx('2025-12-01', -6000), tx('2025-10-25', -9000)]
    // asOf 2026-01: Dec(6000 from Dec25-Jan24 => 4000+2000), Nov(6000), Oct(9000)
    expect(trailingSpend({ asOfMonth: '2026-01', startDay: 25, txs, accounts })).toEqual({ averagePence: 7000, monthsUsed: 3 })
  })

  it('trailingSpend honours excluded categories only when categories passed', () => {
    const txs = [tx('2026-09-10', -5000, { categoryId: 'tr' }), tx('2026-09-11', -1000, { categoryId: 'groc' })]
    const common = { asOfMonth: '2026-10', startDay: 1, txs, accounts }
    expect(trailingSpend({ ...common, categories: exCats }).averagePence).toBe(1000)
    expect(trailingSpend(common).averagePence).toBe(6000)
  })

  it('smoothedIncome with two streams, one without history', () => {
    const two: IncomeStream[] = [...streams, { id: 's2', label: 'Side', expectedMonthlyNetPence: 50000 }]
    const txs = [tx('2026-09-28', 150000, { incomeStreamId: 's1' })]
    const r = smoothedIncome({ asOfMonth: '2026-10', startDay: 1, txs, accounts, streams: two })
    expect(r.perStream).toEqual({ s1: 150000, s2: 50000 })
    expect(r.totalPence).toBe(200000)
    expect(r.monthsUsed).toBe(1)
  })

  it('smoothedIncome excludes transfer and business rows', () => {
    const txs = [
      tx('2026-09-28', 100000, { incomeStreamId: 's1', isTransfer: true }),
      tx('2026-09-28', 100000, { incomeStreamId: 's1', accountId: 'biz' }),
    ]
    const r = smoothedIncome({ asOfMonth: '2026-10', startDay: 1, txs, accounts, streams })
    expect(r.monthsUsed).toBe(0)
    expect(r.perStream.s1).toBe(200000)
  })

  it('smoothedIncome ignores excluded-category income when categories passed', () => {
    const txs = [tx('2026-09-28', 100000, { incomeStreamId: 's1', categoryId: 'tr' })]
    const r = smoothedIncome({ asOfMonth: '2026-10', startDay: 1, txs, accounts, streams, categories: exCats })
    expect(r.monthsUsed).toBe(0)
  })

  it('reports unassignedAveragePence without adding it to the total', () => {
    const txs = [tx('2026-09-05', 30000), tx('2026-08-05', 10000), tx('2026-09-28', 100000, { incomeStreamId: 's1' })]
    const r = smoothedIncome({ asOfMonth: '2026-10', startDay: 1, txs, accounts, streams })
    expect(r.unassignedAveragePence).toBe(20000)
    expect(r.totalPence).toBe(100000)
    expect(r.perStream).toEqual({ s1: 100000 })
  })

  it('throws on invalid month or startDay', () => {
    expect(() => trailingSpend({ asOfMonth: 'bad', startDay: 1, txs: [], accounts })).toThrow(/Invalid budget month/)
    expect(() => smoothedIncome({ asOfMonth: '2026-00', startDay: 1, txs: [], accounts, streams })).toThrow(/Invalid budget month/)
    expect(() => trailingSpend({ asOfMonth: '2026-10', startDay: 0, txs: [], accounts })).toThrow(/start day/)
    expect(() => monthSummary({ ...base, startDay: 1.5, month: '2026-10', txs: [] })).toThrow(/start day/)
  })

  it('monthSummary does not count a positive excluded-category row as income', () => {
    const r = monthSummary({ ...base, categories: exCats, month: '2026-10', txs: [tx('2026-10-03', 5000, { categoryId: 'tr' })] })
    expect(r.totalIncomePence).toBe(0)
    expect(r.incomeByStream).toEqual({})
  })

  it('does not mutate inputs', () => {
    const txs = [tx('2026-09-10', -1000, { categoryId: 'groc' }), tx('2026-09-11', 5000, { incomeStreamId: 's1' })]
    const snap = JSON.stringify({ txs, accounts, exCats, streams })
    monthSummary({ ...base, categories: exCats, month: '2026-09', txs })
    trailingSpend({ asOfMonth: '2026-10', startDay: 1, txs, accounts, categories: exCats })
    smoothedIncome({ asOfMonth: '2026-10', startDay: 1, txs, accounts, streams, categories: exCats })
    expect(JSON.stringify({ txs, accounts, exCats, streams })).toBe(snap)
  })
})

describe('trailingSpend with net-refund months', () => {
  it('never returns a negative average when refunds outweigh spend in a month', () => {
    const r = trailingSpend({
      ...base,
      asOfMonth: '2026-10',
      txs: [tx('2026-09-01', -2000), tx('2026-09-20', 20000, { isRefund: true })],
    })
    expect(r).toEqual({ averagePence: 0, monthsUsed: 0 })
  })

  it('treats a net-refund month as no data, so it neither lowers the average nor counts as a month used', () => {
    const r = trailingSpend({
      ...base,
      asOfMonth: '2026-10',
      txs: [
        tx('2026-07-05', -30000),
        tx('2026-08-05', -10000),
        tx('2026-09-01', -2000),
        tx('2026-09-20', 20000, { isRefund: true }),
      ],
    })
    expect(r).toEqual({ averagePence: 20000, monthsUsed: 2 })
  })

  it('treats a month that nets to exactly zero as no data', () => {
    const r = trailingSpend({
      ...base,
      asOfMonth: '2026-10',
      txs: [tx('2026-08-05', -10000), tx('2026-09-01', -2000), tx('2026-09-03', 2000, { isRefund: true })],
    })
    expect(r).toEqual({ averagePence: 10000, monthsUsed: 1 })
  })

  it('still nets a smaller refund against the month it lands in', () => {
    const r = trailingSpend({
      ...base,
      asOfMonth: '2026-10',
      txs: [tx('2026-09-01', -5000), tx('2026-09-03', 2000, { isRefund: true })],
    })
    expect(r).toEqual({ averagePence: 3000, monthsUsed: 1 })
  })
})

describe('seeded non-spending categories (review I1)', () => {
  const seeded = { startDay: 1, accounts, categories: seedCategories, streams }
  it('does not count a loan direct debit filed under Debt payments as spending', () => {
    const txs = [tx('2026-09-01', -15000, { categoryId: 'debt-payments' }), tx('2026-09-05', -5000, { categoryId: 'groceries-and-food' })]
    expect(trailingSpend({ ...seeded, asOfMonth: '2026-10', txs }).averagePence).toBe(5000)
    expect(monthSummary({ ...seeded, month: '2026-09', txs }).totalSpentPence).toBe(5000)
  })

  it('does not count money sent to an investing platform as spending', () => {
    const txs = [tx('2026-09-20', -10000, { categoryId: 'savings-and-investing' })]
    expect(trailingSpend({ ...seeded, asOfMonth: '2026-10', txs })).toEqual({ averagePence: 0, monthsUsed: 0 })
  })

  it('still counts pay filed under Income as income', () => {
    const txs = [tx('2026-09-28', 250000, { categoryId: 'income', incomeStreamId: 's1' })]
    expect(monthSummary({ ...seeded, month: '2026-09', txs }).totalIncomePence).toBe(250000)
    const r = smoothedIncome({ ...seeded, asOfMonth: '2026-10', txs })
    expect(r.perStream.s1).toBe(200000)
    expect(r.monthsUsed).toBe(1)
  })

  it('does not count money back from an investing platform as income', () => {
    const txs = [tx('2026-09-28', 50000, { categoryId: 'savings-and-investing' })]
    expect(monthSummary({ ...seeded, month: '2026-09', txs }).totalIncomePence).toBe(0)
  })
})

describe('unmatched card repayments (review I2)', () => {
  const withCard: Account[] = [...accounts, { id: 'card', name: 'Card', bank: 'B', kind: 'creditCard' }]
  const b = { startDay: 25, accounts: withCard, categories: seedCategories, streams }
  const repay = tx('2026-10-05', -25000, { description: 'BARCLAYCARD PAYMENT' })
  const shop = tx('2026-10-06', -8333, { description: 'TESCO STORES 3333', categoryId: 'groceries-and-food' })

  it('are listed for attention but not counted as spending while the card statement is missing', () => {
    expect(monthSummary({ ...b, month: '2026-09', txs: [repay, shop] }).totalSpentPence).toBe(8333)
    expect(trailingSpend({ ...b, asOfMonth: '2026-10', txs: [repay, shop] })).toEqual({ averagePence: 8333, monthsUsed: 1 })
  })

  it('a month with only an unmatched repayment has no spending data', () => {
    expect(trailingSpend({ ...b, asOfMonth: '2026-10', txs: [repay] })).toEqual({ averagePence: 0, monthsUsed: 0 })
  })

  it('stays out of spending once the card statement arrives and the pair is flagged as a transfer', () => {
    const paired = { ...repay, isTransfer: true }
    const cardIn = tx('2026-10-07', 25000, { accountId: 'card', description: 'PAYMENT RECEIVED THANK YOU', isTransfer: true })
    const cardSpend = tx('2026-10-02', -4520, { accountId: 'card', description: 'SHELL', categoryId: 'transport' })
    const r = monthSummary({ ...b, month: '2026-09', txs: [paired, cardIn, cardSpend, shop] })
    expect(r.totalSpentPence).toBe(8333 + 4520)
    expect(r.totalIncomePence).toBe(0)
  })
})

describe('debt payments outside the Debts list (part 2, important 1)', () => {
  const b = { startDay: 1, accounts, categories: seedCategories }
  const klarna = (d: string) => tx(d, -4000, { categoryId: 'debt-payments', description: 'KLARNA' })
  const loan = (d: string) => tx(d, -15000, { categoryId: 'debt-payments', description: 'LOAN REPAYMENT' })

  it('averages Debt payments outflows over the same window as trailingSpend', () => {
    const txs = [klarna('2026-07-03'), loan('2026-07-04'), klarna('2026-08-03'), loan('2026-08-04'), klarna('2026-09-03'), loan('2026-09-04')]
    expect(trailingDebtPayments({ ...b, asOfMonth: '2026-10', txs })).toEqual({ averagePence: 19000, monthsUsed: 3 })
    expect(trailingSpend({ ...b, asOfMonth: '2026-10', txs })).toEqual({ averagePence: 0, monthsUsed: 0 })
  })

  it('handles net-refund months the same way and ignores other categories, transfers and business rows', () => {
    const txs = [
      klarna('2026-09-03'),
      tx('2026-08-03', -4000, { categoryId: 'debt-payments' }),
      tx('2026-08-10', 9000, { categoryId: 'debt-payments', isRefund: true }),
      tx('2026-09-05', -7000, { categoryId: 'debt-payments', isTransfer: true }),
      tx('2026-09-06', -7000, { categoryId: 'debt-payments', accountId: 'biz' }),
      tx('2026-09-07', -7000, { categoryId: 'groceries-and-food' }),
    ]
    expect(trailingDebtPayments({ ...b, asOfMonth: '2026-10', txs })).toEqual({ averagePence: 4000, monthsUsed: 1 })
  })

  it('a month with spending but no debt payment counts as a zero month (part 3)', () => {
    const groceries = ['2026-07-05', '2026-08-05', '2026-09-05'].map((d) => tx(d, -30000, { categoryId: 'groceries-and-food' }))
    const oneOff = trailingDebtPayments({ ...b, asOfMonth: '2026-10', txs: [...groceries, tx('2026-08-20', -200000, { categoryId: 'debt-payments' })] })
    expect(oneOff).toEqual({ averagePence: 66667, monthsUsed: 3 })
    const ended = trailingDebtPayments({ ...b, asOfMonth: '2026-10', txs: [...groceries, klarna('2026-07-03')] })
    expect(ended).toEqual({ averagePence: 1333, monthsUsed: 3 })
  })

  it('reports one month of Debt payments for the Budget line', () => {
    expect(monthDebtPayments({ ...b, month: '2026-09', txs: [klarna('2026-09-03'), loan('2026-09-04'), klarna('2026-10-03')] })).toBe(19000)
  })
})

describe('business drawings filed under Transfers (part 2, important 2)', () => {
  const b = { startDay: 1, accounts, categories: seedCategories, streams }
  const drawing = (o: Partial<Transaction> = {}) =>
    tx('2026-09-10', 100000, { categoryId: 'transfers', description: 'TRANSFER FROM BIZ LTD', ...o })

  it('an unpaired Transfers credit counts as income everywhere', () => {
    const t = drawing()
    expect(countsAsIncome(t, accounts, seedCategories)).toBe(true)
    expect(monthSummary({ ...b, month: '2026-09', txs: [t] }).incomeByStream).toEqual({ unassigned: 100000 })
    expect(smoothedIncome({ ...b, asOfMonth: '2026-10', txs: [t] }).unassignedAveragePence).toBe(100000)
  })

  it('a matched transfer pair stays out', () => {
    const t = drawing({ isTransfer: true })
    expect(countsAsIncome(t, accounts, seedCategories)).toBe(false)
    expect(monthSummary({ ...b, month: '2026-09', txs: [t] }).totalIncomePence).toBe(0)
  })

  it('a credit the owner filed under Transfers by hand stays out', () => {
    const t = drawing({ categoryEditedByUser: true })
    expect(countsAsIncome(t, accounts, seedCategories)).toBe(false)
    expect(monthSummary({ ...b, month: '2026-09', txs: [t] }).totalIncomePence).toBe(0)
  })

  it('an outflow under Transfers is still not spending', () => {
    const t = tx('2026-09-10', -5000, { categoryId: 'transfers', description: 'TRANSFER TO BIZ' })
    expect(monthSummary({ ...b, month: '2026-09', txs: [t] }).totalSpentPence).toBe(0)
  })

  it('assigned to a stream, a drawing gives that stream actual history', () => {
    const r = smoothedIncome({ ...b, asOfMonth: '2026-10', txs: [drawing({ incomeStreamId: 's1' })] })
    expect(r.monthsUsed).toBe(1)
    expect(r.perStream.s1).toBe(100000)
  })
})

describe('trailingUnmatchedRepayments (part 2, minor 2)', () => {
  it('averages unmatched card repayments over the months in the window that have spending or repayments', () => {
    const txs = [
      tx('2026-07-05', -10000, { categoryId: 'groceries-and-food' }),
      tx('2026-08-05', -10000, { categoryId: 'groceries-and-food' }),
      tx('2026-08-06', -30000, { description: 'BARCLAYCARD PAYMENT' }),
      tx('2026-09-06', -30000, { description: 'BARCLAYCARD PAYMENT', isTransfer: true }),
    ]
    expect(trailingUnmatchedRepayments({ startDay: 1, accounts, categories: seedCategories, asOfMonth: '2026-10', txs })).toBe(15000)
    expect(trailingUnmatchedRepayments({ startDay: 1, accounts, categories: seedCategories, asOfMonth: '2026-10', txs: txs.slice(0, 2) })).toBe(0)
  })
})
