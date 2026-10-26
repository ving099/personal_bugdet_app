import type { ReactNode } from 'react'

/** The one raised panel. Use sparingly: one per screen, for the key block. */
export default function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `card ${className}` : 'card'}>{children}</section>
}
