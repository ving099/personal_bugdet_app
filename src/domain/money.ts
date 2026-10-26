import type { Pence } from './types'

export class MoneyParseError extends Error {
  constructor(input: string | number) {
    super(`Cannot parse money amount: ${JSON.stringify(input)}`)
    this.name = 'MoneyParseError'
  }
}

const MONEY_RE = /^(-?)£?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

/** Parse a money string or number (pounds) into integer pence. Throws MoneyParseError if unreadable. */
export function toPence(input: string | number): Pence {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyParseError(input)
    return Math.round(input * 100)
  }
  let s = input.trim()
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1).trim()
  }
  const m = MONEY_RE.exec(s)
  if (!m) throw new MoneyParseError(input)
  if (m[1] === '-') {
    if (negative) throw new MoneyParseError(input)
    negative = true
  }
  const pence = Number(m[2].replace(/,/g, '')) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  return negative ? -pence : pence
}

export function formatGBP(p: Pence): string {
  const abs = Math.abs(p)
  const pounds = Math.floor(abs / 100).toLocaleString('en-GB')
  const pence = String(abs % 100).padStart(2, '0')
  return `${p < 0 ? '-' : ''}£${pounds}.${pence}`
}

/** Split total pence by weights using largest remainder; ties go to the lower index. Sums exactly. */
export function splitPence(total: Pence, weights: number[]): Pence[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (weights.length === 0) throw new RangeError('splitPence: weights must not be empty')
  if (weights.some((w) => w < 0)) throw new RangeError('splitPence: weights must not be negative')
  if (sum === 0) {
    if (total !== 0) throw new RangeError('splitPence: weights sum to zero but total is non-zero')
    return weights.map(() => 0)
  }
  const exact = weights.map((w) => (total * w) / sum)
  const parts = exact.map(Math.floor)
  let left = total - parts.reduce((a, b) => a + b, 0)
  const order = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k].i]++
  return parts
}
