import { useGenesis } from '../state/store';

const KIND_ICON: Record<string, string> = {
  global: '🌍',
  social: '👥',
  economia: '💼',
  vida: '🌱',
};

/** Feed com os acontecimentos emergentes da cidade. */
export function EventFeed() {
  const feed = useGenesis((s) => s.feed);
  if (feed.length === 0) return null;
  return (
    <div className="panel event-feed">
      <h3>📰 Acontecendo na cidade</h3>
      <ul>
        {feed.map((item, i) => (
          <li key={`${item.tick}-${i}`} className={item.kind === 'global' ? 'global-event' : ''}>
            {KIND_ICON[item.kind]} {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
