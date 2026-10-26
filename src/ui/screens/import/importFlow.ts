import { formatGBP } from '../../../domain/money'
import type { Account, ImportProfile, ISODate, Transaction } from '../../../domain/types'
import { assignFingerprints } from '../../../import/fingerprint'
import { flagRefunds, markTransfers, merchantKey } from '../../../import/matching'
import { applyProfile, ProfileError, type ParsedTx } from '../../../import/profile'

export type DateFormat = ImportProfile['dateFormat']

/** Every layout the profile type can read, in the order they are offered. */
export const DATE_FORMATS: readonly { value: DateFormat; label: string }[] = [
  { value: 'DD/MM/YYYY', label: 'Day/month/year, like 31/12/2026' },
  { value: 'MM/DD/YYYY', label: 'Month/day/year, like 12/31/2026' },
  { value: 'YYYY-MM-DD', label: 'Year-month-day, like 2026-12-31' },
  { value: 'D MMM YYYY', label: 'Day, month name, year, like 31 Dec 2026' },
]

export const PREVIEW_ROW_LIMIT = 100
export const SAMPLE_ROWS = 5

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-03-12' as '12 Mar 2026'. Anything that is not an ISO date is returned unchanged. */
export function formatDisplayDate(iso: ISODate): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m || +m[2] < 1 || +m[2] > 12) return iso
  return `${+m[3]} ${MONTH_NAMES[+m[2] - 1]} ${m[1]}`
}

/**
 * Works out the date layout from the values in the date column. A slash date with a first part above 12 can only be
 * day/month; a second part above 12 can only be month/day. When every value is 12 or below the file does not say,
 * so the UK layout is assumed and `ambiguous` is true.
 */
export function sniffDateFormat(values: readonly string[]): { format: DateFormat; ambiguous: boolean } {
  const cells = values.map((v) => v.trim()).filter((v) => v !== '')
  if (cells.length > 0 && cells.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) {
    return { format: 'YYYY-MM-DD', ambiguous: false }
  }
  if (cells.length > 0 && cells.every((v) => /^\d{1,2} [A-Za-z]{3} \d{4}$/.test(v))) {
    return { format: 'D MMM YYYY', ambiguous: false }
  }
  let dayFirst = false
  let monthFirst = false
  for (const v of cells) {
    const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}$/.exec(v)
    if (!m) continue
    if (+m[1] > 12) dayFirst = true
    if (+m[2] > 12) monthFirst = true
  }
  if (monthFirst && !dayFirst) return { format: 'MM/DD/YYYY', ambiguous: false }
  if (dayFirst && !monthFirst) return { format: 'DD/MM/YYYY', ambiguous: false }
  return { format: 'DD/MM/YYYY', ambiguous: true }
}

/** Plain-words column name for a picker: the header text when there is one, else a sample value. */
export function columnLabel(sampleRow: readonly string[] | undefined, index: number): string {
  const cell = (sampleRow?.[index] ?? '').trim()
  const short = cell.length > 28 ? `${cell.slice(0, 27)}…` : cell
  return short ? `Column ${index + 1}: ${short}` : `Column ${index + 1}`
}

export interface SampleResult {
  /** The date as written in the file. */
  raw: string
  ok: boolean
  /** '12/03/2026 → 12 Mar 2026, -£4.20, TESCO STORES' or the reason the row cannot be read. */
  text: string
}

/** Applies a profile to the first few data rows, one by one, so a wrong mapping shows before anything is saved. */
export function previewMapping(rows: string[][], profile: ImportProfile, limit = SAMPLE_ROWS): SampleResult[] {
  const out: SampleResult[] = []
  const data = rows.slice(profile.headerRows, profile.headerRows + limit)
  data.forEach((row, i) => {
    const raw = (row[profile.dateColumn] ?? '').trim()
    try {
      const [tx] = applyProfile([row], { ...profile, headerRows: 0 }, 'preview')
      out.push({ raw, ok: true, text: `${raw} → ${formatDisplayDate(tx.date)}, ${formatGBP(tx.amountPence)}, ${tx.description}` })
    } catch (e) {
      const why = e instanceof ProfileError ? e.message.replace(/\brow 1\b/, `row ${i + 1}`) : `Unreadable row ${i + 1}`
      out.push({ raw, ok: false, text: why })
    }
  })
  return out
}

export interface PreviewRow {
  key: string
  file: string
  date: ISODate
  description: string
  amountPence: number
  duplicate: boolean
  transfer: boolean
  refund: boolean
}

export interface PreviewFile {
  name: string
  rows: ParsedTx[]
}

export interface Preview {
  rows: PreviewRow[]
  newRows: number
  duplicates: number
  transfers: number
  refunds: number
}

/**
 * What an import would do, without writing anything. Fingerprints are assigned per file (as `importBatch` does) and
 * compared with the stored ones, and with earlier files in the same drop. New rows are then matched against stored
 * transactions to show which look like transfers or refunds.
 */
export function buildPreview(files: PreviewFile[], existing: Transaction[], accounts: Account[]): Preview {
  const seen = new Set(existing.map((t) => t.fingerprint))
  const rows: PreviewRow[] = []
  const fresh: Transaction[] = []
  files.forEach((file, f) => {
    assignFingerprints(file.rows).forEach((r, i) => {
      const key = `${f}:${i}`
      const duplicate = seen.has(r.fingerprint)
      rows.push({
        key, file: file.name, date: r.date, description: r.description, amountPence: r.amountPence,
        duplicate, transfer: false, refund: false,
      })
      if (duplicate) return
      seen.add(r.fingerprint)
      fresh.push({
        id: `preview:${key}`, accountId: r.accountId, date: r.date, amountPence: r.amountPence,
        description: r.description, fingerprint: r.fingerprint, batchId: 'preview', isTransfer: false, isRefund: false,
      })
    })
  })
  const flagged = new Map(reconcileFlags([...existing, ...fresh], accounts).map((t) => [t.id, t]))
  for (const row of rows) {
    const t = flagged.get(`preview:${row.key}`)
    if (!t) continue
    row.transfer = t.isTransfer
    row.refund = t.isRefund
  }
  const duplicates = rows.filter((r) => r.duplicate).length
  return {
    rows,
    newRows: rows.length - duplicates,
    duplicates,
    transfers: rows.filter((r) => r.transfer).length,
    refunds: rows.filter((r) => r.refund).length,
  }
}

/** Transfers first, then refunds: refund matching skips transfers, so the order matters. */
export function reconcileFlags(txs: Transaction[], accounts: Account[]): Transaction[] {
  return flagRefunds(markTransfers(txs, accounts))
}

/** Rows of `after` whose flags differ from the same position in `before` (both lists in the same order). */
export function changedFlagRows(before: Transaction[], after: Transaction[]): Transaction[] {
  return after.filter((t, i) => t.isTransfer !== before[i].isTransfer || t.isRefund !== before[i].isRefund)
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/**
 * Flag changes after a batch was removed. Rows whose transfer partner or refund source was in the removed batch lose
 * their flags and are matched again against what is left; everything else keeps its flags, so a flag the owner flipped
 * by hand on an unrelated row is not touched. Returns only the rows that changed.
 */
export function reconcileAfterUndo(remaining: Transaction[], removed: Transaction[], accounts: Account[]): Transaction[] {
  const dependsOnRemoved = (t: Transaction): boolean =>
    (t.isTransfer &&
      removed.some(
        (r) =>
          r.amountPence === -t.amountPence && r.accountId !== t.accountId &&
          Math.abs(dayNumber(r.date) - dayNumber(t.date)) <= 3,
      )) ||
    (t.isRefund && removed.some((r) => r.amountPence < 0 && merchantKey(r.description) === merchantKey(t.description)))
  const base = remaining.map((t) => (dependsOnRemoved(t) ? { ...t, isTransfer: false, isRefund: false } : t))
  return changedFlagRows(remaining, reconcileFlags(base, accounts))
}

export interface BatchSummary {
  batchId: string
  accountId: string
  accountName: string
  fileName?: string
  importedAt?: string
  count: number
}

/** One entry per batch, newest first. Rows from before batch details were recorded sort last. */
export function summariseBatches(txs: Transaction[], accounts: Account[]): BatchSummary[] {
  const names = new Map(accounts.map((a) => [a.id, a.name]))
  const byBatch = new Map<string, BatchSummary>()
  for (const t of txs) {
    const found = byBatch.get(t.batchId)
    if (found) {
      found.count += 1
      continue
    }
    byBatch.set(t.batchId, {
      batchId: t.batchId,
      accountId: t.accountId,
      accountName: names.get(t.accountId) ?? 'Unknown account',
      ...(t.sourceFile !== undefined ? { fileName: t.sourceFile } : {}),
      ...(t.importedAt !== undefined ? { importedAt: t.importedAt } : {}),
      count: 1,
    })
  }
  return [...byBatch.values()].sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** '3 new, 1 already imported, 2 look like transfers'. */
export function summaryLine(p: Preview): string {
  const parts = [`${p.newRows} new`, `${p.duplicates} already imported`]
  if (p.transfers > 0) parts.push(p.transfers === 1 ? '1 looks like a transfer' : `${p.transfers} look like transfers`)
  if (p.refunds > 0) parts.push(p.refunds === 1 ? '1 looks like a refund' : `${p.refunds} look like refunds`)
  return parts.join(', ')
}

export function batchLabel(b: BatchSummary): string {
  return b.fileName ?? 'Earlier import'
}

/** Reads every file with one profile. A bad row stops at its file and the message names it. */
export function readAll(
  files: { name: string; rows: string[][] }[],
  profile: ImportProfile,
  accountId: string,
): { files: PreviewFile[] } | { error: string } {
  const out: PreviewFile[] = []
  for (const f of files) {
    try {
      out.push({ name: f.name, rows: applyProfile(f.rows, profile, accountId) })
    } catch (e) {
      const why = e instanceof ProfileError ? e.message : 'The saved mapping could not read it'
      return { error: `${f.name}: ${why}. Check the mapping below.` }
    }
  }
  return { files: out }
}
