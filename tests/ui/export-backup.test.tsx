import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptBackup, encryptBackup } from '../../src/backup/crypto'
import { hashPasscode, verifyPasscode } from '../../src/backup/lock'
import { exportSnapshot, restoreSnapshot } from '../../src/backup/snapshot'
import type { Transaction } from '../../src/domain/types'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import { DbProvider } from '../../src/ui/DbProvider'
import Budget from '../../src/ui/screens/Budget'
import Home from '../../src/ui/screens/Home'
import Invest from '../../src/ui/screens/Invest'
import Settings from '../../src/ui/screens/Settings'

const TODAY = '2026-10-26'
const PASS = 'correct horse battery'
const FAST = 1000 // PBKDF2 rounds for fixture files; the header carries the count, so decrypting them is quick
let counter = 0
const opened: BudgetDB[] = []

async function freshDb(): Promise<BudgetDB> {
  const db = openDb(`export-backup-test-${Date.now()}-${counter++}`)
  opened.push(db)
  await seedDefaults(db)
  await db.settings.update('main', { onboardingDone: true })
  return db
}

async function withData(db: BudgetDB): Promise<void> {
  await db.incomeStreams.put({ id: 's', label: 'Salary', expectedMonthlyNetPence: 300000 })
  await db.accounts.put({ id: 'cur', name: 'Current', bank: 'Bank', kind: 'current' })
  const tx = (id: string, amountPence: number, extra: Partial<Transaction> = {}): Transaction => ({
    id, accountId: 'cur', date: '2026-10-05', amountPence, description: id, fingerprint: id, batchId: 'b',
    isTransfer: false, isRefund: false, ...extra,
  })
  await db.transactions.bulkPut([tx('pay', 300000, { incomeStreamId: 's' }), tx('shop', -4500)])
}

interface Download { blob: Blob; name: string; url: string }
let urlSeq = 0 // never reset: deferred revokes from earlier tests must not look like this test's
let downloads: Download[]
let revoked: string[]

beforeEach(() => {
  downloads = []
  revoked = []
  let pending: { blob: Blob; url: string } | undefined
  URL.createObjectURL = vi.fn((b: Blob) => {
    pending = { blob: b, url: `blob:test-${++urlSeq}` }
    return pending.url
  })
  URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u) })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ ...pending!, name: this.download })
  })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

function show(db: BudgetDB, ui: React.ReactNode) {
  return render(<DbProvider db={db}>{ui}</DbProvider>)
}

const SPREADSHEET = 'Download month-end spreadsheet'

async function sheetNames(d: Download): Promise<string[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await bytesOf(d.blob)) as unknown as ArrayBuffer)
  return wb.worksheets.map((w) => w.name)
}

describe('month-end spreadsheet', () => {
  it('Home downloads budget-YYYY-MM.xlsx with seven sheets and revokes the URL', async () => {
    const db = await freshDb()
    await withData(db)
    const user = userEvent.setup()
    show(db, <Home today={TODAY} />)
    await user.click(await screen.findByRole('button', { name: SPREADSHEET }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].name).toBe('budget-2026-10.xlsx')
    expect(downloads[0].blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const names = await sheetNames(downloads[0])
    expect(names).toHaveLength(7)
    expect(names).toEqual(expect.arrayContaining(['Summary', 'Transactions', 'Budget vs actual', 'Investment plan']))
    await waitFor(() => expect(revoked).toContain(downloads[0].url), { timeout: 3000 })
  })

  it('Budget exports the month shown and ignores a double click', async () => {
    const db = await freshDb()
    await withData(db)
    const user = userEvent.setup()
    show(db, <Budget today={TODAY} />)
    const button = await screen.findByRole('button', { name: SPREADSHEET })
    await user.dblClick(button)
    await waitFor(() => expect(downloads).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: SPREADSHEET })).toHaveAttribute('aria-busy', 'false'))
    expect(downloads).toHaveLength(1)
    expect(downloads[0].name).toBe('budget-2026-10.xlsx')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await bytesOf(downloads[0].blob)) as unknown as ArrayBuffer)
    expect(wb.getWorksheet('Transactions')!.rowCount).toBe(3) // header and the two transactions
  })

  it('shows an alert when the download fails and recovers on retry', async () => {
    const db = await freshDb()
    await withData(db)
    const user = userEvent.setup()
    show(db, <Home today={TODAY} />)
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error('no') })
    await user.click(await screen.findByRole('button', { name: SPREADSHEET }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't make the spreadsheet"))
    await user.click(screen.getByRole('button', { name: SPREADSHEET }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})

async function fillBackup(user: ReturnType<typeof userEvent.setup>, pass: string, confirm: string) {
  await user.type(await screen.findByLabelText('Backup passphrase'), pass)
  await user.type(screen.getByLabelText('Confirm backup passphrase'), confirm)
}

async function backupFile(db: BudgetDB, name = 'backup.bin'): Promise<File> {
  return new File([(await encryptBackup(await exportSnapshot(db), PASS, FAST)) as BlobPart], name)
}

async function chooseAndRestore(user: ReturnType<typeof userEvent.setup>, file: File, pass: string) {
  await user.upload(await screen.findByLabelText('Backup file'), file)
  await user.type(screen.getByLabelText('Passphrase for the backup file'), pass)
  await user.click(screen.getByRole('button', { name: 'Restore from backup…' }))
}

describe('encrypted backup', () => {
  it('downloads budget-backup-<today>.bin, records the date, and restores into a clean db', async () => {
    const source = await freshDb()
    await withData(source)
    const user = userEvent.setup()
    show(source, <Settings today={TODAY} />)
    await waitFor(() => expect(screen.getByText('No backup yet')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('Backup passphrase')).toHaveAttribute('autocomplete', 'new-password'))
    await fillBackup(user, PASS, PASS)
    // Hold key derivation at a gate so the busy state is observable however fast the machine is.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const derive = crypto.subtle.deriveKey.bind(crypto.subtle) as (...a: unknown[]) => Promise<CryptoKey>
    vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation((async (...a: unknown[]) => {
      await gate
      return derive(...a)
    }) as never)
    await user.click(screen.getByRole('button', { name: 'Download encrypted backup' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Encrypting…' })).toBeInTheDocument())
    release()
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 15000 })
    expect(downloads[0].name).toBe('budget-backup-2026-10-26.bin')
    await waitFor(() => expect(revoked).toContain(downloads[0].url), { timeout: 3000 })
    await waitFor(async () => expect((await source.settings.get('main'))?.backupLastAt).toBe('2026-10-26'))
    await waitFor(() => expect(screen.getByText('Last backup: 26 Oct 2026')).toBeInTheDocument(), { timeout: 10000 })
    await waitFor(() => expect(screen.getByText(/Backup downloaded/)).toBeInTheDocument(), { timeout: 10000 })
    await waitFor(() => expect(screen.getByLabelText('Backup passphrase')).toHaveValue(''))
    cleanup()

    // A different, empty device restores it through the UI.
    const target = await freshDb()
    const file = new File([(await bytesOf(downloads[0].blob)) as BlobPart], 'budget-backup-2026-10-26.bin')
    show(target, <Settings today={TODAY} />)
    await chooseAndRestore(user, file, PASS)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('replaces all data on this device')
    await user.click(within(dialog).getByRole('button', { name: 'Replace all data' }))
    await waitFor(() => expect(screen.getByText(/Backup restored/)).toBeInTheDocument(), { timeout: 15000 })
    await waitFor(() => expect(screen.getByText(/Backup restored/)).toHaveAttribute('role', 'status'))
    expect(await target.transactions.count()).toBe(2)
    expect((await target.incomeStreams.toArray()).map((s) => s.label)).toEqual(['Salary'])
    expect((await target.settings.get('main'))?.backupLastAt).toBe('2026-10-26') // the file carries its own date
  }, 40000)

  it('warns, rather than failing, when the file downloaded but the date could not be saved', async () => {
    const db = await freshDb()
    const user = userEvent.setup()
    vi.spyOn(db.settings, 'update').mockRejectedValueOnce(new Error('disk full'))
    show(db, <Settings today={TODAY} />)
    await fillBackup(user, PASS, PASS)
    await user.click(screen.getByRole('button', { name: 'Download encrypted backup' }))
    await waitFor(() => expect(screen.getByText(/downloaded, but the 'last backup' date could not be saved/)).toBeInTheDocument(), { timeout: 15000 })
    expect(downloads).toHaveLength(1)
    expect(screen.queryByText(/Couldn't make the backup/)).not.toBeInTheDocument()
  }, 30000)

  it('stamps the backup date into the file itself', async () => {
    const db = await freshDb()
    const snap = JSON.parse(await exportSnapshot(db, { settings: { backupLastAt: TODAY } }))
    expect(snap.tables.settings[0].backupLastAt).toBe(TODAY)
  })

  it('shows a mismatch error and makes no backup', async () => {
    const db = await freshDb()
    const user = userEvent.setup()
    show(db, <Settings today={TODAY} />)
    await fillBackup(user, PASS, 'something else')
    await waitFor(() => expect(screen.getByText("The passphrases don't match.")).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Download encrypted backup' }))
    expect(downloads).toHaveLength(0)
    expect((await db.settings.get('main'))?.backupLastAt).toBeUndefined()
  })

  it('asks for a longer passphrase', async () => {
    const db = await freshDb()
    const user = userEvent.setup()
    show(db, <Settings today={TODAY} />)
    await fillBackup(user, 'short', 'short')
    await user.click(screen.getByRole('button', { name: 'Download encrypted backup' }))
    await waitFor(() => expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument())
    expect(downloads).toHaveLength(0)
  })

  it('says the last backup is overdue after 30 days', async () => {
    const db = await freshDb()
    await db.settings.update('main', { backupLastAt: '2026-08-01' })
    show(db, <Settings today={TODAY} />)
    await waitFor(() => expect(screen.getByText('Last backup: 1 Aug 2026')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/over 30 days/)).toBeInTheDocument())
  })
})

describe('restore', () => {
  it('a wrong passphrase gives the plain message and changes nothing', async () => {
    const source = await freshDb()
    await withData(source)
    const file = await backupFile(source)
    const target = await freshDb()
    await target.accounts.put({ id: 'mine', name: 'Mine', bank: 'B', kind: 'current' })
    const user = userEvent.setup()
    show(target, <Settings today={TODAY} />)
    await chooseAndRestore(user, file, 'not the passphrase')
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace all data' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wrong passphrase, or the file is damaged.'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect((await target.accounts.toArray()).map((a) => a.id)).toEqual(['mine'])
    expect(await target.transactions.count()).toBe(0)
  })

  it('a file that is not a backup gives the damaged-file message', async () => {
    const target = await freshDb()
    await target.accounts.put({ id: 'mine', name: 'Mine', bank: 'B', kind: 'current' })
    const user = userEvent.setup()
    show(target, <Settings today={TODAY} />)
    await chooseAndRestore(user, new File([new Uint8Array(200)], 'junk.bin'), PASS)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace all data' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("This file looks damaged or isn't a backup from this app."))
    expect(await target.accounts.count()).toBe(1)
  })

  it('a valid wrapper around the wrong data keeps existing data', async () => {
    const target = await freshDb()
    await target.accounts.put({ id: 'mine', name: 'Mine', bank: 'B', kind: 'current' })
    const bad = await encryptBackup(JSON.stringify({ app: 'budget', version: 1, tables: { accounts: [{ id: 'x' }, { id: 'x' }] } }), PASS, FAST)
    const user = userEvent.setup()
    show(target, <Settings today={TODAY} />)
    await chooseAndRestore(user, new File([bad as BlobPart], 'dup.bin'), PASS)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace all data' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't restore. Your existing data has not been changed."))
    expect((await target.accounts.toArray()).map((a) => a.id)).toEqual(['mine'])
  })

  it('cancelling the confirmation changes nothing and returns focus to the button', async () => {
    const source = await freshDb()
    await withData(source)
    const file = await backupFile(source)
    const target = await freshDb()
    const user = userEvent.setup()
    show(target, <Settings today={TODAY} />)
    await chooseAndRestore(user, file, PASS)
    const opener = screen.getByRole('button', { name: 'Restore from backup…' })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('replaces all data on this device')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
    expect(await target.transactions.count()).toBe(0)
  })

  it('announces the chosen file name', async () => {
    const db = await freshDb()
    const user = userEvent.setup()
    show(db, <Settings today={TODAY} />)
    await user.upload(await screen.findByLabelText('Backup file', { exact: true }), new File(['x'], 'my-backup.bin'))
    await waitFor(() => expect(screen.getByText('Chosen file: my-backup.bin')).toHaveAttribute('role', 'status'))
  })

  it('needs a file and a passphrase before asking', async () => {
    const db = await freshDb()
    const user = userEvent.setup()
    show(db, <Settings today={TODAY} />)
    await user.click(await screen.findByRole('button', { name: 'Restore from backup…' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Choose a backup file first.'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('restores a backup made from an older row shape, and the Invest tab can untick it', async () => {
    const source = await freshDb()
    await source.investmentLog.put({
      id: 'old-1', month: '2026-10', wrapper: 'isa', holdingId: 'growth-global', plannedPence: 10000, actualPence: 10000, platformId: 'hl',
    } as never) // no taxYear: how rows looked before that field existed
    await source.allowancesUsed.put({ taxYear: '2026/27', wrapper: 'isa', usedPence: 10000 })
    const file = await backupFile(source)
    const target = await freshDb()
    const user = userEvent.setup()
    const first = show(target, <Settings today={TODAY} />)
    await chooseAndRestore(user, file, PASS)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace all data' }))
    await waitFor(() => expect(screen.getByText(/Backup restored/)).toBeInTheDocument())
    expect(await target.investmentLog.get('old-1')).toBeDefined()
    first.unmount()

    show(target, <Invest today={TODAY} />)
    const logged = await screen.findByRole('region', { name: 'Logged this month' })
    const box = within(logged).getByRole('checkbox', { name: /logged for 2026\/27/ })
    expect(box).toBeChecked()
    await user.click(box)
    await waitFor(async () => expect(await target.investmentLog.count()).toBe(0))
    expect((await target.allowancesUsed.get(['2026/27', 'isa']))?.usedPence).toBe(0)
  })

  it('keeps this device app lock, ignoring any lock in the file', async () => {
    const source = await freshDb()
    await withData(source)
    const old = JSON.parse(await exportSnapshot(source))
    old.tables.settings[0].appLock = { salt: 'AAAA', hash: 'BBBB' } // an old file that still carries a lock
    const file = new File([(await encryptBackup(JSON.stringify(old), PASS, FAST)) as BlobPart], 'old.bin')
    const target = await freshDb()
    const mine = await hashPasscode('2468', 1000)
    await target.settings.update('main', { appLock: mine })
    const user = userEvent.setup()
    show(target, <Settings today={TODAY} />)
    await chooseAndRestore(user, file, PASS)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace all data' }))
    await waitFor(() => expect(screen.getByText(/Your app lock on this device was not changed/)).toBeInTheDocument())
    const lock = (await target.settings.get('main'))!.appLock!
    expect(lock).toEqual(mine)
    expect(await verifyPasscode('2468', lock, 1000)).toBe(true)
    expect(await target.transactions.count()).toBe(2)
  })

  it('a backup without a lock does not remove this device lock, and restoring onto an unlocked device adds none', async () => {
    const source = await freshDb()
    const file = await backupFile(source)
    expect(JSON.stringify(await exportSnapshot(source))).not.toContain('"appLock"')
    const locked = await freshDb()
    const mine = await hashPasscode('1357', 1000)
    await locked.settings.update('main', { appLock: mine })
    const user = userEvent.setup()
    show(locked, <Settings today={TODAY} />)
    await chooseAndRestore(user, file, PASS)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace all data' }))
    await waitFor(() => expect(screen.getByText(/Backup restored/)).toBeInTheDocument())
    expect((await locked.settings.get('main'))!.appLock).toEqual(mine)
    cleanup()

    const open = await freshDb()
    show(open, <Settings today={TODAY} />)
    await chooseAndRestore(user, file, PASS)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace all data' }))
    await waitFor(() => expect(screen.getByText(/Backup restored/)).toBeInTheDocument())
    expect((await open.settings.get('main'))!.appLock).toBeNull()
  })

  it('refuses a file over 50 MB', async () => {
    const target = await freshDb()
    const user = userEvent.setup()
    show(target, <Settings today={TODAY} />)
    const big = new File(['x'], 'big.bin')
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 })
    await chooseAndRestore(user, big, PASS)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('too big'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('round-trips through the library as well', async () => {
    const source = await freshDb()
    await withData(source)
    const target = await freshDb()
    await restoreSnapshot(target, await decryptBackup(await encryptBackup(await exportSnapshot(source), PASS, FAST), PASS))
    expect(await target.transactions.count()).toBe(2)
  })
})
