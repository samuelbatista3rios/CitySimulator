import { useGenesis } from '../state/store';

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtMoney = (n: number) =>
  n >= 1_000_000 ? `$ ${(n / 1_000_000).toFixed(1)} mi` : `$ ${fmt(n)}`;

/** Painel de estatísticas macro da cidade (PIB, desemprego, felicidade...). */
export function Dashboard() {
  const stats = useGenesis((s) => s.stats);
  if (!stats) return <div className="panel dashboard">Gerando Genesis City…</div>;

  const rows: [string, string, string?][] = [
    ['População', fmt(stats.populacao)],
    ['PIB (mês)', fmtMoney(stats.pib)],
    ['Empregos', fmt(stats.empregos)],
    ['Desemprego', `${stats.desemprego.toFixed(1)}%`, stats.desemprego > 15 ? 'bad' : 'good'],
    ['Empregos públicos', fmt(stats.empregosPublicos)],
    ['Empresas ativas', fmt(stats.empresas)],
    ['Falências', fmt(stats.empresasFalidas)],
    ['Inflação', `${stats.inflacao.toFixed(2)}% a.m.`, stats.inflacao > 1.5 ? 'bad' : undefined],
    ['Salário médio', fmtMoney(stats.salarioMedio)],
    ['Criminalidade', stats.criminalidade.toFixed(0), stats.criminalidade > 40 ? 'bad' : 'good'],
    ['Felicidade média', stats.felicidadeMedia.toFixed(0), stats.felicidadeMedia > 55 ? 'good' : 'bad'],
    ['Realização média', stats.realizacaoMedia.toFixed(0), stats.realizacaoMedia > 55 ? 'good' : undefined],
    ['Educação média', stats.educacaoMedia.toFixed(0)],
    ['Saúde média', stats.saudeMedia.toFixed(0)],
    ['Nascimentos (ano)', fmt(stats.nascimentosAno)],
    ['Mortes (ano)', fmt(stats.mortesAno)],
  ];

  const govRows: [string, string, string?][] = [
    ['Prefeito(a)', stats.prefeito ?? '— (sem eleição)'],
    ['Plataforma', stats.plataforma ?? '—'],
    ['Imposto', `${stats.imposto.toFixed(0)}%`],
    ['Salário mínimo', fmtMoney(stats.salarioMinimo)],
    ['Orçamento público', fmtMoney(stats.orcamentoPublico)],
    ['Próxima eleição', `${stats.proximaEleicaoAnos.toFixed(1)} anos`],
  ];
  const instRows: [string, string, string?][] = [
    ['Crimes (ano)', fmt(stats.crimesAno)],
    ['Prisões (ano)', fmt(stats.prisoesAno)],
    ['Presos', fmt(stats.presos)],
    ['Hospitais / Escolas', `${stats.hospitais} / ${stats.escolas}`],
    ['Delegacias', fmt(stats.delegacias)],
    ['Atletas profissionais', fmt(stats.atletas)],
    ['Religiosos', `${stats.religiosos.toFixed(0)}%`],
    ['Inadimplência', `${stats.inadimplencia.toFixed(1)}%`, stats.inadimplencia > 25 ? 'bad' : undefined],
    ['Score de crédito', stats.scoreCreditoMedio.toFixed(0)],
  ];

  return (
    <div className="panel dashboard">
      <h2>📊 Genesis City</h2>
      <div className="clock">
        Ano {stats.year} · Mês {stats.month} · Dia {stats.day} · {String(stats.hour).padStart(2, '0')}h
        <span className="tps"> · {stats.fps.toFixed(0)} ticks/s</span>
      </div>
      {stats.eventoAtivo && <div className="event-banner">{stats.eventoAtivo}</div>}
      <table>
        <tbody>
          {rows.map(([label, value, cls]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className={cls}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="dash-section">🏛️ Governo & Leis</h3>
      <table>
        <tbody>
          {govRows.map(([label, value, cls]) => (
            <tr key={label}><td>{label}</td><td className={cls}>{value}</td></tr>
          ))}
        </tbody>
      </table>
      <h3 className="dash-section">🏥 Instituições & Finanças</h3>
      <table>
        <tbody>
          {instRows.map(([label, value, cls]) => (
            <tr key={label}><td>{label}</td><td className={cls}>{value}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
