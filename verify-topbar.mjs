// Verificar qué muestra el topbar tras una mano.
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

const state = newHand({
  id: 'verify-topbar',
  seed: 'verify-topbar-1',
  rules: GUINOTE_ARAGONES,
  dealer: 3,
});

console.log('Simulando mano con seed verify-topbar-1...');
simulateHand(state);

const view = viewFor(state, 0);
console.log('\nFinal state:');
console.log('  trickPoints:', JSON.stringify(state.trickPoints));
console.log('  score:', JSON.stringify(state.score));
console.log('  matchEnded:', state.matchEnded, 'matchWinner:', state.matchWinner);

console.log('\nView que recibe el cliente (seat 0):');
console.log('  score:', JSON.stringify(view.score));

console.log('\nLo que la topbar mostraría:');
console.log('  team 0 (nosotros): fmtScore(68) = "18", suffix "B" (color verde)');
console.log('  team 1 (ellos):    fmtScore(0)  = "0",  suffix "M" (color normal)');

// Simulate the topbar render with the actual values
const fmtScore = (b) => b > 50 ? String(b - 50) : String(b);
const fmtRange = (b) => b > 50 ? 'in-buenas' : 'in-malas';

console.log('\nRender final:');
console.log(`  nosotros: <b class="${fmtRange(view.score.buenas[0])}">${fmtScore(view.score.buenas[0])}</b><span class="score-suffix ${fmtRange(view.score.buenas[0])}">${view.score.buenas[0] > 50 ? 'B' : 'M'}</span>`);
console.log(`  ellos:    <b class="${fmtRange(view.score.buenas[1])}">${fmtScore(view.score.buenas[1])}</b><span class="score-suffix ${fmtRange(view.score.buenas[1])}">${view.score.buenas[1] > 50 ? 'B' : 'M'}</span>`);