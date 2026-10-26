import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const HomeIcon = () => (
  <Icon>
    <path d="M4 11 12 4l8 7" />
    <path d="M6 10v9h12v-9" />
    <path d="M10 19v-5h4v5" />
  </Icon>
)

export const ImportIcon = () => (
  <Icon>
    <path d="M12 4v10" />
    <path d="m8 10 4 4 4-4" />
    <path d="M5 15v4h14v-4" />
  </Icon>
)

export const BudgetIcon = () => (
  <Icon>
    <path d="M12 4v8h8" />
    <path d="M10 6.5A8 8 0 1 0 17.5 14" />
  </Icon>
)

export const DebtsIcon = () => (
  <Icon>
    <ellipse cx="12" cy="6.5" rx="7" ry="2.5" />
    <path d="M5 6.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5" />
    <path d="M5 11.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5" />
  </Icon>
)

export const InvestIcon = () => (
  <Icon>
    <path d="m4 16 5-5 4 4 7-8" />
    <path d="M15 7h5v5" />
  </Icon>
)

export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7h9" />
    <path d="M17 7h3" />
    <circle cx="15" cy="7" r="2" />
    <path d="M4 17h3" />
    <path d="M11 17h9" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
)

export const ChevronLeftIcon = () => (
  <Icon>
    <path d="m14 6-6 6 6 6" />
  </Icon>
)

export const ChevronRightIcon = () => (
  <Icon>
    <path d="m10 6 6 6-6 6" />
  </Icon>
)
