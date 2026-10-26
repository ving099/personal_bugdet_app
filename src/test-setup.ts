import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * jsdom has no matchMedia. This stub answers `(min-width: Npx)` from `window.__viewportWidth`
 * (default 0, so the app renders its mobile layout). Tests set it (see tests/ui/viewport.ts).
 */
declare global {
  interface Window {
    __viewportWidth?: number
  }
}

window.matchMedia = (query: string): MediaQueryList => {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query)
  const matches = min ? (window.__viewportWidth ?? 0) >= Number(min[1]) : false
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }
}

// Async queries wait for Dexie live queries; the 1s default is too tight when the suite runs in parallel.
configure({ asyncUtilTimeout: 4000 })

afterEach(() => {
  cleanup()
  window.__viewportWidth = 0
})
