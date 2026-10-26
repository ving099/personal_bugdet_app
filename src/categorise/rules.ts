import type { Rule } from '../domain/types'
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
