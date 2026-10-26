import { describe, expect, it } from 'vitest'
import { buildMonthlyPlan } from '../../src/invest/plan'
import { seedHoldings } from '../../src/seed/holdings'
import { seedPlatforms } from '../../src/seed/platforms'
import { seedSettings } from '../../src/seed/settings'
import type { InvestableResult } from '../../src/invest/investable'
import type { Holding } from '../../src/domain/types'

type Input = Parameters<typeof buildMonthlyPlan>[0]

const okInvestable = (investablePence: number): InvestableResult => ({
  ok: true, investablePence, lines: [{ label: 'Spending (3-month average)', pence: 100000 }],
  extraDebtPence: 1500, emergencyTopUpPence: 2500, biggestDrainLabel: 'Spending (3-month average)',
  notes: ['investable note'],
})
const balanced = { growthPct: 70, aggressivePct: 30, underweight: null, biasNote: 'x' } as const

const make = (over: Partial<Input> = {}): Input => ({
  investable: okInvestable(100001),
  wrappers: [
    { wrapper: 'pension', pence: 20000, note: 'pension note' },
    { wrapper: 'isa', pence: 50001 },
    { wrapper: 'gia', pence: 30000 },
  ],
  holdings: seedHoldings,
  platforms: seedPlatforms,
  defaultPlatformByWrapper: { isa: 'trading212', pension: 'trading212', gia: 'ibkr' },
  settings: seedSettings,
  drift: { ...balanced },
  ...over,
})

describe('buildMonthlyPlan', () => {
  it('lines sum to their wrapper pence and the grand total sums exactly', () => {
    const p = buildMonthlyPlan(make())
    expect(p.ok).toBe(true)
    expect(p.totalPence).toBe(100001)
    expect(p.lines.map((l) => l.pence)).toEqual([20000, 50001, 30000])
    for (const l of p.lines) expect(l.holdings.reduce((a, h) => a + h.pence, 0)).toBe(l.pence)
    expect(p.holdings.reduce((a, h) => a + h.pence, 0)).toBe(100001)
    expect(p.lines[0].note).toBe('pension note')
    expect(p.warnings).toEqual([])
  })

  it('carries extra debt, emergency top-up, lines and notes', () => {
    const p = buildMonthlyPlan(make())
    expect(p.extraDebtPence).toBe(1500)
    expect(p.emergencyTopUpPence).toBe(2500)
    expect(p.investableLines).toHaveLength(1)
    expect(p.notes).toContain('investable note')
  })

  it('skips zero-pence wrappers', () => {
    const p = buildMonthlyPlan(make({ wrappers: [{ wrapper: 'isa', pence: 100001 }, { wrapper: 'gia', pence: 0 }] }))
    expect(p.lines.map((l) => l.wrapper)).toEqual(['isa'])
  })

  it('warns when Robinhood is the ISA platform with the seed UCITS funds', () => {
    const p = buildMonthlyPlan(make({ defaultPlatformByWrapper: { isa: 'robinhood' } }))
    const w = p.warnings.filter((x) => x.includes('Robinhood'))
    expect(w.length).toBeGreaterThan(0)
    expect(w[0]).toMatch(/ISA/)
    expect(w[0]).toMatch(/VWRL|Vanguard FTSE All-World/)
    expect(w[0]).toMatch(/another platform/)
  })

  it("shows 'choose' for an unset platform and does not warn", () => {
    const p = buildMonthlyPlan(make({ defaultPlatformByWrapper: {} }))
    expect(p.lines.every((l) => l.platformId === 'choose')).toBe(true)
    expect(p.warnings).toEqual([])
  })

  it('warns when the platform does not support the wrapper (Trading212 LISA)', () => {
    const p = buildMonthlyPlan(
      make({
        wrappers: [{ wrapper: 'lisa', pence: 10000 }, { wrapper: 'isa', pence: 90001 }],
        defaultPlatformByWrapper: { lisa: 'trading212', isa: 'trading212' },
      }),
    )
    expect(p.warnings.some((w) => w.includes('Trading 212') && w.includes('LISA'))).toBe(true)
    expect(p.lines[0].holdings.reduce((a, h) => a + h.pence, 0)).toBe(10000)
  })

  it('ok:false investable gives no lines, zero total and the reason', () => {
    const p = buildMonthlyPlan(
      make({
        investable: { ok: false, reason: 'no-surplus', lines: [], biggestDrainLabel: 'Debt minimums' },
      }),
    )
    expect(p.ok).toBe(false)
    expect(p.reason).toBe('no-surplus')
    expect(p.lines).toEqual([])
    expect(p.holdings).toEqual([])
    expect(p.totalPence).toBe(0)
    expect(p.biggestDrainLabel).toBe('Debt minimums')
  })

  it('shifts the split towards an underweight bucket', () => {
    const p = buildMonthlyPlan(
      make({
        wrappers: [{ wrapper: 'isa', pence: 100000 }],
        investable: okInvestable(100000),
        drift: { growthPct: 87.5, aggressivePct: 12.5, underweight: 'aggressive', biasNote: 'x' },
      }),
    )
    // gap 17.5 -> round 18 -> capped at 10 points: 60/40
    expect(p.effectiveSplit).toEqual({ growth: 60, aggressive: 40 })
    const agg = p.holdings.filter((h) => h.bucket === 'aggressive').reduce((a, h) => a + h.pence, 0)
    expect(agg).toBe(40000)
  })

  it('shifts by the rounded gap when under 10 points', () => {
    const p = buildMonthlyPlan(
      make({ drift: { growthPct: 65, aggressivePct: 35, underweight: 'growth', biasNote: 'x' } }),
    )
    expect(p.effectiveSplit).toEqual({ growth: 75, aggressive: 25 }) // gap 5
  })

  it('never takes the other bucket below zero', () => {
    const p = buildMonthlyPlan(
      make({
        settings: { ...seedSettings, bucketSplit: { growth: 95, aggressive: 5 } },
        drift: { growthPct: 80, aggressivePct: 20, underweight: 'growth', biasNote: 'x' },
      }),
    )
    expect(p.effectiveSplit).toEqual({ growth: 100, aggressive: 0 })
    expect(p.holdings.reduce((a, h) => a + h.pence, 0)).toBe(100001)
  })

  it('uses the target split when nothing is underweight', () => {
    expect(buildMonthlyPlan(make()).effectiveSplit).toEqual({ growth: 70, aggressive: 30 })
  })

  it('warns and uses an unallocated line for an empty bucket without throwing', () => {
    const growthOnly: Holding[] = seedHoldings.filter((h) => h.bucket === 'growth')
    const p = buildMonthlyPlan(make({ holdings: growthOnly }))
    expect(p.warnings).toContain('No aggressive holdings configured — add one in Settings')
    expect(p.holdings.find((h) => h.holdingId === 'unallocated')?.pence).toBe(30000)
    expect(p.holdings.reduce((a, h) => a + h.pence, 0)).toBe(100001)
    for (const l of p.lines) expect(l.holdings.reduce((a, h) => a + h.pence, 0)).toBe(l.pence)
  })
})
