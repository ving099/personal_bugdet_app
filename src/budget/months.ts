import { budgetMonthOf } from '../domain/dates'
import type { Transaction } from '../domain/types'

export function parseMonth(month: string): { y: number; m: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  const m = match ? Number(match[2]) : 0
  if (!match || m < 1 || m > 12) throw new Error(`Invalid budget month "${month}", expected YYYY-MM`)
  return { y: Number(match[1]), m }
}

/** Month `delta` months from `month` ('YYYY-MM'); correct across year boundaries. */
export function shiftMonth(month: string, delta: number): string {
  const { y, m } = parseMonth(month)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** The `count` budget months before `month`, most recent first (excludes `month`). */
export function previousMonths(month: string, count: number): string[] {
  parseMonth(month)
  return Array.from({ length: Math.max(0, count) }, (_, i) => shiftMonth(month, -(i + 1)))
}

/** Transactions whose date falls in the given budget month. */
export function txsInMonth(txs: Transaction[], month: string, startDay: number): Transaction[] {
  parseMonth(month)
  return txs.filter((t) => budgetMonthOf(t.date, startDay) === month)
}
