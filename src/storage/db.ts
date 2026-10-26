import Dexie, { type EntityTable } from 'dexie'
import type {
  Account, AllowanceUsed, Category, Debt, Holding, ImportProfile, IncomeStream,
  InvestmentLog, OpeningHolding, Platform, Rule, SavingsPot, Settings, SinkingFund, Transaction,
} from '../domain/types'

export class BudgetDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  importProfiles!: EntityTable<ImportProfile, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  rules!: EntityTable<Rule, 'id'>
  incomeStreams!: EntityTable<IncomeStream, 'id'>
  debts!: EntityTable<Debt, 'id'>
  savingsPots!: EntityTable<SavingsPot, 'id'>
  sinkingFunds!: EntityTable<SinkingFund, 'id'>
  openingHoldings!: EntityTable<OpeningHolding, 'id'>
  allowancesUsed!: Dexie.Table<AllowanceUsed, [string, string]>
  settings!: EntityTable<Settings, 'id'>
  holdings!: EntityTable<Holding, 'id'>
  platforms!: EntityTable<Platform, 'id'>
  investmentLog!: EntityTable<InvestmentLog, 'id'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      accounts: 'id',
      importProfiles: 'id',
      transactions: 'id, [accountId+date], fingerprint, batchId',
      categories: 'id, name',
      rules: 'id',
      incomeStreams: 'id',
      debts: 'id',
      savingsPots: 'id',
      sinkingFunds: 'id',
      openingHoldings: 'id',
      allowancesUsed: '[taxYear+wrapper]',
      settings: 'id',
      holdings: 'id',
      platforms: 'id',
      investmentLog: 'id, month',
    })
  }
}

export function openDb(name = 'budget'): BudgetDB {
  return new BudgetDB(name)
}

export async function deleteAllData(db: BudgetDB): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })
}
