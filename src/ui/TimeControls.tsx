import { useGenesis } from '../state/store';

const SPEEDS: [number, string][] = [
  [4, '4 h/s'],
  [24, '1 dia/s'],
  [120, '5 dias/s'],
  [720, '1 mês/s'],
  [2160, '3 meses/s'],
];

/** Controles de tempo, salvamento e painel de empresas. */
export function TimeControls() {
  const { paused, speed, togglePause, setSpeed, save, load, saving, saveMessage, toggleCompanies, toggleLaws, showCompanies, companies } =
    useGenesis();

  return (
    <>
      <div className="panel time-controls">
        <button onClick={togglePause}>{paused ? '▶ Continuar' : '⏸ Pausar'}</button>
        {SPEEDS.map(([tps, label]) => (
          <button
            key={tps}
            className={speed === tps ? 'active' : ''}
            onClick={() => setSpeed(tps)}
          >
            {label}
          </button>
        ))}
        <button onClick={save} disabled={saving}>{saving ? '💾…' : '💾 Salvar'}</button>
        <button onClick={() => load()}>📂 Carregar</button>
        <button onClick={toggleLaws}>📜 Leis</button>
        <button onClick={toggleCompanies}>🏢 Empresas</button>
        {saveMessage && <span className="save-msg">{saveMessage}</span>}
      </div>

      {showCompanies && (
        <div className="panel companies-panel">
          <h3>Top 50 empresas (capital)</h3>
          <table>
            <thead>
              <tr><th>Empresa</th><th>Setor</th><th>Capital</th><th>Func.</th><th>Vagas</th></tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.sector}</td>
                  <td>$ {(c.capital / 1000).toFixed(0)}k</td>
                  <td>{c.employees}</td>
                  <td>{c.openPositions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
