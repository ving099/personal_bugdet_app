import type { Rule, Transaction } from '../domain/types'
import { defaultRules, TRANSFERS_CATEGORY_ID } from '../seed/categories'
import { merchantKey } from '../import/matching'

/**
 * Category id for a description, or undefined when no rule matches.
 * Case-insensitive substring match against the lower-cased description or its merchantKey
 * (learned rules store the key, which drops digits and refs). Precedence: any learned match beats any default
 * match regardless of length; within the same source the longest matchText wins.
 * Rules with empty matchText are ignored.
 */
export function categorise(description: string, rules: Rule[]): string | undefined {
  const lower = description.toLowerCase()
  const key = merchantKey(description)
  const best: Partial<Record<Rule['source'], Rule>> = {}
  for (const rule of rules) {
    const text = rule.matchText.toLowerCase()
    if (text === '' || !(lower.includes(text) || key.includes(text))) continue
    const current = best[rule.source]
    if (!current || text.length > current.matchText.length) best[rule.source] = rule
  }
  return (best.learned ?? best.default)?.categoryId
}

/** Builds a learned rule from a categorised description; throws if no merchant text remains. */
export function learnRule(description: string, categoryId: string): Rule {
  const matchText = merchantKey(description)
  if (matchText === '') {
    throw new Error(`Cannot learn a rule: no merchant text in "${description}"`)
  }
  return { id: `learned:${matchText}`, matchText, categoryId, source: 'learned' }
}

/**
 * For rows stored before `categoryEditedByUser` existed: a Transfers row the built-in rules would not file there,
 * or one a learned rule files there, was put there by the owner, so it is marked as set by hand (and stays out of
 * income). Rows the default rules file under Transfers, rows in other categories and rows already marked are
 * returned unchanged. Used by the v4 migration and when restoring a backup.
 */
export function withHandFiledTransferMark<T extends Pick<Transaction, 'description' | 'categoryId' | 'categoryEditedByUser'>>(
  tx: T,
  learned: Rule[],
): T {
  if (tx.categoryId !== TRANSFERS_CATEGORY_ID || tx.categoryEditedByUser) return tx
  const byOwner =
    categorise(tx.description, defaultRules) !== TRANSFERS_CATEGORY_ID ||
    categorise(tx.description, learned.filter((r) => r.source === 'learned')) === TRANSFERS_CATEGORY_ID
  return byOwner ? { ...tx, categoryEditedByUser: true } : tx
}
