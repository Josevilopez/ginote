import { divisionName, type Division } from '@guinote/protocol';
import './DivisionBadge.css';

/**
 * S4-02: insignia de división. Un escudo del color de la división; en
 * grande (perfil) lleva dentro la inicial.
 */
export function DivisionBadge({ division, size = 18, label = false }: { division: Division; size?: number; label?: boolean }) {
  const name = divisionName(division);
  return (
    <span className={`division-badge is-${division}`} title={name} role="img" aria-label={`División ${name}`}>
      <svg viewBox="0 0 24 28" width={size} height={(size * 28) / 24} aria-hidden="true">
        <defs>
          <linearGradient id={`dg-${division}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--div-hi)" />
            <stop offset="1" stopColor="var(--div-lo)" />
          </linearGradient>
        </defs>
        <path
          d="M12 1.5 21.5 5v8.2c0 6.2-4.1 10.9-9.5 13.3C6.6 24.1 2.5 19.4 2.5 13.2V5L12 1.5z"
          fill={`url(#dg-${division})`}
          stroke="rgba(0,0,0,0.45)"
          strokeWidth="1.2"
        />
        {division === 'leyenda' ? (
          <path d="M12 7.5l1.6 3.4 3.7.5-2.7 2.6.7 3.7L12 15.9l-3.3 1.8.7-3.7-2.7-2.6 3.7-.5L12 7.5z" fill="rgba(255,255,255,0.9)" />
        ) : (
          label && (
            <text x="12" y="17.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="rgba(0,0,0,0.6)" fontFamily="Alegreya, Georgia, serif">
              {name[0]}
            </text>
          )
        )}
      </svg>
    </span>
  );
}
