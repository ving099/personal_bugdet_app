import type { Debt, SavingsPot, SinkingFund } from '../../../domain/types'
import { seedSettings } from '../../../seed/settings'
import type { BudgetDB } from '../../../storage/db'

/** Records which pot is the emergency fund. A missing settings row is created from the defaults, never skipped. */
async function setEmergencyFund(db: BudgetDB, potId: string | undefined): Promise<void> {
  if (await db.settings.get('main')) await db.settings.update('main', { emergencyFundPotId: potId })
  else if (potId !== undefined) await db.settings.put({ ...seedSettings, emergencyFundPotId: potId })
}

export const saveDebt = (db: BudgetDB, debt: Debt) => db.debts.put(debt)
export const deleteDebt = (db: BudgetDB, id: string) => db.debts.delete(id)
export const saveSinkingFund = (db: BudgetDB, fund: SinkingFund) => db.sinkingFunds.put(fund)
export const deleteSinkingFund = (db: BudgetDB, id: string) => db.sinkingFunds.delete(id)

/**
 * Saves a pot. At most one pot is the emergency fund: flagging this one clears the flag elsewhere and records it
 * in settings; unflagging the current one clears the setting. One transaction.
 */
export async function savePot(db: BudgetDB, pot: SavingsPot): Promise<void> {
  await db.transaction('rw', db.savingsPots, db.settings, async () => {
    const settings = await db.settings.get('main')
    if (pot.isEmergencyFund) {
      const others = (await db.savingsPots.toArray()).filter((p) => p.id !== pot.id && p.isEmergencyFund)
      await db.savingsPots.bulkPut(others.map((p) => ({ ...p, isEmergencyFund: false })))
      await setEmergencyFund(db, pot.id)
    } else if (settings?.emergencyFundPotId === pot.id) {
      await setEmergencyFund(db, undefined)
    }
    await db.savingsPots.put(pot)
  })
}

export async function deletePot(db: BudgetDB, id: string): Promise<void> {
  await db.transaction('rw', db.savingsPots, db.settings, async () => {
    if ((await db.settings.get('main'))?.emergencyFundPotId === id) {
      await setEmergencyFund(db, undefined)
    }
    await db.savingsPots.delete(id)
  })
}
