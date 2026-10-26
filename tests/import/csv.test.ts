import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseCsv } from '../../src/import/csv'

const fixture = (n: string) => readFileSync(`tests/fixtures/${n}`, 'utf8')

describe('parseCsv', () => {
  it('strips BOM, handles CRLF, quoted commas and trailing blank lines', () => {
    expect(parseCsv(fixture('quirks.csv'))).toEqual([
      ['Date', 'Description', 'Amount'],
      ['03/04/2026', 'Tesco, Basildon', '-1,234.56'],
      ['04/04/2026', 'Refund Shop', '£12.30'],
      ['05/04/2026', 'Gym Fee', '(45.00)'],
    ])
  })

  it('drops blank lines in the middle', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })
})
