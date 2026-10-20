import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGame } from '../store.js';
import { CardView } from '../components/CardView.js';
import { SuitGlyph } from '../components/SuitGlyph.js';
import { LobbyScreen } from '../components/LobbyScreen.js';
import './Game.css';
import { playSound, useMuted } from '../sounds.js';
import { DivisionBadge } from '../components/DivisionBadge.js';
import { DIVISIONS, divisionName } from '@guinote/protocol';
import {
  card,
  teamOf,
  nextSeat,
  canSwapSevenWithTrump,
  nextDealer,
  legalPlaysFromView,
} from '@guinote/engine';
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
  useTableSounds(view, you);
  const seatNames = useGame((s) => s.seatNames);
  const isBot = useGame((s) => s.isBot);
  const roomCode = useGame((s) => s.roomCode);
  const lobby = useGame((s) => s.lobby);
  const pendingActionCardId = useGame((s) => s.pendingActionCardId);
  const lastError = useGame((s) => s.lastError);
  const gameOver = useGame((s) => s.gameOver);
  const matchOver = useGame((s) => s.matchOver);
  const justResolved = useGame((s) => s.justResolved);
  const swapAnnouncement = useGame((s) => s.swapAnnouncement);
  // Auto-clear del swap overlay: el servidor emite `SWAP_HAPPENED`, lo
  // recibimos aquí como parte del estado y mostramos el aviso. Al
  // cabo de 3,5 s lo limpiamos vía el propio store para que el
  // componente se re-renderice sin el overlay. Si llega otro swap
  // mientras, `uid` cambia y este effect re-arranca el timer limpio.
  // Antes el timer vivía en el módulo de `store.ts`, lo que provocaba
  // que el clear se ejecutara sin pasar por el ciclo de vida del
  // componente y a veces la actualización tardaba en reflejarse en
  // pantalla. Mismo patrón que `canteAnnouncement`.
  useEffect(() => {
    if (!swapAnnouncement) return;
    const id = window.setTimeout(() => {
      useGame.setState({ swapAnnouncement: null });
    }, 3500);
    return () => window.clearTimeout(id);
  }, [swapAnnouncement?.uid]);
  const sendAction = useGame((s) => s.sendAction);
  const leave = useGame((s) => s.leave);
  // Progresión del match (S2-13): primero a 3 partidas gana. Lo usa el
  // marcador y los paneles de fin de partida / revancha.
  const matchWins = useGame((s) => s.matchWins);
  // S3-07: cotos ganados y formato de la mesa (match a N cotos en privadas).
  const cotoWinsSrv = useGame((s) => s.cotoWins);
  const format = useGame((s) => s.format);
  const isMatchFormat = format.cotosParaGanar > 1;
  const matchFinished = useGame((s) => s.matchFinished);
  const rematch = useGame((s) => s.rematch);
  const matchEnded = useGame((s) => s.matchEnded);
  const voteRematch = useGame((s) => s.voteRematch);
  // S2-15: estado de cada asiento (desconectado / bot sustituto).
  const seatKinds = useGame((s) => s.seatKinds);
  const seatDeadlines = useGame((s) => s.seatDeadlines);
  const seatDivisions = useGame((s) => s.seatDivisions);

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
  // IMPORTANTE: NO se rellena en `pointerdown` — solo cuando hay
  // movimiento real por encima del umbral de reorder. Esto evita que un
  // tap rápido vea un "flash" de la carta levantada (-6px) antes del
  // FLIP hacia el truco (el usuario reportó ese salto como molesto).
  const [dragVisual, setDragVisual] = useState<{ idx: number; offsetX: number } | null>(null);
  // Rect capturado en `pointerdown` (posición natural de la carta, sin
  // ningún lift inline). Sirve como origen del FLIP cuando el usuario
  // suelta sin moverse lo suficiente como para reordenar: medimos ese
  // mismo punto al iniciar la animación, así no hay "salto" entre la
  // posición al pulsar y la posición de salida de la carta volando.
  const pointerDownRectRef = useRef<DOMRect | null>(null);
  // Timestamp del último drag que se ha COMMITTEADO (reorder hecho). El
  // navegador sintetiza un `click` tras pointerup incluso cuando hubo un
  // drag real — sin este flag, ese click haría `onPlay` y la carta se
  // jugaría en vez de reordenarse. Marcamos un timestamp de 300 ms tras
  // un reorder exitoso; durante esos 300 ms, `onClick` se salta.
  const lastReorderAtRef = useRef<number>(0);

  // ───────────── Animación FLIP al jugar una carta ─────────────
  // Cola de vuelos en curso. Cada vuelo es una carta que debe animarse
  // desde una posición de origen (la mano del jugador si es él quien
  // tira, o el avatar del seat si es otro jugador) hasta su celda en
  // el truco. La cola admite varios vuelos simultáneos (p.ej. en una
  // ronda rápida el rival puede jugar 2 cartas entre dos VIEW).
  // Para cada vuelo aplicamos la técnica FLIP (First/Last/Invert/Play):
  //   - Last: medimos dónde está la carta en el truco (post-VIEW).
  //   - Invert: la colocamos visualmente en el origen con `translate(dx,dy)`
  //             sin transición.
  //   - Play: al siguiente frame, le quitamos el offset y dejamos que la
  //             transición CSS la lleve a su posición final.
  // Si el usuario tiene `prefers-reduced-motion`, no se encolan vuelos:
  // las cartas aparecen directamente en su sitio sin volar.
  const [flyingCards, setFlyingCards] = useState<{
    uid: number;
    cardId: string;
    fromRect: DOMRect;
  }[]>([]);
  // Refs a cada .trick-card para localizarla por card.id durante la
  // animación y aplicar transformadas imperativas sin re-render.
  const trickElsRef = useRef<Record<string, HTMLDivElement | null>>({});
  // Refs a cada `.seat` para usarlo como origen de la animación cuando
  // la carta la tira un rival o el compañero (esos casos no tienen un
  // "slot en la mano" visible — la carta parece salir del jugador que
  // la juega, lo más intuitivo es el avatar del seat).
  const seatElsRef = useRef<Record<Seat, HTMLDivElement | null>>({
    0: null, 1: null, 2: null, 3: null,
  });

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

  // ───────────── Cuenta atrás del turno (espejo del auto-play del server) ──
  // El server tiene una red de seguridad que auto-aplica la primera acción
  // legal de un humano si pasan 10s sin actuar (ver
  // `apps/server/src/room.ts:scheduleAutoPlay`). Aquí reflejamos esa
  // cuenta atrás con un anillo de progreso que se depleta
  // (`<TurnClock />`) en el avatar del seat al que le toca. No usamos
  // ya el pill "Tu turno / Esperando a X" porque se solapaba con la
  // baraja y ocupaba sitio entre el board y la mano.
  const AUTO_PLAY_MS = 10_000;
  // Marca el momento en que empezó MI turno (cuando me toca a mí).
  // Cuando es null, no se pinta ningún reloj: el seat al que le toque
  // se marcará solo con su pulso habitual en el avatar.
  const [myTurnStartedAt, setMyTurnStartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!view || you === null) return;
    if (view.turn !== you) {
      setMyTurnStartedAt(null);
      return;
    }
    // Solo cuenta atrás cuando es MI turno en una fase que requiere
    // acción. En winnerWindow el auto-PASS ya cubre los 350ms; en
    // 'finished' no hay turno. En arrastre sí cuenta: el server
    // auto-tira para no quedarnos colgados si la UI no habilita cartas
    // en el móvil.
    const activePhase =
      view.phase === 'lead' ||
      view.phase === 'follow' ||
      view.phase === 'arrastre';
    if (activePhase) {
      setMyTurnStartedAt(Date.now());
    } else {
      setMyTurnStartedAt(null);
    }
  }, [view?.version, view?.turn, view?.phase, you]);
  // Tick de UI: fuerza re-render cada 100 ms mientras hay cuenta atrás,
  // para que el anillo SVG se vacíe visualmente.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (myTurnStartedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [myTurnStartedAt]);
  // `turnClockPct` = 1 al inicio, 0 al expirar. Solo se pinta en MI
  // avatar — los turnos de bots no tienen red de seguridad, los de
  // otros humanos no se pueden espejar sin violar la privacidad del
  // cliente.
  const turnClockPct =
    myTurnStartedAt !== null
      ? Math.max(0, 1 - (now - myTurnStartedAt) / AUTO_PLAY_MS)
      : null;

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

  // ───────────── Aviso "¡Vamos de últimas!" (Sprint 2.16/2.18, retardo 2.23) ─────────────
  // Cuando el servidor emite `TRICK_JUST_RESOLVED { isArrastreEntrance:
  // true }` significa que el draw de esta baza dejó el mazo+trunfo a 0
  // — entramos en arrastre (6 bazas sin robo). NO se reparten más
  // cartas. Este aviso es solo informativo (sin +10 puntos); el
  // bonus de "10 de últimas" ya NO se muestra en pantalla (Sprint
  // 2.23: el usuario prefiere no pintar overlay en la baza 10 final
  // para que el game-over panel salga limpio).
  const [arrastreAnnouncement, setArrastreAnnouncement] = useState<{
    uid: number;
    winner: Seat;
    playerName: string;
    isMine: boolean;
  } | null>(null);
  // Sprint 2.23: el usuario pidió un pequeño RETARDO antes de pintar
  // el cartel para que se vea primero la jugada (glow de la ganadora
  // durante el FLIP del truco). 2 s es suficiente: la baza queda
  // resuelta con glow pleno durante ese tiempo y luego entra el
  // overlay.
  const arrastreDelayMs = 2000;
  useEffect(() => {
    if (!justResolved || !justResolved.isArrastreEntrance) return;
    if (you === null) return;
    const winner = justResolved.winner as Seat;
    const playerName = seatNames[winner] || SEAT_LABELS[winner];
    const isMine = (winner % 2) === (you % 2);
    const id = window.setTimeout(() => {
      setArrastreAnnouncement({
        uid: performance.now(),
        winner,
        playerName,
        isMine,
      });
    }, arrastreDelayMs);
    return () => window.clearTimeout(id);
  }, [justResolved]);
  // Auto-clear a los 2,8 s tras pintar (timer del cartel en pantalla).
  useEffect(() => {
    if (!arrastreAnnouncement) return;
    const id = window.setTimeout(() => setArrastreAnnouncement(null), 2800);
    return () => window.clearTimeout(id);
  }, [arrastreAnnouncement?.uid]);

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

  // ───────────── FLIP: carta volando de la mano al truco ─────────────
  // Cuando alguien juega una carta, guardamos su rect de origen en la cola
  // `flyingCards` (mano del humano si es él, o avatar del seat si es un
  // rival) y, cuando llega el VIEW con esa carta en el truco, este
  // effect itera sobre cada vuelo pendiente y aplica el FLIP:
  //   1. Mide la posición final en el truco.
  //   2. Calcula el delta (dx, dy) entre final y origen.
  //   3. Coloca la carta en el truco con un `transform` que la desplaza
  //      al origen, sin transición (frame 1).
  //   4. Fuerza reflow y al frame siguiente aplica `transition +
  //      translate(0)` para que se anime hasta su posición final.
  // Se compone con la transform de la clase `.trick-card.pos-N` leyendo
  // la matriz computada, de modo que la carta termina exactamente en su
  // sitio del truco (sin saltos).
  //
  // IMPORTANTE: procesamos CADA vuelo UNA SOLA VEZ. Antes el effect
  // dependía de `[flyingCards, view?.version, you]`, así que cada bump
  // de versión durante una animación en curso (p. ej. un bot tira una
  // segunda carta justo después de la nuestra) re-corria el effect y
  // REINICIABA la animación desde el origen, causando que el usuario
  // viera la misma carta volar dos veces. Ahora usamos un Set de uids
  // ya procesados como filtro y deps = `[flyingCards]`.
  const processedFlightUidsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (flyingCards.length === 0) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const DURATION_MS = 380;
    const EASING = 'cubic-bezier(0.34, 1.18, 0.4, 1)';
    const newFlights = flyingCards.filter(
      (f) => !processedFlightUidsRef.current.has(f.uid),
    );
    if (newFlights.length === 0) return;
    // Marcamos como procesados ANTES de empezar la animación. Esto es
    // idempotente: si el effect re-corre (e.g. por una actualización de
    // `flyingCards` que no tiene que ver con estos vuelos), se saltan
    // porque ya están en el Set.
    for (const flight of newFlights) {
      processedFlightUidsRef.current.add(flight.uid);
    }
    const cleanupTimers: number[] = [];
    const rafs: number[] = [];
    for (const flight of newFlights) {
      const el = trickElsRef.current[flight.cardId];
      if (!el) {
        // El DOM aún no está listo (raro, porque los `useEffect` corren
        // tras commit y los `ref` callbacks también). Para no perder
        // el vuelo, des-marcamos del Set para que el próximo cambio de
        // `flyingCards` lo reintente. Aquí no debería llegar, pero por
        // si llega el ref no estaba aún, no animamos en este ciclo.
        processedFlightUidsRef.current.delete(flight.uid);
        continue;
      }
      if (reduceMotion) {
        // Sin animación: quitamos el vuelo y limpiamos estilos inline
        // (aunque normalmente no hay nada que limpiar si nunca pusimos
        // estilos, lo hacemos por simetría con el camino animado).
        cleanupTimers.push(
          window.setTimeout(() => {
            el.style.transform = '';
            el.style.transition = '';
            el.style.willChange = '';
            el.removeAttribute('data-flying');
            setFlyingCards((prev) => prev.filter((f) => f.uid !== flight.uid));
          }, 0),
        );
        continue;
      }
      const toRect = el.getBoundingClientRect();
      const fromCx = flight.fromRect.left + flight.fromRect.width / 2;
      const fromCy = flight.fromRect.top + flight.fromRect.height / 2;
      const toCx = toRect.left + toRect.width / 2;
      const toCy = toRect.top + toRect.height / 2;
      const dx = fromCx - toCx;
      const dy = fromCy - toCy;
      // Leemos la matriz que ya aplica la CSS class `.trick-card.pos-N`
      // (translate + opcional rotate). Componemos el delta sumándolo al
      // término de translación, sin reemplazar el resto.
      const cs = window.getComputedStyle(el);
      const baseMat = cs.transform;
      let startTransform: string;
      let endTransform: string;
      const m = baseMat.match(/^matrix\(([^)]+)\)$/);
      if (m) {
        const parts = m[1]!.split(',').map((s) => parseFloat(s.trim()));
        if (parts.length !== 6) {
          startTransform = `translate(${dx}px, ${dy}px)`;
          endTransform = 'translate(0px, 0px)';
        } else {
          const [a, b, c, d, tx, ty] = parts as [number, number, number, number, number, number];
          startTransform = `matrix(${a}, ${b}, ${c}, ${d}, ${tx! + dx}, ${ty! + dy})`;
          endTransform = `matrix(${a}, ${b}, ${c}, ${d}, ${tx}, ${ty})`;
        }
      } else {
        startTransform = `translate(${dx}px, ${dy}px)`;
        endTransform = 'translate(0px, 0px)';
      }
      // Frame 1: saltar al origen visualmente SIN transición.
      el.style.transition = 'none';
      el.style.transform = startTransform;
      el.setAttribute('data-flying', '');
      el.style.willChange = 'transform';
      // Forzar reflow.
      void el.getBoundingClientRect();
      // Frame 2: animar a la posición final.
      rafs.push(
        requestAnimationFrame(() => {
          el.style.transition = `transform ${DURATION_MS}ms ${EASING}`;
          el.style.transform = endTransform;
        }),
      );
      // Cleanup: limpiar inline styles y quitar de la cola.
      cleanupTimers.push(
        window.setTimeout(() => {
          el.style.transform = '';
          el.style.transition = '';
          el.style.willChange = '';
          el.removeAttribute('data-flying');
          setFlyingCards((prev) => prev.filter((f) => f.uid !== flight.uid));
        }, DURATION_MS + 60),
      );
    }
    return () => {
      rafs.forEach((id) => cancelAnimationFrame(id));
      cleanupTimers.forEach((id) => window.clearTimeout(id));
    };
  }, [flyingCards]);
  // Safety net: si un vuelo nunca arrancó (p.ej. servidor rechazó la
  // jugada, o el truco se vació sin que pasara por la fase de post-
  // VIEW), lo purgamos a los 2,5 s para no acumular estado.
  useEffect(() => {
    if (flyingCards.length === 0) return;
    const timers = flyingCards.map((f) =>
      window.setTimeout(() => {
        setFlyingCards((prev) => prev.filter((x) => x.uid !== f.uid));
      }, 2500),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [flyingCards]);

  // Detección de cartas NUEVAS en el truco. Tanto las nuestras (cuando
  // llega el VIEW posterior a nuestro `PLAY_CARD`) como las del rival o
  // el compañero se encolan en este único effect, y todas comparten la
  // misma cola `flyingCards`. Comparamos el set de IDs del truco actual
  // con el que vimos en la versión anterior; las nuevas se traducen a
  // vuelos FLIP con origen "mano" (si son nuestras) o "avatar del seat"
// (si son de otros). Este es el ÚNICO sitio donde se encolan vuelos:
// `onPlay` ya no encola optimistamente, lo que evita el bug del
  // doble-vuelo (la carta aparecía "de golpe" en el truco al llegar la
  // VIEW, y luego se animaba desde la mano cuando llegaba la siguiente
  // actualización).
  const shownTrickIdsRef = useRef<Set<string>>(new Set());
  // Flag para no animar en la primera vista (cartas que ya estaban en
  // el truco antes de que este componente las viera). Si te unes a una
  // sala a mitad de baza, esas cartas NO deben animarse — solo las que
  // aparezcan DESPUÉS de este effect corriendo.
  const initializedTrickDiffRef = useRef(false);
  useEffect(() => {
    if (!view) return;
    const currentIds = new Set(view.trick.map((p) => p.card.id));
    // Cuando el truco se vacía (baza resuelta), reseteamos el ref de
    // seguimiento y purgamos la cola de vuelos (sus cartas ya no están
    // en la mesa). Marcamos `initializedTrickDiffRef` para que el
    // siguiente truco no se considere "primera vista".
    if (view.trick.length === 0) {
      shownTrickIdsRef.current = new Set();
      setFlyingCards((prev) => (prev.length > 0 ? [] : prev));
      initializedTrickDiffRef.current = true;
      return;
    }
    // Primera vista con truco no vacío: solo registramos qué cartas hay,
    // sin encolar vuelos. Si te metes a una sala con la baza ya
    // empezada, esas cartas aparecen estáticas (no animadas).
    if (!initializedTrickDiffRef.current) {
      shownTrickIdsRef.current = currentIds;
      initializedTrickDiffRef.current = true;
      return;
    }
    // Diferencia: cartas que están en el truco ACTUAL pero no en el
    // visto en la versión anterior.
    const newEntries: { seat: Seat; cardId: string }[] = [];
    for (const p of view.trick) {
      if (!shownTrickIdsRef.current.has(p.card.id)) {
        newEntries.push({ seat: p.seat, cardId: p.card.id });
      }
    }
    shownTrickIdsRef.current = currentIds;
    if (newEntries.length === 0) return;
    // Para cada carta nueva, determinamos su origen:
    //  - Si es nuestra: usa el rect capturado al `pointerdown` (mano).
    //    Si por algún motivo no hay rect (p.ej. jugada por teclado o
    //    sin pointerdown previo), la carta aparece "estática" sin volar.
    //  - Si es de otro seat: avatar del seat.
    const flightsToAdd: { uid: number; cardId: string; fromRect: DOMRect }[] = [];
    for (const entry of newEntries) {
      let fromRect: DOMRect | null = null;
      if (entry.seat === you) {
        fromRect = pointerDownRectRef.current;
      } else {
        const seatEl = seatElsRef.current[entry.seat];
        if (seatEl) fromRect = seatEl.getBoundingClientRect();
      }
      if (!fromRect) continue;
      flightsToAdd.push({
        // `performance.now()` + Math.random() garantiza unicidad
        // incluso si dos cartas aparecen en el mismo tick del
        // servidor (mismo view.version).
        uid: performance.now() + Math.random(),
        cardId: entry.cardId,
        fromRect,
      });
    }
    if (flightsToAdd.length > 0) {
      setFlyingCards((prev) => [...prev, ...flightsToAdd]);
    }
  }, [view?.version, view?.trick.length, you]);

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
    // Si el servidor nos mandó LOBBY_STATUS (sala esperando a más
    // jugadores antes de repartir), pintamos la pantalla de lobby en
    // vez del "Conectando…". Ver `scheduleLobbyCheck` en el server.
    if (lobby !== null) {
      return <LobbyScreen />;
    }
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

  const onPlay = (card: Card, _fromRect: DOMRect | null) => {
    if (!isMyTurn) return;
    if (view.phase === 'winnerWindow') return;
    if (!legalSet.has(card.id)) return;
    // NO encolamos el vuelo aquí. El `onPlay` solo dispara la acción al
    // servidor. El encolado del vuelo lo hace el "diff effect" (más
    // abajo), cuando llega el VIEW con nuestra propia carta ya
    // colocada en el truco. Esto evita el bug anterior en el que
    // encolar aquí era prematuro (el DOM del truco aún no tenía
    // nuestra carta), se hacía un "skip+unmark" en el FLIP, y luego
    // cuando llegaba la siguiente actualización del servidor se
    // animaba con retraso — el usuario veía la carta "aparecer" en el
    // truco (sin animación) y luego "volver a volar" (con FLIP).
    //
    // El rect de origen (la posición de la carta en nuestra mano al
    // pulsar) ya está capturado en `pointerDownRectRef.current` desde
    // el `pointerdown`; el diff effect lo lee cuando encola.
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
          {/* Centro: fase de la partida (Idas / Vueltas) y, debajo, el
              marcador del match (partidas ganadas; gana quien llegue a 3).
              Antes el marcador de partidas flotaba sobre la mesa. */}
          <div className="score-center">
            <span className={`phase-name phase-${view.vuelta === 1 ? 'idas' : 'vueltas'}`}>
              {view.vuelta === 1 ? 'Idas' : 'Vueltas'}
            </span>
            <span
              className="match-wins"
              title={`Partidas del coto: gana el coto quien llegue a ${format.partidasPorCoto}.${isMatchFormat ? ` Gana el match quien gane ${format.cotosParaGanar} cotos.` : ''}`}
              aria-label={`Partidas: nosotros ${matchWins[(you % 2) as 0 | 1]}, ellos ${matchWins[(1 - (you % 2)) as 0 | 1]}.${isMatchFormat ? ` Cotos: nosotros ${cotoWinsSrv[(you % 2) as 0 | 1]}, ellos ${cotoWinsSrv[(1 - (you % 2)) as 0 | 1]}.` : ''}`}
            >
              <span className="mw-group">
                Partidas <b className="is-mine">{matchWins[(you % 2) as 0 | 1]}</b>
                <span aria-hidden="true">–</span>
                <b className="is-theirs">{matchWins[(1 - (you % 2)) as 0 | 1]}</b>
              </span>
              {isMatchFormat && (
                <>
                  <span className="mw-sep" aria-hidden="true">·</span>
                  <span className="mw-group">
                    Cotos <b className="is-mine">{cotoWinsSrv[(you % 2) as 0 | 1]}</b>
                    <span aria-hidden="true">–</span>
                    <b className="is-theirs">{cotoWinsSrv[(1 - (you % 2)) as 0 | 1]}</b>
                  </span>
                </>
              )}
            </span>
          </div>
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
        {/* Botón "Invitar": muestra el código de sala en grande y copia al
            portapapeles la URL completa con #ABCD para que tu amigo la
            pegue en su móvil. Aparece solo en pantallas con sitio
            (móvil = código solo). */}
        <InviteButton code={roomCode} />
        <MuteButton />
        <button className="btn small" onClick={leave}>Salir</button>
      </header>
      <DivisionToast />

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
          // Nombre visible: para todos los seats usamos `seatNames[seat]` (que
          // viene del server: bots traen nombres aragoneses, humanos el
          // que introdujeron en la Home). Para MI seat añadimos `(Tú)` al
          // final para identificarlo de un vistazo entre los 4 jugadores.
          // Antes era la constante `'Tú'` y la inicial `T`, lo que
          // ocultaba el nombre propio en la mesa.
          const rawName = seatNames[seat] || SEAT_LABELS[seat];
          const displayName = isYou ? `${rawName} (Tú)` : rawName;
          // Iniciales para el avatar (sin hardcodear 'T'): primera letra
          // de las dos primeras palabras. Funciona igual para bots
          // (Pilar, Ramiro → PR) y para el humano.
          // Solo palabras que empiezan por letra: así "(bot)", emojis o
          // números no acaban en el avatar.
          const parts = rawName.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
          const first = (parts[0] ?? '').charAt(0);
          const second = parts.length >= 2 ? (parts[1] ?? '').charAt(0) : '';
          const initials = (first + second).toUpperCase() || '?';
          // Bot desde el principio o bot que sustituye a un humano. SEATS
          // manda `seatKinds`; antes de que llegue usamos `isBot` de WELCOME.
          const kind = seatKinds[seat] ?? (isBot[seat] ? 'bot' : 'human');
          const botSeat = kind === 'bot' || kind === 'substitute';
          return (
            <div
              ref={(el) => {
                // Origen de FLIP para cartas que tira este seat (avatar
                // del jugador). Cuando llegue un VIEW con una carta
                // nueva de este seat en el truco, medimos este rect.
                seatElsRef.current[seat] = el;
              }}
              key={seat}
              className={`seat pos-${pos} ${isActive ? 'active' : ''} ${isPartner(seat) ? 'partner' : ''} ${isYou ? 'you' : ''} ${view.lastWinner === seat ? 'winner' : ''} ${view.phase === 'winnerWindow' ? 'winner-window' : ''} ${!isYou && seatKinds[seat] === 'disconnected' ? 'disconnected' : ''} ${seatKinds[seat] === 'substitute' ? 'substitute' : ''} ${botSeat ? 'is-bot' : ''}`}
            >
              <div className="seat-avatar">
                {initials}
                {/* Insignia de bot: robot pequeño en la esquina del avatar.
                    Los humanos no llevan nada. */}
                {/* S4-02: división (jugadores con cuenta ya clasificados). */}
                {!botSeat && seatDivisions[seat] && (
                  <span className="seat-division">
                    <DivisionBadge division={seatDivisions[seat]!} size={16} />
                  </span>
                )}
                {botSeat && (
                  <span
                    className="seat-bot-badge"
                    role="img"
                    aria-label="Bot"
                    title={kind === 'substitute' ? 'Un bot juega en lugar de este jugador' : 'Bot'}
                  >
                    <BotIcon />
                  </span>
                )}
                {/* Reloj circular de cuenta atrás del turno. Solo se pinta
                    cuando el TURNO ACTIVO es ESTE seat Y es humano. El
                    server tiene una red de seguridad de 10s
                    (`scheduleAutoPlay` en `apps/server/src/room.ts`) que
                    auto-tira por el humano si no actúa; el reloj le
                    avisa visualmente cuánto le queda. Anillos: verde >5s,
                    amarillo 5–2.5s, rojo <2.5s. */}
                {(() => {
                  // Solo renderizamos si:
                  //   - el seat activo es ESTE seat (mismo índice)
                  //   - la fase requiere acción (no winnerWindow ni finished)
                  //   - el seat es humano (los bots no tienen auto-play)
                  //   - hay un porcentaje válido (>0, calculado arriba)
                  if (view.turn !== seat) return null;
                  if (view.phase === 'finished' || view.phase === 'winnerWindow') return null;
                  if (isBot[seat]) return null;
                  if (turnClockPct === null) return null;
                  // Clases CSS según urgencia para el color del stroke.
                  const urgency =
                    turnClockPct > 0.5
                      ? 'turn-clock-fresh'
                      : turnClockPct > 0.25
                        ? 'turn-clock-mid'
                        : 'turn-clock-low';
                  // dasharray = `${pct*100} 100` — el primer valor es
                  // el tramo visible (gira de las 12 en sentido horario
                  // gracias al rotate(-90) en el circle.fill), el
                  // segundo es el resto invisible.
                  const dash = Math.max(0, Math.min(100, turnClockPct * 100));
                  return (
                    <svg
                      viewBox="0 0 36 36"
                      className={`turn-clock ${urgency}`}
                      aria-hidden="true"
                    >
                      <circle
                        className="turn-clock-track"
                        cx="18"
                        cy="18"
                        r="15.9155"
                      />
                      <circle
                        className="turn-clock-fill"
                        cx="18"
                        cy="18"
                        r="15.9155"
                        style={{ strokeDasharray: `${dash} 100` }}
                      />
                    </svg>
                  );
                })()}
              </div>
              <div className="seat-name">
                {displayName}
                {view.lastWinner === seat && ' 👑'}
              </div>
              {/* S2-15: insignia de estado del asiento. */}
              {!isYou && seatKinds[seat] === 'disconnected' && (
                <SeatReconnecting deadline={seatDeadlines[seat] ?? null} />
              )}
              {seatKinds[seat] === 'substitute' && (
                <div className="seat-status is-bot" title="Un bot juega en lugar de este jugador">sustituto</div>
              )}
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
                ref={(el) => {
                  // Indexamos por card.id para la animación FLIP; solo
                  // nos interesa localizar MI carta cuando llega el
                  // VIEW posterior a un `PLAY_CARD` propio. Cleanup
                  // automático: cuando React desmonte el nodo, callback
                  // se vuelve a llamar con `null` y sobrescribimos.
                  trickElsRef.current[p.card.id] = el;
                }}
                key={`${p.seat}-${p.card.id}`}
                className={`trick-card pos-${pos} ${isWinner ? 'winning' : ''}`}
              >
                <CardView card={p.card} small />
              </div>
            );
          })}
        </div>
        </div>

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
                className={`card-slot ${isMyTurn && hasRestrictedHand && legalSet.has(c.id) ? 'playable' : isMyTurn && hasRestrictedHand && !legalSet.has(c.id) ? 'disabled' : ''} ${isDraggingThis ? 'is-dragging' : ''} ${newlyDrawnId === c.id ? 'is-newly-drawn' : ''} ${pendingActionCardId === c.id ? 'is-pending' : ''}`}
                style={style}
                type="button"
                aria-label={`${c.rank} de ${c.suit}`}
                // Camino principal para TAP → jugar la carta. Usamos
                // `onClick` (no `onPointerUp`) porque el navegador SIEMPRE
                // sintetiza un click tras pointerdown+pointerup en el mismo
                // elemento, incluso en mobile. Antes dependíamos de
                // `onPointerUp`, pero `e.preventDefault()` en `pointerdown`
                // hacía que en algunos navegadores mobile (iOS Safari,
                // ciertos Android) el `pointerup` (y por tanto la jugada)
                // se perdiera — había que volver a pulsar. Con `onClick`
                // evitamos esa ruta y la jugada se dispara siempre.
                //
                // Si el usuario ARRASTRA (offsetX > DRAG_THRESHOLD), el
                // flag `dragVisual` queda activo y este handler se salta:
                // ver `isDragging` arriba. Eso evita que un drag se
                // convierta accidentalmente en una jugada + reorder.
                onClick={(e) => {
                  if (isDraggingThis) return;
                  // Si acabamos de procesar un drag (reorder), el click
                  // sintético del navegador NO debe disparar la jugada.
                  // 300 ms es más que suficiente para distinguir drag de
                  // tap puro: el navegador sintetiza el click casi a la vez
                  // que el pointerup, y un reorder tarda en commitearse.
                  if (Date.now() - lastReorderAtRef.current < 300) return;
                  e.preventDefault();
                  onPlay(c, pointerDownRectRef.current);
                }}
                onPointerDown={(e) => {
                  // Permitimos drag-to-reorder SIEMPRE, incluso cuando no es
                  // nuestro turno: la mano es del jugador y puede organizarla
                  // cuando quiera. El click-para-jugar sigue bloqueado vía
                  // onPlay (que comprueba isMyTurn y la legalidad).
                  if (!legalSet.has(c.id)) return;
                  // Importante: NO hacemos `e.preventDefault()` ni
                  // `setPointerCapture` aquí. En algunos navegadores mobile
                  // (iOS Safari, ciertos Android) el preventDefault sobre
                  // pointerdown BLOQUEA el pointerup y/o el click sintético
                  // posterior, dejando la carta "muerta" (hay que volver a
                  // pulsar). Solo capturamos el pointer / prevenimos default
                  // cuando detectamos movimiento real (en onPointerMove).
                  //
                  // Capturamos el rect AHORA, antes de que React aplique
                  // cualquier lift inline (-6px). Es el origen del FLIP si
                  // finalmente el usuario solo hizo tap.
                  const el = slotRefs.current[idx];
                  pointerDownRectRef.current = el ? el.getBoundingClientRect() : null;
                  dragRef.current = { idx, startX: e.clientX, pointerId: e.pointerId };
                  // NO rellenamos `dragVisual` aquí a propósito: para un
                  // tap rápido no queremos ver la carta levantada -6px
                  // durante los 50-100 ms antes del FLIP. Solo pasamos
                  // a "modo drag visual" cuando `onPointerMove` detecta
                  // movimiento por encima del umbral.
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d || d.idx !== idx) return;
                  const offsetX = e.clientX - d.startX;
                  // Threshold original (5 px). Con el lock `pendingAction`
                  // en el store, un tap con movimiento leve que active
                  // dragVisual NO puede provocar doble click: el primer
                  // onPlay ya marcó pending=true y el segundo sendAction
                  // se descarta.
                  const DRAG_THRESHOLD = 5;
                  if (Math.abs(offsetX) > DRAG_THRESHOLD) {
                    try {
                      if (!(e.currentTarget as Element).hasPointerCapture(d.pointerId)) {
                        (e.currentTarget as Element).setPointerCapture(d.pointerId);
                      }
                    } catch { /* ignore */ }
                    e.preventDefault();
                    setDragVisual({ idx, offsetX });
                  }
                }}
                onPointerUp={(e) => {
                  // Si fue un drag (dragVisual activo), hacemos el reorder.
                  // Si fue un tap puro, NO hacemos nada aquí: el navegador
                  // sintetizará un `click` que disparará `onPlay` vía el
                  // handler de `onClick` (que detecta `isDraggingThis` y
                  // sale si estamos arrastrando).
                  const d = dragRef.current;
                  setDragVisual(null);
                  if (!d || d.idx !== idx) return;
                  dragRef.current = null;
                  try { (e.currentTarget as Element).releasePointerCapture(d.pointerId); } catch { /* ignore */ }
                  if (!handRef.current) return;
                  const offsetX = e.clientX - d.startX;
                  // Mismo threshold que `onPointerMove` (5 px).
                  const DRAG_THRESHOLD = 5;
                  if (Math.abs(offsetX) <= DRAG_THRESHOLD) return; // tap: lo maneja onClick
                  // Drag: hacer reorder con regla de centros (mitad izq/der).
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
                  if (slots.length === 0) return;
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
                  lastReorderAtRef.current = Date.now();
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
            - .action-bar-mobile: lista de botones en horizontal.
            - .action-bar-desktop: lista vertical dentro del panel con chrome
              (fondo + borde + pie explicativo).
            Solo se renderiza la barra cuando hay AL MENOS una opción
            disponible (algún cante o cambio de 7). Botones:
              * Uno por CADA cante disponible, etiquetando el palo y el
                valor (+20 o +40) — Rey+Sota del triunfo = 40, Rey+Sota de
                cualquier otro palo = 20.
              * "Cambiar el 7" si tu mano tiene el 7 del triunfo y la carta
                de triunfo está a la vista (o no, según el motor).
              * "Nada" para pasar explícitamente (cancelar el cante y/o el
                cambio). El cliente autoenvía PASS cuando no hay opciones;
                este botón cubre el caso "hay opciones pero prefiero no
                usar ninguna".
            CSS muestra uno u otro según el viewport. */}
        {(myOptions.cantes.length > 0 || myOptions.canSwapSeven) && (() => {
          const isYouWindow =
            view.phase === 'winnerWindow' && view.turn === you;
          // Render helper compartido entre móvil y escritorio: itera los
          // cantes, añade Cambiar-7 si aplica, y termina con Nada.
          // `small` afecta al padding/icono (móvil más compacto).
          const renderButtons = (small: boolean) => {
            const primaryCls = small ? 'btn primary small' : 'btn primary';
            const passCls = small ? 'btn small' : 'btn';
            const glyphSize = small ? 12 : 14;
            return (
              <>
                {myOptions.cantes.map((c) => (
                  <button
                    key={c.suit}
                    className={primaryCls}
                    onClick={() =>
                      sendAction({ type: 'SING_CANTE', suit: c.suit, pair: [10, 12] })
                    }
                    title={
                      c.value === 40
                        ? 'Cantar las 40 (Rey + Sota del triunfo)'
                        : `Cantar 20 en ${SUIT_NAME[c.suit]} (Rey + Sota)`
                    }
                    data-suit={c.suit}
                  >
                    <SuitGlyph suit={c.suit} size={glyphSize} />
                    <span>
                      {c.value === 40
                        ? 'Cantar las 40'
                        : `Cantar 20 en ${SUIT_NAME[c.suit]}`}
                    </span>
                  </button>
                ))}
                {myOptions.canSwapSeven && (
                  <button
                    className={primaryCls}
                    onClick={() => sendAction({ type: 'SWAP_SEVEN' })}
                    title="Cambiar el 7 del triunfo por la carta de triunfo"
                  >
                    Cambiar el 7
                  </button>
                )}
                <button
                  className={passCls}
                  onClick={() => sendAction({ type: 'PASS' })}
                  title="Pasar sin cantar ni cambiar el 7"
                >
                  Nada
                </button>
              </>
            );
          };
          return (
            <>
              <div className="action-bar-mobile">
                <div className={`action-bar${isYouWindow ? ' is-you' : ''}`}>
                  <div className="action-buttons">{renderButtons(true)}</div>
                </div>
              </div>
              <div className="action-bar-desktop">
                <div className={`action-bar${isYouWindow ? ' is-you' : ''}`}>
                  <div className="action-panel">
                    <div className="action-buttons">{renderButtons(false)}</div>
                  </div>
                </div>
              </div>
            </>
          );
        })()}
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
        // S3-06/S3-07: marcador CONTANDO la partida recién terminada. El
        // server lo actualiza al pasar a la siguiente partida (o al abrir la
        // votación), así que durante la pausa la sumamos nosotros.
        const n = format.partidasPorCoto;
        const m = format.cotosParaGanar;
        const pending = matchOver && s.matchWinner !== null && !rematch && !matchFinished;
        const w = s.matchWinner;
        const cotoWins: Record<0 | 1, number> =
          pending && w !== null ? { ...matchWins, [w]: matchWins[w] + 1 } : matchWins;
        const cotoOver = cotoWins[0] >= n || cotoWins[1] >= n;
        const cotosNow: Record<0 | 1, number> =
          pending && w !== null && cotoOver ? { ...cotoWinsSrv, [w]: cotoWinsSrv[w] + 1 } : cotoWinsSrv;
        // ¿Se acaba la mesa? (1 coto: al acabar el coto; match: al llegar a m cotos)
        const tableOver = cotoOver && (m === 1 || cotosNow[0] >= m || cotosNow[1] >= m || !pending);
        const cotoWinnerTeam: 0 | 1 = cotoWins[s.myTeam] >= n ? s.myTeam : s.otherTeam;
        const matchWinnerTeam: 0 | 1 = cotosNow[s.myTeam] >= cotosNow[s.otherTeam] ? s.myTeam : s.otherTeam;
        return (
          <div className="game-over-summary">
            <h2>
              {matchOver
                ? tableOver && m > 1
                  ? 'Match terminado'
                  : cotoOver ? 'Coto terminado' : 'Partida terminada'
                : `Resumen${s.vuelta > 1 ? ` · vuelta ${s.vuelta}` : ''}`}
            </h2>

            {/* ───────────── Resultado según escenario ───────────── */}
            {matchOver && (
              <section className="summary-matchover">
                <h3 className="summary-result-title">
                  {tableOver && m > 1
                    ? matchWinnerTeam === s.myTeam ? '🏆 ¡Match para nosotros!' : 'Match para ellos'
                    : cotoOver
                      ? cotoWinnerTeam === s.myTeam ? '🏆 ¡Coto para nosotros!' : 'Coto para ellos'
                      : s.matchWinner === s.myTeam ? '🎉 Partida para nosotros' : 'Partida para ellos'}
                </h3>
                {/* Marcador (S3-06/S3-07): partidas del coto y, en match, cotos. */}
                <p className="summary-result-subtitle">
                  Partidas <b>{cotoWins[s.myTeam]} – {cotoWins[s.otherTeam]}</b>
                  {!cotoOver && ` · el coto es a ${n}`}
                  {m > 1 && (
                    <>
                      {' · '}Cotos <b>{cotosNow[s.myTeam]} – {cotosNow[s.otherTeam]}</b>
                      {!tableOver && ` · el match es a ${m}`}
                    </>
                  )}
                </p>

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
                {/* Subtítulo con el marcador de partidas del match (S2-13). */}
                {(() => {
                  const mine = matchWins[s.myTeam];
                  const faltan = 3 - mine;
                  return (
                    <p className="summary-result-subtitle">
                      Partidas <b>{mine} - {matchWins[s.otherTeam]}</b> · te
                      {faltan === 1 ? ' falta 1' : ` faltan ${faltan}`}
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
                    Reparte <b>{seatLabel(s.nextDealer)}</b>; sale{' '}
                    <b>{seatLabel(s.nextStarter)}</b>, a su derecha.
                  </p>
                )}
                {s.vuelta === 1 && (
                  <p className="summary-footer">Se juegan las vueltas.</p>
                )}
                {s.vuelta > 1 && (
                  <p className="summary-footer">
                    En las vueltas se arrastran las buenas y las malas de la ida
                    y gana quien primero pase de {MATCH_THRESHOLD}.
                  </p>
                )}
              </section>
            )}

            {/* Pie del panel (S2-13):
                - postgame abierto → votación de revancha (20 s).
                - match cerrado → motivo + volver al inicio.
                - partida recién acabada, aún sin REMATCH_STATUS → espera.
                - mano normal → el server reparte solo (auto-cadencia). */}
            <div className="summary-actions">
              {rematch ? (
                <RematchPanel
                  deadline={rematch.deadline}
                  votes={rematch.votes}
                  you={you}
                  seatLabel={(seat) => seatLabel(seat as Seat)}
                  isBot={isBot}
                  onVote={voteRematch}
                  what={m > 1 ? 'match' : 'coto'}
                />
              ) : matchFinished ? (
                <div className="rematch-closed">
                  <span className="summary-actions-hint">
                    {matchEndedText(matchEnded, s.myTeam, format)}
                  </span>
                  <button className="btn primary summary-continue" type="button" onClick={leave}>
                    Volver al inicio
                  </button>
                </div>
              ) : matchOver ? (
                <span className="summary-actions-hint">
                  {tableOver
                    ? m > 1 ? 'Contando el match…' : 'Contando el coto…'
                    : cotoOver ? 'Siguiente coto en unos segundos…' : 'Siguiente partida en unos segundos…'}
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

      {/* Banner de error: aparece abajo a la izquierda cuando llega un
          `ERROR` del server (o de validación local). Auto-hide a 3 s.
          Antes los errores se acumulaban en `error` pero Game.tsx no
          los pintaba — el usuario no se enteraba de que el server había
          rechazado algo. Con este banner + el lock `pendingAction`, si
          el server rechaza una acción el usuario lo ve y entiende por
          qué su click "no funcionó". */}
      <ErrorBanner />

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
            {/* Sprint 2.9: el mensaje se lee al revés para que coincida
                con el flujo narrativo del jugador — "te quito ESTA CARTA
                y te meto el 7" (info-card-primero). Antes decía "cambia
                el 7 por XXXX" lo que resultaba confuso al verlo rápido
                en el overlay. Usamos `cardName(taken)` (definida más
                abajo junto a `rankLabel`) para mostrar "As de Oros" /
                "Rey de Copas" en vez del dígito. */}
            cambia el <b className="value">{cardName(swapAnnouncement.taken)}</b>{' '}
            por el <b className="value">7</b>
          </div>
        </div>
      )}

      {/* Aviso "¡Vamos de últimas!" (Sprint 2.16). Se muestra en la
          baza 3 cuando tras el draw quedan ≤ 4 cartas para repartir
          en la siguiente (la 4ª será la última con cartas). */}
      {arrastreAnnouncement && (
        <div
          key={arrastreAnnouncement.uid}
          className="arrastre-announcement"
          role="status"
          aria-live="polite"
        >
          <div className="arrastre-title">¡Vamos de últimas!</div>
        </div>
      )}

      {/* El overlay "¡10 de últimas!" se ha retirado definitivamente en
          Sprint 2.23 — el usuario prefiere que el game-over panel salga
          limpio al final, sin un cartel intermedio. El bonus de +10
          sigue aplicándose a los puntos en el motor (`lastTrickBonus`
          en el `apply`); el marcador lo refleja al pasar al resumen. */}
    </div>
  );
}

/**
 * Nombre completo de una carta en formato "As de Oros", "Tres de Copas",
 * "Rey de Espadas", etc. Lo usamos en el mensaje del overlay de
 * SWAP_SEVEN (Sprint 2.9). Como el motor ya garantiza que la carta
 * tomada en un swap es siempre SUPERIOR al 7 (rango ∈ {1, 3, 10, 11,
 * 12}), mostramos los nombres tradicionales (As / Tres / Sota /
 * Caballo / Rey) en vez del dígito para que se lea bonito.
 */
function rankLabel(rank: number): string {
  switch (rank) {
    case 1: return 'As';
    case 3: return 'Tres';
    case 10: return 'Sota';
    case 11: return 'Caballo';
    case 12: return 'Rey';
    default: return `${rank}`;
  }
}
function cardName(c: Card): string {
  return `${rankLabel(c.rank)} de ${SUIT_NAME[c.suit]}`;
}

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

/**
 * Botón "Invitar amigo" en la topbar del juego.
 *
 * Muestra el código de sala (4 letras) en grande y un tooltip con la URL
 * completa lista para copiar (`https://host/#ABCD`). Al pulsar el botón
 * (o el chip del código), copia la URL al portapapeles. Si la copia
 * falla (HTTP sin contexto seguro, navegador viejo), muestra un prompt
 * con la URL para que el usuario la copie a mano.
 *
 * En móvil el ancho es escaso: el chip del código ya es el "botón
 * principal" (muestra + copia al pulsar). En escritorio mostramos
 * también la URL inline para que sea fácil de leer.
 */
function InviteButton({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);
  const shareUrl =
    code !== null
      ? `${window.location.origin}/#${code}`
      : null;

  const copy = async () => {
    if (!shareUrl) return;
    try {
      // API moderna: requiere contexto seguro (HTTPS o localhost).
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        // Fallback para HTTP sin clipboard API: prompt con la URL.
        window.prompt('Copia el enlace:', shareUrl);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('No se pudo copiar. Cópialo manualmente:', shareUrl);
    }
  };

  if (!code) return null;

  // En móvil NO mostramos "Invitar" ni la URL inline: el chip del código
  // ya es el botón principal (tocar copia la URL completa al portapapeles).
  // En escritorio sí mostramos "Invitar" como hint visual.
  return (
    <div className="invite" onClick={copy} role="button" tabIndex={0}
         aria-label="Invitar amigo a esta sala"
         onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') copy(); }}>
      <span className="invite-code" aria-hidden="true">{code}</span>
      <span className="invite-hint">{copied ? '¡Copiado!' : 'Invitar'}</span>
    </div>
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

/**
 * Cartas legales para el humano en este momento. Antes esta función
 * replicaba a mano la lógica de `legalPlays` del motor (`packages/engine`)
 * y se desincronizó (bug reportado: forzaba a tirar bastos incluso cuando
 * ninguno podía ganar). Ahora delega en `legalPlaysFromView` del motor,
 * garantizando UNA SOLA implementación de la regla.
 *
 * La `RulesConfig` VIAJA en el `PlayerView` que el servidor envía por WS
 * (campo `view.rules`). El cliente NO importa ninguna configuración por
 * defecto: si el servidor decide jugar con una variante regional, el
 * cliente recibe esa variante en el primer VIEW y la respeta
 * automáticamente.
 */
function computeLegalSet(view: ReturnType<typeof useGame.getState>['view'], you: number | null): Set<string> {
  const set = new Set<string>();
  if (!view || you === null) return set;
  const cards = legalPlaysFromView(
    {
      hand: view.hand,
      trick: view.trick,
      trumpCard: view.trumpCard,
      trump: view.trump,
      rules: view.rules,
    },
    you as Seat,
  );
  for (const c of cards) set.add(c.id);
  return set;
}


/**
 * Banner flotante de errores del server. Se muestra durante 3 s cuando
 * el cliente recibe un mensaje `ERROR` (por ejemplo, el server rechazó
 * una acción por ILLEGAL_ACTION). Antes los errores se acumulaban en
 * `state.error` pero no se pintaban en la UI durante una partida, así
 * que el usuario no sabía qué había pasado.
 */
/**
 * S2-15: "📡 reconectando… 45 s" bajo el nombre de un jugador cuyo WS se
 * ha caído. La cuenta atrás es la ventana de 45 s del servidor; al vencer,
 * llega un SEATS con el asiento ya como `substitute`.
 */
function SeatReconnecting(props: { deadline: number | null }): JSX.Element {
  const { deadline } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [deadline]);
  const secs = deadline !== null ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  return (
    <div className="seat-status is-away" title="Este jugador ha perdido la conexión">
      📡 {secs !== null ? `${secs} s` : 'sin conexión'}
    </div>
  );
}

/** Texto del cierre de la mesa según `MATCH_ENDED` (S2-13 / S3-06 / S3-07). */
function matchEndedText(
  ended: { winner: 0 | 1 | null; reason: 'won' | 'declined' | 'timeout' | 'abandoned' } | null,
  myTeam: 0 | 1,
  format: { partidasPorCoto: number; cotosParaGanar: number },
): string {
  if (!ended) return 'Mesa cerrada.';
  const what = format.cotosParaGanar > 1 ? 'Match' : 'Coto';
  const result =
    ended.winner === null ? 'Empate.' : ended.winner === myTeam ? `🏆 ¡${what} para nosotros!` : `${what} para ellos.`;
  switch (ended.reason) {
    case 'won':
      return `${result} Primeros en llegar a ${format.partidasPorCoto} partidas.`;
    case 'declined':
      return `${result} No hay revancha: alguien no quiso seguir.`;
    case 'timeout':
      return `${result} No hay revancha: se acabó el tiempo para votar.`;
    case 'abandoned':
      return `${result} Un jugador abandonó la mesa.`;
  }
}

/**
 * Votación de revancha (S2-13). Cuenta atrás hasta `deadline` (hora del
 * server; asumimos relojes razonablemente sincronizados), estado de cada
 * asiento y botones Sí / No. Una vez votado, los botones se ocultan.
 */
function RematchPanel(props: {
  deadline: number;
  votes: Record<string, 'pending' | 'yes' | 'no'>;
  you: number;
  seatLabel: (seat: number) => string;
  isBot: boolean[];
  onVote: (accept: boolean) => void;
  /** S3-07: qué se juega en la revancha. */
  what: 'coto' | 'match';
}): JSX.Element {
  const { deadline, votes, you, seatLabel, isBot, onVote, what } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const total = 20_000;
  const leftMs = Math.max(0, deadline - now);
  const pct = Math.min(100, (leftMs / total) * 100);
  const myVote = votes[String(you)] ?? 'pending';
  const icon = (v: 'pending' | 'yes' | 'no') => (v === 'yes' ? '✅' : v === 'no' ? '❌' : '⏳');
  return (
    <div className="rematch-panel">
      <div className="rematch-title">{what === 'match' ? '¿Otro match?' : '¿Otro coto?'} <span className="rematch-secs">{Math.ceil(leftMs / 1000)} s</span></div>
      <div className="rematch-bar"><div className="rematch-bar-fill" style={{ width: `${pct}%` }} /></div>
      <ul className="rematch-votes">
        {[0, 1, 2, 3].filter((seat) => !isBot[seat]).map((seat) => (
          <li key={seat} className={seat === you ? 'is-me' : undefined}>
            {icon(votes[String(seat)] ?? 'pending')} {seat === you ? 'Tú' : seatLabel(seat)}
          </li>
        ))}
      </ul>
      {myVote === 'pending' ? (
        <div className="rematch-buttons">
          <button className="btn primary" type="button" onClick={() => onVote(true)}>Sí, otro</button>
          <button className="btn" type="button" onClick={() => onVote(false)}>No, terminar</button>
        </div>
      ) : (
        <span className="summary-actions-hint">Esperando al resto de jugadores…</span>
      )}
    </div>
  );
}

function ErrorBanner(): JSX.Element | null {
  const lastError = useGame((s) => s.lastError);
  // Re-render cada 100 ms mientras hay error reciente, para que el
  // banner se oculte exactamente a los 3 s sin intervención.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (lastError === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [lastError !== null]);
  if (lastError === null) return null;
  const ageMs = now - lastError.ts;
  const remainingMs = Math.max(0, 3000 - ageMs);
  if (remainingMs === 0) return null;
  return (
    <div className="error-banner" role="alert" aria-live="assertive">
      <span className="error-banner-icon" aria-hidden="true">⚠</span>
      <span className="error-banner-message">{lastError.message}</span>
    </div>
  );
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

/**
 * S3-08: sonidos de la mesa. Compara cada VIEW con la anterior:
 *  - más cartas jugadas en la mano (bazas cerradas × 4 + baza en curso) → `card`;
 *  - más cantes → `cante`;
 *  - el turno pasa a ser tuyo en una fase de jugar carta → `turn`.
 * La primera VIEW (entrar o reconectar) solo se apunta, no suena.
 */
function useTableSounds(view: PlayerView | null, you: number | null): void {
  const prev = useRef<{ played: number; cantes: number; myTurn: boolean; vuelta: number } | null>(null);
  useEffect(() => {
    if (!view || you === null) {
      prev.current = null;
      return;
    }
    const played = view.finishedTricks.length * 4 + view.trick.length;
    const cantes = view.cantes.length;
    const myTurn =
      view.turn === you &&
      (view.phase === 'lead' || view.phase === 'follow' || view.phase === 'arrastre');
    const before = prev.current;
    prev.current = { played, cantes, myTurn, vuelta: view.vuelta };
    if (!before) return;
    if (cantes > before.cantes) playSound('cante');
    else if (played > before.played) playSound('card');
    if (myTurn && !before.myTurn) {
      // Deja un respiro tras el golpe de la carta del rival.
      window.setTimeout(() => playSound('turn'), played > before.played ? 220 : 0);
    }
  }, [view, you]);
}

function MuteButton() {
  const [muted, setMuted] = useMuted();
  return (
    <button
      type="button"
      className={`btn small mute-btn ${muted ? 'is-muted' : ''}`}
      onClick={() => setMuted(!muted)}
      aria-pressed={muted}
      aria-label={muted ? 'Activar sonido' : 'Silenciar'}
      title={muted ? 'Activar sonido' : 'Silenciar'}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {muted ? (
          <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        ) : (
          <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        )}
      </svg>
    </button>
  );
}

/** Cabeza de robot (antena, ojos y boca), para la insignia de bot. */
function BotIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <line x1="12" y1="2.5" x2="12" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="2.5" r="1.6" fill="currentColor" />
      <rect x="4" y="6" width="16" height="13" rx="4" fill="currentColor" />
      <circle cx="9" cy="12" r="1.9" fill="var(--bot-badge-bg, #0b3b2d)" />
      <circle cx="15" cy="12" r="1.9" fill="var(--bot-badge-bg, #0b3b2d)" />
      <rect x="9" y="15.3" width="6" height="1.6" rx="0.8" fill="var(--bot-badge-bg, #0b3b2d)" />
    </svg>
  );
}

/** S4-02: aviso al cambiar de división al acabar una partida. */
function DivisionToast() {
  const change = useGame((s) => s.divisionChange);
  const dismiss = useGame((s) => s.dismissDivisionChange);
  useEffect(() => {
    if (!change) return;
    const id = window.setTimeout(dismiss, 7000);
    return () => window.clearTimeout(id);
  }, [change, dismiss]);
  if (!change) return null;
  const order = (d: string) => DIVISIONS.findIndex((x) => x.id === d);
  const name = divisionName(change.to);
  const up = change.from === null || order(change.to) > order(change.from);
  const text =
    change.from === null ? `¡Ya tienes división: ${name}!` : up ? `¡Subes a ${name}!` : `Bajas a ${name}`;
  return (
    <button type="button" className={`division-toast ${up ? 'is-up' : 'is-down'}`} onClick={dismiss} role="status">
      <DivisionBadge division={change.to} size={34} label />
      <span>
        <b>{text}</b>
        <small>{up ? 'Sigue así.' : 'La próxima la recuperas.'}</small>
      </span>
    </button>
  );
}
