import { useGenesis } from '../state/store';
import type { HeatmapMetric } from '../state/store';

const OPTIONS: { metric: HeatmapMetric; label: string; icon: string }[] = [
  { metric: 'none', label: 'Mapa', icon: '🗺️' },
  { metric: 'wealth', label: 'Riqueza', icon: '💰' },
  { metric: 'happiness', label: 'Felicidade', icon: '😊' },
  { metric: 'crime', label: 'Crime', icon: '🚨' },
  { metric: 'land', label: 'Imóveis', icon: '🏠' },
];

/** Seletor de mapa de calor (overlay no mapa por métrica). */
export function HeatmapControls() {
  const metric = useGenesis((s) => s.heatmapMetric);
  const setMetric = useGenesis((s) => s.setHeatmapMetric);
  return (
    <div className="panel heatmap-controls">
      <span className="hc-title">Camada</span>
      {OPTIONS.map((o) => (
        <button
          key={o.metric}
          className={metric === o.metric ? 'active' : ''}
          onClick={() => setMetric(o.metric)}
          title={o.label}
        >
          {o.icon} {o.label}
        </button>
      ))}
      {metric !== 'none' && (
        <div className="hc-legend"><span>baixo</span><div className="hc-grad" /><span>alto</span></div>
      )}
    </div>
  );
}
