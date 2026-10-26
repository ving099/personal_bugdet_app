import { describe, expect, it } from 'vitest'
import type { Account, Transaction } from '../../src/domain/types'
import {
  CARD_REPAYMENT_PATTERN,
  flagRefunds,
  isSpendingTx,
  markTransfers,
  merchantKey,
  unmatchedCardRepayments,
} from '../../src/import/matching'

const accounts: Account[] = [
  { id: 'cur', name: 'Current', bank: 'Bank A', kind: 'current' },
  { id: 'cur2', name: 'Current 2', bank: 'Bank B', kind: 'current' },
  { id: 'card', name: 'Card', bank: 'Bank C', kind: 'creditCard' },
  { id: 'sav', name: 'Savings', bank: 'Bank A', kind: 'savings' },
  { id: 'biz', name: 'Business', bank: 'Bank D', kind: 'business' },
]

let n = 0
const tx = (accountId: string, date: string, amountPence: number, description = 'X'): Transaction => ({
  id: `t${++n}`,
  accountId,
  date,
  amountPence,
  description,
  fingerprint: `f${n}`,
  batchId: 'b1',
  isTransfer: false,
  isRefund: false,
})

describe('markTransfers', () => {
  it('pairs equal-and-opposite rows across accounts within three days', () => {
    const out = tx('cur', '2026-03-01', -25000, 'PAYMENT TO CARD')
    const inn = tx('card', '2026-03-03', 25000, 'PAYMENT RECEIVED')
    const purchase = tx('card', '2026-03-02', -4000, 'SHOP')
    const res = markTransfers([out, inn, purchase], accounts)
    expect(res.map((t) => t.isTransfer)).toEqual([true, true, false])
    expect(isSpendingTx(res[2], accounts)).toBe(true)
  })

  it('does not mutate input', () => {
    const a = tx('cur', '2026-03-01', -100)
    const b = tx('sav', '2026-03-01', 100)
    const res = markTransfers([a, b], accounts)
    expect(a.isTransfer).toBe(false)
    expect(res[0]).not.toBe(a)
  })

  it('matches at exactly three days but not four', () => {
    const three = markTransfers([tx('cur', '2026-03-01', -500), tx('sav', '2026-03-04', 500)], accounts)
    expect(three.every((t) => t.isTransfer)).toBe(true)
    const four = markTransfers([tx('cur', '2026-03-01', -500), tx('sav', '2026-03-05', 500)], accounts)
    expect(four.some((t) => t.isTransfer)).toBe(false)
  })

  it('does not pair rows within the same account', () => {
    const res = markTransfers([tx('cur', '2026-03-01', -500), tx('cur', '2026-03-01', 500)], accounts)
    expect(res.some((t) => t.isTransfer)).toBe(false)
  })

  it('is one-to-one: one outflow and two inflows pair only once, nearest date wins', () => {
    const out = tx('cur', '2026-03-10', -3000)
    const far = tx('sav', '2026-03-12', 3000)
    const near = tx('cur2', '2026-03-11', 3000)
    const res = markTransfers([out, far, near], accounts)
    expect(res.map((t) => t.isTransfer)).toEqual([true, false, true])
  })

  it('does not pair a candidate more than three days away even when another pair exists', () => {
    const out = tx('cur', '2026-03-01', -3000)
    const near = tx('sav', '2026-03-02', 3000)
    const far = tx('biz', '2026-03-09', 3000)
    expect(markTransfers([out, near, far], accounts).map((t) => t.isTransfer)).toEqual([true, true, false])
  })

  it('breaks ties by array order', () => {
    const out = tx('cur', '2026-03-10', -3000)
    const first = tx('sav', '2026-03-10', 3000)
    const second = tx('biz', '2026-03-10', 3000)
    const res = markTransfers([out, first, second], accounts)
    expect(res.map((t) => t.isTransfer)).toEqual([true, true, false])
  })

  it('keeps rows already flagged and ignores unknown accounts', () => {
    const flagged = { ...tx('cur', '2026-03-01', -700), isTransfer: true }
    const unknown = tx('nope', '2026-03-01', 900)
    const other = tx('cur', '2026-03-01', -900)
    const res = markTransfers([flagged, unknown, other], accounts)
    expect(res[0].isTransfer).toBe(true)
    expect(res[1].isTransfer).toBe(false)
    expect(res[2].isTransfer).toBe(false)
  })
})

describe('markTransfers and business accounts (review I3)', () => {
  it('never pairs a business-account row: money from the business is income on the personal side', () => {
    const bizOut = tx('biz', '2026-09-10', -100000, 'TRANSFER TO PERSONAL')
    const personalIn = tx('cur', '2026-09-10', 100000, 'TRANSFER FROM BIZ LTD')
    const res = markTransfers([bizOut, personalIn], accounts)
    expect(res.map((t) => t.isTransfer)).toEqual([false, false])
    expect(isSpendingTx(res[1], accounts)).toBe(true)
  })

  it('still pairs the personal row with another personal account when one matches', () => {
    const bizOut = tx('biz', '2026-09-10', -100000)
    const curIn = tx('cur', '2026-09-10', 100000)
    const cur2Out = tx('cur2', '2026-09-11', -100000)
    const res = markTransfers([bizOut, curIn, cur2Out], accounts)
    expect(res.map((t) => t.isTransfer)).toEqual([false, true, true])
  })
})

describe('unmatchedCardRepayments', () => {
  it('lists card-like outflows with no card-side inflow, and not matched ones', () => {
    const unmatched = tx('cur', '2026-03-01', -12000, 'BARCLAYCARD DIRECT DEBIT')
    const matchedOut = tx('cur', '2026-03-05', -25000, 'AMEX PAYMENT')
    const matchedIn = tx('card', '2026-03-06', 25000, 'PAYMENT RECEIVED')
    const debit = tx('cur', '2026-03-02', -999, 'CARD PAYMENT TO TESCO')
    const marked = markTransfers([unmatched, matchedOut, matchedIn, debit], accounts)
    expect(unmatchedCardRepayments(marked, accounts).map((t) => t.id)).toEqual([unmatched.id])
    expect(marked[0].isTransfer).toBe(false)
  })

  it('exports a case-insensitive pattern that excludes bare "card payment"', () => {
    expect(CARD_REPAYMENT_PATTERN.test('Capital One')).toBe(true)
    expect(CARD_REPAYMENT_PATTERN.test('CC PAYMENT 123')).toBe(true)
    expect(CARD_REPAYMENT_PATTERN.test('CARD PAYMENT TO SHOP')).toBe(false)
  })

  it('ignores inflows and card-account rows', () => {
    const inflow = tx('cur', '2026-03-01', 5000, 'AMEX REFUND')
    const onCard = tx('card', '2026-03-01', -5000, 'AMEX')
    expect(unmatchedCardRepayments([inflow, onCard], accounts)).toEqual([])
  })
})

describe('isSpendingTx', () => {
  it('counts current and card rows only, not transfers, business, savings or unknown', () => {
    expect(isSpendingTx(tx('cur', '2026-03-01', -1), accounts)).toBe(true)
    expect(isSpendingTx(tx('card', '2026-03-01', -1), accounts)).toBe(true)
    expect(isSpendingTx(tx('biz', '2026-03-01', -1), accounts)).toBe(false)
    expect(isSpendingTx(tx('sav', '2026-03-01', -1), accounts)).toBe(false)
    expect(isSpendingTx(tx('nope', '2026-03-01', -1), accounts)).toBe(false)
    expect(isSpendingTx({ ...tx('cur', '2026-03-01', -1), isTransfer: true }, accounts)).toBe(false)
  })
})

describe('merchantKey', () => {
  it('ignores digits and case', () => {
    expect(merchantKey('TESCO STORES 4412')).toBe(merchantKey('Tesco Stores 9981'))
    expect(merchantKey('TESCO STORES 4412')).toBe('tesco stores')
  })
  it('strips * references and dates', () => {
    expect(merchantKey('AMAZON.CO.UK*2K4 LONDON')).toBe('amazon.co.uk london')
    expect(merchantKey('AMAZON.CO.UK*9Z1 LONDON')).toBe('amazon.co.uk london')
    expect(merchantKey('  PRET   A MANGER 12/03/2026  ')).toBe('pret a manger')
    expect(merchantKey('CARD ****1234 SHELL 05 MAR')).toBe('card shell')
  })
  it('keeps the merchant after a processor star', () => {
    expect(merchantKey('PAYPAL *SPOTIFY')).toBe('paypal spotify')
    expect(merchantKey('SQ *COFFEE SHOP')).toBe('sq coffee shop')
    expect(merchantKey('PAYPAL *SPOTIFY')).not.toBe(merchantKey('PAYPAL *NETFLIX'))
  })
  it('handles edge cases', () => {
    expect(merchantKey('')).toBe('')
    expect(merchantKey('12345 678')).toBe('')
    expect(merchantKey('CAFÉ NÉRO')).toBe('café néro')
  })
})

describe('flagRefunds', () => {
  it('does not flag a PayPal credit for a different merchant, but flags the same merchant', () => {
    const buy = tx('cur', '2026-03-01', -999, 'PAYPAL *SPOTIFY')
    const other = tx('cur', '2026-03-05', 999, 'PAYPAL *NETFLIX')
    const same = tx('cur', '2026-03-06', 999, 'PAYPAL *SPOTIFY')
    expect(flagRefunds([buy, other, same]).map((t) => t.isRefund)).toEqual([false, false, true])
  })

  it('ignores transfer outflows as purchase history', () => {
    const out = { ...tx('cur', '2026-03-01', -5000, 'MOVE'), isTransfer: true }
    const back = tx('cur', '2026-03-02', 5000, 'MOVE')
    expect(flagRefunds([out, back])[1].isRefund).toBe(false)
  })

  it('flags a credit matching an earlier purchase, not a salary credit', () => {
    const buy = tx('cur', '2026-03-01', -2500, 'AMAZON')
    const refund = tx('cur', '2026-03-09', 2500, 'AMAZON')
    const salary = tx('cur', '2026-03-25', 300000, 'ACME LTD SALARY')
    const res = flagRefunds([buy, refund, salary])
    expect(res.map((t) => t.isRefund)).toEqual([false, true, false])
    expect(refund.isRefund).toBe(false)
  })

  it('does not flag a credit that precedes the purchase', () => {
    const refund = tx('cur', '2026-03-01', 2500, 'AMAZON')
    const buy = tx('cur', '2026-03-09', -2500, 'AMAZON')
    expect(flagRefunds([refund, buy]).some((t) => t.isRefund)).toBe(false)
  })

  it('matches across accounts and with noisy references', () => {
    const buy = tx('card', '2026-03-01', -2500, 'AMAZON.CO.UK*2K4 LONDON')
    const refund = tx('cur', '2026-03-01', 900, 'AMAZON.CO.UK*7Q9 LONDON')
    expect(flagRefunds([buy, refund])[1].isRefund).toBe(true)
  })
})
