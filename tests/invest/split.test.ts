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

  it('throws a clear Error naming the bucket for all-zero weights', () => {
    const zeroed = seedHoldings.map((h) => (h.bucket === 'aggressive' ? { ...h, weight: 0 } : h))
    expect(() => splitBuckets(1000, split, zeroed)).toThrow(/aggressive.*zero/)
    expect(() => splitBuckets(1000, split, zeroed)).not.toThrow(RangeError)
  })

  it('throws a clear Error naming the bucket for negative or non-finite weights', () => {
    const neg = seedHoldings.map((h) => (h.id === 'growth-us' ? { ...h, weight: -1 } : h))
    expect(() => splitBuckets(1000, split, neg)).toThrow(/growth.*invalid weight/)
    expect(() => splitBuckets(1000, split, neg)).not.toThrow(RangeError)
    const nan = seedHoldings.map((h) => (h.id === 'aggressive-em' ? { ...h, weight: Number.NaN } : h))
    expect(() => splitBuckets(1000, split, nan)).toThrow(/aggressive.*invalid weight/)
  })

  it('gives a zero-weight holding 0 pence when others in the bucket are positive', () => {
    const mixed = seedHoldings.map((h) => (h.id === 'growth-us' ? { ...h, weight: 0 } : h))
    const parts = splitBuckets(10000, split, mixed)
    expect(pence(parts, 'growth-us')).toBe(0)
    expect(pence(parts, 'growth-global')).toBe(7000)
  })
})
