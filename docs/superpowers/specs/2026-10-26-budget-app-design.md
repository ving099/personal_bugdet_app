# Personal Budget & Investing App: Design Spec (MVP v1)

Date: 2026-10-26
Status: Draft for owner review
Owner: Vinod (single user, UK)

## 1. Purpose and success criteria

A private personal-finance app for one UK user that turns uploaded bank-statement CSVs into a monthly picture of income, spending and debt, and then tells the user **how much to invest each month, in which tax wrapper, in which fund types, and on which platform**.

The main feature is the investing suggestion. Everything else exists to produce a trustworthy "investable amount" and to give the user month-end spreadsheets.

Success looks like:
1. Statements from several accounts import in minutes, with duplicates and own-account transfers handled.
2. The Home tab shows the month at a glance and one clear "invest this month" figure.
3. The Invest tab gives a concrete monthly plan (amount, wrapper, 70% growth / 30% aggressive split, example funds, platform) that the user can tick off and log.
4. A month-end .xlsx downloads in one tap.
5. The same app runs on iPhone/Android (installed to the home screen) and on a MacBook.
6. Requirements will change, so every rule in the investing and debt engines is a setting or seed-data table, not hard-coded.

## 2. Decisions already made (from brainstorming)

| Topic | Decision |
|---|---|
| Build vs buy | Build. No product found combining statement upload, income streams, debt tracking and a 70/30 investing engine. Closest to buy: TrackSpendZ or Home Budget Analytics (about $5-7 a month) |
| Approach | Hand-built PWA, TypeScript + React |
| Data location | On-device (IndexedDB), no server, no account |
| Devices | Phone and MacBook, same codebase; sync by **manual encrypted backup file** (Mac is the main device) |
| Statements | CSV only (OFX/QIF may follow); no PDF parsing in v1 |
| Income | Net amounts only, labelled by stream; no tax modelling |
| Debt rule | Debts above an APR threshold (default 7%) get surplus first, avalanche order; the rest goes to investing; emergency fund comes before investing |
| Risk split | Two buckets: 70% growth, 30% aggressive |
| Advice stance | Owner asked for direct, concrete suggestions. The app gives a rule-based framework with named example funds, and carries one short line saying the defaults are starting rules, not personal advice, and fund availability and key information documents should be checked before buying |

## 3. Scope

### In v1
- Five tabs: Home, Import, Budget, Debts, Invest.
- Income streams (net, labelled), editable categories, rules that learn from re-categorisation.
- CSV import with per-bank column mapping, duplicate detection, own-account transfer detection.
- Debt tracking with credit limit / original amount.
- Investing engine and monthly plan with logging and drift tracking.
- Month-end .xlsx export.
- Encrypted backup and restore; PWA install and offline use.

### Not in v1
Bank linking (Open Banking), PDF statement parsing, tax or National Insurance modelling, cloud sync, live prices, automatic holdings import from platforms, multi-user, notifications.

## 4. Screens

**Home.** Month selector. Cards for income received, spent, left to spend, debt remaining, and the **Invest this month** figure with a button to the plan. A short "needs attention" list (uncategorised transactions, backup overdue, new import profile needed).

**Import.** Add account; drop one or more CSVs; if the layout is unknown, a one-time mapping screen (date column and format, description, single amount column or separate debit and credit columns); preview with duplicates and transfers marked; confirm. Import history per account.

**Budget.** Categories with monthly limits, spent so far, and a progress bar. Default categories: Groceries and food, Eating out, Direct debits and bills, Housing, Transport, Clothes, Subscriptions, Health, Entertainment, Family and kids, Gifts, Travel, Cash, Miscellaneous, Fees and interest, Debt payments, Savings and investing, Income, Transfers (excluded). Tap a transaction to re-categorise; the app offers "apply to all similar".

**Debts.** List of debts: name, kind (card, loan, other), current balance, **credit limit / original amount**, APR, minimum payment. Cards show utilisation (balance / limit); loans show percentage paid off. Payoff timeline under the avalanche rule with the monthly overpayment set by the investing engine, and a debt-free date.

**Invest** (the main feature). Detailed in section 6.

Layout: bottom tabs on phone; left sidebar and wider tables on desktop (responsive breakpoint at about 900px). Large tap targets, one primary action per screen, plain-English labels.

## 5. Architecture

**Stack:** TypeScript, React, Vite, vite-plugin-pwa; Dexie (IndexedDB); PapaParse (CSV); ExcelJS (.xlsx); Web Crypto AES-GCM with PBKDF2 key derivation (backup); Vitest (tests). Static files only. Hosting is free static hosting (Cloudflare Pages, Netlify or GitHub Pages) and holds no user data.

**Units (each independently testable, no UI dependency):**

| Unit | Responsibility | Depends on |
|---|---|---|
| `domain` | Types, money-in-pence helpers, date helpers | none |
| `storage` | Dexie schema, repositories, migrations | domain |
| `import` | Parse CSV with an ImportProfile into transactions; fingerprinting; duplicate and transfer detection | domain |
| `categorise` | Rule matching, learn-from-correction | domain |
| `budget` | Budget vs actual per month | domain |
| `debt` | Utilisation, percent paid, avalanche schedule, payoff date | domain |
| `invest` | Investable amount, wrapper allocation, 70/30 split, drift | domain, debt |
| `export` | Build month-end workbook | all engines |
| `backup` | Encrypt, decrypt, export, restore | storage |
| `ui` | Screens and components; calls engines, holds no business logic | all |

Engines are pure functions (data in, result out). Money is stored as integer pence everywhere.

## 6. Investing engine (main feature)

### 6.1 Investable amount (per month)

```
investable = monthly net income (all streams, actual or expected)
           - average monthly spending (from imported statements, transfers excluded)
           - sum of debt minimum payments
           - extra payments on debts above the APR threshold   (avalanche order)
           - emergency fund top-up (until target reached)
           - buffer (default 10% of income)
```
If the result is zero or negative, the plan says so and shows which line is the biggest drain. No negative investing.

### 6.2 Wrapper allocation

Wrappers, in a user-editable priority order. Default order and rules:

1. **Pension (SIPP):** default share of investable 25% (editable). The UI states the money is locked until pension age.
2. **Stocks & Shares ISA:** fills up to the remaining allowance for the tax year, spread across the months left.
3. **Lifetime ISA:** off by default; user ticks if eligible; counts inside the ISA allowance (max £4,000 a year).
4. **General investment account (GIA):** whatever remains.

Allowances are settings, seeded for 2026/27 (6 April 2026 to 5 April 2027): ISA £20,000; Lifetime ISA £4,000 (inside the ISA allowance); pension annual allowance up to £60,000 or 100% of earnings (tapering possible for high earners). Source: Bestinvest 2026/27 allowances summary. A reset happens each 6 April. Noted for later: from 6 April 2027 the cash ISA limit drops to £12,000 for under-65s (does not affect stocks and shares ISAs).

### 6.3 The 70/30 split

Within each wrapper's amount: 70% to the **Growth** bucket, 30% to the **Aggressive** bucket. Inside each bucket, the amount is divided by the weights in the holdings table.

**Seed holdings table (editable, example funds, check availability and the key information document before buying):**

| Bucket | Weight in bucket | Fund type | Example |
|---|---|---|---|
| Growth | 2/3 | Global all-world equity ETF | Vanguard FTSE All-World UCITS ETF |
| Growth | 1/3 | US large-cap index ETF | iShares Core S&P 500 UCITS ETF |
| Aggressive | 1/3 | Nasdaq-100 ETF | Invesco EQQQ Nasdaq-100 UCITS ETF |
| Aggressive | 1/3 | Emerging-markets ETF | iShares Core MSCI EM IMI UCITS ETF |
| Aggressive | 1/3 | Global small-cap ETF | iShares MSCI World Small Cap UCITS ETF |

These are starting examples of fund types, held as seed data so the owner can replace any row (ticker, name, bucket, weight, which platforms can buy it). The seed names were chosen from general knowledge, not live market data; they are to be confirmed by the owner before use, and the app shows no prices or performance.

### 6.4 Platform suitability (seed data)

Facts below were checked on 2026-10-26 from public pages; the app treats them as editable settings and shows a "last checked" date.

| Platform | Stocks & Shares ISA | SIPP | Lifetime ISA | GIA | Notes |
|---|---|---|---|---|---|
| Trading 212 | Yes | Yes (launched 2026) | No | Yes | Source: Unbiased review |
| Interactive Brokers UK | Yes | Not direct; via external SIPP administrators (one needs about £75,000) | Not confirmed | Yes | Fees noted: £3 minimum monthly activity fee in the ISA; non-flexible ISA (withdrawals use allowance). Source: MoneyToTheMasses review |
| IG | Yes | Yes | Not confirmed | Yes | Source: IG ISA page |
| Robinhood UK | Yes (rolling out from Feb 2026) | Not confirmed | Not confirmed | Not confirmed in the page read | ISA limited to US-listed stocks and ADRs, so the UCITS ETFs above are **not** purchasable there. The app does not allocate fund-based plans to Robinhood by default |

None of the four platforms was confirmed to offer a Lifetime ISA, so the LISA step is off by default and flagged "needs a separate provider".

The owner sets a default platform per wrapper in Settings. Until set, the plan shows the wrappers and funds and marks the platform as "choose".

### 6.5 Monthly plan card

Example output: "Invest £X. Pension £a, ISA £b, GIA £c. Within ISA: Growth £g (fund 1 £, fund 2 £), Aggressive £h (fund 3 £, fund 4 £, fund 5 £). Platform: <default>". Each line is a checkbox; ticking logs it to InvestmentLog with the actual amount editable. Drift view compares logged holdings against 70/30 and suggests the next month's rebalancing by directing new money to the underweight bucket first. No selling suggestions in v1.

One line on the tab: "Starting rules, not personal advice. Check each fund's key information document and your platform's availability before buying."

## 7. Data model (IndexedDB, money in pence)

- **Account:** id, name, bank, type, importProfileId.
- **ImportProfile:** id, bank label, dateFormat, descriptionColumn, amountMode (single | debitCredit), amountColumn or debitColumn/creditColumn, signConvention, headerRows.
- **Transaction:** id, accountId, date, amountPence, description, categoryId, fingerprint, batchId, isTransfer.
- **Category:** id, name, monthlyLimitPence, excludedFromSpending.
- **Rule:** id, matchText, categoryId, source (default | learned).
- **IncomeStream:** id, label, expectedMonthlyNetPence.
- **Debt:** id, name, kind (card | loan | other), balancePence, **creditLimitOrOriginalPence**, aprPercent, minimumPaymentPence.
- **Settings:** aprThresholdPercent (7), emergencyFundTargetPence, bufferPercent (10), wrapperOrder, wrapperShares, allowances by tax year, bucketSplit (70/30), defaultPlatformByWrapper, backupLastAt.
- **Holding (seed table):** id, bucket, weight, fundType, exampleName, ticker, platforms[].
- **Platform:** id, name, wrappersSupported[], notes, lastChecked.
- **InvestmentLog:** id, month, wrapper, holdingId, plannedPence, actualPence, platformId.

## 8. Import details

- **Fingerprint** = account + date + amount + normalised description + occurrence index within the day, so two genuine identical purchases on one day are not merged and overlapping statements do not double-count.
- **Transfers:** matching amounts leaving one account and arriving in another within three days are marked as transfers and excluded from spending and income.
- **Unknown layout:** shows the mapping screen instead of failing; the profile is saved per account.
- **Atomic import:** an import is one transaction; any failure rolls it back.
- Bank export layouts are assumed from general patterns until real samples are available (see section 12).

## 9. Month-end spreadsheet (.xlsx)

One workbook per month, built in the browser, with sheets: Summary, Transactions (categorised), Budget vs Actual, Income by Stream, Debts (balance, limit/original, utilisation or percent paid, APR, payoff date), Investment Plan (planned and logged). Totals use live Excel formulas where practical, and a test checks that the sheet totals equal the in-app totals.

## 10. Backup and device sync

Export produces an encrypted file (AES-GCM, key from a passphrase via PBKDF2). Import restores it to a fresh or existing device after a clear overwrite warning. The Mac is the main device; the phone gets a copy by importing the file. A nudge appears when the last backup is over 30 days old. The storage layer is isolated so a later "sync an encrypted file via iCloud Drive or Google Drive" option can be added without rewriting the app. Installed home-screen apps are far less likely to have storage cleared than browser tabs, but backups remain the safety net.

## 11. Error handling and testing

**Errors:** wrong backup passphrase shows a clear message and changes nothing; unreadable CSV shows the mapping screen; import failure rolls back; engines return explicit "cannot compute" reasons (for example, no income entered) rather than zero.

**Tests (Vitest, written before implementation):**
- `debt`: avalanche ordering, payoff date, utilisation and percent-paid maths, with fixed examples.
- `invest`: investable amount, wrapper order and caps, 70/30 split rounding (pence must sum exactly), allowance exhaustion and tax-year reset, negative surplus.
- `import`: synthetic CSVs shaped like typical UK exports (single and split amount columns, various date formats), duplicates, overlapping statements, transfers.
- `export`: workbook totals equal app totals.
- `backup`: round-trip, wrong passphrase, tampered file.
- Manual: install and backup/restore on the owner's iPhone and MacBook.

## 12. Open items

1. **Real bank formats:** the owner will supply a few anonymised sample rows per bank, which become test fixtures.
2. **Seed funds:** the example funds in 6.3 and the platform facts in 6.4 should be confirmed by the owner before the first real plan.
3. **Default platform per wrapper:** to be chosen by the owner in Settings.
4. **Hosting:** which free static host to use (decided at deploy time).

## 13. Skills and connectors needed to build this

Skills: `superpowers:writing-plans` (next step), `superpowers:test-driven-development`, `superpowers:using-git-worktrees`, `superpowers:subagent-driven-development` or `superpowers:executing-plans`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, `frontend-design`, and `xlsx` (to verify the exported workbook).

Connectors (optional): a GitHub repository (for version history and to host the app through GitHub Pages); Claude in Chrome (to test the installed app in a browser). Nothing connects to any bank.
