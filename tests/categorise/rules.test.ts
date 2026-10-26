import { describe, expect, it } from 'vitest'
import { categorise, learnRule } from '../../src/categorise/rules'
import { defaultRules, seedCategories } from '../../src/seed/categories'
import type { Rule } from '../../src/domain/types'

describe('categorise', () => {
  it('matches a default merchant rule', () => {
    expect(categorise('TESCO STORES 4412', defaultRules)).toBe('groceries-and-food')
  })

  it('learned rule beats a shorter default rule', () => {
    const learned = learnRule('COSTA COFFEE 0912', 'miscellaneous')
    const rules = [...defaultRules, learned]
    expect(categorise('COSTA COFFEE', defaultRules)).toBe('eating-out')
    expect(categorise('COSTA COFFEE', rules)).toBe('miscellaneous')
  })

  it('learned rule matches a later description with different refs', () => {
    const rules = [learnRule('COSTA', 'miscellaneous')]
    expect(categorise('COSTA 0912 LONDON', rules)).toBe('miscellaneous')
  })

  it('returns undefined for unknown descriptions', () => {
    expect(categorise('ZZZ UNKNOWN PAYEE', defaultRules)).toBeUndefined()
  })

  it('equal length tie goes to the learned rule regardless of order', () => {
    const d: Rule = { id: 'd', matchText: 'costa', categoryId: 'eating-out', source: 'default' }
    const l: Rule = { id: 'l', matchText: 'costa', categoryId: 'gifts', source: 'learned' }
    expect(categorise('Costa', [l, d])).toBe('gifts')
    expect(categorise('Costa', [d, l])).toBe('gifts')
  })

  it('ignores rules with empty matchText', () => {
    const r: Rule = { id: 'e', matchText: '', categoryId: 'gifts', source: 'learned' }
    expect(categorise('anything', [r])).toBeUndefined()
  })
})

describe('learnRule', () => {
  it('normalises the merchant and marks the rule learned', () => {
    const r = learnRule('TESCO STORES 4412', 'groceries-and-food')
    expect(r.matchText).toBe('tesco stores')
    expect(r.source).toBe('learned')
    expect(r.categoryId).toBe('groceries-and-food')
    expect(r.id).toBeTruthy()
  })

  it('throws when nothing remains after normalising', () => {
    expect(() => learnRule('4412 0912', 'gifts')).toThrow(/merchant/i)
  })
})

describe('defaultRules', () => {
  it('has no duplicate matchText and no empty matchText', () => {
    const texts = defaultRules.map((r) => r.matchText)
    expect(texts.every((t) => t.length > 0 && t === t.toLowerCase())).toBe(true)
    expect(new Set(texts).size).toBe(texts.length)
  })
  it('only references seeded categories and is source default', () => {
    const ids = new Set(seedCategories.map((c) => c.id))
    for (const r of defaultRules) {
      expect(ids.has(r.categoryId)).toBe(true)
      expect(r.source).toBe('default')
    }
    expect(new Set(defaultRules.map((r) => r.id)).size).toBe(defaultRules.length)
  })
})
