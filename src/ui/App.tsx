import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { openDb, type BudgetDB } from '../storage/db'
import { seedDefaults } from '../storage/seed'
import './theme.css'
import EmptyState from './components/EmptyState'
import ErrorBoundary from './components/ErrorBoundary'
import {
  BudgetIcon, DebtsIcon, HomeIcon, ImportIcon, InvestIcon, SettingsIcon,
} from './components/icons'
import { panelId, tabId } from './components/tabIds'
import TabNav, { type TabItem } from './components/Tabs'
import LockScreen from './LockScreen'
import { DbProvider } from './DbProvider'
import Budget from './screens/Budget'
import DebtsSavings from './screens/DebtsSavings'
import Home from './screens/Home'
import Import from './screens/Import'
import Invest from './screens/Invest'
import { useInvestPlan } from './screens/invest/investDb'
import Settings from './screens/Settings'
import Wizard from './screens/Wizard'
import { todayISO } from './formValues'
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

/** Debts with "Extra per month" starting from the live plan, so Home, Invest and Debts agree. */
function DebtsTab() {
  const today = todayISO()
  const live = useInvestPlan(today)
  if (!live) return <Loading />
  const { investable } = live.view
  return <DebtsSavings today={today} extraDebtPence={investable.ok ? investable.extraDebtPence : 0} />
}

const SCREENS: Record<TabKey, (go: (tab: TabKey) => void) => ReactNode> = {
  home: (go) => <Home onNavigate={go} />,
  import: () => <Import />,
  budget: () => <Budget />,
  debts: () => <DebtsTab />,
  invest: () => <Invest />,
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

/** After a crash the app reopens on Home, not on the screen that failed, so a reload cannot loop on it. */
function forgetTab(): void {
  try {
    window.localStorage.removeItem(TAB_KEY)
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

  const [moves, setMoves] = useState(0)

  function choose(next: TabKey) {
    setTab(next)
    rememberTab(next)
  }

  /** In-page links (for example Home's "See the plan") switch tab and move focus to the new page. */
  function go(next: TabKey) {
    choose(next)
    setMoves((n) => n + 1)
  }

  useEffect(() => {
    if (moves > 0) document.getElementById('main')?.focus()
  }, [moves])

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TabNav tabs={TABS} active={tab} onChange={choose} variant={wide ? 'sidebar' : 'bottom'} />
      <main className="main" id="main" tabIndex={-1}>
        <div className="content" role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
          <h1 className="page-title">{current.label}</h1>
          {/* Keyed by tab: switching tab clears an error, and the tabs stay usable while one shows. */}
          <ErrorBoundary key={tab} onError={forgetTab} onGoToSettings={() => go('settings')}>
            {SCREENS[tab](go)}
          </ErrorBoundary>
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
  // Last line of defence for anything outside the tabbed screens (lock, wizard, shell): never a blank page.
  return (
    <ErrorBoundary standalone onError={forgetTab} onGoToSettings={() => rememberTab('settings')}>
      <Ready db={db} />
    </ErrorBoundary>
  )
}
