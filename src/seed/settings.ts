import type { Settings } from '../domain/types'

export const seedSettings: Settings = {
  id: 'main',
  budgetMonthStartDay: 1,
  aprThresholdPercent: 7,
  bufferPercent: 10,
  emergencyTopUpSharePercent: 30,
  wrapperOrder: ['pension', 'isa', 'lisa', 'gia'],
  wrapperShares: { pension: 25 },
  allowances: { '2026/27': { isa: 2000000, lisa: 400000, pension: 6000000 } },
  bucketSplit: { growth: 70, aggressive: 30 },
  defaultPlatformByWrapper: {},
  appLock: null,
  theme: 'system',
}
