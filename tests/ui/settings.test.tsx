import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import App from '../../src/ui/App'
import { DbProvider } from '../../src/ui/DbProvider'
import Settings from '../../src/ui/screens/Settings'

// Real passcode hashing costs 600,000 PBKDF2 rounds. Tests use a low count; the stored shape is the same.
vi.mock('../../src/backup/lock', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/backup/lock')>()
  return {
    ...real,
    hashPasscode: (p: string) => real.hashPasscode(p, 1000),
    verifyPasscode: (p: string, s: { salt: string; hash: string }) => real.verifyPasscode(p, s, 1000),
  }
})
const { verifyPasscode } = await import('../../src/backup/lock')

let counter = 0
const opened: BudgetDB[] = []

async function freshDb(): Promise<BudgetDB> {
  const db = openDb(`settings-test-${Date.now()}-${counter++}`)
  opened.push(db)
  await seedDefaults(db)
  return db
}

afterEach(async () => {
  cleanup()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

function renderSettings(db: BudgetDB, today = '2026-10-26') {
  return render(
    <DbProvider db={db}>
      <Settings today={today} />
    </DbProvider>,
  )
}


async function setField(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, value: string) {
  await user.clear(el)
  if (value) await user.type(el, value)
}

describe('Settings: budget', () => {
  it('saves month start day 25 and APR threshold 8 to the main row', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const budget = await screen.findByRole('region', { name: 'Budget' })
    await setField(user, within(budget).getByLabelText('Budget month start day'), '25')
    await setField(user, within(budget).getByLabelText('APR threshold (%)'), '8')
    await user.click(within(budget).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(budget).getByRole('status')).toHaveTextContent('Saved'))
    const row = await db.settings.get('main')
    expect(row).toMatchObject({ budgetMonthStartDay: 25, aprThresholdPercent: 8, bufferPercent: 10 })
  })

  it('rejects month start day 31 with an inline error and does not save', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const budget = await screen.findByRole('region', { name: 'Budget' })
    const day = within(budget).getByLabelText('Budget month start day')
    await setField(user, day, '31')
    expect(within(budget).getByText('Enter a whole number from 1 to 28')).toBeInTheDocument()
    expect(day).toHaveAttribute('aria-invalid', 'true')
    await user.click(within(budget).getByRole('button', { name: 'Save' }))
    expect(within(budget).getByRole('status')).not.toHaveTextContent('Saved')
    expect((await db.settings.get('main'))?.budgetMonthStartDay).toBe(1)
  })

  it('rejects a percentage above 100', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const budget = await screen.findByRole('region', { name: 'Budget' })
    await setField(user, within(budget).getByLabelText('Safety buffer (%)'), '101')
    await user.click(within(budget).getByRole('button', { name: 'Save' }))
    expect((await db.settings.get('main'))?.bufferPercent).toBe(10)
  })
})

describe('Settings: investing', () => {
  it('rejects a 0/0 bucket split and saves a valid one, with a preview', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const inv = await screen.findByRole('region', { name: 'Investing' })
    expect(within(inv).getByRole('img')).toHaveAccessibleName('Growth 70%, aggressive 30%')
    await setField(user, within(inv).getByLabelText('Growth (%)'), '0')
    await setField(user, within(inv).getByLabelText('Aggressive (%)'), '0')
    expect(within(inv).getByText('The two numbers must add up to more than zero')).toBeInTheDocument()
    expect(within(inv).queryByRole('img')).not.toBeInTheDocument()
    await user.click(within(inv).getByRole('button', { name: 'Save' }))
    expect((await db.settings.get('main'))?.bucketSplit).toEqual({ growth: 70, aggressive: 30 })

    await setField(user, within(inv).getByLabelText('Growth (%)'), '60')
    await setField(user, within(inv).getByLabelText('Aggressive (%)'), '40')
    expect(within(inv).getByRole('img')).toHaveAccessibleName('Growth 60%, aggressive 40%')
    await user.click(within(inv).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(inv).getByRole('status')).toHaveTextContent('Saved'))
    expect((await db.settings.get('main'))?.bucketSplit).toEqual({ growth: 60, aggressive: 40 })
  })

  it('reorders accounts, sets shares and the Lifetime ISA switch', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const inv = await screen.findByRole('region', { name: 'Investing' })
    expect(within(inv).getByText("Turn this on only if you're eligible for a Lifetime ISA.")).toBeInTheDocument()
    expect(within(inv).queryByLabelText('Lifetime ISA share (%, optional)')).not.toBeInTheDocument()
    await user.click(within(inv).getByRole('button', { name: 'Move General investment account up' }))
    await user.click(within(inv).getByRole('switch', { name: 'Use a Lifetime ISA' }))
    await setField(user, within(inv).getByLabelText('Pension share (%)'), '40')
    await setField(user, within(inv).getByLabelText('Lifetime ISA share (%, optional)'), '50')
    await user.click(within(inv).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(inv).getByRole('status')).toHaveTextContent('Saved'))
    const row = await db.settings.get('main')
    expect(row?.wrapperOrder).toEqual(['pension', 'isa', 'gia', 'lisa'])
    expect(row?.wrapperShares).toEqual({ pension: 40, lisa: 50 })
    expect(row?.lisaEnabled).toBe(true)
  })
})

describe('Settings: allowances', () => {
  it('has no notice when the current tax year is configured', async () => {
    renderSettings(await freshDb(), '2026-10-26')
    await screen.findByRole('region', { name: 'Allowances' })
    expect(screen.queryByText(/aren't set/)).not.toBeInTheDocument()
  })

  it('warns when the tax year has no entry and copies the latest limits on request', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db, '2027-10-26')
    const allowances = await screen.findByRole('region', { name: 'Allowances' })
    expect(within(allowances).getByText("Allowances for 2027/28 aren't set. Using 2026/27 limits until you add them.")).toBeInTheDocument()
    await user.click(within(allowances).getByRole('button', { name: 'Add 2027/28 allowances' }))
    await waitFor(async () =>
      expect((await db.settings.get('main'))?.allowances['2027/28']).toEqual({ isa: 2000000, lisa: 400000, pension: 6000000 }),
    )
    await waitFor(() => expect(within(allowances).queryByText(/aren't set/)).not.toBeInTheDocument())
    expect(within(allowances).getByText('2027/28 limits')).toBeInTheDocument()
  })

  it('saves what has been used this year and clears it when emptied', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const allowances = await screen.findByRole('region', { name: 'Allowances' })
    await user.type(await within(allowances).findByLabelText('ISA used this year'), '£3,000')
    await user.click(within(allowances).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(allowances).getByRole('status')).toHaveTextContent('Saved'))
    expect(await db.allowancesUsed.get(['2026/27', 'isa'])).toEqual({ taxYear: '2026/27', wrapper: 'isa', usedPence: 300000 })
    await user.clear(within(allowances).getByLabelText('ISA used this year'))
    await user.click(within(allowances).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await db.allowancesUsed.count()).toBe(0))
  })

  it('shows an inline money error and writes nothing', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const allowances = await screen.findByRole('region', { name: 'Allowances' })
    await user.type(await within(allowances).findByLabelText('ISA used this year'), 'abc')
    await user.click(within(allowances).getByRole('button', { name: 'Save' }))
    expect(within(allowances).getAllByText('Enter an amount like 1,250.00').length).toBeGreaterThan(0)
    expect(await db.allowancesUsed.count()).toBe(0)
    expect(within(allowances).getByRole('status')).not.toHaveTextContent('Saved')
  })
})

describe('Settings: example funds', () => {
  it('shows the note, persists a weight change and flags an all-zero bucket', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const funds = await screen.findByRole('region', { name: 'Example funds' })
    await within(funds).findByRole('group', { name: 'Fund 1' })
    expect(within(funds).getByText('Example funds are starting points, not recommendations. Check each one before you buy.')).toBeInTheDocument()

    const first = within(funds).getByRole('group', { name: 'Fund 1' })
    expect(within(first).getByLabelText('Ticker')).toHaveValue('VWRL')
    await setField(user, within(first).getByLabelText('Weight'), '5')
    await user.click(within(funds).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(funds).getByRole('status')).toHaveTextContent('Saved'))
    expect((await db.holdings.get('growth-global'))?.weight).toBe(5)

    expect(within(funds).queryByText(/no funds with weight/)).not.toBeInTheDocument()
    for (const n of [3, 4, 5]) await setField(user, within(within(funds).getByRole('group', { name: `Fund ${n}` })).getByLabelText('Weight'), '0')
    expect(
      within(funds).getByText("Aggressive: This bucket has no funds with weight, so its share can't be placed."),
    ).toBeInTheDocument()
  })

  it('rejects a fractional weight and adds and removes funds', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const funds = await screen.findByRole('region', { name: 'Example funds' })
    const first = await within(funds).findByRole('group', { name: 'Fund 1' })
    await setField(user, within(first).getByLabelText('Weight'), '1.5')
    await user.click(within(funds).getByRole('button', { name: 'Save' }))
    expect((await db.holdings.get('growth-global'))?.weight).toBe(2)
    await setField(user, within(first).getByLabelText('Weight'), '2')

    await user.click(within(funds).getByRole('button', { name: 'Remove fund 5' }))
    await user.click(within(funds).getByRole('button', { name: 'Add fund' }))
    const added = within(funds).getByRole('group', { name: 'Fund 5' })
    await user.type(within(added).getByLabelText('Name'), 'Test fund')
    await user.type(within(added).getByLabelText('Ticker'), 'TEST')
    await user.click(within(added).getByLabelText('Trading 212'))
    await user.click(within(funds).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(funds).getByRole('status')).toHaveTextContent('Saved'))
    const rows = await db.holdings.toArray()
    expect(rows).toHaveLength(5)
    expect(rows.find((r) => r.ticker === 'TEST')).toMatchObject({ exampleName: 'Test fund', bucket: 'growth', weight: 1, platforms: ['trading212'] })
    expect(rows.some((r) => r.ticker === 'WLDS')).toBe(false)
  })
})

describe('Settings: platforms', () => {
  it('edits last checked and the default platform per wrapper', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db, '2026-11-05')
    const platforms = await screen.findByRole('region', { name: 'Platforms' })
    const t212 = await within(platforms).findByRole('group', { name: 'Trading 212' })
    expect(within(platforms).getAllByText('Checked 10 days ago').length).toBe(4)
    fireEvent.change(within(t212).getByLabelText('Last checked'), { target: { value: '2026-11-01' } })
    expect(within(t212).getByText('Checked 4 days ago')).toBeInTheDocument()
    await user.selectOptions(within(platforms).getByLabelText('Default for Stocks and shares ISA'), 'trading212')
    const options = within(within(platforms).getByLabelText('Default for Pension (SIPP)')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Choose each month', 'IG', 'Trading 212'])
    await user.click(within(platforms).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(platforms).getByRole('status')).toHaveTextContent('Saved'))
    expect((await db.platforms.get('trading212'))?.lastChecked).toBe('2026-11-01')
    expect((await db.settings.get('main'))?.defaultPlatformByWrapper).toEqual({ isa: 'trading212' })
  })
})

describe('Settings: app lock', () => {
  it('stores a salted hash, never the plain passcode, and shows the honesty note', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const lock = await screen.findByRole('region', { name: 'App lock' })
    expect(within(lock).getByText('This keeps casual access out. Your encrypted backup is the strongly protected copy.')).toBeInTheDocument()
    await user.type(within(lock).getByLabelText('Passcode'), '2468')
    await user.type(within(lock).getByLabelText('Confirm passcode'), '2468')
    await user.click(within(lock).getByRole('button', { name: 'Set passcode' }))
    await waitFor(() => expect(within(lock).getByRole('status')).toHaveTextContent('Passcode set'))
    const stored = (await db.settings.get('main'))?.appLock
    expect(stored).toEqual({ salt: expect.any(String), hash: expect.any(String) })
    expect(stored?.hash).not.toBe('2468')
    expect(JSON.stringify(await db.settings.toArray())).not.toContain('2468')
    expect(await verifyPasscode('2468', stored!)).toBe(true)
    expect(await verifyPasscode('1357', stored!)).toBe(false)
    // fields are emptied after saving
    expect(within(lock).getByLabelText('New passcode')).toHaveValue('')
  })

  it('rejects short and mismatched passcodes', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const lock = await screen.findByRole('region', { name: 'App lock' })
    await user.type(within(lock).getByLabelText('Passcode'), '123')
    await user.type(within(lock).getByLabelText('Confirm passcode'), '123')
    await user.click(within(lock).getByRole('button', { name: 'Set passcode' }))
    expect(within(lock).getByRole('alert')).toHaveTextContent('Use at least 4 digits, numbers only')
    await setField(user, within(lock).getByLabelText('Passcode'), '1234')
    await setField(user, within(lock).getByLabelText('Confirm passcode'), '1235')
    await user.click(within(lock).getByRole('button', { name: 'Set passcode' }))
    expect(within(lock).getByRole('alert')).toHaveTextContent("The two passcodes don't match")
    expect((await db.settings.get('main'))?.appLock).toBeNull()
  })

  it('needs the current passcode to remove or change it', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    const { hashPasscode } = await import('../../src/backup/lock')
    await db.settings.update('main', { appLock: await hashPasscode('2468') })
    renderSettings(db)
    const lock = await screen.findByRole('region', { name: 'App lock' })
    expect(within(lock).getByText('App lock is on.')).toBeInTheDocument()

    await user.click(within(lock).getByRole('button', { name: 'Remove passcode' }))
    expect(within(lock).getByRole('alert')).toHaveTextContent('Enter your current passcode')
    await user.type(within(lock).getByLabelText('Current passcode'), '9999')
    await user.click(within(lock).getByRole('button', { name: 'Remove passcode' }))
    await waitFor(() => expect(within(lock).getByRole('alert')).toHaveTextContent("That passcode doesn't match"))
    expect((await db.settings.get('main'))?.appLock).not.toBeNull()

    await user.type(within(lock).getByLabelText('Current passcode'), '2468')
    await user.click(within(lock).getByRole('button', { name: 'Remove passcode' }))
    await waitFor(() => expect(within(lock).getByRole('status')).toHaveTextContent('Passcode removed'))
    expect((await db.settings.get('main'))?.appLock).toBeNull()
  })

  it('changes the passcode when the current one is right', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    const { hashPasscode } = await import('../../src/backup/lock')
    await db.settings.update('main', { appLock: await hashPasscode('2468') })
    renderSettings(db)
    const lock = await screen.findByRole('region', { name: 'App lock' })
    await user.type(within(lock).getByLabelText('Current passcode'), '2468')
    await user.type(within(lock).getByLabelText('New passcode'), '13579')
    await user.type(within(lock).getByLabelText('Confirm passcode'), '13579')
    await user.click(within(lock).getByRole('button', { name: 'Change passcode' }))
    await waitFor(() => expect(within(lock).getByRole('status')).toHaveTextContent('Passcode changed'))
    const stored = (await db.settings.get('main'))!.appLock!
    expect(await verifyPasscode('13579', stored)).toBe(true)
  })

  it('does not lock the current session when a passcode is set in the app', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    await db.settings.update('main', { onboardingDone: true })
    render(<App db={db} />)
    await user.click(await screen.findByRole('tab', { name: 'Settings' }))
    const lock = await screen.findByRole('region', { name: 'App lock' })
    await user.type(within(lock).getByLabelText('Passcode'), '2468')
    await user.type(within(lock).getByLabelText('Confirm passcode'), '2468')
    await user.click(within(lock).getByRole('button', { name: 'Set passcode' }))
    await waitFor(() => expect(within(lock).getByRole('status')).toHaveTextContent('Passcode set'))
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument()
  })
})

describe('Settings: appearance', () => {
  it('applies the theme immediately and saves it', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderSettings(db)
    const appearance = await screen.findByRole('region', { name: 'Appearance' })
    expect(within(appearance).getByRole('radio', { name: 'System' })).toBeChecked()
    await user.click(within(appearance).getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    await waitFor(async () => expect((await db.settings.get('main'))?.theme).toBe('dark'))
    await user.click(within(appearance).getByRole('radio', { name: 'Light' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })
})

describe('Settings: backup placeholder', () => {
  it('renders the backup and restore section for Task 19 to replace', async () => {
    renderSettings(await freshDb())
    const backup = await screen.findByRole('region', { name: 'Backup and restore' })
    expect(within(backup).getByText('Download an encrypted backup or restore one on another device. Available once setup is complete.')).toBeInTheDocument()
  })
})

describe('Settings: delete all data', () => {
  async function seeded() {
    const db = await freshDb()
    await db.accounts.add({ id: 'a1', name: 'Current', bank: 'Bank', kind: 'current' })
    await db.settings.update('main', { onboardingDone: true, budgetMonthStartDay: 25, theme: 'dark' })
    return db
  }

  it('requires typing DELETE, then empties storage and restores defaults with the wizard due', async () => {
    const user = userEvent.setup()
    const db = await seeded()
    renderSettings(db)
    await user.click(await screen.findByRole('button', { name: 'Delete all data…' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete all data?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const confirm = within(dialog).getByRole('button', { name: 'Delete everything' })
    expect(confirm).toBeDisabled()
    const input = within(dialog).getByLabelText('Type DELETE to confirm')
    expect(input).toHaveFocus()
    await user.type(input, 'delete')
    expect(confirm).toBeDisabled()
    await user.clear(input)
    await user.type(input, 'DELETE')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(async () => expect(await db.accounts.count()).toBe(0))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const settings = await db.settings.get('main')
    expect(settings).toMatchObject({ onboardingDone: false, budgetMonthStartDay: 1, theme: 'system', appLock: null })
    expect(await db.categories.count()).toBe(19)
    expect(await db.holdings.count()).toBe(5)
    expect(await db.platforms.count()).toBe(4)
    for (const t of ['transactions', 'debts', 'savingsPots', 'incomeStreams', 'allowancesUsed'] as const) {
      expect(await db[t].count()).toBe(0)
    }
  })

  it('cancel and Escape leave the data alone', async () => {
    const user = userEvent.setup()
    const db = await seeded()
    renderSettings(db)
    const opener = await screen.findByRole('button', { name: 'Delete all data…' })
    await user.click(opener)
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(await db.accounts.count()).toBe(1)

    await user.click(opener)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await db.accounts.count()).toBe(1)
    expect((await db.settings.get('main'))?.budgetMonthStartDay).toBe(25)
  })

  it('brings the setup wizard back in the app after deleting', async () => {
    const user = userEvent.setup()
    const db = await seeded()
    render(<App db={db} />)
    await user.click(await screen.findByRole('tab', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Delete all data…' }))
    await user.type(await screen.findByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(screen.getByRole('button', { name: 'Delete everything' }))
    expect(await screen.findByText('Step 1 of 8')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})
