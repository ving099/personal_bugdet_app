import { useCallback, useEffect, useRef, useState } from 'react'

/** Ref for a form (or any container) whose first field takes focus when it appears. */
export function useFocusFirst<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]), select, textarea')?.focus()
  }, [])
  return ref
}

/** Focuses an element by id after the next render, once rows that were removed have gone from the page. */
export function useDeferredFocus(): (id: string) => void {
  const target = useRef('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (tick > 0) document.getElementById(target.current)?.focus()
  }, [tick])
  return useCallback((id: string) => {
    target.current = id
    setTick((n) => n + 1)
  }, [])
}
