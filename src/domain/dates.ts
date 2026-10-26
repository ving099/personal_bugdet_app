import type { ISODate } from './types'

const pad = (n: number) => String(n).padStart(2, '0')
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m is 1-based
const parse = (d: ISODate) => {
  const [y, m, day] = d.split('-').map(Number)
  return { y, m, d: day }
}
const shift = (y: number, m: number, delta: number) => {
  const idx = y * 12 + (m - 1) + delta
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 }
}
const startOf = (y: number, m: number, startDay: number) => Math.min(startDay, daysIn(y, m))

/** 'YYYY-MM' of the month the budget period containing `date` starts in. */
export function budgetMonthOf(date: ISODate, startDay: number): string {
  const { y, m, d } = parse(date)
  const p = d < startOf(y, m, startDay) ? shift(y, m, -1) : { y, m }
  return `${p.y}-${pad(p.m)}`
}

export function budgetMonthRange(month: string, startDay: number): { from: ISODate; to: ISODate } {
  const [y, m] = month.split('-').map(Number)
  const from = `${y}-${pad(m)}-${pad(startOf(y, m, startDay))}`
  if (startDay === 1) return { from, to: `${y}-${pad(m)}-${pad(daysIn(y, m))}` }
  const n = shift(y, m, 1)
  const nextStart = startOf(n.y, n.m, startDay)
  // day before next period's start
  const end = new Date(Date.UTC(n.y, n.m - 1, nextStart - 1))
  return { from, to: end.toISOString().slice(0, 10) }
}

/** Tax year starts 6 April. Returns e.g. '2026/27'. */
export function taxYearOf(date: ISODate): string {
  const { y, m, d } = parse(date)
  const start = m > 4 || (m === 4 && d >= 6) ? y : y - 1
  return `${start}/${pad((start + 1) % 100)}`
}

/** Calendar months remaining in the tax year, current month included (tax year ends in March/April). */
export function monthsLeftInTaxYear(date: ISODate): number {
  const { m, d } = parse(date)
  if (m === 4 && d < 6) return 1
  // months April..March: April->12 ... March->1
  return ((3 - m + 12) % 12) + 1
}
