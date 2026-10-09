// Verificación rápida: simular varias manos y ver cómo evoluciona el score.
import { newHand, apply, legalActions, SEATS, GUINOTE_ARAGONES } from './packages/engine/dist/index.js';

function playRandom(state, seat) {
  const actions = legalActions(state, seat);
  const play = actions.find((a) => a.type === 'PLAY_CARD');
  if (play) apply(state, play);
}

function simulateHand(state) {
  let turns = 0;
  while (state.phase !== 'finished' && turns < 1000) {
    const seat = state.turn;
    if (seat === null) break;
    if (state.phase === 'winnerWindow') {
      apply(state, { type: 'PASS' });
    } else {
      playRandom(state, seat);
    }
    turns++;
  }
  return state;
}

let state = newHand({
  id: 'verify',
  seed: 'verify-1',
  rules: GUINOTE_ARAGONES,
  dealer: 3,
});

console.log('Initial:');
console.log('  score:', JSON.stringify(state.score));
console.log('  vuelta:', state.vuelta);

for (let i = 1; i <= 5; i++) {
  simulateHand(state);
  console.log(`\nAfter hand ${i}:`);
  console.log('  trickPoints:', JSON.stringify(state.trickPoints));
  console.log('  score:', JSON.stringify(state.score));
  console.log('  matchEnded:', state.matchEnded, 'matchWinner:', state.matchWinner);

  if (state.matchEnded) {
    console.log('Match ended!');
    break;
  }

  // Start next hand with continuation
  state = newHand({
    id: `verify-${i + 1}`,
    seed: `verify-next-${i}`,
    rules: GUINOTE_ARAGONES,
    dealer: (state.dealer + 1) % 4,
    continuation: {
      vuelta: state.vuelta + 1,
      score: state.score,
      matchEnded: state.matchEnded,
      matchWinner: state.matchWinner,
    },
  });
  console.log(`  -> vuelta ${state.vuelta} started, score preserved:`, JSON.stringify(state.score));
}