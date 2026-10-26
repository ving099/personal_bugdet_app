import { describe, expect, it } from 'vitest'
import { splitBuckets } from '../../src/invest/split'
import { seedHoldings } from '../../src/seed/holdings'

const split = { growth: 70, aggressive: 30 }
const sum = (xs: { pence: number }[]) => xs.reduce((a, x) => a + x.pence, 0)
const pence = (xs: { holdingId: string; pence: number }[], id: string) =>
  xs.find((x) => x.holdingId === id)?.pence

describe('splitBuckets', () => {
  it('sums exactly to an odd amount and splits within buckets by weight', () => {
    const parts = splitBuckets(10001, split, seedHoldings)
    expect(sum(parts)).toBe(10001)
    const growth = parts.filter((p) => p.bucket === 'growth')
    const aggressive = parts.filter((p) => p.bucket === 'aggressive')
    expect(sum(growth)).toBe(7001)
    expect(pence(parts, 'growth-global')).toBe(4667)
    expect(pence(parts, 'growth-us')).toBe(2334)
    expect(sum(aggressive)).toBe(3000)
    expect(aggressive.map((p) => p.pence)).toEqual([1000, 1000, 1000])
  })

  it('returns zero-pence entries for a zero amount', () => {
    const parts = splitBuckets(0, split, seedHoldings)
    expect(parts).toHaveLength(seedHoldings.length)
    expect(sum(parts)).toBe(0)
  })

  it('throws a clear Error naming an empty bucket', () => {
    const noAgg = seedHoldings.filter((h) => h.bucket === 'growth')
    expect(() => splitBuckets(1000, split, noAgg)).toThrow(/aggressive/)
    expect(() => splitBuckets(1000, split, noAgg)).not.toThrow(RangeError)
    const noGrowth = seedHoldings.filter((h) => h.bucket === 'aggressive')
    expect(() => splitBuckets(1000, split, noGrowth)).toThrow(/growth/)
  })

  it('throws RangeError for a negative amount', () => {
    expect(() => splitBuckets(-1, split, seedHoldings)).toThrow(RangeError)
  })
})
