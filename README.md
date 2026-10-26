# Budget

A private budgeting and investing-suggestions app for UK households. It runs in the browser, installs on your phone or Mac like an ordinary app, and keeps everything on your device. There is no server and there are no accounts: nothing you enter is sent anywhere.

## What it does

- **Import** bank and card statements (CSV files). The app guesses the column layout, remembers it per account, spots duplicates and skips transfers between your own accounts.
- **Categorise** spending: rules place transactions automatically, and on the Budget tab you can pick a category for anything left uncategorised.
- **Budget** the month against your planned amounts, with debts, savings pots and sinking funds alongside.
- **Invest** shows what you can afford to invest this month, split across tax wrappers (pension, ISA, optionally Lifetime ISA, and general account) and a list of example funds. You tick lines off as you buy them, and your remaining allowances update.
- **Month-end spreadsheet** with seven sheets (Summary, Transactions, Budget vs actual, Income by stream, Debts, Savings and yearly bills, Investment plan).

The investing suggestions are generated from your own numbers by the rules in the app. The Invest tab carries one line: "Starting rules, not personal advice. Check each fund's key information document and your platform's availability before buying."

## Install it

Open the app's web address once, then install it so it opens like a normal app and works offline.

- **iPhone:** open it in Safari, tap Share, then Add to Home Screen.
- **Android:** open it in Chrome, then menu, Install app.
- **Mac:** in Safari choose File, Add to Dock. In Chrome use the install icon in the address bar.

Your data lives in the browser storage of the device you install on, so each device has its own copy. Use the backup routine below to move data between devices.

## A month with the app

1. **Import** this month's statements for each account.
2. **Categorise** anything uncategorised on the Budget tab.
3. **Check the plan** on Home, Budget and Invest.
4. **Tick off investments** on the Invest tab as you make them.
5. **Download the month-end spreadsheet** (Home or Budget) and keep it for your records.

## Backups

In Settings, "Download encrypted backup" asks for a passphrase and saves a single file. Move it to another device by AirDrop, iCloud Drive or any file-sharing you like. To restore, choose the file in Settings and enter its passphrase.

- Restoring replaces all data on that device with the contents of the backup.
- The app lock (passcode) stays per device and is not changed by a restore. It keeps casual access out; the encrypted backup is the strongly protected copy.
- Keep the passphrase somewhere safe. It is never stored, and without it the backup cannot be opened by anyone, including you.
- The app reminds you if it has been over 30 days since your last backup.

## Editing funds, platforms and allowances

All in Settings:

- **Funds:** change the example funds, their buckets and weights.
- **Platforms:** change which tax wrappers each platform supports, its notes and the "last checked" date, and pick the default platform for each wrapper.
- **Allowances:** set the ISA, Lifetime ISA and pension allowances for each tax year.

The shipped allowances for 2026/27 are ISA £20,000, Lifetime ISA £4,000 and pension £60,000. The platform facts were checked on 2026-10-26. Rules and platforms change, so treat them as starting points and edit them whenever you learn something new. Example funds are starting points, not recommendations.

## Running it locally

```
npm install
npm run dev       # development server
npm test          # run the tests once
npm run build     # type-check and production build into dist/
npm run preview   # serve the production build
```

Deploying to GitHub Pages: the workflow in `.github/workflows/deploy.yml` builds with `VITE_BASE=/personal_bugdet_app/` on every push to `main`. In the repository settings set Pages, Source, to GitHub Actions. To build for a different path, set `VITE_BASE` yourself, for example `VITE_BASE=/ npm run build`.

## Data and privacy

Everything is stored in your browser's IndexedDB: accounts, transactions, categories and rules, budgets, debts, savings, holdings, platforms, settings and the investment log. The only network use is downloading the app itself. Spreadsheets and backups are made on your device and saved as files you control. Deleting the app or clearing site data removes the data, so keep a backup.
