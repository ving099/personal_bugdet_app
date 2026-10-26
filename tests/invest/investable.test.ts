import { describe, expect, it } from 'vitest'
import { computeInvestable, type InvestableInput } from '../../src/invest/investable'

const base: InvestableInput = {
  incomePence: 300000,
  spendPence: 150000,
  sinkingPence: 10000,
  debtMinimumsPence: 20000,
  highAprPayoffCapacityPence: 0,
  emergencyGapPence: 0,
  bufferPercent: 10,
  emergencyTopUpSharePercent: 30,
  monthsOfHistory: 6,
}

describe('computeInvestable', () => {
  it('computes the plain surplus', () => {
    const r = computeInvestable(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.investablePence).toBe(90000)
    expect(r.emergencyTopUpPence).toBe(0)
    expect(r.extraDebtPence).toBe(0)
    expect(r.lines.map((l) => l.label)).toEqual([
      'Spending (3-month average)',
      'Sinking funds',
      'Debt minimums',
      'Safety buffer',
    ])
    expect(r.lines[3].pence).toBe(30000)
    expect(r.biggestDrainLabel).toBe('Spending (3-month average)')
    expect(r.notes).toEqual([])
  })

  it('routes a share of surplus to the emergency fund', () => {
    const r = computeInvestable({ ...base, emergencyGapPence: 500000 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.emergencyTopUpPence).toBe(27000)
    expect(r.investablePence).toBe(63000)
    expect(r.lines.map((l) => l.label)).toContain('Emergency fund top-up')
    expect(r.notes.length).toBeGreaterThan(0)
  })

  it('pays extra high-APR debt after the emergency top-up', () => {
    const r = computeInvestable({
      ...base,
      emergencyGapPence: 500000,
      highAprPayoffCapacityPence: 40000,
    })
    if (!r.ok) throw new Error('expected ok')
    expect(r.extraDebtPence).toBe(40000)
    expect(r.investablePence).toBe(23000)
    expect(r.lines.map((l) => l.label).slice(-2)).toEqual([
      'Emergency fund top-up',
      'Extra debt payment',
    ])
  })

  it('caps the emergency top-up at the gap', () => {
    const r = computeInvestable({ ...base, emergencyGapPence: 5000 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.emergencyTopUpPence).toBe(5000)
    expect(r.investablePence).toBe(85000)
  })

  it('caps extra debt at the remaining surplus and stays ok with zero investable', () => {
    const r = computeInvestable({ ...base, highAprPayoffCapacityPence: 999999 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.extraDebtPence).toBe(90000)
    expect(r.investablePence).toBe(0)
    expect(r.notes.join(' ')).toMatch(/debt/i)
  })

  it('returns no-income when income is 0', () => {
    const r = computeInvestable({ ...base, incomePence: 0 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('no-income')
    expect(r.lines).toHaveLength(4)
    expect('notes' in r).toBe(false)
  })

  it('returns no-surplus naming the biggest drain', () => {
    const r = computeInvestable({ ...base, spendPence: 100000, debtMinimumsPence: 250000 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('no-surplus')
    expect(r.biggestDrainLabel).toBe('Debt minimums')
    expect(r.lines).toHaveLength(4)
  })

  it('treats surplus of exactly 0 as no-surplus', () => {
    const r = computeInvestable({ ...base, spendPence: 240000 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('no-surplus')
  })

  it('breaks biggest-drain ties by line order', () => {
    const r = computeInvestable({
      ...base,
      incomePence: 100000,
      spendPence: 50000,
      sinkingPence: 50000,
      debtMinimumsPence: 50000,
      bufferPercent: 0,
    })
    if (r.ok) throw new Error('expected not ok')
    expect(r.biggestDrainLabel).toBe('Spending (3-month average)')
  })

  it('base lines sum to income minus surplus0', () => {
    const r = computeInvestable(base)
    if (!r.ok) throw new Error('expected ok')
    const sum = r.lines.slice(0, 4).reduce((a, l) => a + l.pence, 0)
    expect(base.incomePence - sum).toBe(90000)
  })

  it('notes thin history', () => {
    const r2 = computeInvestable({ ...base, monthsOfHistory: 2 })
    if (!r2.ok) throw new Error('expected ok')
    expect(r2.notes.join(' ')).toMatch(/2 months of history/)
    const r1 = computeInvestable({ ...base, monthsOfHistory: 1 })
    if (!r1.ok) throw new Error('expected ok')
    expect(r1.notes.join(' ')).toMatch(/1 month of history/)
    const r0 = computeInvestable({ ...base, monthsOfHistory: 0 })
    if (!r0.ok) throw new Error('expected ok')
    expect(r0.notes.join(' ')).toMatch(/no history.*expected income/i)
    const r3 = computeInvestable({ ...base, monthsOfHistory: 3 })
    if (!r3.ok) throw new Error('expected ok')
    expect(r3.notes).toEqual([])
  })

  it('never returns negative investable', () => {
    for (const cap of [0, 1, 50000, 90000, 1e7]) {
      const r = computeInvestable({ ...base, highAprPayoffCapacityPence: cap, emergencyGapPence: 1e6 })
      if (r.ok) expect(r.investablePence).toBeGreaterThanOrEqual(0)
    }
  })

  it('rejects invalid inputs with RangeError', () => {
    expect(() => computeInvestable({ ...base, spendPence: -1 })).toThrow(RangeError)
    expect(() => computeInvestable({ ...base, incomePence: NaN })).toThrow(RangeError)
    expect(() => computeInvestable({ ...base, emergencyGapPence: Infinity })).toThrow(RangeError)
    expect(() => computeInvestable({ ...base, bufferPercent: 120 })).toThrow(RangeError)
    expect(() => computeInvestable({ ...base, emergencyTopUpSharePercent: -5 })).toThrow(RangeError)
    expect(() => computeInvestable({ ...base, monthsOfHistory: -1 })).toThrow(RangeError)
    expect(() => computeInvestable({ ...base, monthsOfHistory: 1.5 })).toThrow(RangeError)
  })
})
