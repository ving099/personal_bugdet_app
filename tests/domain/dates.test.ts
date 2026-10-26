import { describe, expect, it } from 'vitest'
import { budgetMonthOf, budgetMonthRange, monthsLeftInTaxYear, taxYearOf } from '../../src/domain/dates'

describe('budgetMonthOf', () => {
  it('assigns the day before the start day to the previous month', () =>
    expect(budgetMonthOf('2026-10-24', 25)).toBe('2026-09'))
  it('assigns the start day to its own month', () => expect(budgetMonthOf('2026-10-25', 25)).toBe('2026-10'))
  it('uses the calendar month when start day is 1', () => expect(budgetMonthOf('2026-10-24', 1)).toBe('2026-10'))
  it('rolls back across a year boundary', () => expect(budgetMonthOf('2027-01-10', 25)).toBe('2026-12'))
})

describe('budgetMonthRange', () => {
  it('spans start day to the day before the next start', () =>
    expect(budgetMonthRange('2026-10', 25)).toEqual({ from: '2026-10-25', to: '2026-11-24' }))
  it('is the calendar month when start day is 1', () =>
    expect(budgetMonthRange('2026-02', 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' }))
  it('crosses a year end', () =>
    expect(budgetMonthRange('2026-12', 25)).toEqual({ from: '2026-12-25', to: '2027-01-24' }))
})

describe('taxYearOf', () => {
  it('5 April belongs to the earlier tax year', () => expect(taxYearOf('2026-04-05')).toBe('2025/26'))
  it('6 April starts the new tax year', () => expect(taxYearOf('2026-04-06')).toBe('2026/27'))
})

describe('monthsLeftInTaxYear', () => {
  it('counts the current month', () => expect(monthsLeftInTaxYear('2026-10-26')).toBe(6))
  it('is 1 in the final month', () => expect(monthsLeftInTaxYear('2027-03-31')).toBe(1))
})
