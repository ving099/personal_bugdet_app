import type { BudgetDB } from '../storage/db'
import type { Transaction } from '../domain/types'
import { assignFingerprints } from './fingerprint'
import type { ParsedTx } from './profile'

export type ImportRow = ParsedTx & { categoryId?: string }

function isRealIsoDate(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const dt = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s
}

function validate(t: ImportRow, row: number): void {
  if (typeof t.accountId !== 'string' || t.accountId === '') throw new Error(`Import row ${row}: accountId is empty`)
  if (!isRealIsoDate(t.date)) throw new Error(`Import row ${row}: invalid date "${String(t.date)}"`)
  if (!Number.isSafeInteger(t.amountPence)) throw new Error(`Import row ${row}: amount must be an integer number of pence`)
}

export async function importBatch(
  db: BudgetDB,
  txs: ImportRow[],
): Promise<{ batchId: string; added: number; skipped: number }> {
  const batchId = crypto.randomUUID()
  return db.transaction('rw', db.transactions, async () => {
    txs.forEach((t, i) => validate(t, i + 1))
    const rows = assignFingerprints(txs)
    const stored = await db.transactions.where('fingerprint').anyOf(rows.map((r) => r.fingerprint)).toArray()
    const existing = new Set(stored.map((r) => r.fingerprint))
    const fresh: Transaction[] = rows
      .filter((r) => !existing.has(r.fingerprint))
      .map((r) => ({
        id: crypto.randomUUID(),
        accountId: r.accountId,
        date: r.date,
        amountPence: r.amountPence,
        description: r.description,
        ...(r.categoryId !== undefined ? { categoryId: r.categoryId } : {}),
        fingerprint: r.fingerprint,
        batchId,
        isTransfer: false,
        isRefund: false,
      }))
    await db.transactions.bulkAdd(fresh)
    return { batchId, added: fresh.length, skipped: rows.length - fresh.length }
  })
}

export async function undoBatch(db: BudgetDB, batchId: string): Promise<number> {
  return db.transactions.where('batchId').equals(batchId).delete()
}
