// Smoke "smart": el cliente usa el motor (importado como lib) para decidir
// acciones legales. Confirma que el server recibe acciones válidas, los bots
// responden, y la mano completa termina.

import { legalActions, SEATS } from '@guinote/engine';

const WebSocket = (await import('ws')).default;

async function main() {
  const resp = await fetch('http://127.0.0.1:3001/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Smart' }),
  });
  const { code } = await resp.json();
  console.log('Sala creada:', code);

  const ws = new WebSocket(`ws://127.0.0.1:3001/ws/${code}`);
  const messages = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    messages.push(msg);
  });

  await new Promise((r) => ws.once('open', r));
  await new Promise((r) => setTimeout(r, 100));

  // Construimos un estado "espejo" del server usando la vista. Pero el
  // viewFor oculta manos ajenas, así que no podemos llamar a legalActions
  // directamente. Usamos otra estrategia: el server nos dice qué cartas
  // podemos jugar implícitamente. Como el server YA valida con legalActions,
  // cualquier carta de nuestra mano es legal en draw, y en arrastre
  //我们需要 que el cliente elija del subconjunto legal.
  //
  // Truco: la vista solo nos da `hand` y `trick`. En draw todo vale. En
  // arrastre (trumpCard=null) tenemos que respetar palo. Hacemos la lógica
  // nosotros: si la salida es de un palo, debemos seguirlo si lo tenemos.
  // Para superar/fallar, simplificamos: jugamos la carta de mayor fuerza
  // del palo obligatorio, o triunfo si no hay palo.

  const SEAT_NUM = 4;
  const STRENGTH = [1, 3, 12, 10, 11, 7, 6, 5, 4, 2]; // mismo orden que el motor

  function pickPlayable(view) {
    if (view.phase === 'winnerWindow') return { type: 'PASS' };
    const hand = view.hand;
    if (view.trick.length === 0) {
      // salida: cualquier carta
      return { type: 'PLAY_CARD', cardId: hand[0].id };
    }
    const ledSuit = view.trick[0].card.suit;
    const trump = view.trump;
    const sameSuit = hand.filter((c) => c.suit === ledSuit);
    if (sameSuit.length > 0) {
      // obligamos palo; en la realidad, superar, pero simplificamos: la más alta
      sameSuit.sort((a, b) => STRENGTH.indexOf(a.rank) - STRENGTH.indexOf(b.rank));
      return { type: 'PLAY_CARD', cardId: sameSuit[0].id };
    }
    const trumps = hand.filter((c) => c.suit === trump);
    if (trumps.length > 0) {
      trumps.sort((a, b) => STRENGTH.indexOf(a.rank) - STRENGTH.indexOf(b.rank));
      return { type: 'PLAY_CARD', cardId: trumps[0].id };
    }
    // libre
    return { type: 'PLAY_CARD', cardId: hand[0].id };
  }

  let actions = 0;
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const lastView = [...messages].reverse().find((m) => m.type === 'VIEW');
    if (!lastView) continue;
    const v = lastView.view;
    if (v.phase === 'finished') break;
    if (v.turn !== v.you) continue;
    const action = pickPlayable(v);
    ws.send(JSON.stringify({
      type: 'ACTION',
      commandId: `c-${actions++}`,
      action,
    }));
  }

  await new Promise((r) => setTimeout(r, 500));
  const gameOver = messages.find((m) => m.type === 'GAME_OVER');
  if (gameOver) {
    console.log('✅ Mano terminada. Puntos:', JSON.stringify(gameOver.handPoints));
    const views = messages.filter((m) => m.type === 'VIEW');
    console.log(`Vistas recibidas: ${views.length} (última version=${views[views.length - 1].version})`);
  } else {
    console.log('❌ No llegó GAME_OVER');
    const lastView = [...messages].reverse().find((m) => m.type === 'VIEW');
    if (lastView) console.log(`Última vista: phase=${lastView.view.phase} version=${lastView.view.version} handSize=${lastView.view.hand.length} turn=${lastView.view.turn}`);
  }
  ws.close();
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
