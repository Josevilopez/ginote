// Verificar lo que la topbar muestra tras cada mano de idas.
import { newHand, apply, legalActions, viewFor, GUINOTE_ARAGONES } from './packages/engine/dist/index.js';

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

const fmtScore = (v) => `${v} ${v > 50 ? 'B' : 'M'}`;
const fmtRange = (v) => v > 50 ? 'in-buenas' : 'in-malas';

console.log('=== Simulación de 3 manos de idas (vuelta 1) ===\n');

let state = newHand({ id: 'verify', seed: 'verify-id-1', rules: GUINOTE_ARAGONES, dealer: 3 });
const you = 0;
const myTeam = 0;
const theirTeam = 1;

for (let i = 1; i <= 3; i++) {
  console.log(`--- Vuelta ${state.vuelta}, Mano ${i} ---`);
  console.log(`Inicial: score.buenas = ${JSON.stringify(state.score.buenas)}`);
  
  simulateHand(state);
  
  console.log(`Tras mano: state.score.buenas = ${JSON.stringify(state.score.buenas)}`);
  console.log(`           state.score.malas  = ${JSON.stringify(state.score.malas)}`);
  
  const view = viewFor(state, you);
  console.log(`Vista (seat 0):`);
  console.log(`  nosotros (team ${myTeam}): fmtScore = "${fmtScore(view.score.buenas[myTeam])}"`);
  console.log(`  ellos (team ${theirTeam}):   fmtScore = "${fmtScore(view.score.buenas[theirTeam])}"`);
  console.log('');
  
  if (state.matchEnded) {
    console.log('Match ended!');
    break;
  }
  
  // Start next vuelta with continuation
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
  console.log(`→ Vuelta ${state.vuelta} creada con score preservado: ${JSON.stringify(state.score)}`);
  console.log('');
}