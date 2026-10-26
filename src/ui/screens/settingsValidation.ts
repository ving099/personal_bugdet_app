import { parseNumber } from '../formValues'

/** Each validator returns an error message, or undefined when the value is fine. Inputs are what was typed. */

export function validateMonthStartDay(raw: string): string | undefined {
  const n = parseNumber(raw)
  if (n === undefined || !Number.isInteger(n) || n < 1 || n > 28) return 'Enter a whole number from 1 to 28'
  return undefined
}

export function validatePercent(raw: string): string | undefined {
  const n = parseNumber(raw)
  if (n === undefined || n < 0 || n > 100) return 'Enter a number from 0 to 100'
  return undefined
}
