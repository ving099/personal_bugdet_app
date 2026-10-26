import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import App from '../../src/ui/App'

const fault = vi.hoisted(() => ({ invest: false, wizard: false }))

vi.mock('../../src/ui/screens/Invest', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ui/screens/Invest')>()
  return {
    ...real,
    default: (props: Parameters<typeof real.default>[0]) => {
      if (fault.invest) throw new Error('boom in Invest')
      return real.default(props)
    },
  }
})

vi.mock('../../src/ui/screens/Wizard', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ui/screens/Wizard')>()
  return {
    ...real,
    default: () => {
      if (fault.wizard) throw new Error('boom in Wizard')
      return real.default()
    },
  }
})

let counter = 0
const opened: BudgetDB[] = []

async function freshDb(onboardingDone = true): Promise<BudgetDB> {
  const db = openDb(`boundary-test-${Date.now()}-${counter++}`)
  opened.push(db)
  await seedDefaults(db)
  await db.settings.update('main', { onboardingDone })
  return db
}

beforeEach(() => {
  // React logs every caught render error; keep the output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  cleanup()
  fault.invest = false
  fault.wizard = false
  window.localStorage.clear()
  vi.restoreAllMocks()
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

describe('error boundary', () => {
  it('shows a friendly card instead of a blank page and forgets the remembered tab', async () => {
    fault.invest = true
    window.localStorage.setItem('budget.lastTab', 'invest')
    render(<App db={await freshDb()} />)
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Settings' })).toBeInTheDocument()
    // A reload must not land on the screen that crashed.
    expect(window.localStorage.getItem('budget.lastTab')).toBeNull()
    // The tabs stay usable.
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  it('Go to Settings opens Settings so backup and restore stay reachable', async () => {
    fault.invest = true
    window.localStorage.setItem('budget.lastTab', 'invest')
    const user = userEvent.setup()
    render(<App db={await freshDb()} />)
    await user.click(await screen.findByRole('button', { name: 'Go to Settings' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('budget.lastTab')).toBe('settings')
  })

  it('Try again renders the screen once the problem has gone', async () => {
    fault.invest = true
    window.localStorage.setItem('budget.lastTab', 'invest')
    const user = userEvent.setup()
    render(<App db={await freshDb()} />)
    await screen.findByRole('heading', { name: 'Something went wrong' })
    fault.invest = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument())
    expect(await screen.findByRole('heading', { name: 'Invest this month' })).toBeInTheDocument()
  })

  it('switching tab clears the error', async () => {
    fault.invest = true
    window.localStorage.setItem('budget.lastTab', 'invest')
    const user = userEvent.setup()
    render(<App db={await freshDb()} />)
    await screen.findByRole('heading', { name: 'Something went wrong' })
    await user.click(screen.getByRole('tab', { name: 'Budget' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Budget' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument()
  })

  it('also catches errors outside the tabbed screens (top level)', async () => {
    fault.wizard = true
    window.localStorage.setItem('budget.lastTab', 'invest')
    render(<App db={await freshDb(false)} />)
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Settings' })).toBeInTheDocument()
    expect(window.localStorage.getItem('budget.lastTab')).toBeNull()
  })
})
