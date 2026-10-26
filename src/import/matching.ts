import type { Account, Transaction } from '../domain/types'

/** Description of a payment towards a credit card. Bare "card payment" is excluded: debit-card purchases use it. */
export const CARD_REPAYMENT_PATTERN =
  /\b(credit card|barclaycard|mbna|amex|american express|capital one|card repayment|cc payment)\b/i

const MAX_TRANSFER_GAP_DAYS = 3
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec'

/**
 * Normalised merchant name for comparing descriptions of the same merchant.
 * Lower-cases, drops `*` masks and the reference attached to them, numeric
 * dates ("12/03/2026"), day-month dates ("05 MAR"), and all digits, then
 * collapses whitespace. "TESCO STORES 4412" and "Tesco Stores 9981" both give
 * "tesco stores"; "AMAZON.CO.UK*2K4 LONDON" gives "amazon.co.uk london".
 */
export function merchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/\*\S*/g, ' ')
    .replace(/\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/g, ' ')
    .replace(new RegExp(`\\b\\d{1,2}\\s+(${MONTHS})[a-z]*\\b`, 'g'), ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/**
 * Flags equal-and-opposite rows on two different known accounts, at most three
 * days apart, as transfers. Matching is one-to-one, nearest date first, ties
 * broken by array order. Returns new objects; rows already flagged stay flagged.
 */
export function markTransfers(txs: Transaction[], accounts: Account[]): Transaction[] {
  const known = new Set(accounts.map((a) => a.id))
  const days = txs.map((t) => dayNumber(t.date))
  const candidates: { gap: number; i: number; j: number }[] = []
  for (let i = 0; i < txs.length; i++) {
    for (let j = i + 1; j < txs.length; j++) {
      const a = txs[i]
      const b = txs[j]
      if (a.amountPence === 0 || a.amountPence !== -b.amountPence) continue
      if (a.accountId === b.accountId || !known.has(a.accountId) || !known.has(b.accountId)) continue
      const gap = Math.abs(days[i] - days[j])
      if (gap <= MAX_TRANSFER_GAP_DAYS) candidates.push({ gap, i, j })
    }
  }
  candidates.sort((x, y) => x.gap - y.gap || x.i - y.i || x.j - y.j)
  const matched = new Set<number>()
  for (const { i, j } of candidates) {
    if (matched.has(i) || matched.has(j)) continue
    matched.add(i)
    matched.add(j)
  }
  return txs.map((t, i) => (matched.has(i) && !t.isTransfer ? { ...t, isTransfer: true } : { ...t }))
}

/** Outflows from non-card accounts that look like card repayments but found no card-side inflow (not marked as transfers). */
export function unmatchedCardRepayments(txs: Transaction[], accounts: Account[]): Transaction[] {
  const kindOf = new Map(accounts.map((a) => [a.id, a.kind]))
  return txs.filter((t) => {
    const kind = kindOf.get(t.accountId)
    return (
      kind !== undefined &&
      kind !== 'creditCard' &&
      t.amountPence < 0 &&
      !t.isTransfer &&
      CARD_REPAYMENT_PATTERN.test(t.description)
    )
  })
}

/** True when the row counts toward budget and income analysis: not a transfer, on a current or credit-card account. */
export function isSpendingTx(tx: Transaction, accounts: Account[]): boolean {
  if (tx.isTransfer) return false
  const kind = accounts.find((a) => a.id === tx.accountId)?.kind
  return kind === 'current' || kind === 'creditCard'
}

/** Flags credits whose merchant matches an earlier-or-same-date outflow on any account. Returns new objects. */
export function flagRefunds(txs: Transaction[]): Transaction[] {
  const spentOn = new Map<string, string[]>()
  for (const t of txs) {
    if (t.amountPence >= 0) continue
    const key = merchantKey(t.description)
    if (key) spentOn.set(key, [...(spentOn.get(key) ?? []), t.date])
  }
  return txs.map((t) => {
    if (t.amountPence <= 0 || t.isTransfer) return { ...t }
    const dates = spentOn.get(merchantKey(t.description))
    return dates?.some((d) => d <= t.date) ? { ...t, isRefund: true } : { ...t }
  })
}
