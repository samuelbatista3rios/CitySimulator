import { useGenesis } from '../state/store';

const fmtMoney = (n: number) =>
  n >= 1_000_000 ? `$ ${(n / 1_000_000).toFixed(1)} mi` : `$ ${Math.round(n).toLocaleString('pt-BR')}`;

/** Explicação de cada plataforma política (o que ela prioriza). */
const PLATFORMS: Record<string, { cor: string; desc: string }> = {
  Progressista: { cor: '#7ea0e8', desc: 'Imposto alto, muito gasto social (saúde, educação, transferência de renda).' },
  Centro: { cor: '#9aa6c4', desc: 'Equilíbrio entre imposto, serviços e segurança.' },
  Liberal: { cor: '#7fce7f', desc: 'Imposto baixo e Estado enxuto; foco no setor privado.' },
  'Lei e Ordem': { cor: '#e1a95b', desc: 'Forte investimento em segurança pública e policiamento.' },
};

/**
 * Painel "Leis em vigor": mostra de forma clara a legislação municipal atual
 * (definida pela plataforma do prefeito eleito) e quando será a próxima eleição.
 */
export function LawsPanel() {
  const show = useGenesis((s) => s.showLaws);
  const toggle = useGenesis((s) => s.toggleLaws);
  const stats = useGenesis((s) => s.stats);
  if (!show) return null;

  const plat = stats?.plataforma ?? 'Centro';
  const info = PLATFORMS[plat] ?? PLATFORMS.Centro;
  const eleito = !!stats?.prefeito;

  return (
    <div className="panel laws-panel">
      <button className="close" onClick={toggle}>✕</button>
      <h2>📜 Leis em vigor</h2>

      <div className="law-gov">
        <span className="law-platform" style={{ color: info.cor, borderColor: info.cor }}>
          {plat}
        </span>
        <div className="law-mayor">
          {eleito ? (
            <>Prefeito(a): <strong>{stats!.prefeito}</strong></>
          ) : (
            <span className="muted">Governo provisório (sem prefeito eleito — vigora a plataforma padrão)</span>
          )}
        </div>
      </div>
      <p className="law-desc">{info.desc}</p>

      {eleito && (
        <div className="approval">
          <div className="approval-head">
            <span>Aprovação da gestão</span>
            <strong>{stats!.aprovacao.toFixed(0)}%</strong>
          </div>
          <div className="approval-bar">
            <div
              className="approval-fill"
              style={{
                width: `${stats!.aprovacao}%`,
                background: stats!.aprovacao >= 50 ? '#6fdc8c' : stats!.aprovacao < 30 ? '#ff7b7b' : '#e1a95b',
              }}
            />
          </div>
          <span className="muted">Abaixo de 25% por um ano → eleição de recall.</span>
        </div>
      )}

      <h3>Legislação atual</h3>
      <table className="law-table">
        <tbody>
          <tr>
            <td>Imposto de renda (topo)</td>
            <td>{stats ? `${stats.imposto.toFixed(0)}%` : '—'}</td>
          </tr>
          <tr>
            <td>Imposto corporativo</td>
            <td>{stats ? `${stats.impostoCorporativo.toFixed(0)}%` : '—'}</td>
          </tr>
          <tr>
            <td>IPTU (mensal)</td>
            <td>{stats ? `${stats.impostoPropriedade.toFixed(2)}%` : '—'}</td>
          </tr>
          <tr>
            <td>Salário mínimo</td>
            <td>{stats ? fmtMoney(stats.salarioMinimo) : '—'}</td>
          </tr>
          <tr>
            <td>Empregos públicos</td>
            <td>{stats ? stats.empregosPublicos.toLocaleString('pt-BR') : '—'}</td>
          </tr>
          <tr>
            <td>Subsídio a empresas (mês)</td>
            <td>{stats ? fmtMoney(stats.subsidioEmpresas) : '—'}</td>
          </tr>
          <tr>
            <td>Orçamento público</td>
            <td>{stats ? fmtMoney(stats.orcamentoPublico) : '—'}</td>
          </tr>
          <tr>
            <td>Dívida pública</td>
            <td>{stats ? fmtMoney(stats.dividaPublica) : '—'}</td>
          </tr>
          <tr>
            <td>Juros da dívida (mês)</td>
            <td>{stats ? fmtMoney(stats.jurosDivida) : '—'}</td>
          </tr>
          {stats?.austeridade && (
            <tr>
              <td>Regime fiscal</td>
              <td style={{ color: '#ff7b7b' }}>Austeridade (cortes)</td>
            </tr>
          )}
          <tr>
            <td>Próxima eleição</td>
            <td>{stats ? `em ${stats.proximaEleicaoAnos.toFixed(1)} anos` : '—'}</td>
          </tr>
        </tbody>
      </table>

      <h3>Arrecadação do mês</h3>
      <table className="law-table">
        <tbody>
          <tr><td>Imposto de renda</td><td>{stats ? fmtMoney(stats.arrecadacaoIR) : '—'}</td></tr>
          <tr><td>Imposto corporativo</td><td>{stats ? fmtMoney(stats.arrecadacaoCorp) : '—'}</td></tr>
          <tr><td>IPTU</td><td>{stats ? fmtMoney(stats.arrecadacaoIPTU) : '—'}</td></tr>
        </tbody>
      </table>

      <h3>O que as leis afetam</h3>
      <ul className="law-effects">
        <li>💼 <strong>IR progressivo</strong> — quem ganha mais paga alíquota maior; abastece o caixa.</li>
        <li>🏢 <strong>Imposto corporativo</strong> — incide sobre o lucro das empresas.</li>
        <li>🏠 <strong>IPTU</strong> — proprietários pagam sobre o valor do imóvel.</li>
        <li>💵 <strong>Salário mínimo</strong> — piso pago a todo trabalhador.</li>
        <li>🏛️ <strong>Orçamento</strong> — gasto em segurança, saúde, educação e bolsa de renda.</li>
        <li>🗳️ A cada 4 anos a população <strong>vota</strong> e pode trocar as leis.</li>
      </ul>
    </div>
  );
}
