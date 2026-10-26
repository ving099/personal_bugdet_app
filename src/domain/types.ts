/** Money is integer pence everywhere. GBP only. */
export type Pence = number
/** Date as 'YYYY-MM-DD'. */
export type ISODate = string

export type AccountKind = 'current' | 'creditCard' | 'savings' | 'business'
export type Wrapper = 'pension' | 'isa' | 'lisa' | 'gia'
export type Bucket = 'growth' | 'aggressive'

export interface Account {
  id: string
  name: string
  bank: string
  kind: AccountKind
  importProfileId?: string
}

export interface ImportProfile {
  id: string
  bank: string
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'D MMM YYYY'
  /** Column fields are zero-based indexes into a CSV row. */
  dateColumn: number
  descriptionColumn: number
  amountMode: 'single' | 'debitCredit'
  amountColumn?: number
  debitColumn?: number
  creditColumn?: number
  /** Single-amount mode only: which sign marks money going out. */
  signConvention: 'negativeIsOut' | 'positiveIsOut'
  /** Leading rows to skip. */
  headerRows: number
}

export interface Transaction {
  id: string
  accountId: string
  date: ISODate
  amountPence: Pence
  description: string
  categoryId?: string
  fingerprint: string
  batchId: string
  isTransfer: boolean
  isRefund: boolean
  incomeStreamId?: string
  /** Import batch metadata (ISO date-time and file name); absent on rows imported before it was recorded. */
  importedAt?: string
  sourceFile?: string
}

export interface Category {
  id: string
  name: string
  monthlyLimitPence: Pence
  excludedFromSpending: boolean
}

export interface Rule {
  id: string
  matchText: string
  categoryId: string
  source: 'default' | 'learned'
}

export interface IncomeStream {
  id: string
  label: string
  expectedMonthlyNetPence: Pence
}

export interface Debt {
  id: string
  name: string
  kind: 'card' | 'loan' | 'other'
  balancePence: Pence
  creditLimitOrOriginalPence: Pence
  aprPercent: number
  minimumPaymentPence: Pence
  promoAprPercent?: number
  promoEndsOn?: ISODate
}

export interface SavingsPot {
  id: string
  name: string
  balancePence: Pence
  targetPence: Pence
  isEmergencyFund: boolean
}

export interface SinkingFund {
  id: string
  name: string
  yearlyAmountPence: Pence
  /** Month the amount falls due, 1-12. */
  dueMonth: number
}

export interface OpeningHolding {
  id: string
  holdingId: string
  valuePence: Pence
  asOf: ISODate
  wrapper: Wrapper
  platformId: string
}

export interface AllowanceUsed {
  /** e.g. '2026/27' */
  taxYear: string
  wrapper: Wrapper
  usedPence: Pence
}

export interface Settings {
  id: 'main'
  budgetMonthStartDay: number
  aprThresholdPercent: number
  emergencyFundPotId?: string
  bufferPercent: number
  emergencyTopUpSharePercent: number
  wrapperOrder: Wrapper[]
  wrapperShares: Partial<Record<Wrapper, number>>
  /** Annual allowance in pence by tax year, then wrapper. */
  allowances: Record<string, Partial<Record<Wrapper, Pence>>>
  bucketSplit: Record<Bucket, number>
  defaultPlatformByWrapper: Partial<Record<Wrapper, string>>
  /** Salted passcode hash; null when the lock is off. */
  appLock: { salt: string; hash: string } | null
  theme: 'system' | 'light' | 'dark'
  backupLastAt?: ISODate
  /** Lifetime ISA is off until the owner confirms eligibility. Rows written before this field existed read as false. */
  lisaEnabled: boolean
  /** False until the setup wizard is finished or skipped. Rows written before this field existed read as false. */
  onboardingDone: boolean
}

export interface Holding {
  id: string
  bucket: Bucket
  weight: number
  fundType: string
  exampleName: string
  ticker: string
  platforms: string[]
}

export interface Platform {
  id: string
  name: string
  wrappersSupported: Wrapper[]
  notes: string
  lastChecked: ISODate
}

export interface InvestmentLog {
  id: string
  /** 'YYYY-MM' budget month */
  month: string
  /** Tax year the contribution counts against, e.g. '2026/27'. */
  taxYear: string
  wrapper: Wrapper
  holdingId: string
  plannedPence: Pence
  actualPence: Pence
  platformId: string
}
