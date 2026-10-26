import { useMemo, useState, type FormEvent } from 'react'
import type { ImportProfile } from '../../../domain/types'
import { guessProfile } from '../../../import/profile'
import { parseNumber } from '../../formValues'
import { Button, NumberInput, Select } from '../../components/forms'
import {
  columnLabel, DATE_FORMATS, previewMapping, sniffDateFormat, type DateFormat,
} from './importFlow'

interface MappingFormProps {
  /** Rows of the first usable file, header included. */
  rows: string[][]
  bank: string
  accountId: string
  /** The saved profile when editing; otherwise the form starts from the header-name guess. */
  initial?: ImportProfile
  /** Returns an error message to show, or nothing when saved. */
  onSave: (profile: ImportProfile) => Promise<string | undefined>
  onCancel?: () => void
  /** A problem found while reading the files with the saved mapping. */
  problem?: string
}

const NONE = ''
const col = (n: number | undefined) => (n === undefined ? NONE : String(n))
const toCol = (s: string) => (s === NONE ? undefined : Number(s))

const SIGNS = [
  { value: 'negativeIsOut', label: 'Negative number, like -4.20' },
  { value: 'positiveIsOut', label: 'Positive number, like 4.20 (common on credit card files)' },
] as const

const MODES = [
  { value: 'single', label: 'One amount column' },
  { value: 'debitCredit', label: 'Separate money out and money in columns' },
] as const

/** Tells the app how to read one account's statements. Shows the first rows as they will be read before saving. */
export default function MappingForm({ rows, bank, accountId, initial, onSave, onCancel, problem }: MappingFormProps) {
  const guess = useMemo(() => initial ?? guessProfile(rows), [initial, rows])
  const [dateColumn, setDateColumn] = useState(col(guess.dateColumn))
  const [pickedFormat, setPickedFormat] = useState<DateFormat | null>(initial?.dateFormat ?? null)
  const [descColumn, setDescColumn] = useState(col(guess.descriptionColumn))
  const [mode, setMode] = useState<ImportProfile['amountMode']>(guess.amountMode ?? 'single')
  const [amountColumn, setAmountColumn] = useState(col(guess.amountColumn))
  const [debitColumn, setDebitColumn] = useState(col(guess.debitColumn))
  const [creditColumn, setCreditColumn] = useState(col(guess.creditColumn))
  const [sign, setSign] = useState<ImportProfile['signConvention']>(guess.signConvention ?? 'negativeIsOut')
  const [headerText, setHeaderText] = useState(String(guess.headerRows ?? 1))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const headerRows = parseNumber(headerText)
  const headerOk = headerRows !== undefined && Number.isInteger(headerRows) && headerRows >= 0 && headerRows <= 20
  const dataRows = rows.slice(headerOk ? headerRows : 1)
  const sniffed = useMemo(() => {
    const c = toCol(dateColumn)
    return sniffDateFormat(c === undefined ? [] : dataRows.map((r) => r[c] ?? ''))
  }, [dateColumn, dataRows])
  const dateFormat = pickedFormat ?? sniffed.format

  const sample = rows.find((r) => r.some((c) => c.trim() !== ''))
  const columns = [NONE, ...Array.from({ length: Math.max(0, ...rows.slice(0, 20).map((r) => r.length)) }, (_, i) => String(i))]
  const options = columns.map((v) => ({ value: v, label: v === NONE ? 'Choose a column' : columnLabel(sample, Number(v)) }))

  const profile: ImportProfile | null = useMemo(() => {
    const date = toCol(dateColumn)
    const desc = toCol(descColumn)
    if (date === undefined || desc === undefined || !headerOk) return null
    const base = { id: `profile:${accountId}`, bank, dateFormat, dateColumn: date, descriptionColumn: desc, signConvention: sign, headerRows: headerRows as number }
    if (mode === 'single') {
      const amount = toCol(amountColumn)
      return amount === undefined ? null : { ...base, amountMode: 'single', amountColumn: amount }
    }
    const debit = toCol(debitColumn)
    const credit = toCol(creditColumn)
    return debit === undefined || credit === undefined ? null : { ...base, amountMode: 'debitCredit', debitColumn: debit, creditColumn: credit }
  }, [accountId, bank, dateFormat, dateColumn, descColumn, mode, amountColumn, debitColumn, creditColumn, sign, headerOk, headerRows])

  const samples = profile ? previewMapping(rows, profile) : []

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile || busy) return
    setBusy(true)
    setError('')
    try {
      setError((await onSave(profile)) ?? '')
    } finally {
      setBusy(false)
    }
  }

  const shown = problem || error
  return (
    <form className="import-form mapping" onSubmit={(e) => void submit(e)} aria-label="Statement layout">
      <p className="import-intro">
        {initial
          ? 'Change how this account’s statements are read.'
          : 'This is the first statement for this account, so tell Budget where things are. You only do this once.'}
      </p>
      <div className="mapping-grid">
        <Select label="Date column" value={dateColumn} options={options} onChange={setDateColumn} />
        <Select
          label="Date format"
          value={dateFormat}
          options={DATE_FORMATS}
          onChange={setPickedFormat}
          hint={
            pickedFormat === null && sniffed.ambiguous
              ? 'Every date could be read either way, so UK day/month/year is assumed. Check the examples below.'
              : undefined
          }
        />
        <Select label="Description column" value={descColumn} options={options} onChange={setDescColumn} />
        <Select label="Amounts are in" value={mode} options={MODES} onChange={setMode} />
        {mode === 'single' ? (
          <>
            <Select label="Amount column" value={amountColumn} options={options} onChange={setAmountColumn} />
            <Select label="In this file, money you spend appears as a…" value={sign} options={SIGNS} onChange={setSign} />
          </>
        ) : (
          <>
            <Select label="Money out (debit) column" value={debitColumn} options={options} onChange={setDebitColumn} />
            <Select label="Money in (credit) column" value={creditColumn} options={options} onChange={setCreditColumn} />
          </>
        )}
        <NumberInput
          label="Heading rows to skip"
          value={headerText}
          onChange={setHeaderText}
          hint="Rows at the top that are headings, not transactions."
          error={headerOk ? undefined : 'Enter a whole number, like 1.'}
        />
      </div>

      <h3 className="import-subheading">How the first rows will be read</h3>
      {profile ? (
        <ul className="sample-list" aria-label="How the first rows will be read">
          {samples.map((s, i) => (
            <li key={i} className="sample-row" data-bad={s.ok ? undefined : true}>
              {s.ok ? s.text : `Can't read: ${s.text}`}
            </li>
          ))}
          {samples.length === 0 && <li className="sample-row">There are no transaction rows after the headings.</li>}
        </ul>
      ) : (
        <p className="import-hint">Choose a column for each field and the first rows will show here.</p>
      )}

      {shown && (
        <p className="form-error" role="alert">
          {shown}
        </p>
      )}
      <div className="import-actions">
        <Button variant="primary" type="submit" disabled={!profile || busy} aria-busy={busy}>
          Save mapping
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}
