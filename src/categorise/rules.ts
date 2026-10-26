import type { Rule } from '../domain/types'
import { merchantKey } from '../import/matching'

/**
 * Category id for a description, or undefined when no rule matches.
 * Case-insensitive substring match; the longest matchText wins and, at equal
 * length, a learned rule beats a default one. Rules with empty matchText are ignored.
 */
export function categorise(description: string, rules: Rule[]): string | undefined {
  const haystack = description.toLowerCase()
  let best: Rule | undefined
  for (const rule of rules) {
    const text = rule.matchText.toLowerCase()
    if (text === '' || !haystack.includes(text)) continue
    if (!best) {
      best = rule
      continue
    }
    const bestLen = best.matchText.length
    if (text.length > bestLen || (text.length === bestLen && rule.source === 'learned' && best.source !== 'learned')) {
      best = rule
    }
  }
  return best?.categoryId
}

/** Builds a learned rule from a categorised description; throws if no merchant text remains. */
export function learnRule(description: string, categoryId: string): Rule {
  const matchText = merchantKey(description)
  if (matchText === '') {
    throw new Error(`Cannot learn a rule: no merchant text in "${description}"`)
  }
  return { id: `learned:${matchText}`, matchText, categoryId, source: 'learned' }
}
