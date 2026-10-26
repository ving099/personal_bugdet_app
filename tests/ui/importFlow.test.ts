import { describe, expect, it } from 'vitest'
import type { Account, ImportProfile, Transaction } from '../../src/domain/types'
import {
  buildPreview, changedFlagRows, formatDisplayDate, previewMapping, reconcileAfterUndo, reconcileFlags,
  sniffDateFormat, summariseBatches,
} from '../../src/ui/screens/import/importFlow'

const accounts: Account[] = [
  { id: 'cur', name: 'Current', bank: 'B', kind: 'current' },
  { id: 'sav', name: 'Savings', bank: 'B', kind: 'savings' },
  { id: 'card', name: 'Card', bank: 'B', kind: 'creditCard' },
]

let n = 0
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${n++}`, accountId: 'cur', date: '2026-04-03', amountPence: -100, description: 'X', fingerprint: `fp${n}`,
  batchId: 'b1', isTransfer: false, isRefund: false, ...over,
})

describe('sniffDateFormat', () => {
  it('reads day/month when a day is above 12', () => {
    expect(sniffDateFormat(['03/04/2026', '13/04/2026'])).toEqual({ format: 'DD/MM/YYYY', ambiguous: false })
  })
  it('reads month/day when the second part is above 12', () => {
    expect(sniffDateFormat(['04/13/2026', '04/03/2026'])).toEqual({ format: 'MM/DD/YYYY', ambiguous: false })
  })
  it('defaults to UK day/month when ambiguous', () => {
    expect(sniffDateFormat(['03/04/2026', '05/06/2026'])).toEqual({ format: 'DD/MM/YYYY', ambiguous: true })
    expect(sniffDateFormat([])).toEqual({ format: 'DD/MM/YYYY', ambiguous: true })
  })
  it('recognises ISO and named-month dates', () => {
    expect(sniffDateFormat(['2026-04-03']).format).toBe('YYYY-MM-DD')
    expect(sniffDateFormat(['3 Apr 2026', '13 Apr 2026']).format).toBe('D MMM YYYY')
  })
})

describe('previewMapping', () => {
  const profile: ImportProfile = {
    id: 'p', bank: 'B', dateFormat: 'DD/MM/YYYY', dateColumn: 0, descriptionColumn: 1, amountMode: 'single',
    amountColumn: 2, signConvention: 'negativeIsOut', headerRows: 1,
  }
  it('shows date, amount and description for good rows and a numbered reason for bad ones', () => {
    const out = previewMapping([['Date', 'D', 'A'], ['12/03/2026', 'TESCO STORES', '-4.20'], ['nope', 'X', '1']], profile)
    expect(out[0]).toMatchObject({ ok: true, text: '12/03/2026 → 12 Mar 2026, -£4.20, TESCO STORES' })
    expect(out[1].ok).toBe(false)
    expect(out[1].text).toBe('Unreadable date "nope" in row 2')
  })
  it('formats display dates', () => {
    expect(formatDisplayDate('2026-03-05')).toBe('5 Mar 2026')
  })
})

describe('buildPreview', () => {
  const rows = [
    { accountId: 'cur', date: '2026-04-03', amountPence: -2345, description: 'TESCO' },
    { accountId: 'cur', date: '2026-04-03', amountPence: -2345, description: 'TESCO' },
  ]
  it('marks rows already stored as duplicates and keeps repeated identical rows distinct', () => {
    const first = buildPreview([{ name: 'a.csv', rows }], [], accounts)
    expect(first.newRows).toBe(2)
    const stored = [tx({ accountId: 'cur', date: '2026-04-03', amountPence: -2345, description: 'TESCO',
      fingerprint: JSON.stringify(['cur', '2026-04-03', -2345, 'tesco']) + '#0' })]
    const again = buildPreview([{ name: 'a.csv', rows }], stored, accounts)
    expect(again.duplicates).toBe(1)
    expect(again.newRows).toBe(1)
  })
  it('treats rows repeated by a later file in the same drop as duplicates', () => {
    const p = buildPreview([{ name: 'a.csv', rows }, { name: 'b.csv', rows }], [], accounts)
    expect(p.newRows).toBe(2)
    expect(p.duplicates).toBe(2)
  })
  it('marks a new row that pairs with a stored row on another account as a transfer', () => {
    const stored = [tx({ accountId: 'sav', date: '2026-04-04', amountPence: 5000, description: 'FROM CURRENT' })]
    const p = buildPreview(
      [{ name: 'a.csv', rows: [{ accountId: 'cur', date: '2026-04-03', amountPence: -5000, description: 'TO SAVINGS' }] }],
      stored, accounts,
    )
    expect(p.transfers).toBe(1)
    expect(p.rows[0].transfer).toBe(true)
  })
})

describe('flag reconciliation', () => {
  it('flags transfers then refunds, and changedFlagRows lists only differences', () => {
    const a = tx({ accountId: 'cur', amountPence: -5000, description: 'TO SAV' })
    const b = tx({ accountId: 'sav', amountPence: 5000, description: 'FROM CUR' })
    const shop = tx({ amountPence: -1000, description: 'ZARA 12', date: '2026-04-01' })
    const back = tx({ amountPence: 1000, description: 'ZARA 99', date: '2026-04-05' })
    const before = [a, b, shop, back]
    const after = reconcileFlags(before, accounts)
    expect(changedFlagRows(before, after).map((t) => t.id).sort()).toEqual([a.id, b.id, back.id].sort())
    expect(after[3].isRefund).toBe(true)
    expect(after[2].isRefund).toBe(false)
  })

  it('clears the surviving leg after undo, but leaves unrelated manual flags alone', () => {
    const a = tx({ accountId: 'cur', amountPence: -5000, description: 'TO SAV', batchId: 'b1', isTransfer: true })
    const b = tx({ accountId: 'sav', amountPence: 5000, description: 'FROM CUR', batchId: 'b2', isTransfer: true })
    const manual = tx({ amountPence: -777, description: 'ODD', isTransfer: true })
    const changed = reconcileAfterUndo([b, manual], [a], accounts)
    expect(changed.map((t) => t.id)).toEqual([b.id])
    expect(changed[0].isTransfer).toBe(false)
  })

  it('clears a refund flag when its purchase is undone', () => {
    const shop = tx({ amountPence: -1000, description: 'ZARA 12', date: '2026-04-01', batchId: 'b1' })
    const back = tx({ amountPence: 1000, description: 'ZARA 99', date: '2026-04-05', batchId: 'b2', isRefund: true })
    const changed = reconcileAfterUndo([back], [shop], accounts)
    expect(changed).toHaveLength(1)
    expect(changed[0].isRefund).toBe(false)
  })
})

describe('summariseBatches', () => {
  it('counts rows per batch, newest first, with legacy batches last', () => {
    const rows = [
      tx({ batchId: 'old', importedAt: '2026-01-01T10:00:00.000Z', sourceFile: 'old.csv' }),
      tx({ batchId: 'new', importedAt: '2026-02-01T10:00:00.000Z', sourceFile: 'new.csv' }),
      tx({ batchId: 'new', importedAt: '2026-02-01T10:00:00.000Z', sourceFile: 'new.csv' }),
      tx({ batchId: 'legacy' }),
    ]
    const s = summariseBatches(rows, accounts)
    expect(s.map((b) => b.batchId)).toEqual(['new', 'old', 'legacy'])
    expect(s[0]).toMatchObject({ count: 2, fileName: 'new.csv', accountName: 'Current' })
  })
})
