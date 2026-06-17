import { useEffect } from 'react';
import { useGenesis } from '../state/store';
import type { CitizenDetail } from '../simulation/types';

type Kin = { id: number; nome: string };

/** Árvore genealógica em gerações: avós → pais → (você + irmãos) → filhos → netos. */
function FamilyTree({ citizen, select }: { citizen: CitizenDetail; select: (id: number) => void }) {
  const has =
    citizen.avos.length || citizen.pais.length || citizen.irmaos.length ||
    citizen.filhos.length || citizen.netos.length || citizen.conjuge;
  if (!has) return <div className="muted">Sem família registrada</div>;

  const Row = ({ label, people }: { label: string; people: Kin[] }) =>
    people.length === 0 ? null : (
      <div className="ft-row">
        <span className="ft-label">{label}</span>
        <div className="ft-people">
          {people.map((k) => (
            <button key={k.id} className="ft-chip" onClick={() => select(k.id)}>{k.nome}</button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="family-tree">
      <Row label="Avós" people={citizen.avos} />
      <Row label="Pais" people={citizen.pais} />
      <div className="ft-row ft-self">
        <span className="ft-label">Você</span>
        <div className="ft-people">
          <span className="ft-chip ft-me">{citizen.nome}</span>
          {citizen.conjuge && (
            <button className="ft-chip ft-spouse" onClick={() => select(citizen.conjuge!.id)}>
              💍 {citizen.conjuge.nome}
            </button>
          )}
          {citizen.irmaos.map((k) => (
            <button key={k.id} className="ft-chip" onClick={() => select(k.id)}>{k.nome}</button>
          ))}
        </div>
      </div>
      <Row label="Filhos" people={citizen.filhos} />
      <Row label="Netos" people={citizen.netos} />
    </div>
  );
}

const GOAL_LABELS: Record<string, string> = {
  comprar_carro: '🚗 Comprar carro',
  comprar_casa: '🏠 Comprar casa',
  casar: '💍 Casar',
  abrir_empresa: '🏢 Abrir empresa',
  enriquecer: '💰 Enriquecer',
  estudar: '📚 Estudar',
  arranjar_emprego: '💼 Arranjar emprego',
  promocao: '📈 Conseguir promoção',
  virar_atleta: '🏅 Virar atleta profissional',
};

function Bar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="bar-val">{value}</span>
    </div>
  );
}

/** Ficha completa do cidadão clicado: vida, mente, relações e história. */
export function CitizenPanel() {
  const citizen = useGenesis((s) => s.selectedCitizen);
  const close = useGenesis((s) => s.closeCitizen);
  const refresh = useGenesis((s) => s.refreshCitizen);
  const select = useGenesis((s) => s.selectCitizen);
  const follow = useGenesis((s) => s.follow);
  const stopFollow = useGenesis((s) => s.stopFollow);
  const followId = useGenesis((s) => s.followId);

  // atualiza a ficha em tempo real enquanto aberta
  useEffect(() => {
    if (!citizen) return;
    const h = setInterval(refresh, 2000);
    return () => clearInterval(h);
  }, [citizen?.id]);

  if (!citizen) return null;
  const p = citizen.personalidade;
  const isFollowing = followId === citizen.id;

  return (
    <div className="panel citizen-panel">
      <button className="close" onClick={close}>✕</button>
      <h2>
        {citizen.prefeito && '🏛️ '}{citizen.nome} {citizen.vivo ? '' : '✝'}
      </h2>
      <div className="badges">
        {citizen.prefeito && <span className="badge gov">Prefeito(a)</span>}
        {citizen.preso && <span className="badge jail">🚓 Preso</span>}
        {citizen.criminoso && !citizen.preso && (
          <span className="badge crime">Ficha criminal{citizen.fichaCriminal > 0 ? ` (${citizen.fichaCriminal})` : ''}</span>
        )}
        {citizen.contasAtrasadas > 0 && <span className="badge debt">{citizen.contasAtrasadas}m em atraso</span>}
      </div>
      {citizen.preso && citizen.motivoPrisao && (
        <div className="jail-reason">🔒 Motivo da prisão: {citizen.motivoPrisao}</div>
      )}
      {!citizen.preso && citizen.ultimoCrime && (
        <div className="jail-reason muted">⚖️ Última condenação: {citizen.ultimoCrime}</div>
      )}
      <div className="subtitle">
        {citizen.sexo === 'M' ? 'Homem' : 'Mulher'}, {citizen.idade} anos · {citizen.profissao}
        {citizen.empresa && <> · {citizen.empresa}</>}
      </div>
      <div className="subtitle">
        💵 $ {citizen.dinheiro.toLocaleString('pt-BR')} · {citizen.atividade}
        {citizen.temCasaPropria && ` · 🏠${citizen.valorImovel ? ` $${citizen.valorImovel.toLocaleString('pt-BR')}` : ''}`}{citizen.temCarro && ' · 🚗'}
        {' · '}Escolaridade: {citizen.escolaridade}
      </div>
      <button
        className={`follow-btn ${isFollowing ? 'on' : ''}`}
        onClick={() => (isFollowing ? stopFollow() : follow(citizen.id))}
      >
        {isFollowing ? '🎥 Parar de seguir' : '🎥 Seguir com a câmera'}
      </button>

      <h3>Cidadania & Finanças</h3>
      <Bar label="Score crédito" value={citizen.scoreCredito} max={850} />
      {citizen.emprestimos.length === 0 && <div className="muted">Sem empréstimos</div>}
      {citizen.emprestimos.map((l, i) => (
        <div key={i} className="loan">
          {l.kind}: saldo $ {l.saldo.toLocaleString('pt-BR')} · parcela $ {l.parcela.toLocaleString('pt-BR')}/mês · {l.jurosAno}% a.a.
        </div>
      ))}

      <h3>Estado</h3>
      <Bar label="Felicidade" value={citizen.felicidade} />
      <Bar label="Realização" value={citizen.realizacao} />
      <Bar label="Saúde" value={citizen.saude} />
      <Bar label="Energia" value={citizen.energia} />
      <Bar label="Inteligência" value={citizen.inteligencia} />

      <h3>Cultura & Bem-estar</h3>
      <div className="subtitle">
        🎯 Hobby: {citizen.hobby ?? '—'}
        {citizen.fama > 5 && <> · ⭐ Fama: {citizen.fama}</>}
      </div>
      <div className="subtitle">
        ⛪ Fé: {citizen.religiao ? `${citizen.religiao}` : 'não praticante'}
        {citizen.religiao && ` (devoção ${citizen.religiosidade})`}
      </div>

      <h3>Necessidades</h3>
      <Bar label="Fome" value={citizen.necessidades.fome} />
      <Bar label="Sono" value={citizen.necessidades.sono} />
      <Bar label="Social" value={citizen.necessidades.social} />
      <Bar label="Segurança" value={citizen.necessidades.seguranca} />
      <Bar label="Diversão" value={citizen.necessidades.diversao} />

      <h3>Personalidade (Big Five)</h3>
      <Bar label="Abertura" value={Math.round(p.abertura)} />
      <Bar label="Consciência" value={Math.round(p.consciencia)} />
      <Bar label="Extroversão" value={Math.round(p.extroversao)} />
      <Bar label="Amabilidade" value={Math.round(p.amabilidade)} />
      <Bar label="Neuroticismo" value={Math.round(p.neuroticismo)} />

      {citizen.desempenho !== null && citizen.requisitos && (
        <>
          <h3>Desempenho no cargo</h3>
          <Bar label="Aptidão para a função" value={citizen.desempenho} />
          <div className="subtitle muted">
            {citizen.desempenho >= 75 ? '⭐ Destaque — habilidades muito acima do exigido'
              : citizen.desempenho >= 50 ? '👍 Bom encaixe no cargo'
              : citizen.desempenho >= 30 ? '➖ Cumpre o mínimo, mas patina'
              : '⚠️ Mal alinhado — rende abaixo do esperado'}
          </div>
          <div className="subtitle muted">
            Exige: {citizen.requisitos.skill} ≥ {citizen.requisitos.min}
            {citizen.requisitos.secondary && <> · {citizen.requisitos.secondary} ≥ {citizen.requisitos.minSecondary}</>}
          </div>
        </>
      )}

      <h3>Habilidades</h3>
      {Object.entries(citizen.habilidades).map(([k, v]) => {
        const req = citizen.requisitos;
        const isPrimary = req?.skill === k;
        const isSecondary = req?.secondary === k;
        const destaque = isPrimary || isSecondary;
        const min = isPrimary ? req!.min : isSecondary ? (req!.minSecondary ?? 0) : 0;
        return (
          <div key={k} className={destaque ? 'skill-req' : ''}>
            <Bar
              label={`${destaque ? '🎯 ' : ''}${k}${destaque ? ` (cargo: ≥${min})` : ''}`}
              value={v}
            />
          </div>
        );
      })}

      <h3>Objetivos</h3>
      {citizen.objetivos.length === 0 && <div className="muted">Sem objetivos no momento</div>}
      {citizen.objetivos.map((g) => (
        <div key={g.kind} className="goal">
          {GOAL_LABELS[g.kind] ?? g.kind}
          <div className="bar"><div className="bar-fill" style={{ width: `${g.progress * 100}%` }} /></div>
        </div>
      ))}

      {citizen.planoAtual.length > 0 && (
        <>
          <h3>Plano atual (GOAP)</h3>
          <div className="muted">{citizen.planoAtual.join(' → ')}</div>
        </>
      )}

      <h3>Árvore genealógica</h3>
      <FamilyTree citizen={citizen} select={select} />

      <h3>Amigos</h3>
      {citizen.amigos.length === 0 && <div className="muted">Nenhum amigo próximo</div>}
      {citizen.amigos.map((a) => (
        <div key={a.id}>
          <button className="link" onClick={() => select(a.id)}>{a.nome}</button>
          <span className="muted"> (afinidade {a.forca})</span>
        </div>
      ))}

      <h3>Histórico de vida (memória)</h3>
      <ul className="memories">
        {citizen.memorias.length === 0 && <li className="muted">Nada marcante ainda…</li>}
        {citizen.memorias.map((m, i) => (
          <li key={i}>{m.text}</li>
        ))}
      </ul>
    </div>
  );
}
