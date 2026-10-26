import type { AvalanchePlan } from '../../../debt/debt'
import { effectiveApr, percentPaid, utilisation } from '../../../debt/debt'
import { formatGBP } from '../../../domain/money'
import type { Debt, ISODate, Pence, SavingsPot, SinkingFund } from '../../../domain/types'
import { penceToInput } from '../../formValues'
import { formatDisplayDate } from '../import/importFlow'
import { MONTH_NAMES, type DebtDraft, type PotDraft, type SinkingDraft } from '../wizardModel'

/** The highest APR the Debts & Savings form accepts. */
export const MAX_APR = 100

const rate = (n: number) => `${Number(n.toFixed(2))}%`
const pounds = (p: Pence) => (p / 100).toFixed(2)

export const formatMonthYear = (iso: ISODate) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
export const formatShortMonth = (iso: ISODate) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1].slice(0, 3)} ${iso.slice(0, 4)}`

export interface DebtView {
  aprText: string
  promoText?: string
  /** '60% used' or '60% paid off'. */
  usageText?: string
  usageDetail?: string
  /** Shown instead of usage when the limit or original amount is missing. */
  usageHint?: string
  /** 0 to 100, for the bar. */
  usagePercent?: number
}

export function debtView(d: Debt, today: ISODate): DebtView {
  const out: DebtView = { aprText: `${rate(effectiveApr(d, today))} APR` }
  if (d.promoAprPercent !== undefined && d.promoEndsOn !== undefined) {
    out.promoText =
      today <= d.promoEndsOn
        ? `${rate(d.promoAprPercent)} until ${formatDisplayDate(d.promoEndsOn)}, then ${rate(d.aprPercent)}`
        : `Promotional rate ended ${formatDisplayDate(d.promoEndsOn)}`
  }
  if (d.kind === 'card') {
    const u = utilisation(d)
    if (u === undefined) out.usageHint = 'Add a credit limit to see utilisation'
    else {
      const pct = Math.max(0, Math.round(u * 100))
      Object.assign(out, { usageText: `${pct}% used`, usageDetail: `limit ${formatGBP(d.creditLimitOrOriginalPence)}`, usagePercent: Math.min(100, pct) })
    }
  } else if (d.kind === 'loan') {
    const p = percentPaid(d)
    if (p === undefined) out.usageHint = 'Add the original amount to see how much is paid off'
    else {
      const pct = Math.max(0, Math.round(p * 100))
      Object.assign(out, { usageText: `${pct}% paid off`, usageDetail: `original ${formatGBP(d.creditLimitOrOriginalPence)}`, usagePercent: Math.min(100, pct) })
    }
  }
  return out
}

export interface Milestone {
  debtId: string
  name: string
  /** First plan month with a zero balance; null when it is not cleared within the plan. */
  date: ISODate | null
}

/** When each open debt reaches zero, soonest first; debts that never clear come last. */
export function payoffMilestones(plan: AvalanchePlan, debts: Debt[]): Milestone[] {
  const out = debts
    .filter((d) => d.balancePence > 0)
    .map((d): Milestone => ({
      debtId: d.id,
      name: d.name,
      date: plan.months.find((m) => m.balancePence[d.id] === 0)?.date ?? null,
    }))
  return out.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
}

export interface SeriesPoint {
  date: ISODate
  total: Pence
}

/** Total remaining balance now and after each plan month, thinned to at most `max` points (last point kept). */
export function balanceSeries(plan: AvalanchePlan, debts: Debt[], today: ISODate, max = 120): SeriesPoint[] {
  const open = debts.filter((d) => d.balancePence > 0)
  const all: SeriesPoint[] = [
    { date: today, total: open.reduce((s, d) => s + d.balancePence, 0) },
    ...plan.months.map((m) => ({ date: m.date, total: open.reduce((s, d) => s + (m.balancePence[d.id] ?? 0), 0) })),
  ]
  if (all.length <= max) return all
  const step = (all.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => all[Math.round(i * step)])
}

export const totalBalance = (debts: Debt[]): Pence => debts.reduce((s, d) => s + d.balancePence, 0)
export const totalMinimums = (debts: Debt[]): Pence => debts.reduce((s, d) => s + d.minimumPaymentPence, 0)

export function draftFromDebt(d: Debt): DebtDraft {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    balance: pounds(d.balancePence),
    apr: String(d.aprPercent),
    minimum: pounds(d.minimumPaymentPence),
    limit: penceToInput(d.creditLimitOrOriginalPence),
    promoApr: d.promoAprPercent === undefined ? '' : String(d.promoAprPercent),
    promoEnds: d.promoEndsOn ?? '',
  }
}

export const draftFromPot = (p: SavingsPot): PotDraft => ({
  id: p.id, name: p.name, balance: pounds(p.balancePence), target: penceToInput(p.targetPence), emergency: p.isEmergencyFund,
})

export const draftFromSinking = (s: SinkingFund): SinkingDraft => ({
  id: s.id, name: s.name, yearly: pounds(s.yearlyAmountPence), dueMonth: String(s.dueMonth),
})
