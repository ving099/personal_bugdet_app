import { describe, expect, it } from 'vitest'
import type { Debt } from '../../src/domain/types'
import { avalanchePlan, effectiveApr, highAprDebts, percentPaid, utilisation } from '../../src/debt/debt'

const debt = (o: Partial<Debt> & { id: string }): Debt => ({
  name: o.id,
  kind: 'card',
  balancePence: 100_000,
  creditLimitOrOriginalPence: 500_000,
  aprPercent: 20,
  minimumPaymentPence: 5_000,
  ...o,
})

describe('utilisation / percentPaid', () => {
  it('utilisation = balance / limit', () => {
    expect(utilisation(debt({ id: 'c', balancePence: 300_000, creditLimitOrOriginalPence: 500_000 }))).toBeCloseTo(0.6)
  })
  it('percentPaid = 1 - balance/original', () => {
    expect(
      percentPaid(debt({ id: 'l', kind: 'loan', balancePence: 400_000, creditLimitOrOriginalPence: 1_000_000 })),
    ).toBeCloseTo(0.6)
  })
  it('undefined when limit/original is zero or missing, never NaN', () => {
    expect(utilisation(debt({ id: 'c', creditLimitOrOriginalPence: 0 }))).toBeUndefined()
    expect(percentPaid(debt({ id: 'l', creditLimitOrOriginalPence: 0 }))).toBeUndefined()
    expect(utilisation(debt({ id: 'c', creditLimitOrOriginalPence: undefined as unknown as number }))).toBeUndefined()
  })
  it('utilisation may exceed 1 (not clamped)', () => {
    expect(utilisation(debt({ id: 'c', balancePence: 600_000, creditLimitOrOriginalPence: 500_000 }))).toBeCloseTo(1.2)
  })
})

describe('effectiveApr', () => {
  const promo = debt({ id: 'p', aprPercent: 22.9, promoAprPercent: 0, promoEndsOn: '2027-01-31' })
  it('promo applies before the end date', () => expect(effectiveApr(promo, '2026-12-01')).toBe(0))
  it('promo applies on the last day (inclusive)', () => expect(effectiveApr(promo, '2027-01-31')).toBe(0))
  it('standard APR from the next day', () => {
    expect(effectiveApr(promo, '2027-02-01')).toBe(22.9)
  })
  it('no promo -> standard', () => expect(effectiveApr(debt({ id: 'x', aprPercent: 9 }), '2026-01-01')).toBe(9))
})

describe('highAprDebts', () => {
  const promo = debt({ id: 'p', aprPercent: 22.9, promoAprPercent: 0, promoEndsOn: '2027-01-31' })
  const hi = debt({ id: 'h', aprPercent: 24 })
  it('excludes a 0% promo card until promo ends', () => {
    expect(highAprDebts([promo, hi], 7, '2026-12-01').map((d) => d.id)).toEqual(['h'])
    expect(highAprDebts([promo, hi], 7, '2027-02-01').map((d) => d.id)).toEqual(['p', 'h'])
  })
  it('strictly greater than threshold', () => {
    expect(highAprDebts([debt({ id: 'e', aprPercent: 7 })], 7, '2026-01-01')).toEqual([])
  })
  it('excludes zero-balance debts', () => {
    expect(highAprDebts([debt({ id: 'z', aprPercent: 30, balancePence: 0 })], 7, '2026-01-01')).toEqual([])
  })
})

describe('avalanchePlan', () => {
  it('empty list -> debtFreeDate = startDate, no months', () => {
    expect(avalanchePlan({ debts: [], monthlyOverpaymentPence: 0, startDate: '2026-03-10' })).toEqual({
      debtFreeDate: '2026-03-10',
      months: [],
    })
  })

  it('ignores zero-balance debts', () => {
    const plan = avalanchePlan({
      debts: [debt({ id: 'z', balancePence: 0 }), debt({ id: 'a', balancePence: 10_000, aprPercent: 0, minimumPaymentPence: 10_000 })],
      monthlyOverpaymentPence: 0,
      startDate: '2026-01-01',
    })
    expect(Object.keys(plan.months[0].paidPence)).toEqual(['a'])
    expect(plan.debtFreeDate).toBe('2026-01-01')
  })

  it('24% clears first and its freed minimum rolls to the 8% debt', () => {
    const a = debt({ id: 'a', balancePence: 50_000, aprPercent: 24, minimumPaymentPence: 5_000 })
    const b = debt({ id: 'b', balancePence: 200_000, aprPercent: 8, minimumPaymentPence: 5_000, kind: 'loan' })
    const plan = avalanchePlan({ debts: [b, a], monthlyOverpaymentPence: 10_000, startDate: '2026-01-15' })
    const firstClear = plan.months.findIndex((m) => m.balancePence.a === 0)
    expect(firstClear).toBeGreaterThan(0)
    expect(plan.months.slice(0, firstClear).every((m) => m.balancePence.b > 0)).toBe(true)
    // before a clears, b gets its minimum only (all extra goes to a)
    expect(plan.months[0].paidPence.b).toBe(5_000)
    // after a clears, b gets minimum + overpayment + a's freed minimum
    const after = plan.months[firstClear + 1]
    expect(after.paidPence.b).toBeGreaterThan(plan.months[0].paidPence.b)
    expect(after.paidPence.b).toBe(5_000 + 10_000 + 5_000)
    expect(plan.debtFreeDate).not.toBeNull()
    const last = plan.months[plan.months.length - 1]
    expect(last.balancePence.a + last.balancePence.b).toBe(0)
    expect(plan.debtFreeDate).toBe(last.date)
  })

  it('minimums that cannot cover interest -> null, and terminates', () => {
    const d = debt({ id: 'a', balancePence: 1_000_000, aprPercent: 30, minimumPaymentPence: 1_000 })
    const plan = avalanchePlan({ debts: [d], monthlyOverpaymentPence: 0, startDate: '2026-01-01' })
    expect(plan.debtFreeDate).toBeNull()
    expect(plan.months.length).toBeLessThanOrEqual(600)
  })

  it('month dates advance from the original day-of-month, clamped', () => {
    const d = debt({ id: 'a', balancePence: 1_000_000, aprPercent: 0, minimumPaymentPence: 1_000 })
    const plan = avalanchePlan({ debts: [d], monthlyOverpaymentPence: 0, startDate: '2026-01-31' })
    expect(plan.months.slice(0, 4).map((m) => m.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('leap-year February clamps to 29', () => {
    const d = debt({ id: 'a', balancePence: 1_000_000, aprPercent: 0, minimumPaymentPence: 1_000 })
    const plan = avalanchePlan({ debts: [d], monthlyOverpaymentPence: 0, startDate: '2028-01-31' })
    expect(plan.months[1].date).toBe('2028-02-29')
  })

  it('never pays more than balance + interest; balances stay integer and non-negative', () => {
    const debts = [
      debt({ id: 'a', balancePence: 33_333, aprPercent: 19.9, minimumPaymentPence: 3_000 }),
      debt({ id: 'b', balancePence: 77_777, aprPercent: 6.5, minimumPaymentPence: 2_000, kind: 'loan' }),
    ]
    const plan = avalanchePlan({ debts, monthlyOverpaymentPence: 50_000, startDate: '2026-05-05' })
    const totalPaid = plan.months.reduce((s, m) => s + Object.values(m.paidPence).reduce((x, y) => x + y, 0), 0)
    // interest = paid - principal; principal = initial balance
    const final = plan.months[plan.months.length - 1]
    expect(final.balancePence).toEqual({ a: 0, b: 0 })
    const interest = totalPaid - 111_110
    expect(interest).toBeGreaterThan(0)
    for (const m of plan.months)
      for (const v of [...Object.values(m.balancePence), ...Object.values(m.paidPence)]) {
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
      }
  })

  it('uses promo APR while promo is live (0% interest)', () => {
    const d = debt({ id: 'p', balancePence: 120_000, aprPercent: 24, promoAprPercent: 0, promoEndsOn: '2026-12-31', minimumPaymentPence: 10_000 })
    const plan = avalanchePlan({ debts: [d], monthlyOverpaymentPence: 0, startDate: '2026-01-01' })
    expect(plan.months[0].balancePence.p).toBe(110_000)
    expect(plan.debtFreeDate).toBe('2026-12-01')
  })

  it('throws on negative overpayment and malformed start date', () => {
    expect(() => avalanchePlan({ debts: [], monthlyOverpaymentPence: -1, startDate: '2026-01-01' })).toThrow(/overpayment/i)
    expect(() => avalanchePlan({ debts: [], monthlyOverpaymentPence: 0, startDate: '01/01/2026' })).toThrow(/startDate/)
    expect(() => avalanchePlan({ debts: [], monthlyOverpaymentPence: 0, startDate: '2026-02-30' })).toThrow(/startDate/)
  })
})
