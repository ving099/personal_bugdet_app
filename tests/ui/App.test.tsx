import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { hashPasscode } from '../../src/backup/lock'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import App from '../../src/ui/App'
import { useDb } from '../../src/ui/useDb'
import { setViewportWidth } from './viewport'

let counter = 0
const opened: BudgetDB[] = []

/** A seeded database whose setup wizard is already done, so the tabs show straight away. */
async function freshDb(): Promise<BudgetDB> {
  const db = openDb(`ui-test-${Date.now()}-${counter++}`)
  opened.push(db)
  await seedDefaults(db)
  await db.settings.update('main', { onboardingDone: true })
  return db
}

afterEach(async () => {
  cleanup()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

async function ready() {
  await screen.findByRole('tablist')
}

describe('App shell', () => {
  it('renders the six destinations and switches content on click', async () => {
    const user = userEvent.setup()
    render(<App db={await freshDb()} />)
    await ready()
    const names = ['Home', 'Import', 'Budget', 'Debts & Savings', 'Invest', 'Settings']
    for (const name of names) expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(6)
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Budget' }))
    expect(screen.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('heading', { level: 1, name: 'Budget' })).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { level: 1 })).toHaveTextContent('Budget')
  })

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<App db={await freshDb()} />)
    await ready()
    screen.getByRole('tab', { name: 'Home' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('tab', { name: 'Import' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  })

  it('uses the bottom bar by default and the sidebar at 900px and above', async () => {
    const { unmount } = render(<App db={await freshDb()} />)
    await ready()
    expect(screen.getByRole('navigation')).toHaveAttribute('data-variant', 'bottom')
    unmount()
    setViewportWidth(1200)
    render(<App db={await freshDb()} />)
    await ready()
    expect(screen.getByRole('navigation')).toHaveAttribute('data-variant', 'sidebar')
    expect(screen.getByText('Budget', { selector: '.brand' })).toBeInTheDocument()
  })

  it('has a skip link and a main landmark', async () => {
    render(<App db={await freshDb()} />)
    await ready()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })

  it('follows settings.theme on the html element', async () => {
    const db = await freshDb()
    await db.settings.update('main', { theme: 'dark' })
    render(<App db={db} />)
    await ready()
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'))
    await db.settings.update('main', { theme: 'light' })
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'))
  })

  it('defaults to the system theme', async () => {
    render(<App db={await freshDb()} />)
    await ready()
    expect(document.documentElement).toHaveAttribute('data-theme', 'system')
  })

  it('still renders when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    render(<App db={await freshDb()} />)
    await ready()
    await user.click(screen.getByRole('tab', { name: 'Invest' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Invest' })).toBeInTheDocument()
  })

  it('remembers the last tab', async () => {
    const user = userEvent.setup()
    const first = render(<App db={await freshDb()} />)
    await ready()
    await user.click(screen.getByRole('tab', { name: 'Import' }))
    first.unmount()
    render(<App db={await freshDb()} />)
    await ready()
    expect(screen.getByRole('tab', { name: 'Import' })).toHaveAttribute('aria-selected', 'true')
  })

  it('explains when storage is unavailable', async () => {
    const db = await freshDb()
    vi.spyOn(db, 'transaction').mockRejectedValue(new Error('no storage'))
    render(<App db={db} />)
    expect(await screen.findByText('Storage is unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})

describe('Lock screen', () => {
  let stored: { salt: string; hash: string }
  beforeAll(async () => {
    stored = await hashPasscode('2468')
  }, 20000)

  it('blocks the app until the right passcode is entered', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    await db.settings.update('main', { appLock: stored })
    render(<App db={db} />)
    const input = await screen.findByLabelText('Passcode')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    const unlock = screen.getByRole('button', { name: 'Unlock' })
    expect(unlock).toBeDisabled()

    await user.type(input, '1111')
    await user.click(unlock)
    expect(await screen.findByRole('alert')).toHaveTextContent("That passcode doesn't match. Try again.")
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()

    await user.clear(input)
    await user.type(input, '2468{Enter}')
    expect(await screen.findByRole('tablist')).toBeInTheDocument()
    expect(screen.queryByLabelText('Passcode')).not.toBeInTheDocument()
  }, 30000)
})

describe('useDb', () => {
  it('throws a clear error outside the provider', () => {
    function Probe() {
      useDb()
      return null
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/DbProvider/)
  })
})
