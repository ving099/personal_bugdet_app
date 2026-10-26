import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom has no layout, so this guards the rule; the 48px result was measured with Playwright at 390px wide.
const css = readFileSync(join(__dirname, '../../src/ui/theme.css'), 'utf8')
const block = (selector: string) => new RegExp(`(^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[2] ?? ''

describe('tap targets (review M4)', () => {
  it('a checkbox or switch label is at least 48px tall', () => {
    expect(block('.check-label')).toMatch(/min-height: 48px/)
    expect(block('.check-label')).toMatch(/box-sizing: border-box/)
  })
})
