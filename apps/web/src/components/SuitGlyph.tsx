import type { Suit } from '@guinote/engine';

interface Props {
  suit: Suit;
  size?: number;
}

/**
 * Palos de la baraja española en SVG. No hay glifos Unicode estándar para
 * oros y bastos, así que los dibujamos. Colores: oros dorado, copas rojo,
 * espadas negro, bastos verde oscuro.
 */
export function SuitGlyph({ suit, size = 24 }: Props) {
  switch (suit) {
    case 'oros':
      return (
        <svg viewBox="0 0 100 100" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round">
          {/* Anillo exterior */}
          <circle cx="50" cy="50" r="40" />
          {/* Estrella interior */}
          <path
            d="M 50 22 L 56 44 L 78 44 L 60 56 L 66 78 L 50 66 L 34 78 L 40 56 L 22 44 L 44 44 Z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    case 'copas':
      return (
        <svg viewBox="0 0 100 100" width={size} height={size} fill="currentColor">
          {/* Copa: forma de cáliz */}
          <path d="M 28 15 L 72 15 Q 72 60 50 65 Q 28 60 28 15 Z" />
          {/* Pie */}
          <rect x="45" y="65" width="10" height="15" />
          {/* Base */}
          <rect x="32" y="80" width="36" height="7" rx="2" />
        </svg>
      );
    case 'espadas':
      return (
        <svg viewBox="0 0 100 100" width={size} height={size} fill="currentColor">
          {/* Hoja de la espada */}
          <path d="M 50 8 L 62 78 L 50 72 L 38 78 Z" />
          {/* Guardia (crossguard) */}
          <rect x="22" y="76" width="56" height="6" rx="2" />
          {/* Mango */}
          <rect x="46" y="82" width="8" height="12" />
          {/* Pomo */}
          <circle cx="50" cy="96" r="4" />
        </svg>
      );
    case 'bastos':
      return (
        <svg viewBox="0 0 100 100" width={size} height={size} fill="currentColor">
          {/* Cuerpo del basto: cilindro con vetas */}
          <rect x="44" y="35" width="12" height="58" rx="2" />
          <line x1="44" y1="50" x2="56" y2="50" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" />
          <line x1="44" y1="70" x2="56" y2="70" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" />
          {/* Cabeza del basto: tres lóbulos (trébol) */}
          <circle cx="50" cy="22" r="11" />
          <circle cx="34" cy="30" r="8" />
          <circle cx="66" cy="30" r="8" />
          {/* Cinta o banderín en la punta */}
          <path d="M 50 8 L 50 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M 50 12 L 58 14 L 50 16" fill="currentColor" />
        </svg>
      );
  }
}
