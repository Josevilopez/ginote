/**
 * SEO: genera al compilar el HTML de las páginas públicas para que los
 * buscadores lean el contenido sin ejecutar JavaScript. Lo usa
 * `scripts/prerender.mjs` tras `vite build --ssr`.
 */
import { renderToString } from 'react-dom/server';
import { Rules } from './pages/Rules.js';
import { Privacy } from './pages/Privacy.js';

const noop = () => undefined;

export interface PrerenderedPage {
  /** Ruta pública, sin barra final: `/como-se-juega`. */
  path: string;
  title: string;
  description: string;
  html: string;
}

export function pages(): PrerenderedPage[] {
  return [
    {
      path: '/como-se-juega',
      title: 'Cómo se juega al guiñote · Reglas, puntos y cantes',
      description:
        'Reglas del guiñote explicadas fácil: lo que vale cada carta, el triunfo, el arrastre, los cantes (20 y las cuarenta), buenas y malas, vueltas y el coto.',
      html: renderToString(<Rules onBack={noop} />),
    },
    {
      path: '/privacidad',
      title: 'Privacidad · Guiñote online',
      description: 'Qué datos guarda Guiñote online, para qué y cómo verlos o borrarlos. Sin letra pequeña.',
      html: renderToString(<Privacy onBack={noop} />),
    },
  ];
}
