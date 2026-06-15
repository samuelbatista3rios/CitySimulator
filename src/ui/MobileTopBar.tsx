import { useGenesis } from '../state/store';

/** Barra superior compacta (modo celular): relógio + indicadores-chave. */
export function MobileTopBar() {
  const stats = useGenesis((s) => s.stats);
  if (!stats) return <div className="mobile-topbar">Gerando Genesis City…</div>;
  return (
    <div className="mobile-topbar">
      <div className="mtb-clock">
        🏙️ Ano {stats.year} · M{stats.month} · {String(stats.hour).padStart(2, '0')}h
      </div>
      <div className="mtb-metrics">
        <span>👥 {(stats.populacao / 1000).toFixed(1)}k</span>
        <span className={stats.felicidadeMedia > 55 ? 'good' : 'bad'}>😊 {stats.felicidadeMedia.toFixed(0)}</span>
        <span className={stats.desemprego > 15 ? 'bad' : 'good'}>💼 {(100 - stats.desemprego).toFixed(0)}%</span>
      </div>
      {stats.eventoAtivo && <div className="mtb-event">{stats.eventoAtivo}</div>}
    </div>
  );
}
