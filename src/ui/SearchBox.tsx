import { useEffect, useRef, useState } from 'react';
import { useGenesis } from '../state/store';

/** Busca de habitante por nome → seleciona e abre a ficha. */
export function SearchBox() {
  const [q, setQ] = useState('');
  const search = useGenesis((s) => s.search);
  const clearSearch = useGenesis((s) => s.clearSearch);
  const results = useGenesis((s) => s.searchResults);
  const select = useGenesis((s) => s.selectCitizen);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(q), 250);
    return () => clearTimeout(debounce.current);
  }, [q]);

  return (
    <div className="panel search-box">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔎 Buscar habitante por nome…"
      />
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li
              key={r.id}
              onClick={() => {
                select(r.id);
                setQ('');
                clearSearch();
              }}
            >
              <strong>{r.nome}</strong>
              <span className="muted"> · {r.idade}a · {r.profissao}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
