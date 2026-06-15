import { useEffect, useState } from 'react';

/** Detecta viewport de celular (largura ≤ 768px) reativamente. */
export function useIsMobile(query = '(max-width: 768px)'): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    // reavalia tanto no evento do matchMedia quanto em resize (mais robusto
    // em emuladores/rotação de tela, onde 'change' nem sempre dispara)
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    window.addEventListener('resize', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [query]);
  return isMobile;
}
