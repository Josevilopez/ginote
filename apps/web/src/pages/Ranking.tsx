import { useEffect, useState } from 'react';
import { divisionName, type Division } from '@guinote/protocol';
import { DivisionBadge } from '../components/DivisionBadge.js';
import { useAccount } from '../account.js';
import './Home.css';
import './Ranking.css';

type ScopeKind = 'es' | 'prov' | 'mun';

interface Entry {
  pos: number;
  name: string;
  tag: string;
  /** ELO (general) o lo ganado en la semana (semanal). */
  points: number;
  rating: number;
  division: Division | null;
  you: boolean;
}

interface RankingResponse {
  scope: ScopeKind;
  label: string | null;
  needsPlace: boolean;
  entries: Entry[];
  me:
    | { eligible: true; pos: number; points: number; rating: number; division: Division | null; pairName?: string }
    | {
        eligible: false;
        reason: 'no_account' | 'placement' | 'inactive' | 'week_games' | 'no_pair' | 'pair_games' | 'pair_place';
        gamesLeft: number | null;
        pairName?: string;
      }
    | null;
  error?: string;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** General, esta semana (S4-06) o parejas (S4-05). */
type Period = 'all' | 'week' | 'pairs';

/** S4-04: ranking individual (España · tu provincia · tu pueblo). Vive en `#ranking`. */
export function Ranking({ onBack }: { onBack: () => void }) {
  const { me, place, init, season } = useAccount();
  const [scope, setScope] = useState<ScopeKind>('es');
  // S4-06: general o esta semana.
  const [period, setPeriod] = useState<Period>('all');
  const [data, setData] = useState<RankingResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    fetch(`/api/ranking?scope=${scope}&period=${period}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<RankingResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [scope, period]);

  const tabs: { id: ScopeKind; label: string }[] = [
    { id: 'es', label: 'España' },
    { id: 'prov', label: place?.provinceName?.split('/')[0] ?? 'Mi provincia' },
    { id: 'mun', label: place?.municipioName ?? 'Mi pueblo' },
  ];

  return (
    <div className="home ranking">
      <div className="home-inner">
        <button type="button" className="profile-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Volver
        </button>
        <h1 className="ranking-title">Ranking</h1>

        <div className="ranking-period" role="tablist" aria-label="Periodo">
          <button type="button" role="tab" aria-selected={period === 'all'} className={period === 'all' ? 'is-on' : ''} onClick={() => setPeriod('all')}>
            Temporada
          </button>
          <button type="button" role="tab" aria-selected={period === 'week'} className={period === 'week' ? 'is-on' : ''} onClick={() => setPeriod('week')}>
            Esta semana
          </button>
          <button type="button" role="tab" aria-selected={period === 'pairs'} className={period === 'pairs' ? 'is-on' : ''} onClick={() => setPeriod('pairs')}>
            Parejas
          </button>
        </div>
        {period === 'pairs' && (
          <p className="ranking-week-note">Parejas fijas con cuenta. El nivel de la pareja solo cambia cuando jugáis juntos.</p>
        )}
        {period === 'all' && season && (
          <p className="ranking-week-note">
            {season.name}: termina el {season.ends}. Al empezar la siguiente, cada uno se lleva una insignia con su mejor división.
          </p>
        )}
        {period === 'week' && (
          <p className="ranking-week-note">Puntos de nivel ganados desde el lunes. Se pone a cero cada lunes.</p>
        )}

        <div className="ranking-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={scope === t.id}
              className={scope === t.id ? 'is-on' : ''}
              onClick={() => setScope(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {failed || data?.error ? (
          <p className="home-error" role="alert">No se pudo cargar el ranking. Inténtalo en un rato.</p>
        ) : !data ? (
          <p className="ranking-loading">Cargando…</p>
        ) : data.needsPlace ? (
          <div className="ranking-note">
            {me ? (
              <>
                <p>
                  Dinos de dónde eres para ver el ranking de tu {scope === 'prov' ? 'provincia' : 'pueblo'}.
                </p>
                <a className="ranking-cta" href="#perfil">Elegir en Mi perfil</a>
              </>
            ) : (
              <p>Inicia sesión y dinos de dónde eres para ver el ranking de tu {scope === 'prov' ? 'provincia' : 'pueblo'}.</p>
            )}
          </div>
        ) : (
          <>
            <MyCard data={data} loggedIn={!!me} period={period} />
            {data.entries.length === 0 ? (
              <p className="ranking-note">Aún no hay nadie clasificado aquí. ¡Sé el primero!</p>
            ) : (
              <ol className="ranking-list">
                {data.entries.map((e) => (
                  <li key={`${e.pos}-${e.name}-${e.tag}`} className={`ranking-row ${e.you ? 'is-you' : ''}`}>
                    <span className="ranking-pos">{MEDALS[e.pos - 1] ?? e.pos}</span>
                    {e.division ? <DivisionBadge division={e.division} size={20} /> : <span className="ranking-nobadge" />}
                    <span className="ranking-name">
                      {e.name}
                      {e.tag && <small>#{e.tag}</small>}
                      {e.you && <em> (tú)</em>}
                    </span>
                    <span className={`ranking-points ${period === 'week' && e.points < 0 ? 'is-neg' : ''}`}>
                      {period === 'week' && e.points > 0 ? `+${e.points}` : period === 'week' && e.points < 0 ? `−${-e.points}` : e.points}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {scope === 'mun' && data.entries.length > 0 && data.entries.length < 5 && (
              <p className="ranking-hint">Aún sois pocos en {data.label}. ¡Anima a los del pueblo a jugar!</p>
            )}
          </>
        )}
        <p className="ranking-rules">
          {period === 'week'
            ? 'Salen los jugadores con cuenta que han jugado al menos 3 partidas online esta semana.'
            : period === 'pairs'
              ? 'Salen las parejas fijas (los dos con cuenta) con al menos 5 partidas juntas y alguna en los últimos 30 días. En provincia y pueblo, si los dos sois de allí.'
              : 'Salen los jugadores con cuenta que han jugado al menos 10 partidas online, alguna en esta temporada y en los últimos 30 días.'}
        </p>
      </div>
    </div>
  );
}

function MyCard({ data, loggedIn, period }: { data: RankingResponse; loggedIn: boolean; period: Period }) {
  const me = data.me;
  if (!loggedIn || !me) {
    return <p className="ranking-me is-muted">Inicia sesión con Google (arriba en la portada) para salir en el ranking.</p>;
  }
  if (me.eligible) {
    const outside = !data.entries.some((e) => e.you);
    const pts = period === 'week' ? `${me.points > 0 ? '+' : ''}${me.points} esta semana` : `${me.points} puntos`;
    return (
      <p className="ranking-me">
        {period === 'pairs' ? <>{me.pairName} en {data.label}</> : <>Tu puesto en {data.label}</>}: <b>{me.pos}º</b>
        {period === 'all' && me.division && ` · ${divisionName(me.division)}`} · {pts}
        {outside && <small> (fuera de los 100 primeros)</small>}
      </p>
    );
  }
  const text =
    me.reason === 'no_pair'
      ? 'Aún no tienes pareja en el ranking: juega con tu pareja fija ("Jugar con mi pareja") y que los dos tengáis cuenta.'
      : me.reason === 'pair_games'
        ? `${me.pairName}: os ${me.gamesLeft === 1 ? 'falta 1 partida' : `faltan ${me.gamesLeft} partidas`} juntos para salir.`
        : me.reason === 'pair_place'
          ? `${me.pairName}: para salir aquí tenéis que ser los dos de ${data.label}.`
          : me.reason === 'week_games'
      ? `Juega ${me.gamesLeft} ${me.gamesLeft === 1 ? 'partida online más' : 'partidas online más'} esta semana para salir.`
      : me.reason === 'placement'
      ? `Juega ${me.gamesLeft} ${me.gamesLeft === 1 ? 'partida online más' : 'partidas online más'} para salir en el ranking.`
      : me.reason === 'inactive'
        ? 'Juega una partida online para volver a salir (cuenta haber jugado en esta temporada y en los últimos 30 días).'
        : 'Inicia sesión con Google para salir en el ranking.';
  return <p className="ranking-me is-muted">{text}</p>;
}
