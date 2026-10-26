import type { Category } from '../domain/types'

const NAMES = [
  'Groceries and food', 'Eating out', 'Direct debits and bills', 'Housing', 'Transport',
  'Clothes', 'Subscriptions', 'Health', 'Entertainment', 'Family and kids', 'Gifts', 'Travel',
  'Cash', 'Miscellaneous', 'Fees and interest', 'Debt payments', 'Savings and investing',
  'Income', 'Transfers',
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const seedCategories: Category[] = NAMES.map((name) => ({
  id: slug(name),
  name,
  monthlyLimitPence: 0,
  excludedFromSpending: name === 'Transfers',
}))
