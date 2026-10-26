import { describe, expect, it } from 'vitest'
import { formatGBP, splitPence, toPence } from '../../src/domain/money'

describe('toPence', () => {
  it('parses thousands separators', () => expect(toPence('1,234.56')).toBe(123456))
  it('parses currency symbol and short decimals', () => expect(toPence('£12.5')).toBe(1250))
  it('parses parentheses as negative', () => expect(toPence('(45.00)')).toBe(-4500))
  it('parses a negative whole number', () => expect(toPence('-3')).toBe(-300))
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
  it('always sums exactly for random inputs', () => {
    for (let i = 0; i < 100; i++) {
      const total = Math.floor(Math.random() * 1_000_000)
      const weights = Array.from({ length: 1 + Math.floor(Math.random() * 5) }, () => 1 + Math.floor(Math.random() * 100))
      const parts = splitPence(total, weights)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
    }
  })
})
