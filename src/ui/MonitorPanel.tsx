import { useEffect, useState } from 'react';
import { useGenesis } from '../state/store';

const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const money = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `$ ${(n / 1_000_000).toFixed(1)} mi` : `$ ${fmt(n)}`;

/** Compacta números grandes para os rótulos do eixo (1,2k / 3,4M). */
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(a < 10 ? 1 : 0);
}

/** Mini-gráfico de linha com área preenchida, grade, min/máx e ponto atual. */
function Spark({ data, color, label, value }: { data: number[]; color: string; label: string; value: string }) {
  const w = 188, h = 58, padY = 6;
  let line = '', area = '';
  let min = 0, max = 0, lastX = w, lastY = h / 2;
  if (data.length > 1) {
    min = Math.min(...data); max = Math.max(...data);
    const span = max - min || 1;
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - padY - ((v - min) / span) * (h - padY * 2);
      return [x, y] as const;
    });
    line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    area = `0,${h} ${line} ${w},${h}`;
    [lastX, lastY] = pts[pts.length - 1];
  }
  const gid = `g-${label.replace(/\W/g, '')}`;
  return (
    <div className="spark">
      <div className="spark-head"><span>{label}</span><b>{value}</b></div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="spark-svg">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* grade */}
        <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        {area && <polygon points={area} fill={`url(#${gid})`} />}
        {line && <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" />}
        {data.length > 1 && <circle cx={lastX} cy={lastY} r="2.4" fill={color} />}
      </svg>
      {data.length > 1 && (
        <div className="spark-axis"><span>mín {compact(min)}</span><span>máx {compact(max)}</span></div>
      )}
    </div>
  );
}

function Bars({ values, labels, color }: { values: number[]; labels?: string[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="mbars">
      {values.map((v, i) => (
        <div key={i} className="mbar" title={labels?.[i] ?? ''}>
          <div className="mbar-fill" style={{ height: `${(v / max) * 100}%`, background: color }} />
          {labels && <span className="mbar-lbl">{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

export function MonitorPanel() {
  const show = useGenesis((s) => s.showMonitor);
  const toggle = useGenesis((s) => s.toggleMonitor);
  const refresh = useGenesis((s) => s.refreshMonitor);
  const history = useGenesis((s) => s.history);
  const monitor = useGenesis((s) => s.monitor);
  const selectCitizen = useGenesis((s) => s.selectCitizen);
  const [tab, setTab] = useState<'tend' | 'dist' | 'rank'>('tend');

  // enquanto aberto, atualiza distribuição/rankings periodicamente
  useEffect(() => {
    if (!show) return;
    refresh();
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, [show, refresh]);

  if (!show) return null;
  const series = (key: keyof (typeof history)[number]) => history.map((p) => p[key] as number);
  const last = history[history.length - 1];

  return (
    <div className="panel monitor-panel">
      <button className="close" onClick={toggle}>✕</button>
      <h2>📈 Monitoramento</h2>
      <div className="mon-tabs">
        <button className={tab === 'tend' ? 'active' : ''} onClick={() => setTab('tend')}>Tendências</button>
        <button className={tab === 'dist' ? 'active' : ''} onClick={() => setTab('dist')}>Distribuição</button>
        <button className={tab === 'rank' ? 'active' : ''} onClick={() => setTab('rank')}>Rankings</button>
      </div>

      {tab === 'tend' && (
        <div className="spark-grid">
          {history.length < 2 ? (
            <p className="muted">Coletando dados… (atualiza a cada segundo)</p>
          ) : (
            <>
              <Spark data={series('pib')} color="#6fdc8c" label="PIB (mês)" value={money(last.pib)} />
              <Spark data={series('desemprego')} color="#ff7b7b" label="Desemprego %" value={`${last.desemprego.toFixed(1)}%`} />
              <Spark data={series('inflacao')} color="#e1a95b" label="Inflação %/mês" value={`${last.inflacao.toFixed(2)}%`} />
              <Spark data={series('populacao')} color="#7ea0e8" label="População" value={fmt(last.populacao)} />
              <Spark data={series('aprovacao')} color="#9fc6ff" label="Aprovação %" value={`${last.aprovacao.toFixed(0)}%`} />
              <Spark data={series('divida')} color="#ff9a9a" label="Dívida pública" value={money(last.divida)} />
              <Spark data={series('imob')} color="#b87fe1" label="Índice imobiliário" value={(last.imob * 100).toFixed(0)} />
              <Spark data={series('felicidade')} color="#6fdc8c" label="Felicidade" value={last.felicidade.toFixed(0)} />
            </>
          )}
        </div>
      )}

      {tab === 'dist' && (monitor ? (
        <div className="dist">
          <div className="dist-top">
            <div><span className="muted">Gini (desigualdade)</span><b>{monitor.gini.toFixed(2)}</b></div>
            <div><span className="muted">Pobreza</span><b>{monitor.pobreza.toFixed(0)}%</b></div>
          </div>
          <h3>Riqueza média por decil</h3>
          <Bars values={monitor.decis} color="#6fdc8c" labels={monitor.decis.map((_, i) => `${i + 1}`)} />
          <h3>Pirâmide etária (M / F)</h3>
          <div className="pyramid">
            {monitor.piramide.map((p) => {
              const max = Math.max(1, ...monitor.piramide.map((x) => Math.max(x.m, x.f)));
              return (
                <div key={p.faixa} className="pyr-row">
                  <div className="pyr-m"><div style={{ width: `${(p.m / max) * 100}%` }} /></div>
                  <span className="pyr-lbl">{p.faixa}</span>
                  <div className="pyr-f"><div style={{ width: `${(p.f / max) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
          <h3>Escolaridade</h3>
          <Bars
            values={[monitor.escolaridade.fundamental, monitor.escolaridade.medio, monitor.escolaridade.superior, monitor.escolaridade.pos]}
            color="#7ea0e8"
            labels={['Fund.', 'Médio', 'Sup.', 'Pós']}
          />
        </div>
      ) : <p className="muted">Carregando…</p>)}

      {tab === 'rank' && (monitor ? (
        <div className="rank">
          <h3>💰 Mais ricos</h3>
          <ul>
            {monitor.ricos.map((r) => (
              <li key={r.id} onClick={() => selectCitizen(r.id)}>
                <span>{r.nome}</span><b>{money(r.dinheiro)}</b>
                <small>{r.profissao}</small>
              </li>
            ))}
          </ul>
          <h3>⭐ Mais famosos</h3>
          <ul>
            {monitor.famosos.length === 0 && <li className="muted">— ainda sem celebridades</li>}
            {monitor.famosos.map((r) => (
              <li key={r.id} onClick={() => selectCitizen(r.id)}>
                <span>{r.nome}</span><b>{r.fama} fama</b><small>{r.profissao}</small>
              </li>
            ))}
          </ul>
          <h3>🏠 Maiores proprietários</h3>
          <ul>
            {monitor.proprietarios.map((r) => (
              <li key={r.id} onClick={() => selectCitizen(r.id)}>
                <span>{r.nome}</span><b>{money(r.valor)}</b><small>{r.imoveis} imóveis</small>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="muted">Carregando…</p>)}
    </div>
  );
}
