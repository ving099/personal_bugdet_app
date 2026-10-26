import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { taxYearOfBudgetMonth } from '../../../domain/dates'
import type { ISODate, InvestmentLog, Pence, Wrapper } from '../../../domain/types'
import type { BudgetDB } from '../../../storage/db'
import { useDb } from '../../useDb'
import { ALLOWANCE_WRAPPERS, buildInvestView, type InvestData, type InvestView, type PlanRow } from './investModel'

/** Reads everything the investing engines need. Thin: no figures are worked out here. */
export function useInvestData(): InvestData | undefined {
  const db = useDb()
  return useLiveQuery(async (): Promise<InvestData | undefined> => {
    const settings = await db.settings.get('main')
    if (!settings) return undefined
    return {
      settings,
      accounts: await db.accounts.toArray(),
      categories: await db.categories.toArray(),
      streams: await db.incomeStreams.toArray(),
      txs: await db.transactions.toArray(),
      debts: await db.debts.toArray(),
      pots: await db.savingsPots.toArray(),
      funds: await db.sinkingFunds.toArray(),
      used: await db.allowancesUsed.toArray(),
      holdings: await db.holdings.toArray(),
      platforms: await db.platforms.toArray(),
      opening: await db.openingHoldings.toArray(),
      log: await db.investmentLog.toArray(),
    }
  }, [db])
}

/** The live plan for the budget month containing `today`. Home, Invest and Debts share it so they agree. */
export function useInvestPlan(today: ISODate): { data: InvestData; view: InvestView } | undefined {
  const data = useInvestData()
  return useMemo(() => (data ? { data, view: buildInvestView(data, today) } : undefined), [data, today])
}

async function addUsed(db: BudgetDB, taxYear: string, wrapper: Wrapper, delta: Pence): Promise<void> {
  if (!ALLOWANCE_WRAPPERS.includes(wrapper) || delta === 0) return
  const row = await db.allowancesUsed.get([taxYear, wrapper])
  const usedPence = Math.max(0, (row?.usedPence ?? 0) + delta)
  await db.allowancesUsed.put({ taxYear, wrapper, usedPence })
}

/**
 * Logs one plan line for `taxYear` and raises that year's allowance used, in one transaction. Logging the same
 * line twice changes nothing: the id is tax year + month + wrapper + fund, and an existing row for the same line
 * (even one stored under an older id) also counts. Returns false when it was already logged.
 */
export async function logPlanLine(
  db: BudgetDB,
  line: { row: PlanRow; month: string; taxYear: string; actualPence: Pence; platformId: string },
): Promise<boolean> {
  const { row, month, taxYear, actualPence, platformId } = line
  return db.transaction('rw', db.investmentLog, db.allowancesUsed, async () => {
    if (await db.investmentLog.get(row.id)) return false
    const same = await db.investmentLog.where('month').equals(month)
      .filter((l) => l.taxYear === taxYear && l.wrapper === row.wrapper && l.holdingId === row.holdingId).first()
    if (same) return false
    await db.investmentLog.add({
      id: row.id, month, taxYear, wrapper: row.wrapper, holdingId: row.holdingId, plannedPence: row.plannedPence, actualPence, platformId,
    })
    await addUsed(db, taxYear, row.wrapper, actualPence)
    return true
  })
}

/** The tax year a stored row counts against (rows restored from old backups may lack it). */
async function rowTaxYear(db: BudgetDB, row: InvestmentLog): Promise<string> {
  if (row.taxYear) return row.taxYear
  const startDay = (await db.settings.get('main'))?.budgetMonthStartDay ?? 1
  return taxYearOfBudgetMonth(row.month, startDay)
}

/** Removes a logged line and takes its amount off ITS OWN tax year's allowance used (never below zero). One transaction. */
export async function unlogPlanLine(db: BudgetDB, id: string): Promise<boolean> {
  return db.transaction('rw', db.investmentLog, db.allowancesUsed, db.settings, async () => {
    const row = await db.investmentLog.get(id)
    if (!row) return false
    await db.investmentLog.delete(id)
    await addUsed(db, await rowTaxYear(db, row), row.wrapper, -row.actualPence)
    return true
  })
}

/** Changes the amount on a logged line; its own tax year's allowance used moves by the difference. One transaction. */
export async function setLoggedAmount(db: BudgetDB, id: string, actualPence: Pence): Promise<void> {
  await db.transaction('rw', db.investmentLog, db.allowancesUsed, db.settings, async () => {
    const row = await db.investmentLog.get(id)
    if (!row) throw new Error('That line is no longer logged.')
    if (row.actualPence === actualPence) return
    await db.investmentLog.update(id, { actualPence })
    await addUsed(db, await rowTaxYear(db, row), row.wrapper, actualPence - row.actualPence)
  })
}

/** Sets the default platform for a wrapper (the same setting as in Settings). */
export async function choosePlatform(db: BudgetDB, wrapper: Wrapper, platformId: string): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const s = await db.settings.get('main')
    if (!s) throw new Error('Settings are missing.')
    await db.settings.update('main', { defaultPlatformByWrapper: { ...s.defaultPlatformByWrapper, [wrapper]: platformId } })
  })
}
