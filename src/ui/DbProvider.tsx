import type { ReactNode } from 'react'
import type { BudgetDB } from '../storage/db'
import { DbContext } from './useDb'

export function DbProvider({ db, children }: { db: BudgetDB; children: ReactNode }) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}
