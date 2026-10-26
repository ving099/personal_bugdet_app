import type { Pence } from './types'

/** Parse a money string or number (pounds) into integer pence. */
export function toPence(input: string | number): Pence {
  if (typeof input === 'number') return Math.round(input * 100)
  let s = input.trim()
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.includes('-')) negative = true
  s = s.replace(/[£,\s-]/g, '')
  const n = Number(s)
  if (s === '' || Number.isNaN(n)) return 0
  const pence = Math.round(n * 100)
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
  if (weights.length === 0 || sum <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (total * w) / sum)
  const parts = exact.map(Math.floor)
  let left = total - parts.reduce((a, b) => a + b, 0)
  const order = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k].i]++
  return parts
}
