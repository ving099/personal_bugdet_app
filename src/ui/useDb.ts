import { createContext, useContext } from 'react'
import type { BudgetDB } from '../storage/db'

export const DbContext = createContext<BudgetDB | null>(null)

/** The open database. Only valid below a `DbProvider` (App provides one once storage is seeded). */
export function useDb(): BudgetDB {
  const db = useContext(DbContext)
  if (!db) throw new Error('useDb() must be used inside a <DbProvider>')
  return db
}
