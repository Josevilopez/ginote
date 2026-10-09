import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGame } from '../store.js';
import { CardView } from '../components/CardView.js';
import { SuitGlyph } from '../components/SuitGlyph.js';
import type { Card, Suit } from '@guinote/engine';

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
 * Formato del marcador de puntuación (suma raw de teamPts).
 * Aplica la regla del guiñote aragonés:
 *  - ≤ 50 → "X M" (rango de malas)
 *  - > 50 → "(X-50) B" (rango de buenas, exceso sobre 50)
 * 30 puntos → "30 M". 70 puntos → "20 B". 130 puntos → "80 B".
 */
function fmtScore(value: number): string {
  if (value > 50) return `${value - 50} B`;
  return `${value} M`;
}

/** Clase CSS según el tramo (≤ 50 = malas, > 50 = buenas). */
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
  const sendAction = useGame((s) => s.sendAction);
  const leave = useGame((s) => s.leave);

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
    if (view.trumpCard !== null) {
      // fase de robo: solo ganador/compañero pueden cantar
      const can = view.lastWinner === you || view.lastWinner === view.partner;
      if (can) {
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
    }
    const canSwap =
      view.trumpCard !== null &&
      view.lastWinner !== null &&
      (view.lastWinner === you || view.lastWinner === view.partner) &&
      view.hand.some((c) => c.id === `${view.trump}-7`);
    const mustPass = cantes.length === 0 && !canSwap;
    return { phase: view.phase, plays: [], cantes, canSwapSeven: canSwap, mustPass };
  }, [view, you]);

  // Mano del jugador, en el orden por defecto (palo + fuerza) o el personalizado.
  // El reorder solo afecta a la visualización; las IDs y el envío de jugadas
  // siguen siendo las mismas del servidor. Vive ANTES del early return para
  // no violar las Rules of Hooks.
  const displayCards = useMemo(() => {
    if (!view) return [];
    if (customOrder === null) {
      return [...view.hand].sort((a, b) => {
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return STRENGTH.indexOf(a.rank) - STRENGTH.indexOf(b.rank);
      });
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

  // Gestiona el ciclo de vida de customOrder cuando el servidor actualiza la mano:
  // - Si las cartas no encajan (IDs nuevos ⇒ nueva mano) → reset a null.
  // - Si solo desaparece 1 carta (jugada propia/aliada) → la quitamos del orden.
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
    if (filtered.length === customOrder.length && filtered.length === view.hand.length) {
      return;
    }
    if (filtered.length === view.hand.length) {
      setCustomOrder(filtered);
    } else {
      setCustomOrder(null);
    }
    setDragVisual(null);
    dragRef.current = null;
  }, [view?.hand]);

  if (!view || you === null) {
    return <div className="loading">Conectando a la mesa…</div>;
  }

  const isMyTurn = view.turn === you;
  const isPartner = (seat: number) => view.partner === seat;
  const teammate = view.partner;

  // Cartas legales (heurística cliente para resaltar). Como no tenemos acceso
  // al motor en el bundle, usamos la misma lógica de legalPlays. Para esta
  // primera versión, en draw todo es legal; en arrastre seguimos palo.
  const legalSet = computeLegalSet(view, you);

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
          <span className="trump-label">Triunfo</span>
          <span className="trump-suit" data-suit={view.trump}>
            <SuitGlyph suit={view.trump} size={20} />
          </span>
          {!view.trumpCard && <span className="trump-card-gone">arrastre</span>}
          {/* La carta de triunfo ahora se muestra en el mazo de la mesa (abajo). */}
        </div>
        <div className="score">
          {/* Fase primero (Idas / Vueltas), luego marcador. */}
          <span className={`phase-pill phase-${view.vuelta === 1 ? 'idas' : 'vueltas'}`}>
            {view.vuelta === 1 ? 'Idas' : 'Vueltas'}
          </span>
          <span className="score-team is-mine">
            nosotros:{' '}
            {/* Suma raw de teamPts a través de todas las manos (idas+vueltas).
                Crece al cerrar cada mano. */}
            <b className={fmtRange(view.cumulativeTeamPts[you % 2 as 0 | 1] ?? 0)}>
              {fmtScore(view.cumulativeTeamPts[you % 2 as 0 | 1] ?? 0)}
            </b>
          </span>
          <span className="score-team is-theirs">
            ellos:{' '}
            <b className={fmtRange(view.cumulativeTeamPts[(1 - you % 2) as 0 | 1] ?? 0)}>
              {fmtScore(view.cumulativeTeamPts[(1 - you % 2) as 0 | 1] ?? 0)}
            </b>
          </span>
        </div>
        <button className="btn small" onClick={leave}>Salir</button>
      </header>

      {/* Solo se renderiza el seat activo, en la celda de su posición.
          Cuando cambia el turno, el panel "salta" a otra celda. */}
      <div className="board">
        {/* Todos los seats muestran sus cartas boca abajo, incluido el humano.
            El acento (borde dorado) marca quién tiene el turno. El humano no
            muestra la baraja de dorsos porque sus cartas están en .hand. */}
        {([0, 1, 2, 3] as const).map((seat) => {
          const pos = ((seat - you + 4) % 4) as 0 | 1 | 2 | 3;
          const isActive = view.turn === seat;
          const count = view.handCounts[seat] ?? 0;
          const isYou = seat === you;
          return (
            <div
              key={seat}
              className={`seat pos-${pos} ${isActive ? 'active' : ''} ${isPartner(seat) ? 'partner' : ''} ${isYou ? 'you' : ''} ${view.lastWinner === seat ? 'winner' : ''}`}
            >
              <div className="seat-name">
                {isBot[seat] && !isYou && '🤖 '}
                {isYou ? 'Tú' : seatNames[seat] || SEAT_LABELS[seat]}
                {view.lastWinner === seat && ' 👑'}
              </div>
              {!isYou && (
                <div className="opp-hand">
                  {Array.from({ length: count }).map((_, i) => (
                    <div key={i} className="opp-back" style={{ ['--i' as string]: i } as React.CSSProperties} />
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
          {view.trick.length === 0 && <div className="trick-empty">—</div>}
          {view.trick.map((p) => {
            // Misma rotación que los seats: pos 0 = Sur (humano), 1 = Oeste, 2 = Norte, 3 = Este.
            const pos = ((p.seat - you + 4) % 4) as 0 | 1 | 2 | 3;
            // Ganadora durante la pausa de la baza resuelta. Las demás se
            // quedan como están, sin atenuar.
            const isWinner =
              justResolved !== null &&
              justResolved.winner === p.seat &&
              justResolved.plays.some((jp) => jp.card.id === p.card.id);
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

      {/* Acciones: cantes, cambio del 7, o mensaje de turno (discreto) */}
      <div className={`action-bar ${isMyTurn && view.phase !== 'finished' ? 'is-you' : ''}`}>
        {view.phase === 'finished' ? (
          <div className="hint-turn">Mano terminada</div>
        ) : !isMyTurn ? (
          <div className="hint-turn">
            {view.turn !== null ? `esperando a ${seatNames[view.turn] ?? '…'}` : '…'}
          </div>
        ) : view.phase === 'winnerWindow' ? (
          myOptions.cantes.length > 0 || myOptions.canSwapSeven ? (
            <div className="action-buttons">
              {myOptions.cantes.map((c) => (
                <button
                  key={c.suit}
                  className="btn primary small"
                  onClick={() => sendAction({ type: 'SING_CANTE', suit: c.suit, pair: [10, 12] })}
                >
                  Canto {SUIT_GLYPH[c.suit]} +{c.value}
                </button>
              ))}
              {myOptions.canSwapSeven && (
                <button
                  className="btn primary small"
                  onClick={() => sendAction({ type: 'SWAP_SEVEN' })}
                >
                  Cambio el 7
                </button>
              )}
              <button
                className="btn small"
                onClick={() => sendAction({ type: 'PASS' })}
              >
                Nada
              </button>
            </div>
          ) : (
            <div className="hint-turn">…</div>
          )
        ) : (
          <div className="hint-turn">tu turno · toca una carta</div>
        )}
      </div>

      <div className="hand" ref={handRef}>
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
              className={`card-slot ${isMyTurn && legalSet.has(c.id) ? 'playable' : 'disabled'} ${isDraggingThis ? 'is-dragging' : ''}`}
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

      {matchOver && (
        <div className="match-over">
          <h2>PARTIDA TERMINADA</h2>
          <span className="winner">
            {matchOver.winner === (you ?? -1) % 2
              ? '🎉 Hemos ganado'
              : `Gana el Equipo ${matchOver.winner}`}
          </span>
          <span className="score-line">
            nosotros{' '}
            <b className={fmtRange(matchOver.score.buenas[you % 2 as 0 | 1] ?? 0)}>
              {fmtScore(matchOver.score.buenas[you % 2 as 0 | 1] ?? 0)}
            </b>
            {' · '}ellos{' '}
            <b className={fmtRange(matchOver.score.buenas[(1 - you % 2) as 0 | 1] ?? 0)}>
              {fmtScore(matchOver.score.buenas[(1 - you % 2) as 0 | 1] ?? 0)}
            </b>
          </span>
        </div>
      )}
      {gameOver && !matchOver && (
        <div className="game-over">
          <h2>Fin de mano</h2>
          <span className="score-line">
            nosotros {fmtPts(gameOver.handPoints[you % 2 as 0 | 1])} · ellos {fmtPts(gameOver.handPoints[(1 - you % 2) as 0 | 1])}
          </span>
          {/* En vueltas mostramos el acumulado. Importante: usamos
              gameOver.vuelta (NO view.vuelta) para que el "Acumulado" no
              aparezca en el resumen de la primera vuelta (idas). Si
              usamos view.vuelta, cuando llega el VIEW de vuelta 2 mientras
              el gameOver aún muestra vuelta 1, el resumen diría "Acumulado"
              en una mano que no lo es. */}
          {gameOver.vuelta && gameOver.vuelta > 1 && gameOver.score && (
            <span className="score-line score-cumulative">
              Acumulado: nosotras {gameOver.score.buenas[you % 2 as 0 | 1] ?? 0}B · {gameOver.score.malas[you % 2 as 0 | 1] ?? 0}M
              {' '} · ellos {gameOver.score.buenas[(1 - you % 2) as 0 | 1] ?? 0}B · {gameOver.score.malas[(1 - you % 2) as 0 | 1] ?? 0}M
            </span>
          )}
        </div>
      )}

      {/* Truco y ganador se muestran visualmente sobre las cartas en el board;
          el badge flotante intermedio lo quitamos porque no aportaba info
          que ya no estuviera visible. */}
    </div>
  );
}

const SUIT_GLYPH = { oros: '●', copas: '♥', espadas: '♠', bastos: '♣' } as const;
const STRENGTH = [1, 3, 12, 10, 11, 7, 6, 5, 4, 2] as const;

function computeLegalSet(view: ReturnType<typeof useGame.getState>['view'], you: number): Set<string> {
  const set = new Set<string>();
  if (!view) return set;
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
const RANK_FILE_NAME: Record<number, string> = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  10: '10', 11: '11', 12: '12',
};

function MazoArea({ trumpCard }: { trumpCard: Card }) {
  const fileName = `${trumpCard.suit}-${RANK_FILE_NAME[trumpCard.rank] ?? trumpCard.rank}`;
  return (
    <div className="mazo-area" aria-hidden="true">
      <img
        className="mazo-trump-img"
        src={`/cards/sprite/${fileName}.png`}
        alt={`Triunfo: ${trumpCard.rank} de ${trumpCard.suit}`}
      />
      <div className="mazo-deck">
        <img className="mazo-deck-card" src="/cards/sprite/back.png" alt="" />
        <img className="mazo-deck-card" src="/cards/sprite/back.png" alt="" />
        <img className="mazo-deck-card" src="/cards/sprite/back.png" alt="" />
      </div>
    </div>
  );
}
