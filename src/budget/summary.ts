import { isSpendingTx, isUnmatchedCardRepayment } from '../import/matching'
import { DEBT_PAYMENTS_CATEGORY_ID, INCOME_CATEGORY_ID, TRANSFERS_CATEGORY_ID } from '../seed/categories'
import type { Account, Category, IncomeStream, Pence, SinkingFund, Transaction } from '../domain/types'
import { assertStartDay, parseMonth, previousMonths, txsInMonth } from './months'

const WINDOW = 3
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

type Flow = { kind: 'spend'; pence: Pence } | { kind: 'income'; pence: Pence } | null

const excludedSet = (categories?: Category[]) => new Set((categories ?? []).filter((c) => c.excludedFromSpending).map((c) => c.id))

/** A credit that is money coming in rather than money back. */
const isCredit = (tx: Transaction) => tx.amountPence > 0 && !tx.isRefund

/**
 * The single rule for what a row means to the budget. Rows that are transfers, unmatched card repayments
 * (listed under "needs attention" instead) or on non-spending (business/savings) accounts are ignored entirely.
 * Rows in an excludedFromSpending category are never spending, and their credits are not income either (money
 * back from a platform, say), with two exceptions:
 * - the Income category, which is where pay is filed;
 * - a Transfers credit that the keyword rules filed there (not the owner by hand, `categoryEditedByUser`). Pairing
 *   is the authority on what is a real transfer: a matched pair has `isTransfer` and is already ignored above, so an
 *   unpaired "TRANSFER FROM BIZ LTD" is money arriving from outside, such as business drawings.
 * Outflows and flagged refunds are spend (positive pence for outflows, negative for refunds); other positive rows
 * are income.
 */
function classify(tx: Transaction, accounts: Account[], excluded: Set<string>): Flow {
  if (!isSpendingTx(tx, accounts)) return null
  // Paying a card off moves money, it is not spending; the card's own purchases are the spending.
  if (isUnmatchedCardRepayment(tx, accounts)) return null
  if (tx.categoryId && excluded.has(tx.categoryId)) {
    const pay = tx.categoryId === INCOME_CATEGORY_ID && isCredit(tx)
    const drawing = tx.categoryId === TRANSFERS_CATEGORY_ID && isCredit(tx) && !tx.categoryEditedByUser
    return pay || drawing ? { kind: 'income', pence: tx.amountPence } : null
  }
  if (tx.amountPence < 0) return { kind: 'spend', pence: -tx.amountPence }
  if (tx.amountPence > 0 && tx.isRefund) return { kind: 'spend', pence: -tx.amountPence }
  if (tx.amountPence > 0) return { kind: 'income', pence: tx.amountPence }
  return null
}

/** True when the row counts as income (the same rule as monthSummary and smoothedIncome). */
export function countsAsIncome(tx: Transaction, accounts: Account[], categories: Category[]): boolean {
  return classify(tx, accounts, excludedSet(categories))?.kind === 'income'
}

/**
 * Debt payments as the budget sees them: rows on current or card accounts in the Debt payments category that are not
 * transfers. Outflows are positive pence, flagged refunds negative. Not spending (the category is excluded), but the
 * Invest composition and the Budget tab compare them with the minimums on the Debts list.
 */
function debtPaymentPence(tx: Transaction, accounts: Account[]): number | null {
  if (tx.categoryId !== DEBT_PAYMENTS_CATEGORY_ID || !isSpendingTx(tx, accounts)) return null
  if (isUnmatchedCardRepayment(tx, accounts)) return null
  if (tx.amountPence < 0) return -tx.amountPence
  if (tx.amountPence > 0 && tx.isRefund) return -tx.amountPence
  return null
}

/** Net Debt payments in one budget month (see debtPaymentPence); never below zero. */
export function monthDebtPayments(input: { month: string; startDay: number; txs: Transaction[]; accounts: Account[] }): Pence {
  const rows = txsInMonth(input.txs, input.month, input.startDay)
  return Math.max(0, sum(rows.map((t) => debtPaymentPence(t, input.accounts) ?? 0)))
}

/**
 * Mean over the previous up-to-`months` budget months of the per-month net of `pick` (null rows are skipped).
 * A month counts only when its net is above zero; see trailingSpend for why.
 */
function trailingNetAverage(
  input: { asOfMonth: string; startDay: number; txs: Transaction[]; months?: number },
  pick: (t: Transaction) => number | null,
): { averagePence: Pence; monthsUsed: number } {
  parseMonth(input.asOfMonth)
  assertStartDay(input.startDay)
  const totals: number[] = []
  for (const month of previousMonths(input.asOfMonth, input.months ?? WINDOW)) {
    const net = sum(txsInMonth(input.txs, month, input.startDay).map((t) => pick(t) ?? 0))
    if (net > 0) totals.push(net)
  }
  if (totals.length === 0) return { averagePence: 0, monthsUsed: 0 }
  return { averagePence: Math.round(sum(totals) / totals.length), monthsUsed: totals.length }
}

/**
 * Trailing monthly average of Debt payments over the same window as trailingSpend. For debt payments a month with
 * none is real data (a plan ended, or a one-off payoff), so the window total is divided by every month in the window
 * that has data of either kind: net spending above zero (trailingSpend's months) or net Debt payments above zero.
 * Pass `categories` so spending months are judged exactly as in trailingSpend.
 */
export function trailingDebtPayments(input: {
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
  let total = 0
  let monthsUsed = 0
  for (const month of previousMonths(input.asOfMonth, input.months ?? WINDOW)) {
    const rows = txsInMonth(input.txs, month, input.startDay)
    const paid = sum(rows.map((t) => debtPaymentPence(t, input.accounts) ?? 0))
    const spent = sum(rows.map((t) => classify(t, input.accounts, excluded)).filter((f) => f?.kind === 'spend').map((f) => f!.pence))
    if (paid > 0 || spent > 0) monthsUsed += 1
    if (paid > 0) total += paid
  }
  return { averagePence: monthsUsed === 0 ? 0 : Math.round(total / monthsUsed), monthsUsed }
}

/**
 * Total of card repayments that found no card statement over the trailing three-month window (as-of month excluded).
 * A plain total, not a monthly figure, so a short history cannot make it look alarming. 0 when none.
 */
export function trailingUnmatchedRepayments(input: {
  asOfMonth: string
  startDay: number
  txs: Transaction[]
  accounts: Account[]
  categories?: Category[]
}): Pence {
  parseMonth(input.asOfMonth)
  assertStartDay(input.startDay)
  let total = 0
  for (const month of previousMonths(input.asOfMonth, WINDOW)) {
    const rows = txsInMonth(input.txs, month, input.startDay)
    total += sum(rows.filter((t) => isUnmatchedCardRepayment(t, input.accounts)).map((t) => -t.amountPence))
  }
  return total
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
  const excluded = excludedSet(input.categories)
  return trailingNetAverage(input, (t) => {
    const f = classify(t, input.accounts, excluded)
    return f?.kind === 'spend' ? f.pence : null
  })
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
