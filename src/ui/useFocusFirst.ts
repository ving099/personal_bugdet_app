import { useEffect, useRef } from 'react'

/** Ref for a form (or any container) whose first field takes focus when it appears. */
export function useFocusFirst<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]), select, textarea')?.focus()
  }, [])
  return ref
}
