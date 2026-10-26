import { MoneyParseError, toPence } from '../domain/money'
import type { ImportProfile, ISODate, Pence } from '../domain/types'

export type ParsedTx = { accountId: string; date: ISODate; amountPence: Pence; description: string }

export class ProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileError'
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function iso(y: number, m: number, d: number): ISODate | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseDate(raw: string, format: ImportProfile['dateFormat']): ISODate | null {
  const s = raw.trim()
  let m: RegExpExecArray | null
  switch (format) {
    case 'DD/MM/YYYY':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
      return m ? iso(+m[3], +m[2], +m[1]) : null
    case 'MM/DD/YYYY':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
      return m ? iso(+m[3], +m[1], +m[2]) : null
    case 'YYYY-MM-DD':
      m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
      return m ? iso(+m[1], +m[2], +m[3]) : null
    case 'D MMM YYYY': {
      m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(s)
      const mon = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1
      return m && mon >= 0 ? iso(+m[3], mon + 1, +m[1]) : null
    }
  }
}

export function applyProfile(rows: string[][], profile: ImportProfile, accountId: string): ParsedTx[] {
  return rows.slice(profile.headerRows).map((row, i) => {
    const n = i + 1
    const date = parseDate(row[profile.dateColumn] ?? '', profile.dateFormat)
    if (!date) throw new ProfileError(`Unreadable date "${row[profile.dateColumn] ?? ''}" in row ${n}`)
    let amountPence: Pence
    const cell = (col: number | undefined, label: string): string | undefined => {
      if (col === undefined || col < 0) throw new ProfileError(`No ${label} column set in profile (row ${n})`)
      const t = (row[col] ?? '').trim()
      return t === '' ? undefined : t
    }
    try {
      if (profile.amountMode === 'single') {
        const raw = cell(profile.amountColumn, 'amount')
        if (raw === undefined) throw new ProfileError(`Missing amount in row ${n}`)
        const v = toPence(raw)
        amountPence = profile.signConvention === 'positiveIsOut' ? -v : v
      } else {
        const debit = cell(profile.debitColumn, 'debit')
        const credit = cell(profile.creditColumn, 'credit')
        if (debit === undefined && credit === undefined) throw new ProfileError(`Missing debit and credit amounts in row ${n}`)
        amountPence = (credit === undefined ? 0 : toPence(credit)) - (debit === undefined ? 0 : toPence(debit))
      }
    } catch (e) {
      if (e instanceof MoneyParseError) throw new ProfileError(`Unreadable amount in row ${n}: ${e.message}`)
      throw e
    }
    return { accountId, date, amountPence: amountPence === 0 ? 0 : amountPence, description: (row[profile.descriptionColumn] ?? '').trim() }
  })
}

/** Header-name heuristics; returns whatever it can find. */
export function guessProfile(rows: string[][]): Partial<ImportProfile> {
  const header = (rows[0] ?? []).map(h => h.trim().toLowerCase())
  const find = (re: RegExp, skip: number[] = []) => {
    const i = header.findIndex((h, idx) => re.test(h) && !skip.includes(idx))
    return i >= 0 ? i : undefined
  }
  const guess: Partial<ImportProfile> = { headerRows: 1 }
  const dateColumn = find(/date/)
  const descriptionColumn = find(/descr|merchant|payee|details|narrative|reference/)
  if (dateColumn !== undefined) guess.dateColumn = dateColumn
  if (descriptionColumn !== undefined) guess.descriptionColumn = descriptionColumn
  const debitColumn = find(/debit|paid out|money out/)
  const creditColumn = find(/credit|paid in|money in/)
  if (debitColumn !== undefined && creditColumn !== undefined) {
    guess.amountMode = 'debitCredit'
    guess.debitColumn = debitColumn
    guess.creditColumn = creditColumn
  } else {
    const amountColumn = find(/amount|value/)
    if (amountColumn !== undefined) {
      guess.amountMode = 'single'
      guess.amountColumn = amountColumn
    }
  }
  return guess
}
