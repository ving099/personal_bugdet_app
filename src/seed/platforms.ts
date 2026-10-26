import type { Platform } from '../domain/types'

const lastChecked = '2026-10-26'

export const seedPlatforms: Platform[] = [
  {
    id: 'trading212', name: 'Trading 212', wrappersSupported: ['isa', 'pension', 'gia'], lastChecked,
    notes: 'SIPP launched 2026. No Lifetime ISA. Source: Unbiased review.',
  },
  {
    id: 'ibkr', name: 'Interactive Brokers UK', wrappersSupported: ['isa', 'gia'], lastChecked,
    notes: 'SIPP not direct; only via external SIPP administrators (one needs about £75,000). Lifetime ISA not confirmed. £3 minimum monthly activity fee in the ISA; non-flexible ISA (withdrawals use allowance). Source: MoneyToTheMasses review.',
  },
  {
    id: 'ig', name: 'IG', wrappersSupported: ['isa', 'pension', 'gia'], lastChecked,
    notes: 'Lifetime ISA not confirmed. Source: IG ISA page.',
  },
  {
    id: 'robinhood', name: 'Robinhood UK', wrappersSupported: ['isa'], lastChecked,
    notes: 'ISA rolling out from Feb 2026 and limited to US-listed stocks and ADRs, so the UCITS ETFs in the holdings table are not purchasable here. SIPP, Lifetime ISA and GIA not confirmed. Fund-based plans are not allocated here by default.',
  },
]
