import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  /** Id of the card's heading; names the card as a region. */
  labelledBy?: string
}

/** The one raised panel. Use sparingly: one per screen, for the key block. */
export default function Card({ children, className, labelledBy }: CardProps) {
  return (
    <section className={className ? `card ${className}` : 'card'} aria-labelledby={labelledBy}>
      {children}
    </section>
  )
}
