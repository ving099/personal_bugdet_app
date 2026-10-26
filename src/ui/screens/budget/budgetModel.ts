import { budgetMonthOf, budgetMonthRange } from '../../../domain/dates'
import { formatGBP } from '../../../domain/money'
import type { Account, Category, ISODate, Pence, Transaction } from '../../../domain/types'
import { isUnmatchedCardRepayment, merchantKey } from '../../../import/matching'
import { countsAsIncome } from '../../../budget/summary'
import { shiftMonth } from '../../../budget/months'
import { MONTH_NAMES } from '../wizardModel'

export const UNCATEGORISED = 'uncategorised'
export const UNASSIGNED = 'unassigned'
/** Transactions listed at once for one category or one income group before "Show all". */
export const LIST_LIMIT = 100

export type Standing = 'none' | 'within' | 'over' | 'refunds'

export interface BudgetRow {
  /** Category id, or 'uncategorised'. */
  id: string
  name: string
  spentPence: Pence
  limitPence: Pence
  standing: Standing
  /** '£40.00 of £250.00', '£40.00 spent', 'Refunds £12.00', or empty when nothing is spent and there is no limit. */
  statusText: string
  /** True when there is no limit to measure against. */
  noLimit: boolean
  /** False for rows that are not a real category (Uncategorised, removed categories). */
  canLimit: boolean
  /** 'Over by £50.00' when spending is past the limit. */
  overText?: string
  /** 0 to 1 of the bar to fill. */
  fill: number
  /** Uncategorised only: how many rows need a category. */
  count?: number
}

export function buildBudgetRows(input: {
  spentByCategory: Record<string, Pence>
  categories: Category[]
  /** This month's rows; used only to count the uncategorised ones. */
  monthTxs: Transaction[]
  accounts: Account[]
}): BudgetRow[] {
  const { spentByCategory, categories, monthTxs, accounts } = input
  const make = (id: string, name: string, limitPence: Pence, spentPence: Pence, categoryKnown: boolean, count?: number): BudgetRow => {
    const base = { id, name, spentPence, limitPence, noLimit: limitPence <= 0, canLimit: !!categoryKnown, ...(count !== undefined ? { count } : {}) }
    if (spentPence < 0) {
      return { ...base, standing: 'refunds', statusText: `Refunds ${formatGBP(-spentPence)}`, fill: 0 }
    }
    if (limitPence <= 0) {
      return { ...base, standing: 'none', statusText: spentPence > 0 ? `${formatGBP(spentPence)} spent` : '', fill: 0 }
    }
    const over = spentPence > limitPence
    return {
      ...base,
      standing: over ? 'over' : 'within',
      statusText: `${formatGBP(spentPence)} of ${formatGBP(limitPence)}`,
      ...(over ? { overText: `Over by ${formatGBP(spentPence - limitPence)}` } : {}),
      fill: Math.min(1, spentPence / limitPence),
    }
  }

  const known = new Set(categories.map((c) => c.id))
  const rows = categories
    .filter((c) => !c.excludedFromSpending)
    .map((c) => make(c.id, c.name, c.monthlyLimitPence, spentByCategory[c.id] ?? 0, true))
  // A row can name a category that no longer exists; keep its spending visible.
  for (const [id, spent] of Object.entries(spentByCategory)) {
    if (id !== UNCATEGORISED && !known.has(id)) rows.push(make(id, 'Unknown category', 0, spent, false))
  }
  rows.sort((a, b) => b.spentPence - a.spentPence || a.name.localeCompare(b.name))

  if (UNCATEGORISED in spentByCategory) {
    // Unmatched card repayments are not spending, so they are not counted here either (they are under "needs attention").
    const count = monthTxs.filter(
      (t) => t.categoryId === undefined && countsAsListed(t, accounts) && !t.isTransfer && !isUnmatchedCardRepayment(t, accounts),
    ).length
    rows.unshift(make(UNCATEGORISED, 'Uncategorised', 0, spentByCategory[UNCATEGORISED], false, count))
  }
  return rows
}

/** Rows shown under a category: outflows, refunds and flagged transfers on current or card accounts. */
function countsAsListed(t: Transaction, accounts: Account[]): boolean {
  const kind = accounts.find((a) => a.id === t.accountId)?.kind
  if (kind !== 'current' && kind !== 'creditCard') return false
  return t.amountPence < 0 || t.isRefund || t.isTransfer
}

export function categoryTransactions(monthTxs: Transaction[], accounts: Account[], rowId: string): Transaction[] {
  return monthTxs
    .filter((t) => (t.categoryId ?? UNCATEGORISED) === rowId && countsAsListed(t, accounts))
    .sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description))
}

/** Credits that count as income (the same rule as the income totals) but have no stream yet. */
export function unassignedCredits(monthTxs: Transaction[], accounts: Account[], categories: Category[]): Transaction[] {
  return monthTxs
    .filter((t) => !t.incomeStreamId && countsAsIncome(t, accounts, categories))
    .sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description))
}

/**
 * Ids of the rows that share `tx`'s merchant (the row itself included). Empty when the description has no
 * merchant text to match on. `accept` narrows the candidates, for example to credits only.
 */
export function similarTransactionIds(
  txs: Transaction[],
  tx: Pick<Transaction, 'id' | 'description'>,
  accept: (t: Transaction) => boolean = () => true,
): string[] {
  const key = merchantKey(tx.description)
  if (key === '') return []
  return txs.filter((t) => t.id === tx.id || (accept(t) && merchantKey(t.description) === key)).map((t) => t.id)
}

export const isIncomeCredit = (t: Transaction): boolean => t.amountPence > 0 && !t.isTransfer && !t.isRefund

/** Budget months from the earliest transaction through the current month (later if a row is dated after it). */
export function monthChoices(txs: Transaction[], currentMonth: string, startDay: number): string[] {
  let first = currentMonth
  let last = currentMonth
  for (const t of txs) {
    const m = budgetMonthOf(t.date, startDay)
    if (m < first) first = m
    if (m > last) last = m
  }
  const out: string[] = []
  for (let m = first; m <= last; m = shiftMonth(m, 1)) out.push(m)
  return out
}

const SHORT = MONTH_NAMES.map((n) => n.slice(0, 3))
const dm = (iso: ISODate) => `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`

/** '25 Sep – 24 Oct 2026'; the year is on both ends only when the period spans two years. */
export function formatPeriod(month: string, startDay: number): string {
  const { from, to } = budgetMonthRange(month, startDay)
  const fromYear = from.slice(0, 4)
  const toYear = to.slice(0, 4)
  return fromYear === toYear ? `${dm(from)} – ${dm(to)} ${toYear}` : `${dm(from)} ${fromYear} – ${dm(to)} ${toYear}`
}

/** 'October 2026' for the month a budget period starts in. */
export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}
