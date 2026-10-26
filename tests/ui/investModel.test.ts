import { describe, expect, it } from 'vitest'
import type { Account, Debt, InvestmentLog, Transaction } from '../../src/domain/types'
import { seedCategories } from '../../src/seed/categories'
import { seedHoldings } from '../../src/seed/holdings'
import { seedPlatforms } from '../../src/seed/platforms'
import { seedSettings } from '../../src/seed/settings'
import {
  breakdownLines, buildInvestView, investableInputFor, logId, planForUsed, planGroups, reasonText, type InvestData,
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
      txs: [tx({ date: '2026-09-01', amountPence: 100000, categoryId: 'transfers', incomeStreamId: 's' })],
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
    const total = planGroups(v.plan, seedHoldings, v.month)
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

  it("keeps this month's plan steady while lines are ticked off", () => {
    const before = buildInvestView(data(), TODAY)
    const isa = before.wrappers.find((w) => w.wrapper === 'isa')!
    const log: InvestmentLog[] = [
      { id: logId('2026-10', 'isa', 'growth-global'), month: '2026-10', wrapper: 'isa', holdingId: 'growth-global', plannedPence: isa.pence, actualPence: isa.pence, platformId: 'choose' },
    ]
    const used = [{ taxYear: '2026/27', wrapper: 'isa' as const, usedPence: isa.pence }]
    const after = buildInvestView(data({ log, used }), TODAY)
    expect(after.wrappers).toEqual(before.wrappers)
    expect(after.plan.effectiveSplit).toEqual(before.plan.effectiveSplit)
  })

  it('planForUsed takes this month’s logged amounts back out of allowance used, never below zero', () => {
    const log: InvestmentLog[] = [
      { id: 'x', month: '2026-10', wrapper: 'isa', holdingId: 'h', plannedPence: 5000, actualPence: 5000, platformId: 'choose' },
      { id: 'y', month: '2026-09', wrapper: 'isa', holdingId: 'h', plannedPence: 7000, actualPence: 7000, platformId: 'choose' },
      { id: 'z', month: '2026-10', wrapper: 'pension', holdingId: 'h', plannedPence: 9000, actualPence: 9000, platformId: 'choose' },
    ]
    const used = [
      { taxYear: '2026/27', wrapper: 'isa' as const, usedPence: 20000 },
      { taxYear: '2026/27', wrapper: 'pension' as const, usedPence: 4000 },
      { taxYear: '2025/26', wrapper: 'isa' as const, usedPence: 1 },
    ]
    expect(planForUsed(used, log, '2026-10', '2026/27')).toEqual([
      { taxYear: '2026/27', wrapper: 'isa', usedPence: 15000 },
      { taxYear: '2026/27', wrapper: 'pension', usedPence: 0 },
      { taxYear: '2025/26', wrapper: 'isa', usedPence: 1 },
    ])
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
})
