import type { Debt, ISODate, Pence } from '../domain/types'

export const MAX_PLAN_MONTHS = 600

export interface PlanMonth {
  date: ISODate
  paidPence: Record<string, Pence>
  balancePence: Record<string, Pence>
}

export interface AvalanchePlan {
  debtFreeDate: ISODate | null
  months: PlanMonth[]
}

/** Card: balance / limit. undefined when the limit is missing or zero. Not clamped (may exceed 1). */
export function utilisation(d: Debt): number | undefined {
  const limit = d.creditLimitOrOriginalPence
  if (!Number.isFinite(limit) || !limit) return undefined
  return d.balancePence / limit
}

/** Loan: 1 - balance / original. undefined when the original is missing or zero. Not clamped. */
export function percentPaid(d: Debt): number | undefined {
  const original = d.creditLimitOrOriginalPence
  if (!Number.isFinite(original) || !original) return undefined
  return 1 - d.balancePence / original
}

/** Promo APR applies up to and including promoEndsOn; the standard APR from the next day. */
export function effectiveApr(d: Debt, on: ISODate): number {
  if (d.promoAprPercent !== undefined && d.promoEndsOn !== undefined && on <= d.promoEndsOn) {
    return d.promoAprPercent
  }
  return d.aprPercent
}

/**
 * Open debts whose effective APR on `on` is STRICTLY greater than `thresholdPercent`
 * (an APR exactly at the threshold is not flagged). Zero-balance debts are excluded.
 */
export function highAprDebts(debts: Debt[], thresholdPercent: number, on: ISODate): Debt[] {
  return debts.filter((d) => d.balancePence > 0 && effectiveApr(d, on) > thresholdPercent)
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n: number) => String(n).padStart(2, '0')

function parseStart(s: ISODate): { y: number; m: number; d: number } {
  const match = typeof s === 'string' ? ISO_RE.exec(s) : null
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) return { y, m, d }
  }
  throw new Error(`avalanchePlan: invalid startDate ${JSON.stringify(s)}, expected a real YYYY-MM-DD date`)
}

/** Date `n` calendar months after the start, from the ORIGINAL day-of-month, clamped (31 Jan -> 28 Feb -> 31 Mar). */
function addMonths(start: { y: number; m: number; d: number }, n: number): ISODate {
  const idx = start.y * 12 + (start.m - 1) + n
  const y = Math.floor(idx / 12)
  const m = (idx % 12) + 1
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(Math.min(start.d, dim))}`
}

/**
 * Monthly simulation. Each month: add interest (balance x effective APR / 12, rounded to whole pence),
 * pay each open debt's minimum (capped at balance + interest), then spend the overpayment plus the
 * minimums of debts cleared in EARLIER months on open debts, highest effective APR first
 * (ties: larger balance, then input order). Debts with a zero starting balance are ignored.
 * No debts -> debtFreeDate = startDate and months = []. debtFreeDate is the date of the month in
 * which the last balance reaches zero, or null if not cleared within 600 months.
 */
export function avalanchePlan(input: {
  debts: Debt[]
  monthlyOverpaymentPence: Pence
  startDate: ISODate
}): AvalanchePlan {
  const { monthlyOverpaymentPence: overpay, startDate } = input
  const start = parseStart(startDate)
  if (!Number.isInteger(overpay) || overpay < 0) {
    throw new Error(`avalanchePlan: overpayment must be a non-negative whole number of pence, got ${overpay}`)
  }
  const open = input.debts.filter((d) => d.balancePence > 0)
  if (open.length === 0) return { debtFreeDate: startDate, months: [] }

  const bal = new Map<string, Pence>(open.map((d) => [d.id, d.balancePence]))
  const order = new Map<string, number>(open.map((d, i) => [d.id, i]))
  let freedMinimums = 0
  const months: PlanMonth[] = []

  for (let i = 0; i < MAX_PLAN_MONTHS; i++) {
    const date = addMonths(start, i)
    const live = open.filter((d) => bal.get(d.id)! > 0)
    const paid: Record<string, Pence> = {}
    const owed = new Map<string, Pence>() // balance + interest this month

    for (const d of live) {
      const interest = Math.round((bal.get(d.id)! * effectiveApr(d, date)) / 100 / 12)
      const total = bal.get(d.id)! + interest
      owed.set(d.id, total)
      const pay = Math.min(Math.max(0, Math.round(d.minimumPaymentPence)), total)
      paid[d.id] = pay
    }

    let pool = overpay + freedMinimums
    const ranked = [...live].sort(
      (a, b) =>
        effectiveApr(b, date) - effectiveApr(a, date) ||
        bal.get(b.id)! - bal.get(a.id)! ||
        order.get(a.id)! - order.get(b.id)!,
    )
    for (const d of ranked) {
      if (pool <= 0) break
      const extra = Math.min(pool, owed.get(d.id)! - paid[d.id])
      paid[d.id] += extra
      pool -= extra
    }

    const after: Record<string, Pence> = {}
    for (const d of live) {
      const left = owed.get(d.id)! - paid[d.id]
      bal.set(d.id, left)
      after[d.id] = left
      if (left === 0) freedMinimums += Math.max(0, Math.round(d.minimumPaymentPence))
    }
    // Debts already cleared in earlier months stay in the record at zero.
    for (const d of open) {
      if (!(d.id in paid)) {
        paid[d.id] = 0
        after[d.id] = 0
      }
    }
    months.push({ date, paidPence: paid, balancePence: after })

    if (open.every((d) => bal.get(d.id) === 0)) return { debtFreeDate: date, months }
  }
  return { debtFreeDate: null, months }
}
