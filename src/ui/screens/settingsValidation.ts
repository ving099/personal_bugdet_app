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

/** Two numbers, each finite and not negative, adding up to more than zero. */
export function validateBucketSplit(growth: string, aggressive: string): string | undefined {
  const g = parseNumber(growth)
  const a = parseNumber(aggressive)
  if (g === undefined || a === undefined || g < 0 || a < 0) return 'Enter two numbers that are zero or more'
  if (g + a <= 0) return 'The two numbers must add up to more than zero'
  return undefined
}

/** Holding weights are whole numbers, zero or more. */
export function validateWeight(raw: string): string | undefined {
  const n = parseNumber(raw)
  if (n === undefined || !Number.isInteger(n) || n < 0) return 'Enter a whole number, zero or more'
  return undefined
}

export const NO_WEIGHT_WARNING = "This bucket has no funds with weight, so its share can't be placed."

/** Buckets where no fund has a weight above zero (an unreadable weight counts as zero). */
export function bucketsWithNoWeight(
  rows: readonly { bucket: 'growth' | 'aggressive'; weight: string }[],
): ('growth' | 'aggressive')[] {
  return (['growth', 'aggressive'] as const).filter(
    (b) => !rows.some((r) => r.bucket === b && validateWeight(r.weight) === undefined && Number(r.weight) > 0),
  )
}

export const MIN_PASSCODE_DIGITS = 4

/** Digits only, at least four, and the confirmation must match. */
export function validatePasscode(passcode: string, confirm: string): string | undefined {
  if (!/^\d+$/.test(passcode) || passcode.length < MIN_PASSCODE_DIGITS) {
    return `Use at least ${MIN_PASSCODE_DIGITS} digits, numbers only`
  }
  if (confirm !== passcode) return "The two passcodes don't match"
  return undefined
}
