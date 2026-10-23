// SEO: escribe dist/<ruta>/index.html para cada página pública con su
// título, descripción, canónica y el contenido ya pintado.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ORIGIN = 'https://www.guinoteonline.es';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const ssr = join(root, 'dist-ssr');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const { pages } = await import(pathToFileURL(join(ssr, 'prerender.js')).href);
const template = await readFile(join(dist, 'index.html'), 'utf8');
if (!template.includes('<!--page:start-->') || !template.includes('<!--root:start-->')) {
  throw new Error('index.html sin marcadores <!--page:start--> / <!--root:start-->');
}

for (const p of pages()) {
  const url = `${ORIGIN}${p.path}`;
  const head = [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
  ].join('\n    ');
  const html = template
    .replace(/<!--page:start-->[\s\S]*?<!--page:end-->/, `<!--page:start-->\n    ${head}\n    <!--page:end-->`)
    .replace(/<!--root:start-->[\s\S]*?<!--root:end-->/, `<!--root:start-->${p.html}<!--root:end-->`);
  const out = join(dist, p.path.slice(1), 'index.html');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html);
  console.log(`[prerender] ${p.path} → ${out}`);
}
await rm(ssr, { recursive: true, force: true });
