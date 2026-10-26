import { Button } from '../../components/forms'
import type { AttentionItem, HomeTarget } from './homeModel'

export default function NeedsAttention({ items, onNavigate }: { items: AttentionItem[]; onNavigate: (tab: HomeTarget) => void }) {
  return (
    <section className="home-section" aria-labelledby="attention-heading">
      <h2 className="invest-heading" id="attention-heading">Needs attention</h2>
      {items.length === 0 ? (
        <p className="caught-up">All caught up</p>
      ) : (
        <ul className="attention-list" aria-labelledby="attention-heading">
          {items.map((item) => (
            <li key={item.id} className="attention-row">
              <p className="attention-text">{item.text}</p>
              <Button variant="secondary" onClick={() => onNavigate(item.target)}>
                {item.action}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
