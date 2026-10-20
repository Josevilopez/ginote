import { useEffect, useMemo, useState } from 'react';
import { PROVINCES, searchKey } from '@guinote/protocol';
import { fetchMunicipios, useAccount, type MunicipioRow } from '../account.js';
import './PlacePicker.css';

/**
 * S4-03: "De dónde eres" en el perfil. Provincia (lista) y pueblo
 * (buscador sobre la lista del INE). Opcional; se cambia una vez al mes.
 */
export function PlacePicker() {
  const { place, savePlace, error } = useAccount();
  const [editing, setEditing] = useState(false);
  const [province, setProvince] = useState<string>('');
  const [municipios, setMunicipios] = useState<MunicipioRow[]>([]);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<MunicipioRow | null>(null);
  const [busy, setBusy] = useState(false);

  const locked = !!place?.nextChangeAt;
  const hasPlace = !!place?.province;

  useEffect(() => {
    setMunicipios([]);
    if (!province) return;
    let alive = true;
    void fetchMunicipios(province).then((list) => alive && setMunicipios(list));
    return () => {
      alive = false;
    };
  }, [province]);

  const suggestions = useMemo(() => {
    const q = searchKey(query);
    if (!q || chosen) return [];
    const starts: MunicipioRow[] = [];
    const contains: MunicipioRow[] = [];
    for (const r of municipios) {
      const keys = [searchKey(r[1]), ...(r[2] ? [searchKey(r[2])] : [])];
      if (keys.some((k) => k.startsWith(q))) starts.push(r);
      else if (keys.some((k) => k.includes(q))) contains.push(r);
    }
    return [...starts, ...contains].slice(0, 8);
  }, [query, municipios, chosen]);

  const open = () => {
    setProvince(place?.province ?? '');
    setChosen(null);
    setQuery('');
    setEditing(true);
  };

  const save = async (prov: string | null, mun: string | null) => {
    setBusy(true);
    const ok = await savePlace(prov, mun);
    setBusy(false);
    if (ok) setEditing(false);
  };

  const until = place?.nextChangeAt
    ? new Date(place.nextChangeAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
    : null;

  if (!editing) {
    return (
      <div className="place">
        <p className="place-now">
          {hasPlace ? (
            <>
              <span aria-hidden="true">📍</span>{' '}
              <b>{place!.municipioName ?? place!.provinceName}</b>
              {place!.municipioName && <span className="place-prov"> ({place!.provinceName})</span>}
            </>
          ) : (
            <span className="place-none">No lo has dicho.</span>
          )}
        </p>
        <p className="place-why">
          Para salir en el ranking de tu provincia y de tu pueblo. Es opcional.
        </p>
        {locked ? (
          <p className="place-locked">Podrás cambiarlo a partir del {until}.</p>
        ) : (
          <button type="button" className="place-btn" onClick={open}>
            {hasPlace ? 'Cambiar' : 'Elegir provincia y pueblo'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="place is-editing">
      <label className="place-field">
        Provincia
        <select
          value={province}
          onChange={(e) => {
            setProvince(e.target.value);
            setChosen(null);
            setQuery('');
          }}
        >
          <option value="">Elige tu provincia…</option>
          {PROVINCES.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {province && (
        <div className="place-field">
          <label htmlFor="place-mun">Pueblo o ciudad (opcional)</label>
          {chosen ? (
            <div className="place-chosen">
              <b>{chosen[1]}</b>
              <button type="button" onClick={() => setChosen(null)} aria-label="Elegir otro pueblo">
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <input
                id="place-mun"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={municipios.length ? 'Escribe para buscar…' : 'Cargando…'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {suggestions.length > 0 && (
                <ul className="place-suggest" role="listbox">
                  {suggestions.map((r) => (
                    <li key={r[0]}>
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => {
                          setChosen(r);
                          setQuery('');
                        }}
                      >
                        {r[1]}
                        {r[2] && <small> · {r[2]}</small>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query && suggestions.length === 0 && municipios.length > 0 && (
                <p className="place-empty">No encontramos ese pueblo en esta provincia.</p>
              )}
            </>
          )}
        </div>
      )}

      <p className="place-warn">Solo se puede cambiar una vez al mes.</p>
      {error && <p className="home-error" role="alert">{error}</p>}
      <div className="place-actions">
        <button type="button" className="place-btn" onClick={() => setEditing(false)}>
          Cancelar
        </button>
        <button
          type="button"
          className="place-btn is-main"
          disabled={!province || busy}
          onClick={() => void save(province, chosen ? chosen[0] : null)}
        >
          Guardar
        </button>
      </div>
      {hasPlace && (
        <button type="button" className="place-clear" disabled={busy} onClick={() => void save(null, null)}>
          Prefiero no decirlo
        </button>
      )}
    </div>
  );
}
