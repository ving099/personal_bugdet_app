import { useEffect, useState } from 'react'

function read(query: string): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}
