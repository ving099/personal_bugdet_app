import { describe, expect, it } from 'vitest'
import { avalanchePlan } from '../../src/debt/debt'
import type { Debt } from '../../src/domain/types'
import {
  balanceSeries, debtView, formatMonthYear, formatShortMonth, payoffMilestones, totalBalance, totalMinimums,
} from '../../src/ui/screens/debts/debtsModel'

const debt = (p: Partial<Debt>): Debt => ({
  id: 'd', name: 'Visa', kind: 'card', balancePence: 300000, creditLimitOrOriginalPence: 500000, aprPercent: 22.9,
  minimumPaymentPence: 5000, ...p,
})

describe('debtView', () => {
  it('shows card utilisation and loan percent paid as whole numbers', () => {
    expect(debtView(debt({}), '2026-10-26')).toMatchObject({ usageText: '60% used', usagePercent: 60, usageDetail: 'limit £5,000.00' })
    const loan = debt({ kind: 'loan', balancePence: 400000, creditLimitOrOriginalPence: 1000000 })
    expect(debtView(loan, '2026-10-26')).toMatchObject({ usageText: '60% paid off', usageDetail: 'original £10,000.00' })
    expect(debtView(debt({ balancePence: 333333 }), '2026-10-26').usageText).toBe('67% used')
  })

  it('never prints NaN when the limit or original amount is missing', () => {
    const card = debtView(debt({ creditLimitOrOriginalPence: 0 }), '2026-10-26')
    expect(card.usageHint).toBe('Add a credit limit to see utilisation')
    expect(card.usageText).toBeUndefined()
    const loan = debtView(debt({ kind: 'loan', creditLimitOrOriginalPence: 0 }), '2026-10-26')
    expect(loan.usageHint).toMatch(/original amount/)
    expect(JSON.stringify(card) + JSON.stringify(loan)).not.toMatch(/NaN/)
  })

  it('caps the bar at 100 but not the words, and never goes below 0 paid', () => {
    expect(debtView(debt({ balancePence: 600000 }), '2026-10-26')).toMatchObject({ usageText: '120% used', usagePercent: 100 })
    const over = debt({ kind: 'loan', balancePence: 1200000, creditLimitOrOriginalPence: 1000000 })
    expect(debtView(over, '2026-10-26')).toMatchObject({ usageText: '0% paid off', usagePercent: 0 })
  })

  it('uses the promo rate while it runs, then the standard rate', () => {
    const d = debt({ promoAprPercent: 0, promoEndsOn: '2027-01-31' })
    expect(debtView(d, '2026-10-26')).toMatchObject({ aprText: '0% APR', promoText: '0% until 31 Jan 2027, then 22.9%' })
    expect(debtView(d, '2027-02-01')).toMatchObject({ aprText: '22.9% APR', promoText: 'Promotional rate ended 31 Jan 2027' })
  })

  it('gives other debts no usage line', () => {
    expect(debtView(debt({ kind: 'other' }), '2026-10-26').usageText).toBeUndefined()
  })
})

describe('plan helpers', () => {
  const visa = debt({ id: 'a', name: 'Visa', balancePence: 20000, aprPercent: 0, minimumPaymentPence: 10000 })
  const loan = debt({ id: 'b', name: 'Loan', kind: 'loan', balancePence: 50000, aprPercent: 0, minimumPaymentPence: 10000 })
  const plan = avalanchePlan({ debts: [visa, loan], monthlyOverpaymentPence: 0, startDate: '2026-10-26' })

  it('finds the first month each debt reaches zero, soonest first', () => {
    expect(payoffMilestones(plan, [loan, visa])).toEqual([
      { debtId: 'a', name: 'Visa', date: '2026-11-26' },
      { debtId: 'b', name: 'Loan', date: '2027-01-26' },
    ])
  })

  it('lists a debt that never clears last, with no date', () => {
    const stuck = debt({ id: 'c', name: 'Stuck', balancePence: 10000000, aprPercent: 30, minimumPaymentPence: 100 })
    const p = avalanchePlan({ debts: [stuck, visa], monthlyOverpaymentPence: 0, startDate: '2026-10-26' })
    expect(payoffMilestones(p, [stuck, visa]).map((m) => [m.name, m.date])).toEqual([['Visa', '2026-11-26'], ['Stuck', null]])
  })

  it('ignores debts with nothing owed', () => {
    const none = debt({ id: 'z', balancePence: 0 })
    expect(payoffMilestones(avalanchePlan({ debts: [none], monthlyOverpaymentPence: 0, startDate: '2026-10-26' }), [none])).toEqual([])
  })

  it('builds the total balance series from today to debt-free, and thins long series keeping the end', () => {
    const s = balanceSeries(plan, [visa, loan], '2026-10-26')
    expect(s.map((p) => p.total)).toEqual([70000, 50000, 30000, 10000, 0])
    expect(s[0].date).toBe('2026-10-26')
    const stuck = debt({ id: 'c', balancePence: 10000000, aprPercent: 30, minimumPaymentPence: 100 })
    const long = avalanchePlan({ debts: [stuck], monthlyOverpaymentPence: 0, startDate: '2026-10-26' })
    const thin = balanceSeries(long, [stuck], '2026-10-26', 50)
    expect(thin).toHaveLength(50)
    expect(thin[49].date).toBe(long.months[long.months.length - 1].date)
  })

  it('totals balances and minimums and formats months', () => {
    expect(totalBalance([visa, loan])).toBe(70000)
    expect(totalMinimums([visa, loan])).toBe(20000)
    expect(formatMonthYear('2028-03-31')).toBe('March 2028')
    expect(formatShortMonth('2027-03-31')).toBe('Mar 2027')
  })
})
