// Regenera SOLO el reverso desde otra columna del sprite.
// Uso: node scripts/regen-back.mjs [col]
import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPRITE = join(ROOT, 'apps/web/public/cards/baraja.png');
const OUT = join(ROOT, 'apps/web/public/cards/sprite');

const COL = Number(process.argv[2] ?? 11);
const ROW = 4;
const CELL_W = 160;
const CELL_H = 245;

await sharp(SPRITE)
  .extract({ left: COL * CELL_W, top: ROW * CELL_H, width: CELL_W, height: CELL_H })
  .toFile(join(OUT, 'back.png'));

console.log(`back.png regenerado desde row=${ROW} col=${COL}`);
