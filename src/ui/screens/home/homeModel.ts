import { backupIsOverdue } from '../../../backup/lock'
import type { Account, Category, ISODate, Pence, Settings, Transaction } from '../../../domain/types'
import { unmatchedCardRepayments } from '../../../import/matching'
import { buildBudgetRows, UNCATEGORISED } from '../budget/budgetModel'

export type HomeTarget = 'invest' | 'budget' | 'settings' | 'import' | 'debts'

export interface AttentionItem {
  id: 'uncategorised' | 'backup' | 'card-repayments' | 'unlisted-debts'
  text: string
  action: string
  target: HomeTarget
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The short "needs attention" list on Home, for the current budget month. Empty means all caught up. */
export function attentionItems(input: {
  monthTxs: Transaction[]
  spentByCategory: Record<string, Pence>
  accounts: Account[]
  categories: Category[]
  settings: Settings
  today: ISODate
  /** Trailing monthly debt payments above the Debts list minimums (the Invest figure's unlistedDebtPence). */
  unlistedDebtPence?: Pence
}): AttentionItem[] {
  const { monthTxs, spentByCategory, accounts, categories, settings, today } = input
  const items: AttentionItem[] = []

  // Same count the Budget tab shows on its Uncategorised row.
  const rows = buildBudgetRows({ spentByCategory, categories, monthTxs, accounts })
  const uncategorised = rows.find((r) => r.id === UNCATEGORISED)?.count ?? 0
  if (uncategorised > 0) {
    items.push({
      id: 'uncategorised',
      text: `${plural(uncategorised, 'transaction needs', 'transactions need')} a category.`,
      action: 'Categorise',
      target: 'budget',
    })
  }

  const unmatched = unmatchedCardRepayments(monthTxs, accounts).length
  if (unmatched > 0) {
    items.push({
      id: 'card-repayments',
      text: `${plural(unmatched, 'card repayment has', 'card repayments have')} no matching payment into a card account. Import the card's statement, or mark it as a transfer in Budget.`,
      action: 'Open Budget',
      target: 'budget',
    })
  }

  if ((input.unlistedDebtPence ?? 0) > 0) {
    items.push({
      id: 'unlisted-debts',
      text: "Some debt payments aren't on your Debts list",
      action: 'Open Debts',
      target: 'debts',
    })
  }

  if (backupIsOverdue(settings.backupLastAt, today)) {
    items.push({
      id: 'backup',
      text: settings.backupLastAt ? 'Your last backup was more than 30 days ago.' : 'You have not made a backup yet.',
      action: 'Back up now',
      target: 'settings',
    })
  }
  return items
}
