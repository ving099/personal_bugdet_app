import { describe, expect, it } from 'vitest'
import {
  bucketsWithNoWeight, validateBucketSplit, validateMonthStartDay, validatePasscode, validatePercent, validateWeight,
} from '../../src/ui/screens/settingsValidation'

describe('validateMonthStartDay', () => {
  it.each(['1', '15', '28', ' 25 '])('accepts %s', (v) => expect(validateMonthStartDay(v)).toBeUndefined())
  it.each(['0', '29', '31', '-1', '2.5', '', 'abc', '1e1', 'NaN', 'Infinity'])('rejects %j', (v) =>
    expect(validateMonthStartDay(v)).toBeDefined())
})

describe('validatePercent', () => {
  it.each(['0', '8', '7.5', '100'])('accepts %s', (v) => expect(validatePercent(v)).toBeUndefined())
  it.each(['-0.1', '100.1', '', 'x', 'Infinity', '1e2'])('rejects %j', (v) => expect(validatePercent(v)).toBeDefined())
})

describe('validateBucketSplit', () => {
  it('accepts positive and one-sided splits', () => {
    expect(validateBucketSplit('70', '30')).toBeUndefined()
    expect(validateBucketSplit('100', '0')).toBeUndefined()
    expect(validateBucketSplit('1.5', '0.5')).toBeUndefined()
  })
  it('rejects zero total, negatives, blanks and non-finite values', () => {
    expect(validateBucketSplit('0', '0')).toMatch(/more than zero/)
    expect(validateBucketSplit('-1', '5')).toBeDefined()
    expect(validateBucketSplit('', '5')).toBeDefined()
    expect(validateBucketSplit('Infinity', '5')).toBeDefined()
    expect(validateBucketSplit('NaN', '5')).toBeDefined()
  })
})

describe('validateWeight', () => {
  it.each(['0', '1', '10'])('accepts %s', (v) => expect(validateWeight(v)).toBeUndefined())
  it.each(['-1', '1.5', '', 'x', 'Infinity'])('rejects %j', (v) => expect(validateWeight(v)).toBeDefined())
})

describe('bucketsWithNoWeight', () => {
  it('flags a bucket whose funds all have zero weight', () => {
    expect(
      bucketsWithNoWeight([
        { bucket: 'growth', weight: '2' },
        { bucket: 'aggressive', weight: '0' },
        { bucket: 'aggressive', weight: '0' },
      ]),
    ).toEqual(['aggressive'])
  })
  it('flags a bucket with no funds, and treats unreadable weights as zero', () => {
    expect(bucketsWithNoWeight([{ bucket: 'growth', weight: 'x' }])).toEqual(['growth', 'aggressive'])
  })
  it('flags nothing when each bucket has a weighted fund', () => {
    expect(bucketsWithNoWeight([{ bucket: 'growth', weight: '1' }, { bucket: 'aggressive', weight: '3' }])).toEqual([])
  })
})

describe('validatePasscode', () => {
  it('accepts four or more digits that match', () => {
    expect(validatePasscode('1234', '1234')).toBeUndefined()
    expect(validatePasscode('12345678', '12345678')).toBeUndefined()
  })
  it('rejects short, non-numeric and mismatched passcodes', () => {
    expect(validatePasscode('123', '123')).toMatch(/at least 4 digits/)
    expect(validatePasscode('12a4', '12a4')).toBeDefined()
    expect(validatePasscode('', '')).toBeDefined()
    expect(validatePasscode('1234', '1235')).toMatch(/don't match/)
  })
})
