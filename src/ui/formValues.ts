import { MoneyParseError, toPence } from '../domain/money'
import type { Pence } from '../domain/types'

export const MONEY_ERROR = 'Enter an amount like 1,250.00'

export type MoneyResult = { ok: true; pence: Pence } | { ok: false }

/** Parses what the user typed ('1,234.56', '£1234'). Never throws. Blank is not valid here; callers decide. */
export function parseMoney(raw: string): MoneyResult {
  try {
    return { ok: true, pence: toPence(raw) }
  } catch (e) {
    if (e instanceof MoneyParseError || e instanceof RangeError) return { ok: false }
    return { ok: false }
  }
}

/** Plain decimal numbers only: '7', '7.5', '-1'. Rejects blank, '1e3', '0x10', 'abc'. */
export function parseNumber(raw: string): number | undefined {
  const s = raw.trim()
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** Today as a local 'YYYY-MM-DD'. */
export function todayISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function penceToInput(p: Pence): string {
  return p === 0 ? '' : (p / 100).toFixed(2)
}

export function moneyFieldError(value: string, required: boolean): string | undefined {
  if (value.trim() === '') return required ? MONEY_ERROR : undefined
  return parseMoney(value).ok ? undefined : MONEY_ERROR
}
