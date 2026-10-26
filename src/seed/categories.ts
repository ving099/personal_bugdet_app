import type { Category, Rule } from '../domain/types'

const NAMES = [
  'Groceries and food', 'Eating out', 'Direct debits and bills', 'Housing', 'Transport',
  'Clothes', 'Subscriptions', 'Health', 'Entertainment', 'Family and kids', 'Gifts', 'Travel',
  'Cash', 'Miscellaneous', 'Fees and interest', 'Debt payments', 'Savings and investing',
  'Income', 'Transfers',
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The seeded Income category: its credits are pay, so they count as income even though it is not spending. */
export const INCOME_CATEGORY_ID = 'income'

/**
 * Seed categories that are not spending. Loan and card payments are already in the debt minimums, money sent to a
 * platform is investing, and income and transfers are not outgoings, so counting any of them as spending would
 * double-subtract them from what you can invest.
 */
export const NON_SPENDING_CATEGORY_IDS: readonly string[] = ['debt-payments', 'savings-and-investing', INCOME_CATEGORY_ID, 'transfers']

/** The category with the excluded flag set when it is one of the non-spending seed categories. Other fields kept. */
export function withNonSpendingFlag<T extends Pick<Category, 'id' | 'excludedFromSpending'>>(c: T): T {
  return NON_SPENDING_CATEGORY_IDS.includes(c.id) && !c.excludedFromSpending ? { ...c, excludedFromSpending: true } : c
}

export const seedCategories: Category[] = NAMES.map((name) => ({
  id: slug(name),
  name,
  monthlyLimitPence: 0,
  excludedFromSpending: NON_SPENDING_CATEGORY_IDS.includes(slug(name)),
}))

const RULE_SOURCES: Record<string, string[]> = {
  'groceries-and-food': ['tesco', 'sainsbury', 'asda', 'morrisons', 'aldi', 'lidl', 'waitrose', 'co-op', 'ocado', 'iceland', 'marks & spencer food', 'one stop'],
  'eating-out': ['mcdonald', 'greggs', 'pret a manger', 'nando', 'kfc', 'burger king', 'subway', 'domino', 'pizza hut', 'just eat', 'deliveroo', 'uber eats', 'coffee', 'cafe', 'restaurant'],
  'direct-debits-and-bills': ['council tax', 'british gas', 'octopus energy', 'thames water', 'anglian water', 'tv licence', 'virgin media', 'bt group', 'sky digital', 'vodafone', 'insurance', 'broadband'],
  housing: ['mortgage', 'letting'],
  transport: ['tfl', 'trainline', 'national rail', 'c2c', 'greater anglia', 'uber', 'shell fuel', 'esso ', 'texaco', 'parking', 'dvla'],
  clothes: ['primark', 'next retail', 'h&m', 'zara', 'tk maxx', 'uniqlo'],
  subscriptions: ['netflix', 'spotify', 'disney plus', 'amazon prime', 'apple.com/bill', 'youtube premium', 'now tv'],
  health: ['boots', 'superdrug', 'pharmacy', 'dentist', 'optician', 'specsavers'],
  entertainment: ['cinema', 'odeon', 'steam', 'playstation', 'xbox', 'ticketmaster'],
  'family-and-kids': ['mothercare', 'nursery'],
  gifts: ['funky pigeon', 'moonpig', 'hallmark'],
  travel: ['ryanair', 'easyjet', 'british airways', 'booking.com', 'airbnb', 'trip.com'],
  cash: ['atm withdrawal', 'cash machine', 'cash withdrawal'],
  'fees-and-interest': ['overdraft fee', 'interest charged', 'monthly fee', 'account fee'],
  'debt-payments': ['loan repayment', 'klarna', 'clearpay'],
  'savings-and-investing': ['vanguard', 'trading 212', 'freetrade', 'hargreaves lansdown', 'nutmeg', 'moneybox'],
  income: ['salary', 'wages', 'paystream', 'hmrc refund', 'child benefit'],
  transfers: ['transfer to', 'transfer from', 'standing order to savings'],
}

/** Default keyword rules for common UK merchants and bill words (lower-case matchText). */
export const defaultRules: Rule[] = Object.entries(RULE_SOURCES).flatMap(([categoryId, words]) =>
  words.map((matchText): Rule => ({ id: `default:${matchText}`, matchText, categoryId, source: 'default' })),
)
