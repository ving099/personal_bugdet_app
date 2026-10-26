import Dexie, { type EntityTable } from 'dexie'
import { taxYearOfBudgetMonth } from '../domain/dates'
import { withHandFiledTransferMark } from '../categorise/rules'
import { NON_SPENDING_CATEGORY_IDS, TRANSFERS_CATEGORY_ID } from '../seed/categories'
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
    // v2: log rows carry the tax year they count against. Older rows get the tax year their budget month starts in.
    this.version(2).stores({}).upgrade(async (tx) => {
      const settings = await tx.table<Settings, string>('settings').get('main')
      const startDay = settings?.budgetMonthStartDay ?? 1
      await tx.table<InvestmentLog, string>('investmentLog').toCollection().modify((row) => {
        if (!row.taxYear) row.taxYear = taxYearOfBudgetMonth(row.month, startDay)
      })
    })
    // v3: Debt payments, Savings and investing and Income are not spending (see NON_SPENDING_CATEGORY_IDS).
    // Only the flag changes; limits and names the owner edited are kept.
    this.version(3).stores({}).upgrade(async (tx) => {
      await tx.table<Category, string>('categories').where('id').anyOf([...NON_SPENDING_CATEGORY_IDS]).modify((row) => {
        row.excludedFromSpending = true
      })
    })
    // v4: Transfers credits count as income unless the owner filed them there (categoryEditedByUser). Rows stored
    // before the marker existed get it when the owner must have filed them by hand (see withHandFiledTransferMark).
    this.version(4).stores({}).upgrade(async (tx) => {
      const learned = await tx.table<Rule, string>('rules').filter((r) => r.source === 'learned').toArray()
      await tx.table<Transaction, string>('transactions').filter((t) => t.categoryId === TRANSFERS_CATEGORY_ID).modify((row) => {
        if (withHandFiledTransferMark(row, learned) !== row) row.categoryEditedByUser = true
      })
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
