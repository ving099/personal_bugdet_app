import type { Holding } from '../domain/types'

const platforms = ['trading212', 'ibkr', 'ig']

/** Weights are relative integers within a bucket (Growth 2:1, Aggressive 1:1:1). */
export const seedHoldings: Holding[] = [
  { id: 'growth-global', bucket: 'growth', weight: 2, fundType: 'Global all-world equity ETF', exampleName: 'Vanguard FTSE All-World UCITS ETF', ticker: 'VWRL', platforms },
  { id: 'growth-us', bucket: 'growth', weight: 1, fundType: 'US large-cap index ETF', exampleName: 'iShares Core S&P 500 UCITS ETF', ticker: 'CSPX', platforms },
  { id: 'aggressive-nasdaq', bucket: 'aggressive', weight: 1, fundType: 'Nasdaq-100 ETF', exampleName: 'Invesco EQQQ Nasdaq-100 UCITS ETF', ticker: 'EQQQ', platforms },
  { id: 'aggressive-em', bucket: 'aggressive', weight: 1, fundType: 'Emerging-markets ETF', exampleName: 'iShares Core MSCI EM IMI UCITS ETF', ticker: 'EIMI', platforms },
  { id: 'aggressive-smallcap', bucket: 'aggressive', weight: 1, fundType: 'Global small-cap ETF', exampleName: 'iShares MSCI World Small Cap UCITS ETF', ticker: 'WLDS', platforms },
]
