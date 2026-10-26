import { categorise, learnRule } from '../../../categorise/rules'
import type { Pence, Transaction } from '../../../domain/types'
import { defaultRules } from '../../../seed/categories'
import type { BudgetDB } from '../../../storage/db'
import { isIncomeCredit, similarTransactionIds } from './budgetModel'

/**
 * Gives one transaction a new category. With `applyToSimilar`, also learns a rule for the merchant and moves
 * every stored row with the same merchant, in any month or account. Unchecked, nothing but this row changes
 * and no rule is written. Returns how many other rows moved.
 */
export async function recategorise(
  db: BudgetDB,
  txId: string,
  categoryId: string,
  applyToSimilar: boolean,
): Promise<{ othersChanged: number }> {
  return db.transaction('rw', db.transactions, db.rules, async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) throw new Error('That transaction no longer exists.')
    if (!applyToSimilar) {
      await db.transactions.update(txId, { categoryId })
      return { othersChanged: 0 }
    }
    const rule = learnRule(tx.description, categoryId)
    // A rule that only repeats the built-in answer is not kept, so changing back leaves nothing stale.
    if (categorise(tx.description, defaultRules) === categoryId) await db.rules.delete(rule.id)
    else await db.rules.put(rule)
    const ids = new Set(similarTransactionIds(await db.transactions.toArray(), tx))
    const rows = (await db.transactions.bulkGet([...ids])).filter((t): t is Transaction => t !== undefined)
    const moved = rows.filter((t) => t.categoryId !== categoryId)
    await db.transactions.bulkPut(moved.map((t) => ({ ...t, categoryId })))
    return { othersChanged: moved.filter((t) => t.id !== txId).length }
  })
}

/** Sets a flag by hand. The row is marked `flagsEditedByUser`, so later imports do not re-match its flags. */
export async function setFlag(db: BudgetDB, txId: string, flag: 'isRefund' | 'isTransfer', value: boolean): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    if ((await db.transactions.update(txId, { [flag]: value, flagsEditedByUser: true })) === 0) {
      throw new Error('That transaction no longer exists.')
    }
  })
}

/** Zero clears the limit. */
export async function setLimit(db: BudgetDB, categoryId: string, limitPence: Pence): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    if ((await db.categories.update(categoryId, { monthlyLimitPence: Math.max(0, limitPence) })) === 0) {
      throw new Error('That category no longer exists.')
    }
  })
}

/** Labels one credit with an income stream; with `applyToSimilar`, every matching credit gets it. */
export async function assignStream(
  db: BudgetDB,
  txId: string,
  streamId: string,
  applyToSimilar: boolean,
): Promise<{ changed: number }> {
  return db.transaction('rw', db.transactions, db.incomeStreams, async () => {
    if (!(await db.incomeStreams.get(streamId))) throw new Error('That income stream no longer exists.')
    const tx = await db.transactions.get(txId)
    if (!tx) throw new Error('That transaction no longer exists.')
    const ids = applyToSimilar ? similarTransactionIds(await db.transactions.toArray(), tx, isIncomeCredit) : [txId]
    const rows = (await db.transactions.bulkGet(ids.length > 0 ? ids : [txId])).filter((t): t is Transaction => t !== undefined)
    await db.transactions.bulkPut(rows.map((t) => ({ ...t, incomeStreamId: streamId })))
    return { changed: rows.length }
  })
}

export async function addIncomeStream(db: BudgetDB, label: string, expectedMonthlyNetPence: Pence): Promise<string> {
  const id = globalThis.crypto.randomUUID()
  await db.incomeStreams.add({ id, label: label.trim(), expectedMonthlyNetPence })
  return id
}
