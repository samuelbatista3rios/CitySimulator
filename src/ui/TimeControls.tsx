import { Fragment, useEffect, useState } from 'react';
import { useGenesis } from '../state/store';

const SECTOR_LABEL: Record<string, string> = {
  tecnologia: 'Tecnologia', comercio: 'Comércio', industria: 'Indústria',
  servicos: 'Serviços', cultura: 'Cultura', esporte: 'Esporte',
};
const money = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : `$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;

const SPEEDS: [number, string][] = [
  [4, '4 h/s'],
  [24, '1 dia/s'],
  [120, '5 dias/s'],
  [720, '1 mês/s'],
  [2160, '3 meses/s'],
];

/** Controles de tempo, salvamento e painel de empresas. */
export function TimeControls() {
  const { paused, speed, togglePause, setSpeed, save, load, saving, saveMessage, toggleCompanies, refreshCompanies, setCompanySort, companySort, toggleLaws, toggleMonitor, showCompanies, companies } =
    useGenesis();
  const [expanded, setExpanded] = useState<number | null>(null);

  // mantém a lista de empresas viva enquanto o painel está aberto
  useEffect(() => {
    if (!showCompanies) return;
    const id = setInterval(refreshCompanies, 2500);
    return () => clearInterval(id);
  }, [showCompanies, refreshCompanies]);

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
        <button onClick={toggleMonitor}>📈 Monitor</button>
        {saveMessage && <span className="save-msg">{saveMessage}</span>}
      </div>

      {showCompanies && (
        <div className="panel companies-panel">
          <div className="cp-head">
            <h3>Top 50 empresas · clique para detalhes</h3>
            <div className="cp-sort">
              {([['capital', 'Capital'], ['receita', 'Receita'], ['recentes', 'Recentes']] as const).map(([s, label]) => (
                <button key={s} className={companySort === s ? 'active' : ''} onClick={() => setCompanySort(s)}>{label}</button>
              ))}
            </div>
          </div>
          <table>
            <thead>
              <tr><th>Empresa</th><th>Setor</th><th>Capital</th><th>Func.</th><th>Vagas</th></tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <Fragment key={c.id}>
                  <tr
                    className={`company-row${expanded === c.id ? ' open' : ''}`}
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  >
                    <td>{expanded === c.id ? '▾ ' : '▸ '}{c.name} <span className="cp-year">ano {c.foundedYear}</span></td>
                    <td>{SECTOR_LABEL[c.sector] ?? c.sector}</td>
                    <td>{money(c.capital)}</td>
                    <td>{c.employees}</td>
                    <td>{c.openPositions}</td>
                  </tr>
                  {expanded === c.id && (
                    <tr className="company-detail">
                      <td colSpan={5}>
                        <div className="cd-grid">
                          <span>Dono(a)</span><b>{c.ownerName ?? 'Corporação'}</b>
                          <span>Fundada</span><b>Ano {c.foundedYear}</b>
                          <span>Receita (mês)</span><b>{money(c.revenue)}</b>
                          <span>Salário médio</span><b>{money(c.avgSalary)}</b>
                          <span>Dividendos (mês)</span><b>{money(c.dividends)}</b>
                          <span>Produtividade</span><b>{(c.productivity * 100).toFixed(0)}%</b>
                          <span>Preço</span><b>{(c.price * 100).toFixed(0)}% da ref.</b>
                          <span>Tecnologia</span><b>{(c.techLevel * 100).toFixed(0)}%</b>
                        </div>
                        <table className="cd-positions">
                          <thead>
                            <tr><th>Cargo</th><th>Salário</th><th>Equipe</th><th>Vagas</th></tr>
                          </thead>
                          <tbody>
                            {c.positions.map((p) => (
                              <tr key={p.title}>
                                <td>{p.title}</td>
                                <td>{money(p.salary)}</td>
                                <td>{p.filled}</td>
                                <td>{p.open}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
