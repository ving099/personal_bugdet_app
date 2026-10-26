import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { openDb, type BudgetDB } from '../storage/db'
import { seedDefaults } from '../storage/seed'
import './theme.css'
import EmptyState from './components/EmptyState'
import {
  BudgetIcon, DebtsIcon, HomeIcon, ImportIcon, InvestIcon, SettingsIcon,
} from './components/icons'
import { panelId, tabId } from './components/tabIds'
import TabNav, { type TabItem } from './components/Tabs'
import LockScreen from './LockScreen'
import { DbProvider } from './DbProvider'
import Budget from './screens/Budget'
import DebtsSavings from './screens/DebtsSavings'
import Import from './screens/Import'
import Settings from './screens/Settings'
import Wizard from './screens/Wizard'
import { useMediaQuery } from './useMediaQuery'

type TabKey = 'home' | 'import' | 'budget' | 'debts' | 'invest' | 'settings'

const TABS: readonly TabItem<TabKey>[] = [
  { id: 'home', label: 'Home', icon: <HomeIcon /> },
  { id: 'import', label: 'Import', icon: <ImportIcon /> },
  { id: 'budget', label: 'Budget', icon: <BudgetIcon /> },
  { id: 'debts', label: 'Debts & Savings', shortLabel: 'Debts', icon: <DebtsIcon /> },
  { id: 'invest', label: 'Invest', icon: <InvestIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

/** Placeholder screens; tasks 15-19 replace these one by one. */
const SCREENS: Record<TabKey, () => ReactNode> = {
  home: () => (
    <EmptyState
      title="Nothing to show yet"
      body="Import a bank statement to see where your money goes and what you can invest this month."
    />
  ),
  import: () => <Import />,
  budget: () => <Budget />,
  debts: () => <DebtsSavings />,
  invest: () => (
    <EmptyState
      title="Nothing to invest yet"
      body="After you import a month of income and spending, this page shows what is safe to invest."
    />
  ),
  settings: () => <Settings />,
}

const TAB_KEY = 'budget.lastTab'

function readLastTab(): TabKey {
  try {
    const v = window.localStorage.getItem(TAB_KEY)
    if (TABS.some((t) => t.id === v)) return v as TabKey
  } catch {
    /* storage unavailable: convenience only */
  }
  return 'home'
}

function rememberTab(tab: TabKey): void {
  try {
    window.localStorage.setItem(TAB_KEY, tab)
  } catch {
    /* storage unavailable: convenience only */
  }
}

function Loading() {
  return (
    <div className="loading" role="status">
      Loading
    </div>
  )
}

function Shell() {
  const [tab, setTab] = useState<TabKey>(readLastTab)
  const wide = useMediaQuery('(min-width: 900px)')
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]

  function choose(next: TabKey) {
    setTab(next)
    rememberTab(next)
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TabNav tabs={TABS} active={tab} onChange={choose} variant={wide ? 'sidebar' : 'bottom'} />
      <main className="main" id="main" tabIndex={-1}>
        <div className="content" role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
          <h1 className="page-title">{current.label}</h1>
          {SCREENS[tab]()}
        </div>
      </main>
    </div>
  )
}

function Ready({ db }: { db: BudgetDB }) {
  const settings = useLiveQuery(() => db.settings.get('main'), [db])
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings?.theme ?? 'system')
  }, [settings?.theme])

  if (!settings) return <Loading />
  // A lock set while the app is open must not lock the person out of the session they are in.
  if (!settings.appLock && !unlocked) setUnlocked(true)
  if (settings.appLock && !unlocked) {
    return <LockScreen stored={settings.appLock} onUnlock={() => setUnlocked(true)} />
  }
  return (
    <DbProvider db={db}>
      {settings.onboardingDone ? <Shell /> : <Wizard />}
    </DbProvider>
  )
}

export default function App({ db: provided }: { db?: BudgetDB }) {
  const [db] = useState(() => provided ?? openDb())
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    let cancelled = false
    seedDefaults(db).then(
      () => !cancelled && setState('ready'),
      () => !cancelled && setState('failed'),
    )
    return () => {
      cancelled = true
    }
  }, [db])

  if (state === 'failed') {
    return (
      <main className="lock">
        <EmptyState
          title="Storage is unavailable"
          body="Budget keeps your data in this browser, and the browser is not allowing it. If you are in a private window, open the app in a normal window. Otherwise check that site data is allowed for this page, then reload."
        />
      </main>
    )
  }
  if (state === 'loading') return <Loading />
  return <Ready db={db} />
}
