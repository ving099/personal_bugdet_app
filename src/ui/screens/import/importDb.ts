import type { Rule } from '../../../domain/types'
import { importBatch, undoBatch } from '../../../import/batch'
import { categorise } from '../../../categorise/rules'
import { defaultRules } from '../../../seed/categories'
import type { BudgetDB } from '../../../storage/db'
import { changedFlagRows, reconcileAfterUndo, reconcileFlags, type PreviewFile } from './importFlow'

export interface FileResult {
  fileName: string
  batchId: string
  added: number
  skipped: number
}

/** Persists only the rows whose transfer or refund flag changed, in one transaction. Returns how many were written. */
export async function reconcileStoredFlags(db: BudgetDB): Promise<number> {
  return db.transaction('rw', db.transactions, db.accounts, async () => {
    const [txs, accounts] = await Promise.all([db.transactions.toArray(), db.accounts.toArray()])
    const changed = changedFlagRows(txs, reconcileFlags(txs, accounts))
    if (changed.length > 0) await db.transactions.bulkPut(changed)
    return changed.length
  })
}

/**
 * Imports each file as its own batch, in order, categorising new rows with default rules and learned rules.
 * A failure stops at that file: earlier files stay imported (each batch is atomic) and are reported in `results`.
 */
export async function importFiles(
  db: BudgetDB,
  files: PreviewFile[],
  now: number = Date.now(),
): Promise<{ results: FileResult[]; failed?: { fileName: string } }> {
  const learned: Rule[] = await db.rules.filter((r) => r.source === 'learned').toArray()
  const rules = [...defaultRules, ...learned]
  const results: FileResult[] = []
  try {
    for (const [i, file] of files.entries()) {
      const rows = file.rows.map((r) => {
        const categoryId = categorise(r.description, rules)
        return categoryId === undefined ? r : { ...r, categoryId }
      })
      const out = await importBatch(db, rows, { fileName: file.name, importedAt: new Date(now + i).toISOString() })
      results.push({ fileName: file.name, ...out })
    }
  } catch {
    await reconcileStoredFlags(db).catch(() => 0)
    return { results, failed: { fileName: files[results.length]?.name ?? 'the file' } }
  }
  await reconcileStoredFlags(db)
  return { results }
}

/** Removes one batch, then clears flags that depended on it. Both happen in one transaction. */
export async function undoImport(db: BudgetDB, batchId: string): Promise<number> {
  return db.transaction('rw', db.transactions, db.accounts, async () => {
    const removed = await db.transactions.where('batchId').equals(batchId).toArray()
    await undoBatch(db, batchId)
    const [remaining, accounts] = await Promise.all([db.transactions.toArray(), db.accounts.toArray()])
    const changed = reconcileAfterUndo(remaining, removed, accounts)
    if (changed.length > 0) await db.transactions.bulkPut(changed)
    return removed.length
  })
}
