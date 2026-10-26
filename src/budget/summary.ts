import { isSpendingTx } from '../import/matching'
import type { Account, Category, IncomeStream, Pence, SinkingFund, Transaction } from '../domain/types'
import { parseMonth, previousMonths, txsInMonth } from './months'

const WINDOW = 3
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Spend rows count: spending-account, non-transfer, outflow or flagged refund, category not excluded. */
function spendDelta(tx: Transaction, accounts: Account[], excluded: Set<string>): Pence | null {
  if (!isSpendingTx(tx, accounts)) return null
  if (tx.categoryId && excluded.has(tx.categoryId)) return null
  if (tx.amountPence < 0) return -tx.amountPence
  if (tx.amountPence > 0 && tx.isRefund) return -tx.amountPence
  return null
}

function isIncome(tx: Transaction, accounts: Account[]): boolean {
  return tx.amountPence > 0 && !tx.isRefund && isSpendingTx(tx, accounts)
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
  const excluded = new Set(input.categories.filter((c) => c.excludedFromSpending).map((c) => c.id))
  const spentByCategory: Record<string, Pence> = {}
  const incomeByStream: Record<string, Pence> = {}
  for (const tx of txsInMonth(input.txs, input.month, input.startDay)) {
    const spend = spendDelta(tx, input.accounts, excluded)
    if (spend !== null) {
      const key = tx.categoryId ?? 'uncategorised'
      spentByCategory[key] = (spentByCategory[key] ?? 0) + spend
    } else if (isIncome(tx, input.accounts)) {
      const key = tx.incomeStreamId ?? 'unassigned'
      incomeByStream[key] = (incomeByStream[key] ?? 0) + tx.amountPence
    }
  }
  const totalSpentPence = sum(Object.values(spentByCategory))
  const totalIncomePence = sum(Object.values(incomeByStream))
  return { spentByCategory, totalSpentPence, incomeByStream, totalIncomePence, leftPence: totalIncomePence - totalSpentPence }
}

/** Mean spend over the previous up-to-`months` budget months (as-of month excluded) that have spending data. */
export function trailingSpend(input: {
  asOfMonth: string
  startDay: number
  txs: Transaction[]
  accounts: Account[]
  months?: number
}): { averagePence: Pence; monthsUsed: number } {
  parseMonth(input.asOfMonth)
  const totals: number[] = []
  for (const month of previousMonths(input.asOfMonth, input.months ?? WINDOW)) {
    const rows = txsInMonth(input.txs, month, input.startDay).filter((t) => spendDelta(t, input.accounts, new Set()) !== null)
    if (rows.length === 0) continue
    totals.push(sum(rows.map((t) => spendDelta(t, input.accounts, new Set()) as number)))
  }
  if (totals.length === 0) return { averagePence: 0, monthsUsed: 0 }
  return { averagePence: Math.round(sum(totals) / totals.length), monthsUsed: totals.length }
}

/** Per stream: lower of expected monthly net and trailing average actual; expected when no history. */
export function smoothedIncome(input: {
  asOfMonth: string
  startDay: number
  txs: Transaction[]
  accounts: Account[]
  streams: IncomeStream[]
}): { totalPence: Pence; perStream: Record<string, Pence>; monthsUsed: number } {
  parseMonth(input.asOfMonth)
  const history = previousMonths(input.asOfMonth, WINDOW).map((m) =>
    txsInMonth(input.txs, m, input.startDay).filter((t) => isIncome(t, input.accounts)),
  )
  const perStream: Record<string, Pence> = {}
  let monthsUsed = 0
  for (const s of input.streams) {
    const totals = history
      .map((rows) => rows.filter((t) => t.incomeStreamId === s.id))
      .filter((rows) => rows.length > 0)
      .map((rows) => sum(rows.map((t) => t.amountPence)))
    monthsUsed = Math.max(monthsUsed, totals.length)
    perStream[s.id] =
      totals.length === 0 ? s.expectedMonthlyNetPence : Math.min(s.expectedMonthlyNetPence, Math.round(sum(totals) / totals.length))
  }
  return { totalPence: sum(Object.values(perStream)), perStream, monthsUsed }
}

/** Monthly set-aside for sinking funds: each fund's yearly amount / 12, rounded to whole pence per fund. */
export function sinkingMonthlyPence(funds: SinkingFund[]): Pence {
  return sum(funds.map((f) => Math.round(f.yearlyAmountPence / 12)))
}
