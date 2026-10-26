import { formatGBP } from '../../domain/money'

interface MoneyProps {
  pence: number
  /** 'auto' colours by sign and adds a "+" and a screen-reader label so colour is never the only signal. */
  tone?: 'auto' | 'none'
  size?: 'body' | 'hero'
}

export default function Money({ pence, tone = 'none', size = 'body' }: MoneyProps) {
  const sizeClass = size === 'hero' ? 'money money-hero' : 'money'
  if (tone !== 'auto') return <span className={sizeClass}>{formatGBP(pence)}</span>
  const sign = pence > 0 ? 'in' : pence < 0 ? 'out' : 'zero'
  return (
    <span className={sizeClass} data-sign={sign}>
      {sign !== 'zero' && <span className="sr-only">{sign === 'in' ? 'Money in ' : 'Money out '}</span>}
      {sign === 'in' ? '+' : ''}
      {formatGBP(pence)}
    </span>
  )
}
