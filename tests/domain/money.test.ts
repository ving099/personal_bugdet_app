import { describe, expect, it } from 'vitest'
import { formatGBP, MoneyParseError, splitPence, toPence } from '../../src/domain/money'

describe('toPence', () => {
  it('parses thousands separators', () => expect(toPence('1,234.56')).toBe(123456))
  it('parses currency symbol and short decimals', () => expect(toPence('£12.5')).toBe(1250))
  it('parses parentheses as negative', () => expect(toPence('(45.00)')).toBe(-4500))
  it('parses a negative whole number', () => expect(toPence('-3')).toBe(-300))
  it.each(['', '   ', 'abc', '1e3', '0x10', '1.2.3', '12-34', '1.234', '.5'])('rejects %j', (bad) => {
    expect(() => toPence(bad)).toThrow(MoneyParseError)
  })
  it('rejects non-finite numbers', () => {
    expect(() => toPence(NaN)).toThrow(MoneyParseError)
    expect(() => toPence(Infinity)).toThrow(MoneyParseError)
  })
  it('parses a real zero', () => expect(toPence('0.00')).toBe(0))
})

describe('formatGBP', () => {
  it('formats with separators', () => expect(formatGBP(123456)).toBe('£1,234.56'))
  it('puts the minus before the symbol', () => expect(formatGBP(-500)).toBe('-£5.00'))
})

describe('splitPence', () => {
  it('splits 70/30 with remainder to the largest', () =>
    expect(splitPence(10001, [70, 30])).toEqual([7001, 3000]))
  it('breaks ties to the lower index', () =>
    expect(splitPence(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]))
  it('throws on empty weights', () => expect(() => splitPence(100, [])).toThrow(RangeError))
  it('throws on zero-sum weights with non-zero total', () =>
    expect(() => splitPence(100, [0, 0])).toThrow(RangeError))
  it('throws on a negative weight', () => expect(() => splitPence(100, [5, -1])).toThrow(RangeError))
  it('returns zeros for total 0', () => expect(splitPence(0, [0, 0, 0])).toEqual([0, 0, 0]))
  it('sums exactly for a negative total', () => {
    const parts = splitPence(-10001, [70, 30])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-10001)
    expect(parts).toHaveLength(2)
  })
  it('gives the single pence to the lowest index', () => expect(splitPence(1, [1, 1, 1])).toEqual([1, 0, 0]))
  it('always sums exactly for random inputs', () => {
    for (let i = 0; i < 100; i++) {
      const total = Math.floor(Math.random() * 1_000_000)
      const weights = Array.from({ length: 1 + Math.floor(Math.random() * 5) }, () => 1 + Math.floor(Math.random() * 100))
      const parts = splitPence(total, weights)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
    }
  })
})
