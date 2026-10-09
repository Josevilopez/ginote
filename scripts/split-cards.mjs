// Recorta el sprite de la baraja española en imágenes individuales.
// Ejecutar una sola vez: `node scripts/split-cards.mjs`.
//
// Genera 40 cartas (4 palos × 10 ranks: 1, 2..7, 10, 11, 12) + 1 reverso.

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPRITE = join(ROOT, 'apps/web/public/cards/baraja.png');
const OUT = join(ROOT, 'apps/web/public/cards/sprite');

const SUITS = ['oros', 'copas', 'espadas', 'bastos'];
const SUIT_ROW = { oros: 0, copas: 1, espadas: 2, bastos: 3 };

// Ranks que se usan en guiñote (1 = As, 2..7, 10 = Sota, 11 = Caballo, 12 = Rey).
// Las columnas en el sprite son: 1→0, 2→1, ..., 7→6, 10→9, 11→10, 12→11.
const RANK_COL = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 10: 9, 11: 10, 12: 11 };

const CELL_W = 160;
const CELL_H = 245;
// Fila 4: reverso. La baraja solo tiene el reverso real en la columna 1
// (las otras 11 celdas de esa fila están en blanco).
const BACK_ROW = 4;
const BACK_COL = 1;

await mkdir(OUT, { recursive: true });

const image = sharp(SPRITE);
const meta = await image.metadata();
console.log(`Sprite: ${meta.width}×${meta.height}`);

async function extract(name, col, row) {
  const x = col * CELL_W;
  const y = row * CELL_H;
  const outPath = join(OUT, `${name}.png`);
  await sharp(SPRITE)
    .extract({ left: x, top: y, width: CELL_W, height: CELL_H })
    .toFile(outPath);
  console.log(`  → ${name}.png`);
}

console.log('Recortando cartas...');
for (const suit of SUITS) {
  for (const [rankStr, col] of Object.entries(RANK_COL)) {
    const rank = Number(rankStr);
    const name = `${suit}-${rank}`;
    await extract(name, col, SUIT_ROW[suit]);
  }
}

console.log('Recortando reverso...');
await extract('back', BACK_COL, BACK_ROW);

console.log(`\nListo. ${Object.keys(RANK_COL).length * SUITS.length + 1} imágenes en ${OUT}`);
