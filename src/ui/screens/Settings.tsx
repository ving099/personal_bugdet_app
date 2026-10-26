import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { Settings as SettingsRow, Wrapper } from '../../domain/types'
import { pensionFirst } from '../../invest/wrappers'
import { Button, NumberInput } from '../components/forms'
import SplitBar from '../components/SplitBar'
import { parseNumber, todayISO } from '../formValues'
import { useDb } from '../useDb'
import AllowancesSection from './AllowancesSection'
import AppLockSection from './AppLockSection'
import BackupSection from './BackupSection'
import DeleteSection from './DeleteSection'
import FundsSection from './FundsSection'
import PlatformsSection from './PlatformsSection'
import { SaveRow, SettingsSection } from './SettingsSection'
import { validateBucketSplit, validateMonthStartDay, validatePercent } from './settingsValidation'
import { useSaveStatus } from './useSaveStatus'

/** The two places money can go first. The Lifetime ISA sits inside the ISA allowance; general investing is always last. */
type Priority = 'pension' | 'isa'
const PRIORITY_NAMES: Record<Priority, string> = {
  pension: 'Pension (SIPP)', isa: 'ISA (stocks and shares, and Lifetime ISA)',
}
const toWrapperOrder = (p: Priority[]): Wrapper[] =>
  p[0] === 'pension' ? ['pension', 'isa', 'lisa', 'gia'] : ['isa', 'lisa', 'pension', 'gia']

function BudgetSection({ settings }: { settings: SettingsRow }) {
  const db = useDb()
  const { status, run, setStatus, clear } = useSaveStatus()
  const [day, setDay] = useState(String(settings.budgetMonthStartDay))
  const [apr, setApr] = useState(String(settings.aprThresholdPercent))
  const [buffer, setBuffer] = useState(String(settings.bufferPercent))
  const [topUp, setTopUp] = useState(String(settings.emergencyTopUpSharePercent))
  const errors = {
    day: validateMonthStartDay(day), apr: validatePercent(apr), buffer: validatePercent(buffer), topUp: validatePercent(topUp),
  }

  async function save() {
    clear()
    if (Object.values(errors).some(Boolean)) {
      setStatus('Fix the highlighted fields first.')
      return
    }
    await run(() =>
      db.settings
        .update('main', {
          budgetMonthStartDay: Number(parseNumber(day)),
          aprThresholdPercent: Number(parseNumber(apr)),
          bufferPercent: Number(parseNumber(buffer)),
          emergencyTopUpSharePercent: Number(parseNumber(topUp)),
        })
        .then(() => undefined),
    )
  }

  const change = (set: (v: string) => void) => (v: string) => {
    clear()
    set(v)
  }
  return (
    <SettingsSection title="Budget">
      <div className="row-fields">
        <NumberInput label="Budget month start day" value={day} onChange={change(setDay)} error={errors.day}
          hint="The day your budget month begins, 1 to 28." />
        <NumberInput label="APR threshold" suffix="%" value={apr} onChange={change(setApr)} error={errors.apr}
          hint="Debts above this rate are paid off before you invest." />
        <NumberInput label="Safety buffer" suffix="%" value={buffer} onChange={change(setBuffer)} error={errors.buffer}
          hint="The share of leftover money held back before investing." />
        <NumberInput label="Emergency fund top-up share" suffix="%" value={topUp} onChange={change(setTopUp)}
          error={errors.topUp} hint="The share of what is left that goes to your emergency fund until it reaches its target." />
      </div>
      <SaveRow onSave={() => void save()} status={status} />
    </SettingsSection>
  )
}

function InvestingSection({ settings }: { settings: SettingsRow }) {
  const db = useDb()
  const { status, run, setStatus, clear } = useSaveStatus()
  const [growth, setGrowth] = useState(String(settings.bucketSplit.growth))
  const [aggressive, setAggressive] = useState(String(settings.bucketSplit.aggressive))
  const [order, setOrder] = useState<Priority[]>(pensionFirst(settings.wrapperOrder) ? ['pension', 'isa'] : ['isa', 'pension'])
  const [pension, setPension] = useState(String(settings.wrapperShares.pension ?? 0))
  const [lisaShare, setLisaShare] = useState(settings.wrapperShares.lisa === undefined ? '' : String(settings.wrapperShares.lisa))
  const [lisaOn, setLisaOn] = useState(settings.lisaEnabled ?? false)

  const splitError = validateBucketSplit(growth, aggressive)
  const pensionError = validatePercent(pension)
  const lisaError = lisaOn && lisaShare.trim() !== '' ? validatePercent(lisaShare) : undefined
  const g = Number(parseNumber(growth))
  const a = Number(parseNumber(aggressive))

  function move(i: number, by: -1 | 1) {
    clear()
    const next = [...order]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    setOrder(next)
  }
  const change = (set: (v: string) => void) => (v: string) => {
    clear()
    set(v)
  }

  async function save() {
    clear()
    if (splitError || pensionError || lisaError) {
      setStatus('Fix the highlighted fields first.')
      return
    }
    const shares = { ...settings.wrapperShares, pension: Number(parseNumber(pension)) }
    if (lisaOn) {
      if (lisaShare.trim() === '') delete shares.lisa
      else shares.lisa = Number(parseNumber(lisaShare))
    }
    await run(() =>
      db.settings
        .update('main', {
          bucketSplit: { growth: g, aggressive: a },
          wrapperOrder: toWrapperOrder(order),
          wrapperShares: shares,
          lisaEnabled: lisaOn,
        })
        .then(() => undefined),
    )
  }

  return (
    <SettingsSection title="Investing">
      <h3 className="settings-subheading">Growth and aggressive split</h3>
      <div className="row-fields">
        <NumberInput label="Growth" suffix="%" value={growth} onChange={change(setGrowth)} />
        <NumberInput label="Aggressive" suffix="%" value={aggressive} onChange={change(setAggressive)} />
      </div>
      {splitError ? (
        <p className="field-error">{splitError}</p>
      ) : (
        <div className="split-preview">
          <SplitBar growthPct={(g / (g + a)) * 100} aggressivePct={(a / (g + a)) * 100} />
        </div>
      )}

      <h3 className="settings-subheading">Account order</h3>
      <p className="settings-note">Money goes to the account at the top first.</p>
      <ol className="order-list">
        {order.map((w, i) => (
          <li className="order-item" key={w}>
            <span className="order-name">{PRIORITY_NAMES[w]}</span>
            <Button variant="secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${PRIORITY_NAMES[w]} up`}>
              Up
            </Button>
            <Button variant="secondary" disabled={i === order.length - 1} onClick={() => move(i, 1)}
              aria-label={`Move ${PRIORITY_NAMES[w]} down`}>
              Down
            </Button>
          </li>
        ))}
      </ol>
      <p className="settings-note">General investing always gets whatever is left.</p>

      <h3 className="settings-subheading">Shares</h3>
      <div className="row-fields">
        <NumberInput label="Pension share" suffix="%" value={pension} onChange={change(setPension)} error={pensionError}
          hint="The share of what you invest that goes into your pension. Pension money is locked until pension age." />
        {lisaOn && (
          <NumberInput label="Lifetime ISA share" suffix="%, optional" value={lisaShare} onChange={change(setLisaShare)}
            error={lisaError} hint="Leave blank for no cap." />
        )}
      </div>

      <h3 className="settings-subheading">Lifetime ISA</h3>
      <div className="switch-row">
        <input
          id="lisa-switch"
          className="switch"
          type="checkbox"
          role="switch"
          checked={lisaOn}
          aria-describedby="lisa-switch-hint"
          onChange={(e) => {
            clear()
            setLisaOn(e.target.checked)
          }}
        />
        <label className="check-label" htmlFor="lisa-switch">
          Use a Lifetime ISA
        </label>
        <p className="field-hint switch-hint" id="lisa-switch-hint">
          Turn this on only if you&apos;re eligible for a Lifetime ISA.
        </p>
      </div>
      <SaveRow onSave={() => void save()} status={status} />
    </SettingsSection>
  )
}

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

function AppearanceSection({ settings }: { settings: SettingsRow }) {
  const db = useDb()
  const { status, run } = useSaveStatus()
  async function choose(theme: SettingsRow['theme']) {
    document.documentElement.setAttribute('data-theme', theme)
    await run(() => db.settings.update('main', { theme }).then(() => undefined), 'Saved')
  }
  return (
    <SettingsSection title="Appearance">
      <fieldset className="radio-group">
        <legend className="field-label">Theme</legend>
        {THEMES.map((t) => (
          <label className="radio" key={t.value}>
            <input type="radio" name="theme" className="radio-input" value={t.value} checked={settings.theme === t.value}
              onChange={() => void choose(t.value)} />
            <span>{t.label}</span>
          </label>
        ))}
      </fieldset>
      <p className="save-status" role="status">
        {status}
      </p>
    </SettingsSection>
  )
}

export default function Settings({ today = todayISO() }: { today?: string }) {
  const db = useDb()
  const row = useLiveQuery(() => db.settings.get('main'), [db])
  if (!row) return <div className="loading" role="status">Loading</div>
  const settings: SettingsRow = { ...row, lisaEnabled: row.lisaEnabled ?? false, onboardingDone: row.onboardingDone ?? false }
  return (
    <div className="settings">
      <BudgetSection settings={settings} />
      <InvestingSection settings={settings} />
      <AllowancesSection settings={settings} today={today} />
      <FundsSection />
      <PlatformsSection settings={settings} today={today} />
      <AppLockSection appLock={settings.appLock} />
      <AppearanceSection settings={settings} />
      <BackupSection today={today} />
      <DeleteSection />
    </div>
  )
}
