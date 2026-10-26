import { useId, useState, type ComponentProps, type ReactNode } from 'react'
import { moneyFieldError } from '../formValues'

export interface ControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface FieldProps {
  label: string
  hint?: string
  error?: string
  children: (control: ControlProps) => ReactNode
}

/** A visible label, optional hint and error, wired to the control with aria-describedby. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ')
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  )
}

interface TextInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string
  type?: 'text' | 'date' | 'password'
  inputMode?: 'text' | 'numeric' | 'decimal'
  autoComplete?: string
}

export function TextInput({ label, value, onChange, hint, error, type = 'text', inputMode, autoComplete }: TextInputProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(c) => (
        <input
          {...c}
          className={type === 'password' ? 'input input-code' : 'input'}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete ?? 'off'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

interface MoneyInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  /** Blank is an error when required; otherwise blank means "not given". */
  required?: boolean
  /** Show errors now (for example after a failed Next), not only after the field has been left. */
  showErrors?: boolean
  /** The form shows its own message, so the field shows none. */
  quiet?: boolean
}

/** Pounds as typed; parsed with `toPence` by the owner of the form. Shows an inline error, never throws. */
export function MoneyInput({ label, value, onChange, hint, required = false, showErrors = false, quiet = false }: MoneyInputProps) {
  const [touched, setTouched] = useState(false)
  const error = !quiet && (touched || showErrors) ? moneyFieldError(value, required) : undefined
  return (
    <Field label={label} hint={hint} error={error}>
      {(c) => (
        <input
          {...c}
          className="input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
        />
      )}
    </Field>
  )
}

interface NumberInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string
  suffix?: string
}

/** Decimal text input (keeps what was typed). Validation lives with the form that owns the value. */
export function NumberInput({ label, value, onChange, hint, error, suffix }: NumberInputProps) {
  return (
    <Field label={suffix ? `${label} (${suffix})` : label} hint={hint} error={error}>
      {(c) => (
        <input
          {...c}
          className="input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

interface SelectProps<V extends string> {
  label: string
  value: V
  onChange: (value: V) => void
  options: readonly { value: V; label: string }[]
  hint?: string
  disabled?: boolean
}

export function Select<V extends string>({ label, value, onChange, options, hint, disabled }: SelectProps<V>) {
  return (
    <Field label={label} hint={hint}>
      {(c) => (
        <select {...c} className="input input-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as V)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

interface CheckboxProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
  disabled?: boolean
}

export function Checkbox({ label, checked, onChange, hint, disabled }: CheckboxProps) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="check">
      <input
        id={id}
        className="check-box"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="check-label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <p className="field-hint check-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

type ButtonProps = ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }

export function Button({ variant = 'secondary', className, type = 'button', ...rest }: ButtonProps) {
  const cls = `btn btn-${variant}${className ? ` ${className}` : ''}`
  return <button {...rest} type={type} className={cls} />
}

interface RowEditorProps<T> {
  items: readonly T[]
  getKey: (item: T) => string
  /** Singular noun for button names, for example 'account'. */
  noun: string
  renderRow: (item: T, index: number) => ReactNode
  onAdd: () => void
  onRemove: (item: T) => void
  emptyText: string
}

/** A list of repeated sub-forms with add and remove. Remove buttons are named "Remove account 2" and so on. */
export function RowEditor<T>({ items, getKey, noun, renderRow, onAdd, onRemove, emptyText }: RowEditorProps<T>) {
  return (
    <div className="rows">
      {items.length === 0 && <p className="rows-empty">{emptyText}</p>}
      {items.map((item, i) => (
        <fieldset className="row-card" key={getKey(item)}>
          <legend className="row-legend">{`${noun[0].toUpperCase()}${noun.slice(1)} ${i + 1}`}</legend>
          <div className="row-fields">{renderRow(item, i)}</div>
          <Button variant="secondary" className="row-remove" onClick={() => onRemove(item)}>
            {`Remove ${noun} ${i + 1}`}
          </Button>
        </fieldset>
      ))}
      <Button variant="secondary" onClick={onAdd}>
        {`Add ${noun}`}
      </Button>
    </div>
  )
}
