import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { panelId, tabId } from './tabIds'

export interface TabItem<Id extends string = string> {
  id: Id
  /** Full name, always the accessible name. */
  label: string
  /** Shorter visible label for the narrow bottom bar. */
  shortLabel?: string
  icon: ReactNode
}

interface TabNavProps<Id extends string> {
  tabs: readonly TabItem<Id>[]
  active: Id
  onChange: (id: Id) => void
  variant: 'bottom' | 'sidebar'
}

/** One navigation component; `variant` picks the bottom bar (phones) or the left sidebar (wide screens). */
export default function TabNav<Id extends string>({ tabs, active, onChange, variant }: TabNavProps<Id>) {
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const sidebar = variant === 'sidebar'

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === active)
    const prev = sidebar ? 'ArrowUp' : 'ArrowLeft'
    const next = sidebar ? 'ArrowDown' : 'ArrowRight'
    let to = -1
    if (e.key === next || e.key === 'ArrowDown') to = (i + 1) % tabs.length
    else if (e.key === prev || e.key === 'ArrowUp') to = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = tabs.length - 1
    if (to < 0) return
    e.preventDefault()
    onChange(tabs[to].id)
    refs.current.get(tabs[to].id)?.focus()
  }

  return (
    <nav className="nav" data-variant={variant} aria-label="Main">
      {sidebar && <p className="brand">Budget</p>}
      <div className="tablist" role="tablist" aria-orientation={sidebar ? 'vertical' : 'horizontal'} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId(t.id)}
            className="tab"
            aria-selected={t.id === active}
            aria-controls={panelId(t.id)}
            aria-label={t.label}
            tabIndex={t.id === active ? 0 : -1}
            ref={(el) => {
              if (el) refs.current.set(t.id, el)
              else refs.current.delete(t.id)
            }}
            onClick={() => onChange(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label" aria-hidden="true">
              {sidebar ? t.label : (t.shortLabel ?? t.label)}
            </span>
          </button>
        ))}
      </div>
    </nav>
  )
}
