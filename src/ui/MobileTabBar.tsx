import { useGenesis } from '../state/store';

const TABS: { key: 'stats' | 'laws' | 'empresas' | 'busca' | 'monitor'; icon: string; label: string }[] = [
  { key: 'stats', icon: '📊', label: 'Cidade' },
  { key: 'laws', icon: '📜', label: 'Leis' },
  { key: 'empresas', icon: '🏢', label: 'Empresas' },
  { key: 'monitor', icon: '📈', label: 'Monitor' },
  { key: 'busca', icon: '🔎', label: 'Buscar' },
];

/** Barra de abas inferior (modo celular): abre um painel por vez. */
export function MobileTabBar() {
  const active = useGenesis((s) => s.mobilePanel);
  const open = useGenesis((s) => s.openMobilePanel);
  return (
    <nav className="mobile-tabbar">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={active === t.key ? 'active' : ''}
          onClick={() => open(t.key)}
        >
          <span className="mt-icon">{t.icon}</span>
          <span className="mt-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
