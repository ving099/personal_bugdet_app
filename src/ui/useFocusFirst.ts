import { useCallback, useEffect, useRef, useState } from 'react'

/** Ref for a form (or any container) whose first field takes focus when it appears. */
export function useFocusFirst<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]), select, textarea')?.focus()
  }, [])
  return ref
}

/**
 * Focuses the first of the given element ids that exists, after the next render. If the page then updates
 * (`watch` changes) and focus has been lost to the body because the focused row went away, the same ids are tried
 * again, so the last id should be an element that always exists.
 */
export function useDeferredFocus(watch?: unknown): (...ids: string[]) => void {
  const targets = useRef<string[]>([])
  const pending = useRef(false)
  const [tick, setTick] = useState(0)

  const focusNow = useCallback(() => {
    for (const id of targets.current) {
      const el = document.getElementById(id)
      if (el) {
        el.focus()
        return
      }
    }
  }, [])

  useEffect(() => {
    if (tick > 0) {
      pending.current = true
      focusNow()
    }
  }, [tick, focusNow])

  useEffect(() => {
    if (!pending.current) return
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected) focusNow()
    pending.current = false
  }, [watch, focusNow])

  return useCallback((...ids: string[]) => {
    targets.current = ids
    setTick((n) => n + 1)
  }, [])
}
