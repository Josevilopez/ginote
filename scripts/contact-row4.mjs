// Genera un contact sheet de TODAS las celdas de la fila 4 del sprite para
// identificar cuál es el reverso real. Uso: node scripts/contact-row4.mjs
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPRITE = join(ROOT, 'apps/web/public/cards/baraja.png');
const OUT_DIR = join(ROOT, 'apps/web/public/cards/_debug');
const OUT = join(OUT_DIR, 'row4-contact.png');

const CELL_W = 160;
const CELL_H = 245;
const ROW = 4;
const COLS = 12;
const SCALE = 0.5; // miniaturas

const cellW = Math.round(CELL_W * SCALE);
const cellH = Math.round(CELL_H * SCALE);
const labelH = 24;
const gap = 6;
const padX = 12;
const padY = 12;

await mkdir(OUT_DIR, { recursive: true });

// Construye SVG con cada celda + su número de columna encima.
const composite = await sharp(SPRITE).metadata();
const cells = [];
for (let col = 0; col < COLS; col++) {
  const img = await sharp(SPRITE)
    .extract({ left: col * CELL_W, top: ROW * CELL_H, width: CELL_W, height: CELL_H })
    .resize({ width: cellW, height: cellH })
    .toBuffer();
  cells.push({ input: img, top: padY + labelH, left: padX + col * (cellW + gap) });

  // Etiqueta
  const labelSvg = Buffer.from(
    `<svg width="${cellW}" height="${labelH}">
       <rect width="100%" height="100%" fill="#222"/>
       <text x="50%" y="16" text-anchor="middle" font-family="sans-serif"
             font-size="16" fill="#fff">col ${col}</text>
     </svg>`
  );
  cells.push({ input: labelSvg, top: padY, left: padX + col * (cellW + gap) });
}

const totalW = padX * 2 + COLS * cellW + (COLS - 1) * gap;
const totalH = padY * 2 + labelH + cellH;

await sharp({
  create: { width: totalW, height: totalH, channels: 3, background: { r: 30, g: 30, b: 30 } }
})
  .composite(cells)
  .png()
  .toFile(OUT);

console.log(`Contact sheet: ${OUT}`);
console.log(`Tamaño: ${totalW}×${totalH}`);
