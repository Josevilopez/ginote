// Verificación: ver qué view.score llega al cliente tras una mano.
import { newHand, apply, legalActions, SEATS, viewFor, GUINOTE_ARAGONES } from './packages/engine/dist/index.js';

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

const state = newHand({
  id: 'verify-view',
  seed: 'verify-view-1',
  rules: GUINOTE_ARAGONES,
  dealer: 3,
});

console.log('Initial view.score:');
const initialView = viewFor(state, 0);
console.log(JSON.stringify(initialView.score));

simulateHand(state);
console.log('\nAfter hand 1:');
console.log('  state.score:', JSON.stringify(state.score));
const view = viewFor(state, 0);
console.log('  view.score:', JSON.stringify(view.score));

// Verify what the topbar would show
const ourTeam = 0; // you % 2 = 0
const ourBuenas = view.score.buenas[ourTeam];
const ourMalas = view.score.malas[ourTeam];
console.log('\nTopbar display:');
console.log(`  Buenas: ${ourBuenas}`);
console.log(`  Malas: ${ourMalas}`);
console.log(`  fmtScore: ${ourBuenas > 50 ? ourBuenas - 50 : ourBuenas}`);
console.log(`  Suffix: ${ourBuenas > 50 ? 'B' : 'M'}`);