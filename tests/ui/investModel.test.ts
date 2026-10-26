import { describe, expect, it } from 'vitest'
import type { Account, Debt, InvestmentLog, Transaction } from '../../src/domain/types'
import { seedCategories } from '../../src/seed/categories'
import { seedHoldings } from '../../src/seed/holdings'
import { seedPlatforms } from '../../src/seed/platforms'
import { seedSettings } from '../../src/seed/settings'
import {
  breakdownLines, buildInvestView, investableInputFor, investState, lineKey, logId, planForUsed, planGroups, reasonText,
  withTaxYears, wrapperSummary, type InvestData,
} from '../../src/ui/screens/invest/investModel'

const TODAY = '2026-10-26'
const current: Account = { id: 'cur', name: 'Current', bank: 'Bank', kind: 'current' }
let n = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${n++}`, accountId: 'cur', date: '2026-09-10', amountPence: -1000, description: 'Shop', fingerprint: `f${n}`,
  batchId: 'b', isTransfer: false, isRefund: false, ...p,
})
const debt = (p: Partial<Debt>): Debt => ({
  id: 'd', name: 'Card', kind: 'card', balancePence: 100000, creditLimitOrOriginalPence: 500000, aprPercent: 22.9,
  minimumPaymentPence: 2500, ...p,
})

const data = (p: Partial<InvestData> = {}): InvestData => ({
  settings: { ...seedSettings, onboardingDone: true },
  accounts: [current],
  categories: seedCategories,
  streams: [{ id: 's', label: 'Salary', expectedMonthlyNetPence: 300000 }],
  txs: [],
  debts: [],
  pots: [],
  funds: [],
  used: [],
  holdings: seedHoldings,
  platforms: seedPlatforms,
  opening: [],
  log: [],
  ...p,
})

describe('investableInputFor: income and spending', () => {
  it('ignores spending in an excluded category (categories must reach trailingSpend)', () => {
    const d = data({
      txs: [
        tx({ date: '2026-09-10', amountPence: -50000, categoryId: 'groceries-and-food' }),
        // Not flagged as a transfer, but in the excluded Transfers category: must not count as spending.
        tx({ date: '2026-09-12', amountPence: -90000, categoryId: 'transfers' }),
      ],
    })
    expect(investableInputFor(d, TODAY).input.spendPence).toBe(50000)
  })

  it('ignores income in an excluded category (categories must reach smoothedIncome)', () => {
    const d = data({
      txs: [tx({ date: '2026-09-01', amountPence: 100000, categoryId: 'savings-and-investing', incomeStreamId: 's' })],
    })
    // Counted, the stream would fall to its £1,000 average; excluded, there is no history so expected £3,000 stands.
    expect(investableInputFor(d, TODAY).input.incomePence).toBe(300000)
  })

  it('uses the lower of expected and the trailing average actual income', () => {
    const d = data({
      txs: [
        tx({ date: '2026-09-01', amountPence: 250000, incomeStreamId: 's', categoryId: 'income' }),
        tx({ date: '2026-08-01', amountPence: 250000, incomeStreamId: 's', categoryId: 'income' }),
      ],
    })
    const { input } = investableInputFor(d, TODAY)
    expect(input.incomePence).toBe(250000)
    expect(input.monthsOfHistory).toBe(2)
  })

  it('works out the budget month from the start day', () => {
    expect(investableInputFor(data(), TODAY).month).toBe('2026-10')
    const late = data({ settings: { ...seedSettings, budgetMonthStartDay: 27 } })
    expect(investableInputFor(late, TODAY).month).toBe('2026-09')
    // With start day 27, 26 Sep falls in August's period, so it is history for September.
    const d = data({
      settings: { ...seedSettings, budgetMonthStartDay: 27 },
      txs: [
        tx({ date: '2026-09-26', amountPence: -40000, categoryId: 'eating-out' }),
        // 28 Sep is inside the current period (27 Sep - 26 Oct), so it is not history yet.
        tx({ date: '2026-09-28', amountPence: -70000, categoryId: 'eating-out' }),
      ],
    })
    expect(investableInputFor(d, TODAY).input.spendPence).toBe(40000)
  })

  it('passes the buffer and top-up settings through', () => {
    const d = data({ settings: { ...seedSettings, bufferPercent: 15, emergencyTopUpSharePercent: 40 } })
    const { input } = investableInputFor(d, TODAY)
    expect(input.bufferPercent).toBe(15)
    expect(input.emergencyTopUpSharePercent).toBe(40)
  })
})

describe('investableInputFor: debts, sinking funds and the emergency fund', () => {
  it('counts only balances above the APR threshold as payoff capacity, and every minimum', () => {
    const d = data({
      debts: [
        debt({ id: 'high', balancePence: 100000, aprPercent: 22.9, minimumPaymentPence: 2500 }),
        debt({ id: 'at', balancePence: 200000, aprPercent: 7, minimumPaymentPence: 4000 }),
        debt({ id: 'promo', balancePence: 300000, aprPercent: 24.9, promoAprPercent: 0, promoEndsOn: '2027-03-01', minimumPaymentPence: 3000 }),
        debt({ id: 'ended', balancePence: 400000, aprPercent: 19.9, promoAprPercent: 0, promoEndsOn: '2026-10-25', minimumPaymentPence: 5000 }),
        debt({ id: 'paid', balancePence: 0, aprPercent: 30, minimumPaymentPence: 1000 }),
      ],
    })
    const { input } = investableInputFor(d, TODAY)
    expect(input.highAprPayoffCapacityPence).toBe(500000)
    expect(input.debtMinimumsPence).toBe(15500)
  })

  it('uses the APR threshold from settings', () => {
    const d = data({ settings: { ...seedSettings, aprThresholdPercent: 25 }, debts: [debt({ aprPercent: 22.9 })] })
    expect(investableInputFor(d, TODAY).input.highAprPayoffCapacityPence).toBe(0)
  })

  it('spreads sinking funds over twelve months', () => {
    const d = data({
      funds: [
        { id: 'a', name: 'Car', yearlyAmountPence: 120000, dueMonth: 3 },
        { id: 'b', name: 'TV', yearlyAmountPence: 15950, dueMonth: 6 },
      ],
    })
    expect(investableInputFor(d, TODAY).input.sinkingPence).toBe(10000 + 1329)
  })

  it('takes the emergency gap from the pot named in settings', () => {
    const pots = [
      { id: 'e', name: 'Emergency', balancePence: 120000, targetPence: 300000, isEmergencyFund: true },
      { id: 'h', name: 'Holiday', balancePence: 0, targetPence: 900000, isEmergencyFund: false },
    ]
    expect(investableInputFor(data({ pots, settings: { ...seedSettings, emergencyFundPotId: 'e' } }), TODAY).input.emergencyGapPence).toBe(180000)
    expect(investableInputFor(data({ pots }), TODAY).input.emergencyGapPence).toBe(0)
    const full = [{ ...pots[0], balancePence: 400000 }]
    expect(investableInputFor(data({ pots: full, settings: { ...seedSettings, emergencyFundPotId: 'e' } }), TODAY).input.emergencyGapPence).toBe(0)
  })
})

describe('buildInvestView', () => {
  it('plan lines sum exactly to the investable amount', () => {
    const v = buildInvestView(data(), TODAY)
    expect(v.investable.ok).toBe(true)
    if (!v.investable.ok) return
    const total = planGroups(v.plan, seedHoldings, v.month, v.taxYear)
      .flatMap((g) => g.rows)
      .reduce((s, r) => s + r.plannedPence, 0)
    expect(total).toBe(v.investable.investablePence)
    expect(v.taxYear).toBe('2026/27')
  })

  it('gives LISA a line only when it is turned on', () => {
    expect(buildInvestView(data(), TODAY).wrappers.map((w) => w.wrapper)).not.toContain('lisa')
    const on = buildInvestView(data({ settings: { ...seedSettings, lisaEnabled: true } }), TODAY)
    expect(on.wrappers.map((w) => w.wrapper)).toContain('lisa')
  })

  it('reads allowance used for the tax year of today only', () => {
    const full = buildInvestView(data({ used: [{ taxYear: '2026/27', wrapper: 'isa', usedPence: 2000000 }] }), TODAY)
    expect(full.wrappers.find((w) => w.wrapper === 'isa')!.pence).toBe(0)
    const old = buildInvestView(data({ used: [{ taxYear: '2025/26', wrapper: 'isa', usedPence: 2000000 }] }), TODAY)
    expect(old.wrappers.find((w) => w.wrapper === 'isa')!.pence).toBeGreaterThan(0)
  })

  it("keeps this month's plan steady while lines are ticked off, even when ISA room is nearly used up", () => {
    // £1,000 of ISA room left over 6 months: the ISA slot is capped at £166.66, so any extra "used" would shrink it.
    const nearlyFull = [{ taxYear: '2026/27', wrapper: 'isa' as const, usedPence: 1900000 }]
    const before = buildInvestView(data({ used: nearlyFull }), TODAY)
    const isa = before.wrappers.find((w) => w.wrapper === 'isa')!
    expect(isa.pence).toBe(16666)
    const row = before.groups.find((g) => g.wrapper === 'isa')!.rows.find((r) => r.holdingId === 'growth-global')!
    const log: InvestmentLog[] = [
      { id: row.id, month: '2026-10', taxYear: '2026/27', wrapper: 'isa', holdingId: 'growth-global', plannedPence: row.plannedPence, actualPence: row.plannedPence, platformId: 'choose' },
    ]
    const used = [{ ...nearlyFull[0], usedPence: 1900000 + row.plannedPence }]
    const after = buildInvestView(data({ log, used }), TODAY)
    expect(after.wrappers).toEqual(before.wrappers)
    expect(after.plan.effectiveSplit).toEqual(before.plan.effectiveSplit)
    expect(after.logged.get(lineKey('isa', 'growth-global'))?.id).toBe(row.id)
    expect(after.otherLogged).toEqual([])
  })

  it('planForUsed takes this month’s logged amounts for this tax year back out, never below zero', () => {
    const log: InvestmentLog[] = [
      { id: 'x', month: '2026-10', taxYear: '2026/27', wrapper: 'isa', holdingId: 'h', plannedPence: 5000, actualPence: 5000, platformId: 'choose' },
      { id: 'y', month: '2026-09', taxYear: '2026/27', wrapper: 'isa', holdingId: 'h', plannedPence: 7000, actualPence: 7000, platformId: 'choose' },
      { id: 'z', month: '2026-10', taxYear: '2026/27', wrapper: 'pension', holdingId: 'h', plannedPence: 9000, actualPence: 9000, platformId: 'choose' },
      // Same budget month, another tax year: never touches 2026/27.
      { id: 'w', month: '2026-10', taxYear: '2025/26', wrapper: 'isa', holdingId: 'h', plannedPence: 3000, actualPence: 3000, platformId: 'choose' },
    ]
    const used = [
      { taxYear: '2026/27', wrapper: 'isa' as const, usedPence: 20000 },
      { taxYear: '2026/27', wrapper: 'pension' as const, usedPence: 4000 },
      { taxYear: '2025/26', wrapper: 'isa' as const, usedPence: 3000 },
    ]
    expect(planForUsed(used, log, '2026-10', '2026/27')).toEqual([
      { taxYear: '2026/27', wrapper: 'isa', usedPence: 15000 },
      { taxYear: '2026/27', wrapper: 'pension', usedPence: 0 },
      { taxYear: '2025/26', wrapper: 'isa', usedPence: 3000 },
    ])
  })

  it('across 6 April, a line logged for the old tax year does not count in the new one', () => {
    // Start day 1: 3 Apr and 7 Apr 2027 are both in budget month 2027-04, but in different tax years.
    const d = (p: Partial<InvestData>) => data({ settings: { ...seedSettings, allowances: { '2026/27': { isa: 2000000, pension: 6000000 }, '2027/28': { isa: 2000000, pension: 6000000 } } }, ...p })
    const april3 = buildInvestView(d({}), '2027-04-03')
    expect(april3.taxYear).toBe('2026/27')
    const row = april3.groups.find((g) => g.wrapper === 'pension')!.rows[0]
    expect(row.id).toBe(logId('2026/27', '2027-04', 'pension', row.holdingId))
    const log: InvestmentLog[] = [
      { id: row.id, month: '2027-04', taxYear: '2026/27', wrapper: 'pension', holdingId: row.holdingId, plannedPence: row.plannedPence, actualPence: row.plannedPence, platformId: 'choose' },
    ]
    const used = [{ taxYear: '2026/27', wrapper: 'pension' as const, usedPence: row.plannedPence }]
    const fresh = buildInvestView(d({}), '2027-04-07')
    const april7 = buildInvestView(d({ log, used }), '2027-04-07')
    expect(april7.taxYear).toBe('2027/28')
    expect(april7.wrappers).toEqual(fresh.wrappers)
    expect(april7.logged.size).toBe(0)
    expect(april7.otherLogged.map((l) => l.id)).toEqual([row.id])
    const again = april7.groups.find((g) => g.wrapper === 'pension')!.rows.find((r) => r.holdingId === row.holdingId)!
    expect(again.id).toBe(logId('2027/28', '2027-04', 'pension', row.holdingId))
    expect(again.id).not.toBe(row.id)

    // With ISA room nearly used in 2027/28, an old-year ISA log in the same budget month must not free up room.
    const tight = [{ taxYear: '2027/28', wrapper: 'isa' as const, usedPence: 1900000 }]
    const oldIsa: InvestmentLog = { ...log[0], id: 'old-isa', wrapper: 'isa', actualPence: 50000, plannedPence: 50000 }
    expect(buildInvestView(d({ used: tight, log: [oldIsa] }), '2027-04-07').wrappers)
      .toEqual(buildInvestView(d({ used: tight }), '2027-04-07').wrappers)
  })

  it('fills in a missing tax year from the budget month', () => {
    const old = { id: 'o', month: '2026-04', wrapper: 'isa', holdingId: 'h', plannedPence: 1, actualPence: 1, platformId: 'p' } as unknown as InvestmentLog
    // The budget month starts on 1 Apr (old tax year) with start day 1, on 6 Apr (new tax year) with start day 6.
    expect(withTaxYears([old], 1)[0].taxYear).toBe('2025/26')
    expect(withTaxYears([old], 6)[0].taxYear).toBe('2026/27')
  })

  it('names the state: a plan, nothing left over, or no figure', () => {
    expect(investState(buildInvestView(data(), TODAY).investable)).toBe('invest')
    expect(investState(buildInvestView(data({ streams: [] }), TODAY).investable)).toBe('none')
    // The whole surplus goes to a large high-APR debt.
    const zero = buildInvestView(data({ debts: [debt({ balancePence: 10000000, minimumPaymentPence: 0 })] }), TODAY)
    expect(investState(zero.investable)).toBe('zero')
    expect(zero.groups).toEqual([])
  })

  it('summarises where the money goes by wrapper', () => {
    expect(wrapperSummary(buildInvestView(data(), TODAY).plan)).toBe('Pension £675.00, ISA £2,025.00')
  })

  it('returns the no-income reason when there is no income at all', () => {
    const v = buildInvestView(data({ streams: [] }), TODAY)
    expect(v.investable.ok).toBe(false)
    expect(v.plan.lines).toEqual([])
    expect(reasonText(v.investable).long).toMatch(/no income/i)
  })
})

describe('breakdownLines', () => {
  it('starts with income, subtracts each line and ends with the investable figure', () => {
    const v = buildInvestView(
      data({
        debts: [debt({ balancePence: 5000, minimumPaymentPence: 1000 })],
        pots: [{ id: 'e', name: 'E', balancePence: 0, targetPence: 1000, isEmergencyFund: true }],
        settings: { ...seedSettings, emergencyFundPotId: 'e' },
      }),
      TODAY,
    )
    const lines = breakdownLines(v)
    expect(lines[0]).toMatchObject({ pence: 300000 })
    expect(lines[0].label).toMatch(/^Income/)
    expect(lines.slice(1, -1).every((l) => l.pence <= 0)).toBe(true)
    expect(lines.map((l) => l.label)).toContain('Extra payment on high-interest debt')
    expect(lines.map((l) => l.label)).toContain('Emergency fund top-up')
    const last = lines[lines.length - 1]
    expect(last.label).toBe('Invest this month')
    expect(lines.slice(0, -1).reduce((s, l) => s + l.pence, 0)).toBe(last.pence)
  })

  it('ends with the shortfall when there is nothing to invest', () => {
    const v = buildInvestView(
      data({ streams: [{ id: 's', label: 'Salary', expectedMonthlyNetPence: 100000 }], txs: [tx({ amountPence: -150000, categoryId: 'housing' })] }),
      TODAY,
    )
    const lines = breakdownLines(v)
    const last = lines[lines.length - 1]
    expect(last).toEqual({ label: 'Shortfall this month', pence: 100000 - 150000 - 10000, total: true })
  })
})

describe('buildInvestView never throws on figures the engines reject', () => {
  const bad = [
    ['a negative debt minimum', data({ debts: [debt({ minimumPaymentPence: -500 })] })],
    ['an out-of-range pension share', data({ settings: { ...seedSettings, onboardingDone: true, wrapperShares: { pension: 150 } } })],
    ['a safety buffer above 100%', data({ settings: { ...seedSettings, onboardingDone: true, bufferPercent: 250 } })],
  ] as const
  for (const [what, d] of bad) {
    it(`returns an explicit no-figure view for ${what}`, () => {
      const view = buildInvestView(d, TODAY)
      expect(view.investable.ok).toBe(false)
      expect(!view.investable.ok && view.investable.reason).toBe('invalid-data')
      expect(investState(view.investable)).toBe('none')
      expect(view.groups).toEqual([])
      expect(view.plan.ok).toBe(false)
      expect(view.plan.lines).toEqual([])
      expect(view.month).toBe('2026-10')
      expect(reasonText(view.investable).long).toBe(
        "We couldn't work out a figure from your data. Check your latest transactions and debts.",
      )
      expect(() => breakdownLines(view)).not.toThrow()
    })
  }
})

describe('investableInputFor: debt payments are not double-counted (review I1)', () => {
  it('leaves a loan direct debit filed under Debt payments out of spendPence; the minimum covers it', () => {
    const d = data({
      txs: [
        tx({ date: '2026-09-01', amountPence: -15000, description: 'LOAN REPAYMENT', categoryId: 'debt-payments' }),
        tx({ date: '2026-09-10', amountPence: -40000, categoryId: 'groceries-and-food' }),
      ],
      debts: [debt({ kind: 'loan', aprPercent: 5, minimumPaymentPence: 15000 })],
    })
    const { input } = investableInputFor(d, TODAY)
    expect(input.spendPence).toBe(40000)
    expect(input.debtMinimumsPence).toBe(15000)
  })
})

describe('buildInvestView honours the account order (review I4)', () => {
  it('puts the ISA line first when the ISA comes first, and the plan still sums exactly', () => {
    const d = data({ settings: { ...seedSettings, onboardingDone: true, wrapperOrder: ['isa', 'lisa', 'pension', 'gia'] } })
    const view = buildInvestView(d, TODAY)
    expect(view.investable.ok).toBe(true)
    if (!view.investable.ok) return
    expect(view.wrappers.map((w) => w.wrapper)).toEqual(['isa', 'pension', 'gia'])
    expect(view.wrappers.reduce((a, w) => a + w.pence, 0)).toBe(view.investable.investablePence)
    expect(view.plan.holdings.reduce((a, h) => a + h.pence, 0)).toBe(view.investable.investablePence)
    expect(view.plan.lines[0].wrapper).toBe('isa')
  })
})

describe('debt payments not on the Debts list (part 2, important 1)', () => {
  const months = ['2026-07-10', '2026-08-10', '2026-09-10']
  const groceries = months.map((date) => tx({ date, amountPence: -50000, categoryId: 'groceries-and-food' }))
  const klarna = months.map((date) => tx({ date, amountPence: -4000, description: 'KLARNA', categoryId: 'debt-payments' }))
  const loan = months.map((date) => tx({ date, amountPence: -15000, description: 'LOAN REPAYMENT', categoryId: 'debt-payments' }))
  const loanDebt = debt({ id: 'loan', kind: 'loan', aprPercent: 5, minimumPaymentPence: 15000 })
  const klarnaDebt = debt({ id: 'klarna', kind: 'other', aprPercent: 0, minimumPaymentPence: 4000 })
  const investable = (d: InvestData) => {
    const v = buildInvestView(d, TODAY)
    if (!v.investable.ok) throw new Error('expected a figure')
    return v.investable.investablePence
  }
  const base = investable(data({ txs: groceries }))

  it('with no debts entered, the whole £190 a month comes off the investable figure', () => {
    const d = data({ txs: [...groceries, ...klarna, ...loan] })
    const { input, unlistedDebtPence } = investableInputFor(d, TODAY)
    expect(unlistedDebtPence).toBe(19000)
    expect(input.spendPence).toBe(50000 + 19000)
    expect(investable(d)).toBe(base - 19000)
  })

  it('after adding the loan (minimum £150), only the Klarna £40 is extra; the loan counts once', () => {
    const d = data({ txs: [...groceries, ...klarna, ...loan], debts: [loanDebt] })
    const { input, unlistedDebtPence } = investableInputFor(d, TODAY)
    expect(unlistedDebtPence).toBe(4000)
    expect(input.spendPence).toBe(54000)
    expect(input.debtMinimumsPence).toBe(15000)
    expect(investable(d)).toBe(base - 19000)
  })

  it('with both entered, nothing extra', () => {
    const d = data({ txs: [...groceries, ...klarna, ...loan], debts: [loanDebt, klarnaDebt] })
    const { input, unlistedDebtPence } = investableInputFor(d, TODAY)
    expect(unlistedDebtPence).toBe(0)
    expect(input.spendPence).toBe(50000)
    expect(investable(d)).toBe(base - 19000)
  })

  it('shows its own line in "How we got this number" only when there is some', () => {
    const label = 'Debt payments not on your Debts list'
    const lines = breakdownLines(buildInvestView(data({ txs: [...groceries, ...klarna], debts: [loanDebt] }), TODAY))
    expect(lines.find((l) => l.label === label)).toBeUndefined()
    const withExtra = breakdownLines(buildInvestView(data({ txs: [...groceries, ...klarna] }), TODAY))
    expect(withExtra.find((l) => l.label === label)?.pence).toBe(-4000)
    expect(withExtra.find((l) => l.label === 'Spending (3-month average)')?.pence).toBe(-50000)
    expect(withExtra.slice(0, -1).reduce((s, l) => s + l.pence, 0)).toBe(withExtra.at(-1)!.pence)
  })
})

describe('understated spending note (part 2, minor 2)', () => {
  it('reports the trailing monthly average of unmatched card repayments', () => {
    const d = data({
      txs: [
        tx({ date: '2026-08-10', amountPence: -50000, categoryId: 'groceries-and-food' }),
        tx({ date: '2026-09-10', amountPence: -50000, categoryId: 'groceries-and-food' }),
        tx({ date: '2026-09-05', amountPence: -30000, description: 'BARCLAYCARD PAYMENT' }),
      ],
    })
    expect(buildInvestView(d, TODAY).unmatchedRepaymentPence).toBe(15000)
    expect(buildInvestView(data(), TODAY).unmatchedRepaymentPence).toBe(0)
  })
})
