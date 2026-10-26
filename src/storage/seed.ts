import type { BudgetDB } from './db'
import { seedCategories } from '../seed/categories'
import { seedHoldings } from '../seed/holdings'
import { seedPlatforms } from '../seed/platforms'
import { seedSettings } from '../seed/settings'

async function seedIfEmpty<T>(
  table: { count(): Promise<number>; bulkAdd(rows: T[]): Promise<unknown> },
  rows: T[],
): Promise<void> {
  if ((await table.count()) === 0) await table.bulkAdd(rows)
}

/** Idempotent: fills a table only when it is empty, so user edits are never overwritten. */
export async function seedDefaults(db: BudgetDB): Promise<void> {
  await db.transaction('rw', [db.categories, db.holdings, db.platforms, db.settings], async () => {
    await seedIfEmpty(db.categories, seedCategories)
    await seedIfEmpty(db.holdings, seedHoldings)
    await seedIfEmpty(db.platforms, seedPlatforms)
    await seedIfEmpty(db.settings, [seedSettings])
  })
}
