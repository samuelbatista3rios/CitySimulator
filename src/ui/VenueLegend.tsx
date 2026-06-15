import { VENUE_COLORS } from '../rendering/VenueMarkers';

const ITEMS: [keyof typeof VENUE_COLORS, string][] = [
  ['restaurante', '🍽️ Restaurante'],
  ['bar', '🍺 Bar'],
  ['cinema', '🎬 Cinema'],
  ['teatro', '🎭 Teatro'],
  ['estadio', '🏟️ Estádio'],
  ['ginasio', '🏋️ Academia'],
  ['templo', '⛪ Templo'],
];

/** Legenda dos locais de lazer (cores dos marcadores no mapa). */
export function VenueLegend() {
  return (
    <div className="panel venue-legend">
      <div className="vl-title">Lazer & cultura</div>
      {ITEMS.map(([type, label]) => (
        <div key={type} className="vl-row">
          <span className="vl-dot" style={{ background: VENUE_COLORS[type] }} />
          {label}
        </div>
      ))}
    </div>
  );
}
