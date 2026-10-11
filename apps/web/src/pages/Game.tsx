import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGame } from '../store.js';
import { CardView } from '../components/CardView.js';
import { SuitGlyph } from '../components/SuitGlyph.js';
import { card, teamOf, nextSeat, canSwapSevenWithTrump, nextDealer } from '@guinote/engine';
import type { Card, PlayerView, Seat, Suit } from '@guinote/engine';

const SUIT_NAME: Record<Suit, string> = {
  oros: 'Oros',
  copas: 'Copas',
  espadas: 'Espadas',
  bastos: 'Bastos',
};

const SEAT_LABELS = ['Norte', 'Oeste', 'Sur', 'Este'] as const;

/**
 * Formato de los puntos de UNA MANO (hand puntos / trickPoints).
 *  - 1-50 puntos = "X M" (malas)
 *  - 51-100+ = "(puntos - 50) B" (buenas, solo el exceso)
 * 70 puntos → "20 B". 30 puntos → "30 M".
 */
function fmtPts(pts: number): string {
  if (pts > 50) return `${pts - 50} B`;
  return `${pts} M`;
}

/**
 * Marcador del topbar (valor a pintar): el motor solo maneja puntos
 * raw (`view.cumulativeTeamPts`); la noción de Buenas/Malas es PURAMENTE
 * presentación. Se pinta como "Buenas" el tramo de arriba (≥ 51 raw
 * ⇒ +(raw-50) en el número) y como "Malas" el tramo de abajo. Lo
 * importante: el corte "51 en pantalla ↔ 101 raw" es lo que dispara
 * `MATCH_OVER`, idéntico al motor (`cumulativeTeamPts > threshold(100)`).
 */
function fmtScore(value: number): string {
  if (value > 50) return `${value - 50}`;
  return `${value}`;
}

/** Clase CSS según el tramo: > 50 ⇒ "in-buenas" (blanco), si no "in-malas" (rojo). */
function fmtRange(value: number): string {
  return value > 50 ? 'in-buenas' : 'in-malas';
}

export function Game() {
  const view = useGame((s) => s.view);
  const you = useGame((s) => s.you);
  const seatNames = useGame((s) => s.seatNames);
  const isBot = useGame((s) => s.isBot);
  const gameOver = useGame((s) => s.gameOver);
  const matchOver = useGame((s) => s.matchOver);
  const justResolved = useGame((s) => s.justResolved);
  const swapAnnouncement = useGame((s) => s.swapAnnouncement);
  const sendAction = useGame((s) => s.sendAction);
  const leave = useGame((s) => s.leave);
  // Progresión partida → coto → match (servidor). Necesitamos varios
  // en el render del marcador y de los paneles de fin de mano.
  const partidas = useGame((s) => s.partidas);
  const cotos = useGame((s) => s.cotos);
  const partidaEnCoto = useGame((s) => s.partidaEnCoto);
  const cotoEnMatch = useGame((s) => s.cotoEnMatch);
  const matchFinished = useGame((s) => s.matchFinished);
  const matchChampion = useGame((s) => s.matchChampion);

  // Drag & drop para reordenar la mano. `customOrder` es la permutación de
  // IDs en el orden actual; `null` = orden por defecto (palo + fuerza).
  // Se resetea solo cuando se reparten cartas nuevas (handIds distintos).
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const handRef = useRef<HTMLDivElement>(null);
  // Refs a cada slot para medir su centro real en el momento del drop.
  // Evita el desfase 1-3 que daba la fórmula basada en `handWidth / n`.
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dragRef = useRef<{ idx: number; startX: number; pointerId: number } | null>(null);
  // offsetX se actualiza en cada move y se renderiza como translateX.
  const [dragVisual, setDragVisual] = useState<{ idx: number; offsetX: number } | null>(null);

  // ¿En qué fase estamos para el humano? ¿qué puede hacer?
  const myOptions = useMemo(() => {
    if (!view || you === null) return { phase: 'idle' as const, plays: [], cantes: [], canSwapSeven: false, mustPass: false };
    if (view.phase !== 'winnerWindow' || view.turn !== you) {
      return { phase: view?.phase ?? 'idle', plays: [], cantes: [], canSwapSeven: false, mustPass: false };
    }
    const cantes: { suit: Card['suit']; value: number }[] = [];
    // ¿Quién puede cantar AHORA? Igual que el motor:
    //  - Hay que haber ganado la última baza (o ser compañero del ganador),
    //    TANTO en winnerWindow COMO en arrastre.
    //  - El flag `allowedInArrastre` (siempre true en guiñote aragonés)
    //    decide si los cantes se admiten en arrastre.
    const lastWinner = view.lastWinner;
    const winnerOrPartner =
      lastWinner !== null && (lastWinner === you || lastWinner === view.partner);
    const inArrastre = view.trumpCard === null;
    const canCanteNow =
      winnerOrPartner && (!inArrastre || true /* allowedInArrastre: true por defecto */);
    if (canCanteNow) {
      const [r1, r2] = [10, 12];
      for (const suit of ['oros', 'copas', 'espadas', 'bastos'] as Card['suit'][]) {
        if (view.cantes.some((c) => c.suit === suit)) continue;
        const has1 = view.hand.some((c) => c.suit === suit && c.rank === r1);
        const has2 = view.hand.some((c) => c.suit === suit && c.rank === r2);
        if (has1 && has2) {
          cantes.push({ suit, value: suit === view.trump ? 40 : 20 });
        }
      }
    }
    const canSwap =
      canSwapSevenWithTrump(view.trumpCard) &&
      view.lastWinner !== null &&
      (view.lastWinner === you || view.lastWinner === view.partner) &&
      view.hand.some((c) => c.id === `${view.trump}-7`);
    const mustPass = cantes.length === 0 && !canSwap;
    return { phase: view.phase, plays: [], cantes, canSwapSeven: canSwap, mustPass };
  }, [view, you]);

  // Cantes agrupados por seat para mostrarlos como chips fijos junto a cada
  // jugador (no efímero como el popup de cante-announcement). Se preserva el
  // orden de declaración; `view.cantes` resetea a [] al repartirse la siguiente
  // mano (engine/src/state.ts:235), así que los chips aparecen al cantar y
  // desaparecen solos al inicio de la siguiente. Vive ANTES del early return.
  const cantesBySeat = useMemo(() => {
    const map: Record<Seat, { suit: Suit; value: number; team: 0 | 1 }[]> = {
      0: [], 1: [], 2: [], 3: [],
    };
    if (!view) return map;
    for (const c of view.cantes) {
      map[c.seat].push({ suit: c.suit, value: c.value, team: c.team });
    }
    return map;
  }, [view?.cantes]);

  // Mano del jugador, en el orden de reparto del motor o el personalizado.
  // NO auto-ordenamos por palo+fuerza: cada jugador (incluido el humano) se
  // ordena sus cartas como quiera. El motor reparte en orden de barajadura
  // y nos lo pasa tal cual en `view.hand`. Si el jugador hace drag-drop,
  // se guarda en `customOrder` y se respeta; si nunca reordena, ve las
  // cartas tal como salieron.
  // El reorder solo afecta a la visualización; las IDs y el envío de jugadas
  // siguen siendo las mismas del servidor. Vive ANTES del early return para
  // no violar las Rules of Hooks.
  const displayCards = useMemo(() => {
    if (!view) return [];
    if (customOrder === null) {
      return view.hand.slice();
    }
    const map = new Map(view.hand.map((c) => [c.id, c]));
    return customOrder
      .map((id) => map.get(id))
      .filter((c): c is Card => c !== undefined);
  }, [view?.hand, customOrder]);

  // Auto-PASS en winnerWindow cuando no hay cante ni cambio del 7.
  useEffect(() => {
    if (!view || you === null) return;
    if (view.phase !== 'winnerWindow' || view.turn !== you) return;
    if (myOptions.mustPass) {
      const t = setTimeout(() => sendAction({ type: 'PASS' }), 350);
      return () => clearTimeout(t);
    }
  }, [view?.version, view?.turn, view?.phase, you, myOptions.mustPass, sendAction]);

  // ───────────── Anuncio de cante (overlay central) ─────────────
  // Cuando se declara un cante nuevo, mostramos un overlay centrado con
  // el nombre del jugador, el equipo y el valor (40 o 20) durante 3,5 s,
  // para que TODOS los jugadores lo vean en su pantalla. Sustituye al
  // toast anterior y al "Cantes" del antiguo resumen de mano, con foco en
  // visibilidad inmediata en el centro del tablero.
  const [canteAnnouncement, setCanteAnnouncement] = useState<{
    uid: number;
    seat: Seat;
    team: 0 | 1;
    suit: Suit;
    value: number;
  } | null>(null);
  // Cuenta de cantes que ya hemos anunciado. Incrementamos solo cuando
  // `view.cantes.length` crece; al pasar a 0 (nueva mano) reseteamos.
  const lastCantesCountRef = useRef(0);
  useEffect(() => {
    if (!view) return;
    const cur = view.cantes.length;
    const prev = lastCantesCountRef.current;
    if (cur > prev) {
      const last = view.cantes[cur - 1]!;
      setCanteAnnouncement({
        uid: performance.now(),
        seat: last.seat,
        team: last.team,
        suit: last.suit,
        value: last.value,
      });
      lastCantesCountRef.current = cur;
    } else if (cur === 0 && prev > 0) {
      // Nueva mano: el motor resetea `state.cantes` al repartir.
      lastCantesCountRef.current = 0;
    }
  }, [view?.cantes, view]);
  // Auto-clear al cabo de 3,5 s. Si llega otro cante mientras tanto,
  // `uid` cambia y este effect se re-ejecuta con un timer nuevo.
  useEffect(() => {
    if (!canteAnnouncement) return;
    const id = window.setTimeout(() => setCanteAnnouncement(null), 3500);
    return () => window.clearTimeout(id);
  }, [canteAnnouncement?.uid]);

  // Highlight de la carta ganadora desacoplado del timer de `justResolved`.
  // El bug que queríamos evitar: `justResolved` se limpia por su timer de
  // 4s, pero las cartas de la baza siguen renderizadas hasta que el
  // servidor envíe el siguiente VIEW con la baza vacía. Eso provocaba un
  // instante visible de "cartas en mesa pero sin highlight" entre el
  // timer y el unmount.
  //
  // Solución: mantenemos el highlight mientras las cartas de la baza
  // sigan en pantalla. Solo se limpia cuando `view.trick` se vacía.
  const [winningKeys, setWinningKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (justResolved !== null) {
      const keys = justResolved.plays
        .filter((jp) => jp.seat === justResolved.winner)
        .map((jp) => `${jp.seat}-${jp.card.id}`);
      setWinningKeys(new Set(keys));
    }
    // Si `justResolved` pasa a null, NO limpiamos aquí — dejamos que el
    // siguiente effect lo haga cuando `view.trick` se vacíe.
  }, [justResolved]);
  useEffect(() => {
    if (view && view.trick.length === 0) {
      setWinningKeys(new Set());
    }
  }, [view?.trick.length]);

  // Highlight breve (1,5s) en la carta recién ROBADA del mazo por el
  // jugador. Distinguimos "robo" (1 carta nueva tras un truco) del
  // "reparto inicial" (6 cartas nuevas al empezar mano), porque en el
  // segundo caso no tiene sentido destacar una sola.
  //
  // Mecánica: comparamos el set de IDs de la mano actual con el que
  // recordamos del render anterior. Si hay exactamente 1 ID nuevo y
  // provenía de un "robo" (mano creció de 5 a 6 o de N a N+1 dentro
  // de la misma mano), marcamos ese ID para el highlight.
  const prevHandIdsRef = useRef<string | null>(null);
  const [newlyDrawnId, setNewlyDrawnId] = useState<string | null>(null);
  useEffect(() => {
    if (!view) return;
    const currentIds = view.hand.map((c) => c.id).join('|');
    const prev = prevHandIdsRef.current;
    if (prev === null) {
      // Primera vez: inicializamos sin highlight (mano recién repartida).
      prevHandIdsRef.current = currentIds;
      return;
    }
    if (prev === currentIds) return; // sin cambios
    const prevSet = new Set(prev.split('|'));
    const newIds = view.hand.filter((c) => !prevSet.has(c.id));
    prevHandIdsRef.current = currentIds;
    if (newIds.length === 1) {
      // Caso típico: 1 carta nueva → highlight de 1,5s
      const newId = newIds[0]!.id;
      setNewlyDrawnId(newId);
      const t = setTimeout(() => setNewlyDrawnId(null), 1500);
      return () => clearTimeout(t);
    }
    // 0 cartas nuevas (mano encogió) o 6+ nuevas (nueva mano): sin highlight
  }, [view?.hand]);

  // Gestiona el ciclo de vida de customOrder cuando el servidor actualiza la mano:
  // - Si la mano creció (carta nueva) → mantenemos el orden del jugador y
  //   añadimos la nueva al final (antes se reseteaba y perdía el orden).
  // - Si la mano encogió (carta jugada) → quitamos esa carta del orden.
  // - Si los IDs no encajan en absoluto (nueva mano) → reset a null.
  // - Si la mano está intacta → mantenemos el orden.
  // También cancelamos cualquier drag en curso al cambiar la mano.
  useEffect(() => {
    if (!view) return;
    if (customOrder === null) {
      setDragVisual(null);
      dragRef.current = null;
      return;
    }
    const handIds = new Set(view.hand.map((c) => c.id));
    const filtered = customOrder.filter((id) => handIds.has(id));

    // Caso 1: mano creció → preservamos el orden del jugador y añadimos
    // las cartas nuevas al final. Antes caía al else y reseteaba a null.
    if (view.hand.length > customOrder.length) {
      const customOrderSet = new Set(customOrder);
      const newIds = view.hand
        .filter((c) => !customOrderSet.has(c.id))
        .map((c) => c.id);
      setCustomOrder([...customOrder, ...newIds]);
      setDragVisual(null);
      dragRef.current = null;
      return;
    }

    // Sin cambios
    if (filtered.length === customOrder.length && filtered.length === view.hand.length) {
      return;
    }
    // Caso 2: mano encogió (carta jugada)
    if (filtered.length === view.hand.length) {
      setCustomOrder(filtered);
    } else {
      // Caso 3: mano completamente nueva
      setCustomOrder(null);
    }
    setDragVisual(null);
    dragRef.current = null;
  }, [view?.hand]);

  // Cartas legales de mi mano (heurística cliente). `computeLegalSet` no es
  // un hook, así que podría declararse post-early-return, pero como abajo lo
  // necesitamos dentro de `hasRestrictedHand` (otro hook), lo movemos aquí.
  const legalSet = computeLegalSet(view, you);
  // Mano restringida = al menos UNA carta no es legal. Si toda la mano es
  // legal, no resaltamos ninguna para no sobrecargar de marcos.
  const hasRestrictedHand = useMemo(
    () => displayCards.some((c) => !legalSet.has(c.id)),
    [displayCards, legalSet],
  );

  if (!view || you === null) {
    return <div className="loading">Conectando a la mesa…</div>;
  }

  const isMyTurn = view.turn === you;
  const isPartner = (seat: number) => view.partner === seat;
  const teammate = view.partner;

  // Cartas legales (heurística cliente para resaltar). Como no tenemos acceso
  // al motor en el bundle, usamos la misma lógica de legalPlays. Para esta
  // primera versión, en draw todo es legal; en arrastre seguimos palo.
  // (Movido arriba del early return para que `hasRestrictedHand` pueda
  //  leerlo dentro del useMemo. La función `computeLegalSet` no es un hook.)

  const onPlay = (card: Card) => {
    if (!isMyTurn) return;
    if (view.phase === 'winnerWindow') return;
    if (!legalSet.has(card.id)) return;
    sendAction({ type: 'PLAY_CARD', cardId: card.id });
  };

  return (
    <div className="game">
      {/* Header: triunfo + puntos + salir */}
      <header className="topbar">
        <div className="trump-info">
          {/* Solo el As del palo del triunfo, con un anillo del color del
              palo. Los otros tres Ases no se renderizan: "marca el triunfo"
              debe leerse como "el As del triunfo", no como "uno entre cuatro". */}
          <div className="trump-mini" data-suit={view.trump} aria-hidden="true">
            <CardView card={card(view.trump, 1)} small />
          </div>
          <div className="trump-text">
            <span className="trump-label">Triunfo</span>
            <span className="trump-name" data-suit={view.trump}>
              {SUIT_NAME[view.trump]}
            </span>
            {!view.trumpCard && <span className="trump-card-gone">arrastre</span>}
          </div>
        </div>
        <div className="score">
          {/* Marcadores en vertical: número grande arriba, "Nosotros"/"Ellos"
              debajo. La fase (Idas / Vueltas) queda centrada entre ambos.

              Fuente del número: `view.cumulativeTeamPts[team]`. Es la
              suma raw de cartas + 10 de últimas + cantes a lo largo
              de toda la partida. El motor la incrementa baza a baza y
              al cantarse un cante, y la preserva entre manos vía
              `continuation` en `newHand`, así que:
              - Crece tras cada tirada, sin esperar al cierre de mano.
              - Vueltas parte del resultado de idas, no se resetea.
              - Cruza 100 (raw) ⇒ `MATCH_OVER` por el motor y el
                color de la cifra pasa a blanco (visible a la vez).

              La noción "Buenas/Malas" es PURAMENTE presentación del
              cliente: `fmtScore` pinta el tramo de arriba
              (raw > 50 ⇒ "(raw-50)") en blanco, y el de abajo en
              rojo. Eso es lo que el usuario llama "51 Buenas" cuando
              raw = 101 — y dispara MATCH_OVER inmediatamente. */}
          <div className="score-team is-mine">
            {(() => {
              const team = you % 2 as 0 | 1;
              const value = view.cumulativeTeamPts[team] ?? 0;
              return (
                <b className={`score-num ${fmtRange(value)}`}>
                  {fmtScore(value)}
                </b>
              );
            })()}
            <span className="score-label">Nosotros</span>
          </div>
          <span className={`phase-pill phase-${view.vuelta === 1 ? 'idas' : 'vueltas'}`}>
            {view.vuelta === 1 ? 'Idas' : 'Vueltas'}
          </span>
          <div className="score-team is-theirs">
            {(() => {
              const team = (1 - you % 2) as 0 | 1;
              const value = view.cumulativeTeamPts[team] ?? 0;
              return (
                <b className={`score-num ${fmtRange(value)}`}>
                  {fmtScore(value)}
                </b>
              );
            })()}
            <span className="score-label">Ellos</span>
          </div>
        </div>
        <button className="btn small" onClick={leave}>Salir</button>
      </header>

      {/* Solo se renderiza el seat activo, en la celda de su posición.
          Cuando cambia el turno, el panel "salta" a otra celda. */}
      <div className="board">
        <div className="seats-area">
          {/* Todos los seats muestran sus cartas boca abajo, incluido el humano.
              El acento (borde dorado) marca quién tiene el turno. El humano no
              muestra la baraja de dorsos porque sus cartas están dentro del
              propio tablero (no en un div separado). */}
        {([0, 1, 2, 3] as const).map((seat) => {
          const pos = ((seat - you + 4) % 4) as 0 | 1 | 2 | 3;
          const isActive = view.turn === seat;
          const isYou = seat === you;
          // Iniciales para el avatar: primera letra de las dos primeras
          // palabras del nombre. Los bots ahora llevan nombres aragoneses
          // ("Pilar", "Ramiro", etc.) generados en el servidor; los que
          // aún no tienen nombre muestran la inicial de su seat label.
          // Para el humano usamos "T" de "Tú".
          const displayName = isYou ? 'Tú' : seatNames[seat] || SEAT_LABELS[seat];
          const parts = displayName.trim().split(/\s+/);
          const first = (parts[0] ?? '').charAt(0);
          const second = parts.length >= 2 ? (parts[1] ?? '').charAt(0) : '';
          const initials = isYou ? 'T' : (first + second).toUpperCase() || '?';
          return (
            <div
              key={seat}
              className={`seat pos-${pos} ${isActive ? 'active' : ''} ${isPartner(seat) ? 'partner' : ''} ${isYou ? 'you' : ''} ${view.lastWinner === seat ? 'winner' : ''} ${view.phase === 'winnerWindow' ? 'winner-window' : ''}`}
            >
              <div className="seat-avatar">{initials}</div>
              <div className="seat-name">
                {displayName}
                {view.lastWinner === seat && ' 👑'}
              </div>
              {/* Cantes fijos de este jugador durante la mano actual: chips
                  pequeños con el valor y el palo, coloreados por suit. Yacen al
                  final del seat para no chocar con avatar/nombre. Si el
                  jugador no ha cantado nada, no se renderiza el contenedor. */}
              {cantesBySeat[seat].length > 0 && (
                <div className="seat-cantes" aria-label={`Cantes de ${displayName}`}>
                  {cantesBySeat[seat].map((c, i) => (
                    <span
                      key={`${c.suit}-${i}`}
                      className="cante-chip"
                      data-suit={c.suit}
                      title={`${c.value === 40 ? 'Cuarenta' : 'Veinte'} en ${SUIT_NAME[c.suit]}`}
                    >
                      <SuitGlyph suit={c.suit} size={15} />
                      <b>+{c.value}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Mazo de la mesa: triunfo boca arriba con el mazo encima tapando
            media carta. Solo se muestra durante la fase de robo (trumpCard
            visible); al entrar en arrastre, el mazo desaparece. */}
        {view.trumpCard && (
          <MazoArea trumpCard={view.trumpCard} />
        )}

        {/* Baza en rombo: cada carta va en la celda de su seat */}
        <div className="trick-area">
          {view.trick.map((p) => {
            // Misma rotación que los seats: pos 0 = Sur (humano), 1 = Oeste, 2 = Norte, 3 = Este.
            const pos = ((p.seat - you + 4) % 4) as 0 | 1 | 2 | 3;
            // Ganadora: depende de `winningKeys` (estado local), no de
            // `justResolved` directamente, para que el highlight NO se
            // quite cuando el timer de 2,5 s limpia `justResolved` — debe
            // persistir mientras las cartas sigan en pantalla. Las demás
            // se quedan como están, sin atenuar.
            const isWinner = winningKeys.has(`${p.seat}-${p.card.id}`);
            return (
              <div
                key={`${p.seat}-${p.card.id}`}
                className={`trick-card pos-${pos} ${isWinner ? 'winning' : ''}`}
              >
                <CardView card={p.card} small />
              </div>
            );
          })}
        </div>
        </div>

        {/* Marcador "estilo tenis" — fuera del tablero (dentro de `.game`)
            para que su `position: absolute` se refiera a la pantalla y no
            al board. En escritorio va anclado a la izquierda de la pantalla
            (esquina superior izquierda). En móvil (`@media max-width: 768px`)
            se estira de borde a borde del board (que en móvil ocupa todo el
            ancho) con las dos cifras en una fila "0-3" — ver
            `.match-tennis-dash` y la media query asociada en styles.css. */}
        {(() => {
          const myTeam = (you % 2) as 0 | 1;
          const otherTeam = (1 - (you % 2)) as 0 | 1;
          return (
            <div className="match-tennis">
              {/* Caja "Partidas" (idas/vueltas individuales ganadas). En el
                  DOM va PRIMERO para que con el `order` del CSS la saquemos
                  a la izquierda. */}
              <div className="match-tennis-board">
                <div className="match-tennis-label">Partidas</div>
                <div className="match-tennis-row is-mine">
                  <span className="match-tennis-count">{partidas[myTeam]}</span>
                </div>
                {/* El guion solo se ve en móvil (display: none por defecto).
                    Lo añadimos al DOM para no duplicar el render según el
                    viewport. */}
                <span className="match-tennis-dash" aria-hidden="true">-</span>
                <div className="match-tennis-row is-theirs">
                  <span className="match-tennis-count">{partidas[otherTeam]}</span>
                </div>
              </div>
              {/* Caja "Cotos" (sets de 3 partidas ganados). Va segunda en
                  el DOM y el CSS la coloca a la derecha. */}
              <div className="match-tennis-board">
                <div className="match-tennis-label">Cotos</div>
                <div className="match-tennis-row is-mine">
                  <span className="match-tennis-count">{cotos[myTeam]}</span>
                </div>
                <span className="match-tennis-dash" aria-hidden="true">-</span>
                <div className="match-tennis-row is-theirs">
                  <span className="match-tennis-count">{cotos[otherTeam]}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Mano + acciones agrupadas en .hand-area. En móvil se apilan
            verticalmente (mano arriba, acciones abajo); en escritorio (≥
            769 px) se ponen en fila con la mano a la izquierda y las
            acciones a la derecha, ambas alineadas al borde inferior. */}
        <div className="hand-area">
        <div className="hand" ref={handRef}>
          {/* Solo marcamos cartas como `playable` (marco amarillo + elevación)
              cuando la mano está RESTRINGIDA: al menos una carta no es legal.
              Si TODAS son jugables, no marcamos ninguna para no sobrecargar
              la mano con marcos amarillos. */}
          {displayCards.map((c, idx) => {
            const isDraggingThis = dragVisual?.idx === idx;
            // Mientras arrastramos, la carta traducida no desplaza a las demás.
            // El "snap" a la posición nueva se hace en el reorder (post-up).
            const style: CSSProperties | undefined = isDraggingThis
              ? {
                  transform: `translateX(${dragVisual!.offsetX}px) translateY(-6px)`,
                  zIndex: 10,
                  cursor: 'grabbing',
                }
              : undefined;
            return (
              <button
                key={c.id}
                ref={(el) => { slotRefs.current[idx] = el; }}
                className={`card-slot ${isMyTurn && hasRestrictedHand && legalSet.has(c.id) ? 'playable' : isMyTurn && hasRestrictedHand && !legalSet.has(c.id) ? 'disabled' : ''} ${isDraggingThis ? 'is-dragging' : ''} ${newlyDrawnId === c.id ? 'is-newly-drawn' : ''}`}
                style={style}
                aria-label={`${c.rank} de ${c.suit}`}
                onPointerDown={(e) => {
                  // Permitimos drag-to-reorder SIEMPRE, incluso cuando no es
                  // nuestro turno: la mano es del jugador y puede organizarla
                  // cuando quiera. El click-para-jugar sigue bloqueado vía
                  // onPlay (que comprueba isMyTurn y la legalidad).
                  if (!legalSet.has(c.id)) return;
                  e.preventDefault();
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  dragRef.current = { idx, startX: e.clientX, pointerId: e.pointerId };
                  setDragVisual({ idx, offsetX: 0 });
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d || d.idx !== idx) return;
                  setDragVisual({ idx, offsetX: e.clientX - d.startX });
                }}
                onPointerUp={(e) => {
                  const d = dragRef.current;
                  dragRef.current = null;
                  setDragVisual(null);
                  if (!d || d.idx !== idx || !handRef.current) return;
                  try { (e.currentTarget as Element).releasePointerCapture(d.pointerId); } catch { /* ignore */ }
                  const offsetX = e.clientX - d.startX;
                  const DRAG_THRESHOLD = 5;
                  if (Math.abs(offsetX) > DRAG_THRESHOLD) {
                    // Regla con centros como ancla (simétrica izq/der):
                    // 1) Encontrar la carta no-arrastrada cuyo CENTRO esté más
                    //    cerca del cursor.
                    // 2) Si `cursorX < center` → cae ANTES de esa carta.
                    // 3) Si `cursorX >= center` → cae DESPUÉS (= antes de la
                    //    siguiente carta, o al final si es la última).
                    // Así, la "mitad izquierda" del slot de cada carta es zona
                    // de "antes" y la "mitad derecha" es zona de "después":
                    // arrastras a la izquierda y caes antes; a la derecha y
                    // caes después, sin saltos inexplicables.
                    const cursorX = e.clientX;
                    type SlotInfo = { cardId: string; center: number };
                    const slots: SlotInfo[] = [];
                    for (let i = 0; i < slotRefs.current.length; i++) {
                      if (i === idx) continue; // la arrastrada tiene transform
                      const el = slotRefs.current[i];
                      if (!el || !el.isConnected) continue;
                      const r = el.getBoundingClientRect();
                      slots.push({
                        cardId: displayCards[i]!.id,
                        center: r.left + r.width / 2,
                      });
                    }
                    if (slots.length === 0) {
                      setDragVisual(null);
                      dragRef.current = null;
                      return;
                    }
                    // Carta con centro más cercano al cursor.
                    let bestIdx = 0;
                    let bestDist = Math.abs(slots[0]!.center - cursorX);
                    for (let i = 1; i < slots.length; i++) {
                      const d = Math.abs(slots[i]!.center - cursorX);
                      if (d < bestDist) {
                        bestDist = d;
                        bestIdx = i;
                      }
                    }
                    // ¿Cursor a la izquierda o derecha del centro más cercano?
                    const insertAt =
                      cursorX < slots[bestIdx]!.center
                        ? bestIdx // antes
                        : bestIdx + 1; // después
                    // Construir el nuevo orden.
                    const movedId = displayCards[idx]!.id;
                    const newOrder: string[] = [];
                    for (let i = 0; i <= slots.length; i++) {
                      if (i === insertAt) newOrder.push(movedId);
                      if (i < slots.length) newOrder.push(slots[i]!.cardId);
                    }
                    setCustomOrder(newOrder);
                  } else {
                    // Tap (sin arrastre significativo) → jugar la carta.
                    onPlay(c);
                  }
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setDragVisual(null);
                }}
              >
                <CardView card={c} />
              </button>
            );
          })}
        </div>

        {/* Acciones: dos variantes del panel.
            - .action-bar-mobile: 3 botones en horizontal (Cantar, Cambiar,
              Nada). Render CONDICIONAL: solo aparece en la ventana de
              decisión del jugador cuando hay al menos un cante o un 7 que
              cambiar. El botón "Nada" permite pasar explícitamente.
            - .action-bar-desktop: 2 botones en vertical dentro del panel
              con chrome (fondo + borde + pie explicativo). SIEMPRE visible
              (los botones individuales se desactivan cuando no proceden).
            CSS muestra uno u otro según el viewport. */}
        <div className="action-bar-mobile">
          {(myOptions.cantes.length > 0 || myOptions.canSwapSeven) && (
            <div className={`action-bar${view.phase === 'winnerWindow' && view.turn === you ? ' is-you' : ''}`}>
              <div className="action-buttons">
                <button
                  className="btn primary small"
                  disabled={myOptions.cantes.length === 0}
                  onClick={() => {
                    // Canta el primer cante disponible, priorizando 40
                    // (Rey+Sota del triunfo) sobre 20 (Rey+Sota de cualquier
                    // otro palo). El motor ya se encarga de validar el caso
                    // del 40 y descontarlo de la lista de cantes.
                    const c =
                      myOptions.cantes.find((c) => c.value === 40) ??
                      myOptions.cantes.find((c) => c.value === 20);
                    if (c) sendAction({ type: 'SING_CANTE', suit: c.suit, pair: [10, 12] });
                  }}
                  title={
                    myOptions.cantes.length === 0
                      ? 'No tienes Rey+Sota de ningún palo'
                      : 'Canta el primer cante disponible (40 antes que 20)'
                  }
                >
                  Cantar
                </button>
                <button
                  className="btn primary small"
                  disabled={!myOptions.canSwapSeven}
                  onClick={() => sendAction({ type: 'SWAP_SEVEN' })}
                  title={myOptions.canSwapSeven ? `Cambiar el 7 por el triunfo` : 'No tienes el 7 del triunfo (o no es tu turno, o el triunfo no es una carta superior)'}
                >
                  Cambiar el 7
                </button>
                <button
                  className="btn small"
                  onClick={() => sendAction({ type: 'PASS' })}
                >
                  Nada
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="action-bar-desktop">
          <div className={`action-bar${view.phase === 'winnerWindow' && view.turn === you ? ' is-you' : ''}`}>
            <div className="action-panel">
              <div className="action-buttons">
                <button
                  className="btn primary"
                  disabled={myOptions.cantes.length === 0}
                  onClick={() => {
                    const c =
                      myOptions.cantes.find((c) => c.value === 40) ??
                      myOptions.cantes.find((c) => c.value === 20);
                    if (c) sendAction({ type: 'SING_CANTE', suit: c.suit, pair: [10, 12] });
                  }}
                  title={
                    myOptions.cantes.length === 0
                      ? 'No tienes Rey+Sota de ningún palo'
                      : 'Canta el primer cante disponible (40 antes que 20)'
                  }
                >
                  Cantar
                </button>
                <button
                  className="btn primary"
                  disabled={!myOptions.canSwapSeven}
                  onClick={() => sendAction({ type: 'SWAP_SEVEN' })}
                  title={myOptions.canSwapSeven ? `Cambiar el 7 por el triunfo` : 'No tienes el 7 del triunfo (o no es tu turno, o el triunfo no es una carta superior)'}
                >
                  Cambiar el 7
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Resumen de fin de partida (ida/vuelta). Se muestra cuando llega el
          GAME_OVER (con o sin MATCH_OVER). Estructura compacta: título +
          cajas grandes con el marcador + tabla 3 columnas con el desglose.
          - matchOver: "Partida terminada · Hemos ganado / Ganan ellos" +
            sin acción Continuar (auto-cadencia del servidor).
          - gameOver sin cierre: "Resumen · vuelta N" + 🏁 "Vamos de
            vueltas" + (sin botón, los servidores reparten al siguiente). */}
      {(gameOver || matchOver) && view && (() => {
        const s = buildSummary(view, you);
        const seatLabel = (seat: Seat) => seatNames[seat] || SEAT_LABELS[seat];
        return (
          <div className="game-over-summary">
            <h2>
              {matchOver
                ? 'Partida terminada'
                : `Resumen${s.vuelta > 1 ? ` · vuelta ${s.vuelta}` : ''}`}
            </h2>

            {/* ───────────── Resultado según escenario ───────────── */}
            {matchOver && (
              <section className="summary-matchover">
                <h3 className="summary-result-title">
                  {s.matchWinner === s.myTeam ? '🎉 Hemos ganado' : 'Ganan ellos'}
                </h3>
                {/* Subtítulo que indica el nivel en el que estamos:
                    - matchFinished: el match entero ha terminado.
                    - partidas[winner] == 4 && !matchFinished: coto ganado.
                    - en otro caso: solo partida ganada (panel normal). */}
                {matchFinished ? (
                  <p className="summary-result-subtitle">🏆 Match terminado</p>
                ) : s.matchWinner !== null && partidas[s.matchWinner] >= 3 ? (
                  <p className="summary-result-subtitle">Coto ganado — empezamos el siguiente</p>
                ) : (
                  <p className="summary-result-subtitle">Partida {partidaEnCoto} de 3 ganada</p>
                )}

                {/* Cajas grandes con el marcador final de la partida.
                    Presentación pura: a partir del `cumulative` raw del
                    equipo pintamos (raw-50) como "Buenas" si raw > 50, o
                    raw como "Malas" si raw ≤ 50. Sin gestión de dos
                    contadores separados en el motor. */}
                <div className="summary-score-boxes">
                  <div className="summary-score-box is-mine">
                    <span className="summary-score-label">Nosotros</span>
                    {(() => {
                      const m = marcadorAcumulado(s.cumulative[s.myTeam]);
                      return m.value > 0 ? (
                        <>
                          <span className="summary-score-value">{m.value}</span>
                          <span className="summary-score-suffix">{m.label}</span>
                        </>
                      ) : (
                        <span className="summary-score-value">{m.label}</span>
                      );
                    })()}
                  </div>
                  <div className="summary-score-box is-theirs">
                    <span className="summary-score-label">Ellos</span>
                    {(() => {
                      const m = marcadorAcumulado(s.cumulative[s.otherTeam]);
                      return m.value > 0 ? (
                        <>
                          <span className="summary-score-value">{m.value}</span>
                          <span className="summary-score-suffix">{m.label}</span>
                        </>
                      ) : (
                        <span className="summary-score-value">{m.label}</span>
                      );
                    })()}
                  </div>
                </div>

                {/* Tabla con el desglose de la mano (2 columnas: puntos
                    formateados de esta mano + quién se llevó las 10 de
                    últimas). Quitamos la fila Diferencia porque su info ya
                    está implícita en el título y en las cajas grandes.

                    Se muestra SOLO cuando la partida termina en IDAS
                    (vuelta === 1). En vueltas 2+ las cajas grandes con
                    Buenas/Malas ya cuentan toda la historia y la tabla
                    resulta redundante — el cliente solo ve el marcador
                    final. */}
                {s.vuelta === 1 && (
                  <>
                    <h3 className="summary-table-title">Desglose de la mano</h3>
                    <div className="summary-table">
                      <div className="summary-table-row summary-table-header">
                        <span className="summary-table-label" />
                        <span className="summary-table-col">Nosotros</span>
                        <span className="summary-table-col">Ellos</span>
                      </div>
                      <div className="summary-table-row">
                        <span className="summary-table-label">Puntos</span>
                        <span className="summary-table-col">
                          {formatPunto(s.handTotal[s.myTeam])}
                        </span>
                        <span className="summary-table-col">
                          {formatPunto(s.handTotal[s.otherTeam])}
                        </span>
                      </div>
                      {view.cantes.length > 0 && (
                        <div className="summary-table-row">
                          <span className="summary-table-label">Cantes</span>
                          <span className="summary-table-col">
                            {renderCantesForTeam(view.cantes, s.myTeam)}
                          </span>
                          <span className="summary-table-col">
                            {renderCantesForTeam(view.cantes, s.otherTeam)}
                          </span>
                        </div>
                      )}
                      <div className="summary-table-row">
                        <span className="summary-table-label">10 de últimas</span>
                        <span className="summary-table-col">
                          {s.lastTrickWinnerTeam === s.myTeam
                            ? seatLabel(s.lastTrickWinnerSeat!)
                            : '—'}
                        </span>
                        <span className="summary-table-col">
                          {s.lastTrickWinnerTeam === s.otherTeam
                            ? seatLabel(s.lastTrickWinnerSeat!)
                            : '—'}
                        </span>
                      </div>
                    </div>
                  </>
                )}


              </section>
            )}
            {!matchOver && s.matchWinner === null && (
              <section className="summary-matchover">
                <h3 className="summary-result-title">🏁 Vamos de vueltas</h3>
                {/* Subtítulo con el progreso de partidas en el coto actual:
                    "Llevas X de 3 partidas, faltan N" o "¡Has ganado
                    el coto!" si partidas[myTeam] == 3. */}
                {(() => {
                  const myPartidas = partidas[s.myTeam];
                  const faltan = 3 - myPartidas;
                  if (myPartidas >= 3) {
                    return (
                      <p className="summary-result-subtitle">
                        ¡Has ganado el coto!
                      </p>
                    );
                  }
                  return (
                    <p className="summary-result-subtitle">
                      Llevas <b>{myPartidas}</b> de 3 partidas
                      {faltan === 1 ? ' · falta 1' : ` · faltan ${faltan}`}
                    </p>
                  );
                })()}

                {/* Cajas grandes con el marcador de cada equipo. La noción de
                    Buenas/Malas es presentación: el motor solo acumula
                    puntos raw (`cumulative`) y el cliente los traduce al
                    pintar (raw > 50 ⇒ "(raw-50) Buenas", si no "raw Malas"). */}
                <div className="summary-score-boxes">
                  <div className="summary-score-box is-mine">
                    <span className="summary-score-label">Nosotros</span>
                    {(() => {
                      const m = marcadorAcumulado(s.cumulative[s.myTeam]);
                      return m.value > 0 ? (
                        <>
                          <span className="summary-score-value">{m.value}</span>
                          <span className="summary-score-suffix">{m.label}</span>
                        </>
                      ) : (
                        <span className="summary-score-value">{m.label}</span>
                      );
                    })()}
                  </div>
                  <div className="summary-score-box is-theirs">
                    <span className="summary-score-label">Ellos</span>
                    {(() => {
                      const m = marcadorAcumulado(s.cumulative[s.otherTeam]);
                      return m.value > 0 ? (
                        <>
                          <span className="summary-score-value">{m.value}</span>
                          <span className="summary-score-suffix">{m.label}</span>
                        </>
                      ) : (
                        <span className="summary-score-value">{m.label}</span>
                      );
                    })()}
                  </div>
                </div>

                {/* Tabla con el desglose de la mano + cuánto le falta a cada
                    pareja para cerrar (>50). */}
                <h3 className="summary-table-title">Desglose de la mano</h3>
                <div className="summary-table">
                  <div className="summary-table-row summary-table-header">
                    <span className="summary-table-label" />
                    <span className="summary-table-col">Nosotros</span>
                    <span className="summary-table-col">Ellos</span>
                  </div>
                  <div className="summary-table-row">
                    <span className="summary-table-label">Puntos</span>
                    <span className="summary-table-col">{formatPunto(s.handTotal[s.myTeam])}</span>
                    <span className="summary-table-col">{formatPunto(s.handTotal[s.otherTeam])}</span>
                  </div>
                  {view.cantes.length > 0 && (
                    <div className="summary-table-row">
                      <span className="summary-table-label">Cantes</span>
                      <span className="summary-table-col">
                        {renderCantesForTeam(view.cantes, s.myTeam)}
                      </span>
                      <span className="summary-table-col">
                        {renderCantesForTeam(view.cantes, s.otherTeam)}
                      </span>
                    </div>
                  )}
                  <div className="summary-table-row">
                    <span className="summary-table-label">10 de últimas</span>
                    <span className="summary-table-col">
                      {s.lastTrickWinnerTeam === s.myTeam
                        ? seatLabel(s.lastTrickWinnerSeat!)
                        : '—'}
                    </span>
                    <span className="summary-table-col">
                      {s.lastTrickWinnerTeam === s.otherTeam
                        ? seatLabel(s.lastTrickWinnerSeat!)
                        : '—'}
                    </span>
                  </div>
                </div>

                {/* Hints contextuales: dealer, siguiente jugador, recordatorio
                    de las reglas de las vueltas. */}
                {s.nextDealer !== null && s.nextStarter !== null && (
                  <p className="summary-footer">
                    Reparte <b>{seatLabel(s.nextDealer)}</b>.
                    {' '}Sale <b>{seatLabel(s.nextStarter)}</b>{' '}
                    (a la derecha del dealer).
                  </p>
                )}
                {s.vuelta === 1 && (
                  <p className="summary-footer">Se juegan las vueltas.</p>
                )}
                {s.vuelta > 1 && (
                  <p className="summary-footer">
                    En vueltas se arrastran las buenas/malas de la ida.
                    La partida termina en cuanto una pareja pase {MATCH_THRESHOLD} puntos.
                  </p>
                )}
              </section>
            )}

            {/* Pie del panel de resumen. Con la auto-cadencia del servidor,
                ya no hay botón "Continuar": 3 partidas forman un coto, 2
                cotos forman un match, y el siguiente juego se reparte solo
                ~3 s después de este panel. Cuando el match entero ha
                terminado, lo decimos en texto para que el usuario sepa que
                tiene que crear una sala nueva. */}
            <div className="summary-actions">
              {matchFinished ? (
                <span className="summary-actions-hint">
                  🏆 El match ha terminado. Crea una sala nueva para volver a jugar.
                </span>
              ) : (
                <span className="summary-actions-hint">
                  Repartiendo siguiente mano…
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Truco y ganador se muestran visualmente sobre las cartas en el board;
          el badge flotante intermedio lo quitamos porque no aportaba info
          que ya no estuviera visible. */}

      {/* Anuncio de cante: aparece centrado al declararse un cante nuevo
          (SING_CANTE llega al servidor → llega al cliente → este overlay
          lo muestra durante 3,5 s y se va solo). `key={canteAnnouncement.uid}`
          fuerza remount para reiniciar la animación CSS cuando llega otro
          cante antes de que el actual haya expirado. */}
      {canteAnnouncement && (
        <div
          key={canteAnnouncement.uid}
          className={
            'cante-announcement' +
            (you !== null && canteAnnouncement.team === (you % 2)
              ? ' is-mine'
              : ' is-theirs')
          }
          role="status"
          aria-live="polite"
        >
          <div className="cante-announcement-team">
            {you !== null && canteAnnouncement.team === (you % 2)
              ? 'Nosotros'
              : 'Ellos'}
          </div>
          <div className="cante-announcement-player">
            {seatNames[canteAnnouncement.seat] || SEAT_LABELS[canteAnnouncement.seat]}
          </div>
          <div className="cante-announcement-text">
            canta <b className="value">+{canteAnnouncement.value}</b>
            {/* Cuando el cante es de 40, el palo es siempre el del triunfo
                (regla del motor: `value = suit === trump ? 40 : 20`), así
                que decirlo es redundante. Solo mostramos el palo en los
                cantes de 20, donde sí puede ser cualquier palo. */}
            {canteAnnouncement.value !== 40 && (
              <> en <b className="suit">{SUIT_NAME[canteAnnouncement.suit]}</b></>
            )}
          </div>
        </div>
      )}

      {/* Anuncio de SWAP del 7: aparece centrado cuando alguien cambia su 7
          por la carta de triunfo. Mismo patrón que el cante: lo emite el
          servidor, vive 3,5 s en pantalla y se va solo. `key={swapAnnouncement.uid}`
          fuerza remount para reiniciar la animación si llega otro swap antes
          de que el actual haya expirado. */}
      {swapAnnouncement && (
        <div
          key={swapAnnouncement.uid}
          className={
            'swap-announcement' +
            (you !== null && (swapAnnouncement.seat % 2) === (you % 2)
              ? ' is-mine'
              : ' is-theirs')
          }
          role="status"
          aria-live="polite"
        >
          <div className="swap-announcement-team">
            {you !== null && (swapAnnouncement.seat % 2) === (you % 2)
              ? 'Nosotros'
              : 'Ellos'}
          </div>
          <div className="swap-announcement-player">
            {seatNames[swapAnnouncement.seat] || SEAT_LABELS[swapAnnouncement.seat]}
          </div>
          <div className="swap-announcement-text">
            cambia el <b className="value">7</b> por{' '}
            <SwapCardInline card={swapAnnouncement.taken} />
          </div>
        </div>
      )}
    </div>
  );
}

const STRENGTH = [1, 3, 12, 10, 11, 7, 6, 5, 4, 2] as const;

/**
 * Mini-chip inline que pinta la carta que un jugador acaba de recibir
 * tras un SWAP_SEVEN. Lo usamos en el overlay `.swap-announcement`.
 * Como las cartas que entran siempre son SUPERIORES al 7 (el motor ya
 * filtra que el triunfo sea 1, 3, 10, 11 o 12), mostramos el nombre
 * completo (As/Tres/Sota/Caballo/Rey) en vez del dígito.
 */
function SwapCardInline({ card }: { card: Card }) {
  const rankLabel =
    card.rank === 1 ? 'As' :
    card.rank === 3 ? 'Tres' :
    card.rank === 10 ? 'Sota' :
    card.rank === 11 ? 'Caballo' :
    card.rank === 12 ? 'Rey' :
    `${card.rank}`;
  return (
    <span className="swap-announcement-card" data-suit={card.suit}>
      {rankLabel} de <SuitGlyph suit={card.suit} size={14} />
    </span>
  );
}

/** Umbral de cierre de la partida sobre `cumulativeTeamPts` (raw puntos
 *  acumulados). Debe coincidir con `rules.ts scoring.threshold`. La
 *  representación visual (topbar, score boxes) pinta el tramo de arriba
 *  con la misma regla de "Buenas" (raw > 50 ⇒ raw - 50), por lo que
 *  nuestra "X Buenas" en pantalla > 50 equivale a raw > 100. */
const MATCH_THRESHOLD = 100;

/** Resumen numérico del game-over para el panel. */
interface Summary {
  myTeam: 0 | 1;
  otherTeam: 0 | 1;
  /** Total de la mano (= trickPoints, ya incluye cantes + 10 de últimas). */
  handTotal: Record<0 | 1, number>;
  /** Acumulado raw de la partida (= view.cumulativeTeamPts). El motor
   *  actualiza este campo en vivo y lo preserva entre manos. La
   *  noción de Buenas/Malas se deriva en el cliente al pintar. */
  cumulative: Record<0 | 1, number>;
  /** Ganador (seat) de la última baza. null si no hay trucos. */
  lastTrickWinnerSeat: Seat | null;
  /** Equipo que ganó la última baza (se llevó las 10). null si no hay. */
  lastTrickWinnerTeam: 0 | 1 | null;
  /** ¿Quién cierra la partida? (matchWinner) o null si no cierra nadie. */
  matchWinner: 0 | 1 | null;
  /** Siguiente repartidor: el ganador de la última baza (regla "el que
   *  corta, reparte"). Si la partida terminó no hay siguiente mano. */
  nextDealer: Seat | null;
  /** Seat que sale (primer jugador de la próxima mano): a la derecha del dealer. */
  nextStarter: Seat | null;
  /** Vuelta actual (1 = idas, 2+ = vueltas). */
  vuelta: number;
}

function buildSummary(view: PlayerView, you: number): Summary {
  const myTeam = (you % 2) as 0 | 1;
  const otherTeam = (1 - myTeam) as 0 | 1;

  const lastTrick = view.finishedTricks[view.finishedTricks.length - 1];
  const lastTrickWinnerSeat = lastTrick ? lastTrick.winner : null;
  const lastTrickWinnerTeam = lastTrickWinnerSeat !== null
    ? teamOf(lastTrickWinnerSeat)
    : null;

  const handTotal: Record<0 | 1, number> = {
    0: view.trickPoints[0] ?? 0,
    1: view.trickPoints[1] ?? 0,
  };

  // Quien reparte la siguiente mano lo decide el motor con la regla
  // "el que corta, reparte". Si la partida terminó (matchEnded), no
  // hay próxima mano.
  const computedNextDealer = view.matchEnded
    ? null
    : nextDealer(lastTrickWinnerSeat, view.dealer);
  const computedNextStarter = computedNextDealer !== null ? nextSeat(computedNextDealer) : null;

  return {
    myTeam,
    otherTeam,
    handTotal,
    cumulative: {
      0: view.cumulativeTeamPts[0] ?? 0,
      1: view.cumulativeTeamPts[1] ?? 0,
    },
    lastTrickWinnerSeat,
    lastTrickWinnerTeam,
    matchWinner: view.matchEnded ? view.matchWinner : null,
    nextDealer: computedNextDealer,
    nextStarter: computedNextStarter,
    vuelta: view.vuelta,
  };
}

/** Puntos de la mano en formato de partida: si el equipo pasa de 50 suma a
 *  buenas (pts − 50), si no suma a malas. value=0 → "—". */
function formatPunto(value: number): string {
  if (value <= 0) return '—';
  if (value > 50) return `${value - 50} Buenas`;
  return `${value} Malas`;
}

/** Lista compacta de cantes cantados por un equipo: "+20 Copas", "+40 Oros".
 *  Si el equipo no cantó nada → "—". Cada cante: prefijo "+", valor y palo
 *  con nombre completo (los nombres son cortos y encajan en la celda;
 *  encadenados con " · " si hay varios. */
function renderCantesForTeam(
  cantes: readonly { team: 0 | 1; suit: Suit; value: number }[],
  team: 0 | 1,
): string {
  const ours = cantes.filter((c) => c.team === team);
  if (ours.length === 0) return '—';
  return ours.map((c) => `+${c.value} ${SUIT_NAME[c.suit]}`).join(' · ');
}

/** Marcador compacto de una pareja en el panel de fin de mano/partida.
 *  Recibe el acumulado raw (`s.cumulative[team]`) y decide cómo pintarlo:
 *  - raw > 50 → "(raw-50) Buenas" (zona de arriba).
 *  - 0 < raw ≤ 50 → "raw Malas" (zona de abajo, sin cruzar el piso).
 *  - raw = 0 → "—" (equipo no ha puntuado nada). */
function marcadorAcumulado(cumRaw: number): { value: number; label: string } {
  if (cumRaw > 50) return { value: cumRaw - 50, label: 'Buenas' };
  if (cumRaw > 0)  return { value: cumRaw,      label: 'Malas'  };
  return { value: 0, label: '—' };
}

function computeLegalSet(view: ReturnType<typeof useGame.getState>['view'], you: number | null): Set<string> {
  const set = new Set<string>();
  if (!view) return set;
  if (you === null) return set;
  if (view.trumpCard !== null) {
    // draw: todo legal
    for (const c of view.hand) set.add(c.id);
    return set;
  }
  if (view.trick.length === 0) {
    for (const c of view.hand) set.add(c.id);
    return set;
  }
  const led = view.trick[0]!.card.suit;
  const sameSuit = view.hand.filter((c) => c.suit === led);
  if (sameSuit.length > 0) {
    // ¿compañero gana? winner del viewFor viene como lastWinner (anterior), pero
    // aquí el ganador actual se deduce del trick parcial.
    const winningIdx = currentWinnerIndex(view.trick, view.trump);
    const winnerSeat = view.trick[winningIdx]!.seat;
    const partnerWins = winnerSeat !== you && winnerSeat === view.partner;
    if (partnerWins) {
      for (const c of sameSuit) set.add(c.id);
      return set;
    }
    // obligar a superar si puedo
    const winningCard = view.trick[winningIdx]!.card;
    const higher = sameSuit.filter((c) => beats(c, winningCard, view.trump));
    for (const c of (higher.length > 0 ? higher : sameSuit)) set.add(c.id);
    return set;
  }
  const trumps = view.hand.filter((c) => c.suit === view.trump);
  if (trumps.length > 0) {
    const winningIdx = currentWinnerIndex(view.trick, view.trump);
    const winningCard = view.trick[winningIdx]!.card;
    const winnerSeat = view.trick[winningIdx]!.seat;
    const partnerWins = winnerSeat !== you && winnerSeat === view.partner;
    if (partnerWins) {
      // exención total
      for (const c of view.hand) set.add(c.id);
      return set;
    }
    const higher = trumps.filter((c) => beats(c, winningCard, view.trump));
    for (const c of (higher.length > 0 ? higher : trumps)) set.add(c.id);
    return set;
  }
  for (const c of view.hand) set.add(c.id);
  return set;
}

function beats(a: Card, b: Card, trump: string): boolean {
  if (a.suit === b.suit) return STRENGTH.indexOf(a.rank) < STRENGTH.indexOf(b.rank);
  return a.suit === trump && b.suit !== trump;
}

function currentWinnerIndex(plays: readonly { card: Card }[], trump: string): number {
  let bestIdx = 0;
  for (let i = 1; i < plays.length; i++) {
    if (beats(plays[i]!.card, plays[bestIdx]!.card, trump)) bestIdx = i;
  }
  return bestIdx;
}

/**
 * Mazo de la mesa en el centro superior:
 *  - Carta de triunfo (boca arriba) en la mitad inferior.
 *  - Pila de dorsos encima, tapando la otra mitad.
 * Solo se renderiza durante la fase de robo (cuando trumpCard es visible).
 */
function MazoArea({ trumpCard }: { trumpCard: Card }) {
  const fileName = `${String(trumpCard.rank).padStart(2, '0')}-${trumpCard.suit}`;
  return (
    <div className="mazo-area" aria-hidden="true">
      <img
        className="mazo-trump-img"
        src={`/cards/sprite/${fileName}.png`}
        alt={`Triunfo: ${trumpCard.rank} de ${trumpCard.suit}`}
      />
      <div className="mazo-deck">
        <img className="mazo-deck-card" src="/cards/sprite/reverso.png" alt="" />
        <img className="mazo-deck-card" src="/cards/sprite/reverso.png" alt="" />
        <img className="mazo-deck-card" src="/cards/sprite/reverso.png" alt="" />
      </div>
    </div>
  );
}
