import { Html } from '@react-three/drei';
import { useGenesis } from '../state/store';
import type { InstitutionKind } from '../simulation/types';

const ICON: Record<InstitutionKind, string> = {
  hospital: '🏥',
  escola: '🏫',
  delegacia: '🚓',
  prefeitura: '🏛️',
};

/**
 * Ícones flutuantes sobre os prédios que sediam instituições públicas.
 * São poucas dezenas → custo desprezível; ficam visíveis de longe (occlude
 * desligado) para o jogador localizar serviços na cidade.
 */
export function InstitutionMarkers() {
  const layout = useGenesis((s) => s.layout);
  if (!layout) return null;
  return (
    <group>
      {layout.institutions.map((m, i) => (
        <Html
          key={i}
          position={[m.x, 26, m.z]}
          center
          distanceFactor={140}
          zIndexRange={[10, 0]}
        >
          <div className="inst-marker" title={m.kind}>{ICON[m.kind]}</div>
        </Html>
      ))}
      {layout.nobleCenter && (
        <Html position={[layout.nobleCenter.x, 22, layout.nobleCenter.z]} center distanceFactor={150} zIndexRange={[10, 0]}>
          <div className="inst-marker noble-marker" title="Bairro Nobre">💎</div>
        </Html>
      )}
      {layout.boemioCenter && (
        <Html position={[layout.boemioCenter.x, 20, layout.boemioCenter.z]} center distanceFactor={150} zIndexRange={[10, 0]}>
          <div className="inst-marker" title="Bairro Boêmio / Cultural">🎭</div>
        </Html>
      )}
    </group>
  );
}
