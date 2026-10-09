// Verificar el nuevo cumulativeTeamPts.
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

const fmtScore = (v) => v > 50 ? `${v - 50} B` : `${v} M`;

console.log('=== Simulación con cumulativeTeamPts ===\n');

let state = newHand({ id: 'verify', seed: 'verify-cum-1', rules: GUINOTE_ARAGONES, dealer: 3 });

for (let i = 1; i <= 3; i++) {
  simulateHand(state);
  const view = viewFor(state, 0);
  console.log(`Vuelta ${state.vuelta}, mano ${i}:`);
  console.log(`  trickPoints: ${JSON.stringify(state.trickPoints)}`);
  console.log(`  cumulativeTeamPts: ${JSON.stringify(state.cumulativeTeamPts)}`);
  console.log(`  Topbar nosotros: ${fmtScore(view.cumulativeTeamPts[0] ?? 0)}`);
  console.log(`  Topbar ellos:    ${fmtScore(view.cumulativeTeamPts[1] ?? 0)}`);
  console.log('');

  if (state.matchEnded) {
    console.log('Match ended!');
    break;
  }

  state = newHand({
    id: `verify-${i + 1}`,
    seed: `verify-cum-next-${i}`,
    rules: GUINOTE_ARAGONES,
    dealer: (state.dealer + 1) % 4,
    continuation: {
      vuelta: state.vuelta + 1,
      score: state.score,
      cumulativeTeamPts: state.cumulativeTeamPts,
      matchEnded: state.matchEnded,
      matchWinner: state.matchWinner,
    },
  });
  console.log(`→ Vuelta ${state.vuelta} creada con cumulative preservado: ${JSON.stringify(state.cumulativeTeamPts)}`);
  console.log('');
}