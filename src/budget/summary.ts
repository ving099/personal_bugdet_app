import { isSpendingTx } from '../import/matching'
import { INCOME_CATEGORY_ID } from '../seed/categories'
import type { Account, Category, IncomeStream, Pence, SinkingFund, Transaction } from '../domain/types'
import { assertStartDay, parseMonth, previousMonths, txsInMonth } from './months'

const WINDOW = 3
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

type Flow = { kind: 'spend'; pence: Pence } | { kind: 'income'; pence: Pence } | null

const excludedSet = (categories?: Category[]) => new Set((categories ?? []).filter((c) => c.excludedFromSpending).map((c) => c.id))

/**
 * The single rule for what a row means to the budget. Rows that are transfers or on non-spending
 * (business/savings) accounts are ignored entirely. Rows in an excludedFromSpending category are never
 * spending, and their credits are not income either (a transfer in, money back from a platform), except in
 * the Income category, which is where pay is filed. Outflows and flagged refunds are spend (positive pence
 * for outflows, negative for refunds); other positive rows are income.
 */
function classify(tx: Transaction, accounts: Account[], excluded: Set<string>): Flow {
  if (!isSpendingTx(tx, accounts)) return null
  if (tx.categoryId && excluded.has(tx.categoryId)) {
    const pay = tx.categoryId === INCOME_CATEGORY_ID && tx.amountPence > 0 && !tx.isRefund
    return pay ? { kind: 'income', pence: tx.amountPence } : null
  }
  if (tx.amountPence < 0) return { kind: 'spend', pence: -tx.amountPence }
  if (tx.amountPence > 0 && tx.isRefund) return { kind: 'spend', pence: -tx.amountPence }
  if (tx.amountPence > 0) return { kind: 'income', pence: tx.amountPence }
  return null
}

/**
 * Summary of one budget month.
 * Sign convention: spentByCategory / totalSpentPence are POSITIVE spend in pence; refunds
 * subtract from their category (the true net is reported, never clamped, so a category can go negative).
 * incomeByStream is positive pence keyed by stream id ('unassigned' when none); uncategorised spend
 * is keyed 'uncategorised'. leftPence = totalIncomePence - totalSpentPence.
 */
export function monthSummary(input: {
  month: string
  startDay: number
  txs: Transaction[]
  accounts: Account[]
  categories: Category[]
  streams: IncomeStream[]
}): {
  spentByCategory: Record<string, Pence>
  totalSpentPence: Pence
  incomeByStream: Record<string, Pence>
  totalIncomePence: Pence
  leftPence: Pence
} {
  parseMonth(input.month)
  assertStartDay(input.startDay)
  const excluded = excludedSet(input.categories)
  const spentByCategory: Record<string, Pence> = {}
  const incomeByStream: Record<string, Pence> = {}
  for (const tx of txsInMonth(input.txs, input.month, input.startDay)) {
    const flow = classify(tx, input.accounts, excluded)
    if (flow?.kind === 'spend') {
      const key = tx.categoryId ?? 'uncategorised'
      spentByCategory[key] = (spentByCategory[key] ?? 0) + flow.pence
    } else if (flow?.kind === 'income') {
      const key = tx.incomeStreamId ?? 'unassigned'
      incomeByStream[key] = (incomeByStream[key] ?? 0) + flow.pence
    }
  }
  const totalSpentPence = sum(Object.values(spentByCategory))
  const totalIncomePence = sum(Object.values(incomeByStream))
  return { spentByCategory, totalSpentPence, incomeByStream, totalIncomePence, leftPence: totalIncomePence - totalSpentPence }
}

/**
 * Mean spend over the previous up-to-`months` budget months (as-of month excluded) that have spending data.
 * A month "has data" only when its NET spend (outflows minus refunds) is above zero. A month where refunds
 * match or outweigh spending (for example a big return of something bought the month before) is treated as
 * no data: it is left out of both the average and `monthsUsed`, so it can neither drag the average down nor
 * make it negative. The result is therefore always >= 0.
 * Callers (e.g. the Invest composition) must pass `categories` so excludedFromSpending categories
 * are ignored exactly as in monthSummary; when omitted, no category is excluded.
 */
export function trailingSpend(input: {
  asOfMonth: string
  startDay: number
  txs: Transaction[]
  accounts: Account[]
  categories?: Category[]
  months?: number
}): { averagePence: Pence; monthsUsed: number } {
  parseMonth(input.asOfMonth)
  assertStartDay(input.startDay)
  const excluded = excludedSet(input.categories)
  const totals: number[] = []
  for (const month of previousMonths(input.asOfMonth, input.months ?? WINDOW)) {
    const flows = txsInMonth(input.txs, month, input.startDay)
      .map((t) => classify(t, input.accounts, excluded))
      .filter((f) => f?.kind === 'spend')
    const net = sum(flows.map((f) => f!.pence))
    if (net <= 0) continue
    totals.push(net)
  }
  if (totals.length === 0) return { averagePence: 0, monthsUsed: 0 }
  return { averagePence: Math.round(sum(totals) / totals.length), monthsUsed: totals.length }
}

/**
 * Per stream: lower of expected monthly net and trailing average actual; expected when no history.
 * Callers must pass `categories` so excludedFromSpending rows are not counted as income.
 * `unassignedAveragePence` is informational only (trailing average of income with no stream, so the UI
 * can prompt the user to assign one); it is NOT included in totalPence or perStream.
 */
export function smoothedIncome(input: {
  asOfMonth: string
  startDay: number
  txs: Transaction[]
  accounts: Account[]
  streams: IncomeStream[]
  categories?: Category[]
}): { totalPence: Pence; perStream: Record<string, Pence>; monthsUsed: number; unassignedAveragePence: Pence } {
  parseMonth(input.asOfMonth)
  assertStartDay(input.startDay)
  const excluded = excludedSet(input.categories)
  const history = previousMonths(input.asOfMonth, WINDOW).map((m) =>
    txsInMonth(input.txs, m, input.startDay).filter((t) => classify(t, input.accounts, excluded)?.kind === 'income'),
  )
  const monthlyTotals = (match: (t: Transaction) => boolean) =>
    history
      .map((rows) => rows.filter(match))
      .filter((rows) => rows.length > 0)
      .map((rows) => sum(rows.map((t) => t.amountPence)))
  const perStream: Record<string, Pence> = {}
  let monthsUsed = 0
  for (const s of input.streams) {
    const totals = monthlyTotals((t) => t.incomeStreamId === s.id)
    monthsUsed = Math.max(monthsUsed, totals.length)
    perStream[s.id] =
      totals.length === 0 ? s.expectedMonthlyNetPence : Math.min(s.expectedMonthlyNetPence, Math.round(sum(totals) / totals.length))
  }
  const un = monthlyTotals((t) => !t.incomeStreamId)
  const unassignedAveragePence = un.length === 0 ? 0 : Math.round(sum(un) / un.length)
  return { totalPence: sum(Object.values(perStream)), perStream, monthsUsed, unassignedAveragePence }
}

/** Monthly set-aside for sinking funds: each fund's yearly amount / 12, rounded to whole pence per fund. */
export function sinkingMonthlyPence(funds: SinkingFund[]): Pence {
  return sum(funds.map((f) => Math.round(f.yearlyAmountPence / 12)))
}
