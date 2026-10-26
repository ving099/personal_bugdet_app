import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseCsv } from '../../src/import/csv'
import { applyProfile, guessProfile, ProfileError } from '../../src/import/profile'
import type { ImportProfile } from '../../src/domain/types'

const rows = (n: string) => parseCsv(readFileSync(`tests/fixtures/${n}`, 'utf8'))

const base: ImportProfile = {
  id: 'p', bank: 'Test', dateFormat: 'DD/MM/YYYY', dateColumn: 0, descriptionColumn: 1,
  amountMode: 'single', amountColumn: 2, signConvention: 'negativeIsOut', headerRows: 1,
}

describe('applyProfile', () => {
  it('single amount: negative is outflow', () => {
    expect(applyProfile(rows('single-amount.csv'), base, 'acc1')).toEqual([
      { accountId: 'acc1', date: '2026-04-03', amountPence: -2345, description: 'TESCO STORES 2231' },
      { accountId: 'acc1', date: '2026-04-04', amountPence: 250000, description: 'ACME LTD SALARY' },
      { accountId: 'acc1', date: '2026-04-05', amountPence: -1099, description: 'NETFLIX.COM' },
    ])
  })

  it('debit/credit columns: debit outflow, credit inflow, blank is zero', () => {
    const p: ImportProfile = { ...base, amountMode: 'debitCredit', descriptionColumn: 1, debitColumn: 2, creditColumn: 3 }
    expect(applyProfile(rows('debit-credit.csv'), p, 'a').map(t => t.amountPence)).toEqual([-450, 20000, -6210])
  })

  it('positiveIsOut: positive numbers stored as negative pence', () => {
    const p: ImportProfile = { ...base, dateFormat: 'YYYY-MM-DD', signConvention: 'positiveIsOut' }
    const out = applyProfile(rows('card-positive-spend.csv'), p, 'card')
    expect(out.map(t => t.amountPence)).toEqual([-2999, 15000, -4520])
    expect(out[0].date).toBe('2026-06-10')
  })

  it('parses quirky amounts', () => {
    const out = applyProfile(rows('quirks.csv'), base, 'a')
    expect(out.map(t => t.amountPence)).toEqual([-123456, 1230, -4500])
    expect(out[0].description).toBe('Tesco, Basildon')
  })

  it('DD/MM vs MM/DD', () => {
    const r = [['03/04/2026', 'x', '-1.00']]
    expect(applyProfile(r, { ...base, headerRows: 0 }, 'a')[0].date).toBe('2026-04-03')
    expect(applyProfile(r, { ...base, headerRows: 0, dateFormat: 'MM/DD/YYYY' }, 'a')[0].date).toBe('2026-03-04')
  })

  it('D MMM YYYY', () => {
    const r = [['3 Apr 2026', 'x', '-1.00']]
    expect(applyProfile(r, { ...base, headerRows: 0, dateFormat: 'D MMM YYYY' }, 'a')[0].date).toBe('2026-04-03')
  })

  it('bad date throws ProfileError naming the 1-based data row', () => {
    const r = [['h'], ['03/04/2026', 'x', '-1.00'], ['31/02/2026', 'y', '-2.00']]
    expect(() => applyProfile(r, base, 'a')).toThrow(ProfileError)
    expect(() => applyProfile(r, base, 'a')).toThrow(/row 2/)
  })

  it('bad amount throws ProfileError naming the row', () => {
    const r = [['h'], ['03/04/2026', 'x', 'abc']]
    expect(() => applyProfile(r, base, 'a')).toThrow(ProfileError)
    expect(() => applyProfile(r, base, 'a')).toThrow(/row 1/)
  })
})

describe('applyProfile amount strictness', () => {
  const dc: ImportProfile = { ...base, amountMode: 'debitCredit', debitColumn: 2, creditColumn: 3 }
  const run = (r: string[][], p: ImportProfile) => () => applyProfile(r, { ...p, headerRows: 0 }, 'a')

  it('single: blank amount cell throws naming the row', () => {
    expect(run([['03/04/2026', 'x', '1.00'], ['03/04/2026', 'x', '  ']], base)).toThrow(/row 2/)
    expect(run([['03/04/2026', 'x', '  ']], base)).toThrow(ProfileError)
  })
  it('single: missing cell (short row) throws', () => {
    expect(run([['03/04/2026', 'x']], base)).toThrow(/row 1/)
  })
  it('single: undefined amountColumn throws ProfileError', () => {
    expect(run([['03/04/2026', 'x', '1.00']], { ...base, amountColumn: undefined })).toThrow(ProfileError)
  })
  it('single: out-of-range amountColumn throws', () => {
    expect(run([['03/04/2026', 'x', '1.00']], { ...base, amountColumn: 9 })).toThrow(/row 1/)
  })
  it('single: a real zero is valid', () => {
    expect(applyProfile([['03/04/2026', 'x', '0.00']], { ...base, headerRows: 0 }, 'a')[0].amountPence).toBe(0)
  })
  it('debitCredit: one blank cell counts as zero', () => {
    const out = applyProfile([['03/04/2026', 'x', '', '5.00'], ['03/04/2026', 'x', '2.00']], { ...dc, headerRows: 0 }, 'a')
    expect(out.map(t => t.amountPence)).toEqual([500, -200])
  })
  it('debitCredit: both blank or missing throws naming the row', () => {
    expect(run([['03/04/2026', 'x', '1.00', ''], ['03/04/2026', 'x', '', '']], dc)).toThrow(/row 2/)
    expect(run([['03/04/2026', 'x']], dc)).toThrow(/row 1/)
  })
  it('debitCredit: undefined debit or credit column throws', () => {
    const r = [['03/04/2026', 'x', '1.00', '']]
    expect(run(r, { ...dc, debitColumn: undefined })).toThrow(ProfileError)
    expect(run(r, { ...dc, creditColumn: undefined })).toThrow(ProfileError)
  })
  it('debitCredit: a real zero in one column is valid', () => {
    expect(applyProfile([['03/04/2026', 'x', '0.00', '']], { ...dc, headerRows: 0 }, 'a')[0].amountPence).toBe(0)
  })
  it('debitCredit: positiveIsOut is ignored', () => {
    const r = [['03/04/2026', 'x', '4.50', ''], ['03/04/2026', 'x', '', '2.00']]
    const a = applyProfile(r, { ...dc, headerRows: 0, signConvention: 'positiveIsOut' }, 'a')
    const b = applyProfile(r, { ...dc, headerRows: 0, signConvention: 'negativeIsOut' }, 'a')
    expect(a).toEqual(b)
    expect(a.map(t => t.amountPence)).toEqual([-450, 200])
  })
})

describe('guessProfile', () => {
  it('single amount', () => {
    expect(guessProfile(rows('single-amount.csv'))).toMatchObject({
      dateColumn: 0, descriptionColumn: 1, amountMode: 'single', amountColumn: 2, headerRows: 1,
    })
  })
  it('debit/credit', () => {
    expect(guessProfile(rows('debit-credit.csv'))).toMatchObject({
      dateColumn: 0, descriptionColumn: 1, amountMode: 'debitCredit', debitColumn: 2, creditColumn: 3, headerRows: 1,
    })
  })
  it('card', () => {
    expect(guessProfile(rows('card-positive-spend.csv'))).toMatchObject({
      dateColumn: 0, descriptionColumn: 1, amountMode: 'single', amountColumn: 2,
    })
  })
})
