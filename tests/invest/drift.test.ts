import { describe, expect, it } from 'vitest'
import { driftReport } from '../../src/invest/drift'
import { seedHoldings } from '../../src/seed/holdings'
import type { InvestmentLog, OpeningHolding } from '../../src/domain/types'

const bucketSplit = { growth: 70, aggressive: 30 }
const open = (holdingId: string, valuePence: number): OpeningHolding => ({
  id: `o-${holdingId}`, holdingId, valuePence, asOf: '2026-10-01', wrapper: 'isa', platformId: 'trading212',
})
const log = (holdingId: string, actualPence: number): InvestmentLog => ({
  id: `l-${holdingId}-${actualPence}`, month: '2026-10', wrapper: 'isa', holdingId, plannedPence: actualPence,
  actualPence, platformId: 'trading212',
})
const run = (opening: OpeningHolding[], logs: InvestmentLog[] = []) =>
  driftReport({ opening, log: logs, holdings: seedHoldings, bucketSplit })

describe('driftReport', () => {
  it('flags aggressive as underweight at 87.5 / 12.5', () => {
    const r = run([open('growth-global', 700000), open('aggressive-em', 100000)])
    expect(r.growthPct).toBe(87.5)
    expect(r.aggressivePct).toBe(12.5)
    expect(r.underweight).toBe('aggressive')
    expect(r.biasNote).toBe('Aggressive is 12.5% of your portfolio vs a 30% target, so new money leans towards it.')
  })

  it('returns null within the 2 point tolerance (strictly greater needed)', () => {
    const within = run([open('growth-global', 6800), open('aggressive-em', 3200)])
    expect(within.underweight).toBeNull()
    expect(within.biasNote).toBe('Within 2 points of your 70/30 target.')
    const edge = run([open('growth-global', 7200), open('aggressive-em', 2800)]) // aggressive 28 = exactly 2 below
    expect(edge.underweight).toBeNull()
  })

  it('reports growth underweight when it is too low', () => {
    const r = run([open('growth-global', 500000), open('aggressive-em', 500000)])
    expect(r.underweight).toBe('growth')
    expect(r.biasNote).toBe('Growth is 50% of your portfolio vs a 70% target, so new money leans towards it.')
  })

  it('is 0/0 and null with no holdings, never NaN', () => {
    const r = run([])
    expect(r.growthPct).toBe(0)
    expect(r.aggressivePct).toBe(0)
    expect(r.underweight).toBeNull()
    expect(r.biasNote).toBe('No holdings recorded yet — using your target split.')
  })

  it('adds logged actual pence to opening values', () => {
    const r = run([open('growth-global', 70000), open('aggressive-em', 30000)], [
      log('aggressive-nasdaq', 100000),
    ])
    expect(r.growthPct).toBe(35)
    expect(r.aggressivePct).toBe(65)
    expect(r.underweight).toBe('growth')
  })

  it('ignores unknown holding ids', () => {
    const r = run([open('growth-global', 7000), open('aggressive-em', 3000), open('mystery', 999999)], [
      log('ghost', 50000),
    ])
    expect(r.growthPct).toBe(70)
    expect(r.underweight).toBeNull()
  })
})
