import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { taxYearOf } from '../../domain/dates'
import type { AllowanceUsed, Pence, Settings } from '../../domain/types'
import { seedSettings } from '../../seed/settings'
import { Button, MoneyInput } from '../components/forms'
import { moneyFieldError, parseMoney, penceToInput } from '../formValues'
import { useDb } from '../useDb'
import { SaveRow, SettingsSection } from './SettingsSection'
import { useSaveStatus } from './useSaveStatus'

const LIMIT_WRAPPERS = ['isa', 'lisa', 'pension'] as const
type LimitWrapper = (typeof LIMIT_WRAPPERS)[number]
const NAMES: Record<LimitWrapper, string> = { isa: 'ISA', lisa: 'Lifetime ISA', pension: 'Pension' }

type Drafts = Record<string, Record<LimitWrapper, string>>

function latestYear(allowances: Settings['allowances']): string | undefined {
  return Object.keys(allowances).sort().at(-1)
}

interface EditorProps {
  settings: Settings
  usedRows: AllowanceUsed[]
  year: string
}

function AllowancesEditor({ settings, usedRows, year }: EditorProps) {
  const db = useDb()
  const { status, run, setStatus, clear } = useSaveStatus()
  const years = Object.keys(settings.allowances).sort().reverse()
  const [limits, setLimits] = useState<Drafts>(() =>
    Object.fromEntries(
      years.map((y) => [y, Object.fromEntries(
        LIMIT_WRAPPERS.map((w) => [w, penceToInput(settings.allowances[y]?.[w] ?? 0)]),
      ) as Record<LimitWrapper, string>]),
    ),
  )
  const [used, setUsed] = useState<Record<LimitWrapper, string>>(() =>
    Object.fromEntries(
      LIMIT_WRAPPERS.map((w) => [w, penceToInput(usedRows.find((r) => r.taxYear === year && r.wrapper === w)?.usedPence ?? 0)]),
    ) as Record<LimitWrapper, string>,
  )
  const [attempted, setAttempted] = useState(false)
  const lisaOn = settings.lisaEnabled ?? false

  const allMoney = [
    ...years.flatMap((y) => LIMIT_WRAPPERS.map((w) => limits[y][w])),
    ...LIMIT_WRAPPERS.map((w) => used[w]),
  ]
  const invalid = allMoney.some((v) => {
    if (moneyFieldError(v, false) !== undefined) return true
    const r = parseMoney(v)
    return r.ok && r.pence < 0
  })

  async function save() {
    clear()
    if (invalid) {
      setAttempted(true)
      setStatus('Fix the highlighted amounts first.')
      return
    }
    const pence = (v: string): Pence => (v.trim() === '' ? 0 : (parseMoney(v) as { pence: Pence }).pence)
    const allowances: Settings['allowances'] = {}
    for (const y of years) {
      allowances[y] = {}
      for (const w of LIMIT_WRAPPERS) allowances[y][w] = pence(limits[y][w])
    }
    await run(async () => {
      await db.transaction('rw', [db.settings, db.allowancesUsed], async () => {
        await db.settings.update('main', { allowances })
        for (const w of LIMIT_WRAPPERS) {
          if (used[w].trim() === '' || pence(used[w]) === 0) await db.allowancesUsed.delete([year, w])
          else await db.allowancesUsed.put({ taxYear: year, wrapper: w, usedPence: pence(used[w]) })
        }
      })
    })
  }

  return (
    <>
      {years.map((y) => (
        <fieldset className="row-card settings-group" key={y}>
          <legend className="row-legend">{`${y} limits`}</legend>
          <div className="row-fields">
            {LIMIT_WRAPPERS.map((w) => (
              <MoneyInput
                key={w}
                label={`${NAMES[w]} limit`}
                value={limits[y][w]}
                showErrors={attempted}
                onChange={(v) => setLimits({ ...limits, [y]: { ...limits[y], [w]: v } })}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset className="row-card settings-group">
        <legend className="row-legend">{`Used so far in ${year}`}</legend>
        <div className="row-fields">
          {LIMIT_WRAPPERS.filter((w) => w !== 'lisa' || lisaOn).map((w) => (
            <MoneyInput
              key={w}
              label={`${NAMES[w]} used this year`}
              value={used[w]}
              showErrors={attempted}
              onChange={(v) => setUsed({ ...used, [w]: v })}
            />
          ))}
        </div>
      </fieldset>
      <SaveRow onSave={() => void save()} status={status} />
    </>
  )
}

export default function AllowancesSection({ settings, today }: { settings: Settings; today: string }) {
  const db = useDb()
  const year = taxYearOf(today)
  const usedRows = useLiveQuery(() => db.allowancesUsed.toArray(), [db])
  const latest = latestYear(settings.allowances)
  const missing = settings.allowances[year] === undefined
  const fallback = latest ? settings.allowances[latest] : seedSettings.allowances[latestYear(seedSettings.allowances) as string]
  const { status, run } = useSaveStatus()

  async function addYear() {
    await run(async () => {
      await db.settings.update('main', { allowances: { ...settings.allowances, [year]: { ...fallback } } })
    }, `Added ${year} allowances`)
  }

  return (
    <SettingsSection title="Allowances">
      <p className="settings-note">
        Yearly limits for each tax year, and how much you have already paid in this year. A new tax year starts on 6 April.
      </p>
      {missing && (
        <div className="notice">
          <p className="notice-text">
            {latest
              ? `Allowances for ${year} aren't set. Using ${latest} limits until you add them.`
              : `Allowances for ${year} aren't set. Add them to plan your ISA and pension contributions.`}
          </p>
          <Button variant="secondary" onClick={() => void addYear()}>
            {`Add ${year} allowances`}
          </Button>
          <p className="save-status" role="status">
            {status}
          </p>
        </div>
      )}
      {usedRows && (
        <AllowancesEditor
          key={Object.keys(settings.allowances).sort().join('|')}
          settings={settings}
          usedRows={usedRows}
          year={year}
        />
      )}
    </SettingsSection>
  )
}
