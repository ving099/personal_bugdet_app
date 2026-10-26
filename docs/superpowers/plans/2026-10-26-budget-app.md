# Personal Budget & Investing App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP of a private, on-device personal budgeting PWA that imports bank CSVs and produces a concrete monthly investing plan (70% growth / 30% aggressive) plus month-end spreadsheets.

**Architecture:** Pure-function engines (`import`, `categorise`, `budget`, `debt`, `invest`, `export`, `backup`) over a Dexie/IndexedDB store, with a React UI that holds no business logic. Static files only; no server, no account.

**Tech Stack:** TypeScript, React, Vite, vite-plugin-pwa, Dexie + dexie-react-hooks, PapaParse, ExcelJS, Web Crypto, Vitest, fake-indexeddb, React Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-26-budget-app-design.md`

## Global Constraints

- Money is integer pence everywhere (`type Pence = number`); GBP only; dates are ISO strings `YYYY-MM-DD`.
- No server, no bank linking, CSV statements only (no PDF/OFX/QIF in v1); no tax or NI modelling.
- Engines are pure functions with no UI or database imports (except `storage`, `import` batch functions, `backup` restore).
- Defaults: debt APR threshold 7%; buffer 10% of income; bucket split 70/30; pension share of investable 25%; budget month start day 1; backup nudge after 30 days.
- 2026/27 allowances (6 April 2026 to 5 April 2027): ISA £20,000; Lifetime ISA £4,000 (inside the ISA allowance); pension £60,000. LISA step off by default.
- Wrapper default order: pension, Stocks & Shares ISA, Lifetime ISA, GIA.
- Transfers match when amounts are equal and opposite across two of the user's accounts within three days.
- Plan-level decisions the spec leaves open: emergency top-up each month = min(remaining gap to target, `emergencyTopUpSharePercent` of the month's pre-emergency surplus), default 30%; income transactions link to a stream through `Transaction.incomeStreamId`.
- Single user; every UI string is plain English; one line on the Invest tab: "Starting rules, not personal advice. Check each fund's key information document and your platform's availability before buying."

## Review Focus

Each line below has a test in the named task.

1. CSV quirks: UTF-8 BOM, CRLF, quoted commas in descriptions, `£` and thousands separators (`"1,234.56"`), parenthesised negatives, blank trailing lines (Task 3).
2. Date ambiguity: `03/04/2026` read as DD/MM or MM/DD only per the profile's explicit format; 5 and 6 April tax-year boundary; custom month start day on the boundary date (Tasks 1, 3).
3. No data, no income, negative surplus, or under three months of history: engines return an explicit "cannot compute" or reason, never `NaN` or `£0` presented as a plan (Tasks 7, 9).
4. Pence rounding: splitting £100.01 by 70/30 and across three funds sums exactly to the input (Tasks 1, 11).
5. Idempotent import: re-importing the same file adds nothing; two genuinely identical same-day purchases are both kept; overlapping statements add only new rows (Task 4).

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html, public/icon.svg, scripts/make-icons.mjs
src/domain/      money.ts, dates.ts, types.ts
src/seed/        categories.ts, holdings.ts, platforms.ts, settings.ts   (editable seed data)
src/storage/     db.ts, seed.ts
src/import/      csv.ts, profile.ts, fingerprint.ts, batch.ts, matching.ts
src/categorise/  rules.ts
src/budget/      months.ts, summary.ts
src/debt/        debt.ts
src/invest/      investable.ts, wrappers.ts, split.ts, drift.ts, plan.ts
src/export/      workbook.ts
src/backup/      crypto.ts, snapshot.ts, lock.ts
src/ui/          App.tsx, theme.css, components/, screens/ (Home, Import, Budget, DebtsSavings, Invest, Settings, Wizard)
tests/           mirrors src/, plus tests/fixtures/*.csv
```

---

### Task 1: Scaffold and domain

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/domain/money.ts`, `src/domain/dates.ts`, `src/domain/types.ts`
- Test: `tests/domain/money.test.ts`, `tests/domain/dates.test.ts`

**Interfaces:**
- Produces (`money.ts`): `toPence(input: string | number): Pence`; `formatGBP(p: Pence): string`; `splitPence(total: Pence, weights: number[]): Pence[]` (largest remainder, ties to lower index, result sums exactly).
- Produces (`dates.ts`): `budgetMonthOf(date: ISODate, startDay: number): string` (`'YYYY-MM'` of the month the period starts in); `budgetMonthRange(month: string, startDay: number): {from: ISODate; to: ISODate}`; `taxYearOf(date: ISODate): string` (`'2026/27'`); `monthsLeftInTaxYear(date: ISODate): number` (current month included).
- Produces (`types.ts`): `Pence`, `ISODate`, `AccountKind = 'current'|'creditCard'|'savings'|'business'`, `Account`, `ImportProfile`, `Transaction` (spec §7 fields plus `incomeStreamId?: string`), `Category`, `Rule`, `IncomeStream`, `Debt`, `SavingsPot`, `SinkingFund`, `OpeningHolding`, `AllowanceUsed`, `Settings` (spec §7 plus `emergencyTopUpSharePercent: number`), `Holding`, `Platform`, `InvestmentLog`, `Wrapper = 'pension'|'isa'|'lisa'|'gia'`, `Bucket = 'growth'|'aggressive'`. Field names exactly as the spec's data model.

- [ ] **Step 1: Scaffold.** Run `npm create vite@latest . -- --template react-ts` (continue past the non-empty-folder prompt), then `npm i dexie dexie-react-hooks papaparse exceljs` and `npm i -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event fake-indexeddb vite-plugin-pwa @types/papaparse sharp`. Configure Vitest (`environment: 'jsdom'`, setup file importing `fake-indexeddb/auto` and `@testing-library/jest-dom`). Expected: `npx vitest run` reports "no test files".
- [ ] **Step 2: Write failing tests.** `money.test.ts`: `toPence('1,234.56')` → `123456`; `toPence('£12.5')` → `1250`; `toPence('(45.00)')` → `-4500`; `toPence('-3')` → `-300`; `formatGBP(123456)` → `'£1,234.56'`; `formatGBP(-500)` → `'-£5.00'`; `splitPence(10001,[70,30])` → `[7001,3000]`; `splitPence(10000,[1,1,1])` → `[3334,3333,3333]`; for 100 random totals and weights the parts always sum to the total. `dates.test.ts`: `budgetMonthOf('2026-10-24',25)` → `'2026-09'`; `('2026-10-25',25)` → `'2026-10'`; `('2026-10-24',1)` → `'2026-10'`; `budgetMonthRange('2026-10',25)` → `{from:'2026-10-25',to:'2026-11-24'}`; `taxYearOf('2026-04-05')` → `'2025/26'`; `('2026-04-06')` → `'2026/27'`; `monthsLeftInTaxYear('2026-10-26')` → `6`; `monthsLeftInTaxYear('2027-03-31')` → `1`.
- [ ] **Step 3: Run** `npx vitest run tests/domain` → FAIL (modules missing).
- [ ] **Step 4: Implement** the functions above in `money.ts`, `dates.ts`, `types.ts`.
- [ ] **Step 5: Run** `npx vitest run tests/domain` → PASS.
- [ ] **Step 6: Commit** `feat: scaffold project and domain helpers`.

### Task 2: Storage and seed data

**Files:**
- Create: `src/storage/db.ts`, `src/storage/seed.ts`, `src/seed/categories.ts`, `src/seed/holdings.ts`, `src/seed/platforms.ts`, `src/seed/settings.ts`
- Test: `tests/storage/seed.test.ts`

**Interfaces:**
- Consumes: types from Task 1.
- Produces: `class BudgetDB extends Dexie` with typed tables `accounts, importProfiles, transactions, categories, rules, incomeStreams, debts, savingsPots, sinkingFunds, openingHoldings, allowancesUsed, settings, holdings, platforms, investmentLog`; `openDb(name = 'budget'): BudgetDB`; `seedDefaults(db: BudgetDB): Promise<void>` (idempotent); `deleteAllData(db: BudgetDB): Promise<void>`. Transactions indexed on `[accountId+date]`, `fingerprint`, `batchId`.

- [ ] **Step 1: Failing test** `seed.test.ts`: after `seedDefaults` twice, categories count equals the spec §4 list length (19), `settings.get('main')` has `aprThresholdPercent 7`, `bufferPercent 10`, `bucketSplit {growth:70,aggressive:30}`, `budgetMonthStartDay 1`, `emergencyTopUpSharePercent 30`, `wrapperShares.pension 25`; holdings contain the five spec §6.3 rows with weights 2/3, 1/3 and 1/3 ×3; platforms contain the four spec §6.4 rows with `lastChecked '2026-10-26'`; `allowances['2026/27']` equals `{isa:2000000, lisa:400000, pension:6000000}`; `deleteAllData` empties every table.
- [ ] **Step 2: Run** `npx vitest run tests/storage` → FAIL.
- [ ] **Step 3: Implement** the `BudgetDB` schema and the seed modules with the spec's exact values. Settings stored as a single row keyed `'main'`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: storage schema and seed data`.

### Task 3: CSV parsing and import profiles

**Files:**
- Create: `src/import/csv.ts`, `src/import/profile.ts`, `tests/fixtures/{single-amount,debit-credit,card-positive-spend,quirks}.csv`
- Test: `tests/import/csv.test.ts`, `tests/import/profile.test.ts`

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]` (strips BOM, handles CRLF, quoted commas, drops blank lines); `type ParsedTx = {accountId; date: ISODate; amountPence: Pence; description: string}`; `applyProfile(rows: string[][], profile: ImportProfile, accountId: string): ParsedTx[]` (throws `ProfileError` naming the row on an unreadable date or amount); `guessProfile(rows: string[][]): Partial<ImportProfile>` (header-name heuristics for date, description, amount or debit/credit columns). Profile fields: `dateFormat: 'DD/MM/YYYY'|'MM/DD/YYYY'|'YYYY-MM-DD'|'D MMM YYYY'`, `signConvention: 'negativeIsOut'|'positiveIsOut'`, `amountMode: 'single'|'debitCredit'`.

- [ ] **Step 1: Failing tests.** Review Focus 1: `quirks.csv` (BOM, CRLF, `"Tesco, Basildon"`, `"1,234.56"`, `£`, `(45.00)`, trailing blank lines) parses to the expected rows and pence. Review Focus 2: `03/04/2026` under `DD/MM/YYYY` → `2026-04-03`, under `MM/DD/YYYY` → `2026-03-04`. Single-amount, split debit/credit, and `positiveIsOut` (card) fixtures yield outflows as negative pence. Bad date throws `ProfileError` with the row number. `guessProfile` on each fixture header finds the right columns.
- [ ] **Step 2: Run** `npx vitest run tests/import` → FAIL. **Step 3: Implement** with PapaParse for tokenising and `toPence` for amounts. **Step 4: Run** → PASS. **Step 5: Commit** `feat: csv parsing and import profiles`.

### Task 4: Fingerprints, atomic import, undo

**Files:**
- Create: `src/import/fingerprint.ts`, `src/import/batch.ts`
- Test: `tests/import/batch.test.ts`

**Interfaces:**
- Consumes: `ParsedTx`, `BudgetDB`.
- Produces: `assignFingerprints(txs: ParsedTx[]): (ParsedTx & {fingerprint: string})[]` (account + date + amount + normalised description + occurrence index within that day); `importBatch(db: BudgetDB, txs: ParsedTx[]): Promise<{batchId: string; added: number; skipped: number}>` (one Dexie transaction; skips rows whose fingerprint already exists; throws and stores nothing if any row has an invalid date); `undoBatch(db: BudgetDB, batchId: string): Promise<number>` (rows removed).

- [ ] **Step 1: Failing tests (Review Focus 5).** Two identical same-day rows get different fingerprints and both import; re-importing the same file returns `added 0, skipped N`; an overlapping statement adds only rows not already stored; a batch with one invalid-date row throws and `transactions` stays empty; `undoBatch` removes exactly that batch's rows and leaves others.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat: idempotent atomic import with undo`.

### Task 5: Transfers, card repayments, business accounts, refunds

**Files:**
- Create: `src/import/matching.ts`
- Test: `tests/import/matching.test.ts`

**Interfaces:**
- Produces: `markTransfers(txs: Transaction[], accounts: Account[]): Transaction[]` (sets `isTransfer` on equal-and-opposite pairs across different accounts within three days; one-to-one matching); `unmatchedCardRepayments(txs: Transaction[], accounts: Account[]): Transaction[]` (outflows from a current account whose description suggests a card payment and have no matching inflow on a `creditCard` account); `flagRefunds(txs: Transaction[]): Transaction[]` (positive amount whose normalised merchant matches an earlier outflow sets `isRefund`); `isSpendingTx(tx: Transaction, accounts: Account[]): boolean` (false for transfers and for `business` or `savings` accounts).

- [ ] **Step 1: Failing tests.** A £250 out of current and £250 in on a card two days later are both transfers, and the card's own purchases stay spending; a card repayment with no card-side row appears in `unmatchedCardRepayments` and is not a transfer; two unrelated £30 amounts three accounts apart are not paired twice; business-account rows are excluded by `isSpendingTx`; a refund from "AMAZON" after a purchase from "AMAZON" is flagged `isRefund`, a salary credit is not.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat: transfer, card, business and refund matching`.

### Task 6: Categorisation

**Files:**
- Create: `src/categorise/rules.ts`
- Test: `tests/categorise/rules.test.ts`

**Interfaces:**
- Produces: `categorise(description: string, rules: Rule[]): string | undefined` (case-insensitive substring; longest `matchText` wins; learned rules beat default rules on equal length); `learnRule(description: string, categoryId: string): Rule` (`source: 'learned'`, `matchText` = normalised merchant, i.e. description with trailing digits, dates and card refs removed); `src/seed/categories.ts` also exports default keyword rules for common UK merchants and bill words.

- [ ] **Step 1: Failing tests.** "TESCO STORES 4412" → groceries rule; learned rule for "COSTA" beats the default for "COFFEE"; learned rule matches "COSTA 0912 LONDON"; unknown description returns `undefined`.
- [ ] **Step 2–5:** run FAIL, implement, run PASS, commit `feat: rule-based categorisation`.

### Task 7: Budget engine and trailing averages

**Files:**
- Create: `src/budget/months.ts`, `src/budget/summary.ts`
- Test: `tests/budget/summary.test.ts`

**Interfaces:**
- Consumes: `budgetMonthOf`, `isSpendingTx`.
- Produces: `monthSummary(input: {month: string; startDay: number; txs: Transaction[]; accounts: Account[]; categories: Category[]; streams: IncomeStream[]}): {spentByCategory: Record<string, Pence>; totalSpentPence: Pence; incomeByStream: Record<string, Pence>; totalIncomePence: Pence; leftPence: Pence}` (refunds reduce their category; transfers and business accounts excluded); `trailingSpend(input: {asOfMonth: string; startDay: number; txs; accounts; months?: 3}): {averagePence: Pence; monthsUsed: number}`; `smoothedIncome(input: {asOfMonth; startDay; txs; accounts; streams}): {totalPence: Pence; perStream: Record<string, Pence>; monthsUsed: number}` (each stream: lower of expected and trailing average actual, expected only when no history); `sinkingMonthlyPence(funds: SinkingFund[]): Pence`.

- [ ] **Step 1: Failing tests (Review Focus 3).** Spend from Oct 25 falls in the October period when `startDay` 25; refund nets the category; business-account and transfer rows excluded; `trailingSpend` with two months of data returns `monthsUsed 2`; with none returns `monthsUsed 0` (not `NaN`); `smoothedIncome` picks the lower of expected £2,000 and actual average £1,700; `sinkingMonthlyPence([{yearlyAmountPence:120000,...}])` → `10000`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: budget summary and trailing averages`.

### Task 8: Debt engine

**Files:**
- Create: `src/debt/debt.ts`
- Test: `tests/debt/debt.test.ts`

**Interfaces:**
- Produces: `utilisation(d: Debt): number | undefined` (balance / limit for cards, `undefined` if no limit); `percentPaid(d: Debt): number | undefined` (loans: `1 - balance/original`); `effectiveApr(d: Debt, on: ISODate): number` (promo APR until `promoEndsOn`, then `aprPercent`); `avalanchePlan(input: {debts: Debt[]; monthlyOverpaymentPence: Pence; startDate: ISODate}): {debtFreeDate: ISODate | null; months: {date: ISODate; paidPence: Record<string, Pence>; balancePence: Record<string, Pence>}[]}` (minimums on all, extra to highest effective APR first, monthly interest = balance × APR/12; `debtFreeDate` null if not payable within 600 months); `highAprDebts(debts: Debt[], thresholdPercent: number, on: ISODate): Debt[]`.

- [ ] **Step 1: Failing tests.** £3,000 card limit £5,000 → utilisation 0.6; loan original £10,000 balance £4,000 → 0.6 paid; promo 0% until 2027-01-31 gives 0 on 2026-12-01 and 22.9 on 2027-02-01; two debts, 24% and 8%, with overpayment: the 24% one reaches zero first and the freed minimum rolls to the next; minimums that cannot cover interest return `debtFreeDate null`; `highAprDebts` at 7% excludes a 0%-promo card until its promo ends.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: debt engine`.

### Task 9: Investable amount

**Files:**
- Create: `src/invest/investable.ts`
- Test: `tests/invest/investable.test.ts`

**Interfaces:**
- Consumes: `smoothedIncome`, `trailingSpend`, `sinkingMonthlyPence`, `highAprDebts` results.
- Produces: `computeInvestable(input: {incomePence: Pence; spendPence: Pence; sinkingPence: Pence; debtMinimumsPence: Pence; highAprPayoffCapacityPence: Pence; emergencyGapPence: Pence; bufferPercent: number; emergencyTopUpSharePercent: number; monthsOfHistory: number}): InvestableResult` where `InvestableResult = {ok: true; investablePence: Pence; lines: {label: string; pence: Pence}[]; extraDebtPence: Pence; emergencyTopUpPence: Pence; biggestDrainLabel: string; notes: string[]} | {ok: false; reason: 'no-income' | 'no-surplus'; lines; biggestDrainLabel: string}`. Order: `surplus0 = income − spend − sinking − minimums − buffer(income)`; `emergency = min(gap, share% × max(surplus0,0))`; `surplus1 = surplus0 − emergency`; `extraDebt = min(max(surplus1,0), capacity)`; `investable = surplus1 − extraDebt`.

- [ ] **Step 1: Failing tests (Review Focus 3).** Income £3,000, spend £1,500, sinking £100, minimums £200, buffer 10% (£300), gap 0, capacity 0 → investable £900. With emergency gap £5,000 and share 30% → top-up £270 and investable £630. With that same emergency gap and high-APR capacity £400 → extra debt £400 and investable £230. Income 0 → `{ok:false, reason:'no-income'}`. Surplus negative → `{ok:false, reason:'no-surplus'}` with `biggestDrainLabel` naming the largest outgoing line. `monthsOfHistory` under 3 adds a note.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: investable amount engine`.

### Task 10: Wrapper allocation and allowances

**Files:**
- Create: `src/invest/wrappers.ts`
- Test: `tests/invest/wrappers.test.ts`

**Interfaces:**
- Produces: `allocateWrappers(input: {investablePence: Pence; today: ISODate; settings: Pick<Settings,'wrapperOrder'|'wrapperShares'|'allowances'>; used: AllowanceUsed[]; lisaEnabled: boolean}): {wrapper: Wrapper; pence: Pence; note?: string}[]`. Pension gets `shares.pension`% of investable (capped by remaining pension allowance); ISA takes the lesser of the remainder and `remainingIsa / monthsLeftInTaxYear(today)` (LISA, when enabled, is carved from inside the ISA room, capped at `remainingLisa / monthsLeft`); GIA takes what is left. Allowances read for `taxYearOf(today)`; used amounts for other tax years are ignored.

- [ ] **Step 1: Failing tests.** £1,000 with pension 25%, ISA room £20,000, six months left → pension £250, ISA £750, GIA £0; ISA room used £19,500 → ISA capped at £83.33 (pence rounded down), remainder to GIA; `used` rows for `2025/26` ignored on `2026-10-26`; on `2026-04-06` the room resets to the full £20,000; with `lisaEnabled`, LISA never exceeds £4,000 and counts against the ISA room; allocations sum exactly to the investable amount.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: wrapper allocation and tax-year allowances`.

### Task 11: 70/30 split, drift, monthly plan

**Files:**
- Create: `src/invest/split.ts`, `src/invest/drift.ts`, `src/invest/plan.ts`
- Test: `tests/invest/split.test.ts`, `tests/invest/drift.test.ts`, `tests/invest/plan.test.ts`

**Interfaces:**
- Produces (`split.ts`): `splitBuckets(amountPence: Pence, bucketSplit: {growth: number; aggressive: number}, holdings: Holding[]): {holdingId: string; bucket: Bucket; pence: Pence}[]` (bucket amounts via `splitPence`, then holdings in a bucket via their `weight`; `holdings.platforms` ignored here).
- Produces (`drift.ts`): `driftReport(input: {opening: OpeningHolding[]; log: InvestmentLog[]; holdings: Holding[]; bucketSplit}): {growthPct: number; aggressivePct: number; underweight: Bucket | null; biasNote: string}` (uses `actualPence` of logged rows plus opening values; `underweight` null when within 2 percentage points).
- Produces (`plan.ts`): `buildMonthlyPlan(input: {investable: InvestableResult; wrappers: ReturnType<typeof allocateWrappers>; holdings: Holding[]; platforms: Platform[]; defaultPlatformByWrapper: Partial<Record<Wrapper, string>>; settings; drift: ReturnType<typeof driftReport>}): MonthlyPlan` with per-wrapper lines, per-holding amounts, chosen platform (or `'choose'`), and a warning when the chosen platform does not support the wrapper or cannot hold the fund (platform `wrappersSupported` and holding `platforms`; Robinhood's seed carries no UCITS funds, so it triggers the warning). When `drift.underweight` is set, new money is split with extra weight to that bucket by moving up to 10 percentage points of the split, never below 0.

- [ ] **Step 1: Failing tests (Review Focus 4).** `splitBuckets(10001, 70/30, seedHoldings)` parts sum to `10001`; growth `7001` splits `4667 / 2334` (2/3, 1/3) and aggressive `3000` splits three ways `1000 ×3`; drift with opening growth £7,000, aggressive £1,000 reports growth 87.5% and `underweight 'aggressive'`; within tolerance returns `null`; a plan with default platform Robinhood for the ISA carries the warning; a plan with an unset platform shows `'choose'`; `ok:false` investable yields a plan with no lines and the reason.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: bucket split, drift and monthly plan`.

### Task 12: Month-end workbook

**Files:**
- Create: `src/export/workbook.ts`
- Test: `tests/export/workbook.test.ts`

**Interfaces:**
- Produces: `buildWorkbook(data: ExportData): Promise<Uint8Array>` where `ExportData = {month: string; summary: ReturnType<typeof monthSummary>; txs: Transaction[]; categories: Category[]; streams: IncomeStream[]; debts: Debt[]; savings: SavingsPot[]; sinking: SinkingFund[]; plan: MonthlyPlan | null; allowances: ...; log: InvestmentLog[]}`. Sheets in order: Summary, Transactions, Budget vs Actual, Income by Stream, Debts, Savings and Sinking Funds, Investment Plan. Currency cells formatted `£#,##0.00`; totals are Excel formulas.

- [ ] **Step 1: Failing test.** Build a workbook from fixture data, read it back with ExcelJS: seven sheets with those names; Summary spent equals `summary.totalSpentPence/100`; Transactions row count equals fixture; the Debts sheet shows utilisation for a card and percent paid for a loan; formula cells have a cached `result` equal to the app total (write results alongside formulas).
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: month-end workbook export`.

### Task 13: Backup, restore and app lock

**Files:**
- Create: `src/backup/crypto.ts`, `src/backup/snapshot.ts`, `src/backup/lock.ts`
- Test: `tests/backup/crypto.test.ts`, `tests/backup/snapshot.test.ts`, `tests/backup/lock.test.ts`

**Interfaces:**
- Produces: `encryptBackup(json: string, passphrase: string): Promise<Uint8Array>` (PBKDF2 → AES-GCM, random salt and IV in a small header with a format version); `decryptBackup(bytes: Uint8Array, passphrase: string): Promise<string>` (throws `WrongPassphraseError` on bad passphrase or tampering); `exportSnapshot(db: BudgetDB): Promise<string>` and `restoreSnapshot(db: BudgetDB, json: string): Promise<void>` (replaces all tables in one transaction); `hashPasscode(passcode: string): Promise<{salt: string; hash: string}>`; `verifyPasscode(passcode: string, stored: {salt: string; hash: string}): Promise<boolean>`; `backupIsOverdue(lastAt: ISODate | undefined, today: ISODate): boolean` (over 30 days or never).

- [ ] **Step 1: Failing tests.** Round trip returns the original JSON; wrong passphrase and one flipped byte both throw `WrongPassphraseError`; snapshot of a seeded db with transactions restores into a fresh db with identical table contents; restoring corrupt JSON throws and leaves the target unchanged; empty db round-trips; wrong passcode returns false, right returns true; `backupIsOverdue` true at 31 days and when undefined.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: encrypted backup, restore and passcode`.

### Task 14: UI shell, theme, PWA

**Files:**
- Create: `src/ui/App.tsx`, `src/ui/theme.css`, `src/ui/components/{Tabs,Card,Money,EmptyState}.tsx`, `public/icon.svg`, `scripts/make-icons.mjs`; Modify: `vite.config.ts`, `index.html`
- Test: `tests/ui/App.test.tsx`

**Interfaces:**
- Produces: `<App/>` with five tabs (Home, Import, Budget, Debts & Savings, Invest) plus Settings; bottom tabs under 900px, left sidebar at 900px and above; `useDb()` hook returning the open `BudgetDB`; `<Money pence={...}/>` formatting via `formatGBP`; lock screen shown when `settings.appLock` is set; theme follows `settings.theme` (`system` default). Before building screens, load the `frontend-design` skill and keep a calm, high-contrast look with large tap targets.

- [ ] **Step 1: Failing tests.** Renders five tabs and switches content on click; at a 1200px-wide viewport the navigation is the sidebar variant; with a passcode set the app renders the lock screen until the right passcode is entered; `<Money pence={-500}/>` shows `-£5.00`.
- [ ] **Step 2: Run** `npx vitest run tests/ui` → FAIL. **Step 3: Implement** shell, theme variables for light and dark (`prefers-color-scheme` plus the setting), and configure `vite-plugin-pwa` (manifest name "Budget", `display: 'standalone'`, theme colour, icons 192/512 and an apple-touch 180 generated from `public/icon.svg` by `scripts/make-icons.mjs` using sharp; precache all assets). **Step 4: Run** → PASS; `npm run build` succeeds. **Step 5: Commit** `feat: app shell, theme and PWA`.

### Task 15: Setup wizard and Settings

**Files:**
- Create: `src/ui/screens/Wizard.tsx`, `src/ui/screens/Settings.tsx`
- Test: `tests/ui/wizard.test.tsx`, `tests/ui/settings.test.tsx`

**Interfaces:**
- Consumes: `BudgetDB`, `seedDefaults`, `hashPasscode`.
- Produces: wizard steps in order: accounts (name, bank, kind), income streams, debts (including credit limit / original amount and optional promo), savings pots (flag the emergency fund), sinking funds, allowances already used this tax year, opening holdings, settings (month start day, defaults). Settings screen edits everything in spec §4 "Settings", including wrapper order, shares, LISA switch, example-fund table, platforms with last-checked dates, default platform per wrapper, app lock with the one-line honesty note ("This keeps casual access out. Your encrypted backup is the strongly protected copy."), theme, backup/restore and delete all data (confirmation required).

- [ ] **Step 1: Failing tests.** Completing the wizard writes the expected rows (account kind `business` saved; debt with `creditLimitOrOriginalPence`); Home is shown only after the wizard finishes or is skipped; Settings saves month start day 25 and an APR threshold of 8; setting a passcode stores a salted hash, never the plain value; delete-all requires confirmation and empties storage.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: setup wizard and settings`.

### Task 16: Import screen

**Files:**
- Create: `src/ui/screens/Import.tsx`
- Test: `tests/ui/import.test.tsx`

**Interfaces:**
- Consumes: `parseCsv`, `guessProfile`, `applyProfile`, `assignFingerprints`, `importBatch`, `undoBatch`, `categorise`, `markTransfers`, `flagRefunds`, `unmatchedCardRepayments`.
- Produces: pick an account, drop one or more CSVs; unknown layout opens a mapping form (date column and format, description, single or debit/credit, sign convention) pre-filled by `guessProfile` and saved to the account; preview table marks duplicates and transfers; confirm imports; import history lists batches with an Undo button (confirmation required); unmatched card repayments are listed under "needs attention".

- [ ] **Step 1: Failing tests.** Uploading `single-amount.csv` to an account with no profile shows the mapping form; confirming stores transactions categorised by rules; uploading it again reports all rows skipped; Undo removes the batch; a card repayment without a card-side row appears in the attention list.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: import screen`.

### Task 17: Budget and Debts & Savings screens

**Files:**
- Create: `src/ui/screens/Budget.tsx`, `src/ui/screens/DebtsSavings.tsx`
- Test: `tests/ui/budget.test.tsx`, `tests/ui/debts.test.tsx`

**Interfaces:**
- Consumes: `monthSummary`, `categorise`/`learnRule`, `utilisation`, `percentPaid`, `avalanchePlan`.
- Produces: Budget: month selector (respecting the start day), per-category limit, spent and progress bar, re-categorise a transaction with an "apply to all similar" option that saves a learned rule; income by stream. Debts & Savings: debt list showing utilisation (cards) or percent paid (loans), APR, promo end, payoff timeline and debt-free date, savings pots with progress to target, sinking funds with the monthly set-aside.

- [ ] **Step 1: Failing tests.** A £40 grocery transaction moves the Groceries bar to 40 of its limit; re-categorising with "apply to all similar" changes a second matching transaction on the next import; a card shows "60% used", a loan "60% paid off"; the emergency-fund pot shows progress and the flagged label.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: budget and debts-savings screens`.

### Task 18: Home and Invest screens

**Files:**
- Create: `src/ui/screens/Home.tsx`, `src/ui/screens/Invest.tsx`
- Test: `tests/ui/home.test.tsx`, `tests/ui/invest.test.tsx`

**Interfaces:**
- Consumes: Tasks 7–11 engines.
- Produces: Home: income, spent, left, debt remaining, the **Invest this month** figure with a button to the plan, "needs attention" list (uncategorised, backup overdue, unmatched card repayments). Invest: "How we got this number" lines from `computeInvestable`, the plan card per wrapper and fund with platform (or "choose") and any platform warning, a checkbox per line that writes `InvestmentLog` (editable actual amount) and increments `AllowanceUsed`, the drift view, and the required one-line disclaimer. When `ok:false`, show the reason and the biggest drain instead of a plan.

- [ ] **Step 1: Failing tests.** With seeded data the Invest tab shows the plan lines summing to the investable figure; ticking an ISA line writes a log row and raises `AllowanceUsed` for `2026/27`; with no income entered the tab shows the no-income reason and no plan; the disclaimer text appears exactly once; Home shows "Back up now" when `backupIsOverdue`.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: home and invest screens`.

### Task 19: Export and backup wiring

**Files:**
- Create: `src/ui/components/{ExportButton,BackupPanel}.tsx`
- Test: `tests/ui/export-backup.test.tsx`

**Interfaces:**
- Consumes: `buildWorkbook`, `encryptBackup`, `decryptBackup`, `exportSnapshot`, `restoreSnapshot`.
- Produces: "Download month-end spreadsheet" (names the file `budget-YYYY-MM.xlsx`) on Home and Budget; Backup panel in Settings with passphrase fields: export encrypted file `budget-backup-YYYY-MM-DD.bin` (also sets `backupLastAt`); restore with an overwrite warning and a clear message on wrong passphrase.

- [ ] **Step 1: Failing tests.** The export button triggers a download whose bytes parse as an xlsx with seven sheets; backup then restore into a clean db reproduces the data; a wrong passphrase shows the message and changes nothing.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat: spreadsheet and backup wiring`.

### Task 20: Verification, repository and deploy

**Files:**
- Create: `README.md` (install on iPhone/Android and Mac, backup routine, how to edit funds and platforms), `.github/workflows/deploy.yml` (GitHub Pages via `actions/deploy-pages`)
- Modify: none

**Interfaces:** none.

- [ ] **Step 1:** Run `npm run build && npx vitest run` → all tests pass, build succeeds. Run the `superpowers:verification-before-completion` checks and `superpowers:requesting-code-review` over the whole branch before continuing.
- [ ] **Step 2:** Using Claude in Chrome against `npm run preview`, import the synthetic fixture CSVs, confirm categorisation, the Invest plan, the spreadsheet download, and PWA installability (manifest and service worker registered). Report any failure with what was seen.
- [ ] **Step 3:** With the owner's empty repository name, attach it with push access, push `main`, enable Pages, and confirm the deployed URL loads over HTTPS.
- [ ] **Step 4:** Walk the owner through installing on iPhone (Share → Add to Home Screen) and MacBook (Safari → Add to Dock), then one backup export and restore between the two devices.
- [ ] **Step 5: Commit** `docs: readme and deploy workflow`.
