import type { Card, Suit } from '@guinote/engine';
import { SuitGlyph } from './SuitGlyph.js';

interface Props {
  card: Card;
  small?: boolean;
}

/**
 * Cara de la carta al estilo de la baraja española clásica.
 * - As: 1 símbolo grande centrado.
 * - 2..7: 2..7 símbolos del palo distribuidos.
 * - Sota (10), Caballo (11), Rey (12): figuras humanas estilizadas con
 *   gradientes, siluetas más orgánicas y adornos reconocibles.
 */
export function CardFace({ card, small }: Props) {
  return (
    <div className={`card-face-inner ${small ? 'small' : ''}`}>
      <div className="rank top">{RANK_GLYPH[card.rank]}</div>
      <div className="pip-area">
        {card.rank === 1 && <BigSuit suit={card.suit} />}
        {card.rank >= 2 && card.rank <= 7 && <Pips rank={card.rank} suit={card.suit} />}
        {card.rank === 10 && <SotaFigure suit={card.suit} />}
        {card.rank === 11 && <CaballoFigure suit={card.suit} />}
        {card.rank === 12 && <ReyFigure suit={card.suit} />}
      </div>
      <div className="rank bottom">{RANK_GLYPH[card.rank]}</div>
    </div>
  );
}

const RANK_GLYPH: Record<number, string> = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  10: 'S', 11: 'C', 12: 'R',
};

const POSITIONS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
  7: [0, 1, 2, 3, 5, 6, 8],
};
const GRID_X = [22, 50, 78] as const;
const GRID_Y = [22, 50, 78] as const;

function Pips({ rank, suit }: { rank: number; suit: Suit }) {
  const positions = POSITIONS[rank] ?? [];
  const size = rank >= 7 ? 24 : 26;
  return (
    <>
      {positions.map((p, i) => (
        <div
          key={i}
          className="pip"
          style={{
            left: `${GRID_X[p % 3]}%`,
            top: `${GRID_Y[Math.floor(p / 3)]}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <SuitGlyph suit={suit} size={size} />
        </div>
      ))}
    </>
  );
}

function BigSuit({ suit }: { suit: Suit }) {
  return (
    <div className="big-suit">
      <SuitGlyph suit={suit} size={56} />
    </div>
  );
}

function FigureBase({ suit, children }: { suit: Suit; children: React.ReactNode }) {
  return (
    <div className={`figure ${suit}`}>
      <svg viewBox="0 0 100 140" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`grad-${suit}-main`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--card-${suit}-light)`} />
            <stop offset="100%" stopColor={`var(--card-${suit}-dark)`} />
          </linearGradient>
          <linearGradient id={`grad-skin`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7dcae" />
            <stop offset="100%" stopColor="#d4a676" />
          </linearGradient>
        </defs>
        {children}
      </svg>
    </div>
  );
}

/* ============================
   SOTA — figura de pie, sombrero de ala, capa, espada
   ============================ */
function SotaFigure({ suit }: { suit: Suit }) {
  const c = `url(#grad-${suit}-main)`;
  const cStroke = `var(--card-${suit}-dark)`;
  return (
    <FigureBase suit={suit}>
      {/* Sombra del suelo */}
      <ellipse cx="50" cy="135" rx="26" ry="3" fill="rgba(0,0,0,0.18)" />
      {/* Piernas (botas) */}
      <path d="M 40 100 L 38 130 L 47 130 L 47 100 Z" fill="#2a1a0a" />
      <path d="M 53 100 L 53 130 L 62 130 L 60 100 Z" fill="#2a1a0a" />
      {/* Capa con pliegues (detrás) */}
      <path d="M 30 50 Q 22 75 28 110 L 36 110 Q 32 78 38 55 Z" fill={c} opacity="0.85" />
      {/* Túnica principal */}
      <path
        d="M 35 55 Q 33 80 38 108 L 62 108 Q 67 80 65 55 Q 50 60 35 55 Z"
        fill={c}
        stroke={cStroke}
        strokeWidth="0.6"
      />
      {/* Pliegues verticales de la túnica */}
      <path d="M 44 60 Q 42 85 45 105" stroke={cStroke} strokeWidth="0.4" fill="none" opacity="0.5" />
      <path d="M 56 60 Q 58 85 55 105" stroke={cStroke} strokeWidth="0.4" fill="none" opacity="0.5" />
      {/* Cinturón */}
      <rect x="36" y="88" width="28" height="4" fill="#3a2410" />
      <rect x="48" y="87" width="4" height="6" fill="#e8c46b" />
      {/* Brazo izquierdo (con espada) */}
      <path d="M 32 58 Q 24 70 22 84 L 26 86 Q 30 74 36 64 Z" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Espada lateral */}
      <line x1="22" y1="68" x2="14" y2="98" stroke="#c0c0c0" strokeWidth="2" />
      <line x1="22" y1="68" x2="14" y2="98" stroke="#e0e0e0" strokeWidth="0.6" />
      <rect x="19" y="66" width="6" height="3" fill="#e8c46b" />
      <circle cx="22" cy="65" r="2" fill="#e8c46b" />
      {/* Brazo derecho (en la capa) */}
      <path d="M 68 58 Q 76 70 78 80 L 74 82 Q 70 72 64 64 Z" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Mano */}
      <circle cx="24" cy="86" r="2.5" fill="url(#grad-skin)" />
      {/* Cuello alto (gorguera) */}
      <path d="M 42 50 L 42 56 L 58 56 L 58 50 Z" fill="#f5f0e1" />
      <path d="M 43 51 L 43 55 L 57 55 L 57 51 Z" fill="none" stroke="#888" strokeWidth="0.3" />
      {/* Cabeza */}
      <ellipse cx="50" cy="40" rx="9" ry="11" fill="url(#grad-skin)" stroke="#8b6b4a" strokeWidth="0.4" />
      {/* Cabello / patillas */}
      <path d="M 41 38 Q 41 50 47 50 L 47 38 Z" fill="#3a2410" />
      <path d="M 59 38 Q 59 50 53 50 L 53 38 Z" fill="#3a2410" />
      {/* Cara: ojos, nariz, boca */}
      <ellipse cx="46" cy="40" rx="0.9" ry="1.2" fill="#222" />
      <ellipse cx="54" cy="40" rx="0.9" ry="1.2" fill="#222" />
      <path d="M 50 42 L 49 45 L 51 45 Z" fill="#c89870" />
      <path d="M 47 47 Q 50 49 53 47" stroke="#8b3030" strokeWidth="0.6" fill="none" />
      {/* Sombrero de ala ancha con cinta */}
      <ellipse cx="50" cy="28" rx="20" ry="3.5" fill={c} stroke={cStroke} strokeWidth="0.5" />
      <path d="M 40 28 Q 50 18 60 28 L 58 28 Q 50 21 42 28 Z" fill={c} stroke={cStroke} strokeWidth="0.5" />
      <ellipse cx="50" cy="28" rx="3" ry="1" fill="#e8c46b" />
      {/* Pluma del sombrero */}
      <path d="M 58 22 Q 68 18 65 30 Q 62 25 60 28" fill={c} stroke={cStroke} strokeWidth="0.4" />
      <path d="M 60 22 Q 64 20 62 26" stroke={cStroke} strokeWidth="0.3" fill="none" />
    </FigureBase>
  );
}

/* ============================
   CABALLO — jinete a caballo
   ============================ */
function CaballoFigure({ suit }: { suit: Suit }) {
  const c = `url(#grad-${suit}-main)`;
  const cStroke = `var(--card-${suit}-dark)`;
  return (
    <FigureBase suit={suit}>
      {/* Sombra */}
      <ellipse cx="50" cy="135" rx="34" ry="3" fill="rgba(0,0,0,0.18)" />
      {/* Patas del caballo */}
      <rect x="22" y="105" width="5" height="20" rx="1" fill={c} />
      <rect x="32" y="105" width="5" height="20" rx="1" fill={c} />
      <rect x="62" y="105" width="5" height="20" rx="1" fill={c} />
      <rect x="72" y="105" width="5" height="20" rx="1" fill={c} />
      {/* Cascos (pezuñas) */}
      <rect x="20" y="123" width="9" height="3" fill="#2a1a0a" />
      <rect x="30" y="123" width="9" height="3" fill="#2a1a0a" />
      <rect x="60" y="123" width="9" height="3" fill="#2a1a0a" />
      <rect x="70" y="123" width="9" height="3" fill="#2a1a0a" />
      {/* Cuerpo del caballo */}
      <ellipse cx="48" cy="98" rx="28" ry="13" fill={c} stroke={cStroke} strokeWidth="0.6" />
      {/* Cola */}
      <path d="M 22 95 Q 12 92 16 108 Q 19 100 24 102" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Crin */}
      <path d="M 30 88 Q 28 92 30 95 M 35 86 Q 33 90 35 93 M 40 85 Q 38 89 40 92"
        stroke={cStroke} strokeWidth="0.6" fill="none" />
      {/* Cuello del caballo */}
      <path d="M 70 86 L 82 65 L 88 76 L 75 95 Z" fill={c} stroke={cStroke} strokeWidth="0.5" />
      {/* Cabeza del caballo */}
      <ellipse cx="86" cy="62" rx="9" ry="6" fill={c} stroke={cStroke} strokeWidth="0.5" />
      {/* Hocico */}
      <ellipse cx="93" cy="64" rx="2.5" ry="1.8" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Ojo del caballo */}
      <circle cx="86" cy="60" r="1" fill="#222" />
      {/* Oreja */}
      <path d="M 84 55 L 86 50 L 89 55 Z" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Crin del cuello */}
      <path d="M 75 78 Q 73 84 76 90 M 78 75 Q 76 81 79 87" stroke={cStroke} strokeWidth="0.6" fill="none" />
      {/* Silla */}
      <ellipse cx="50" cy="86" rx="12" ry="3" fill="#3a2410" />
      <ellipse cx="50" cy="85" rx="10" ry="2" fill="#8b5a2a" />
      {/* Estribos */}
      <line x1="42" y1="89" x2="40" y2="100" stroke="#3a2410" strokeWidth="0.8" />
      <line x1="58" y1="89" x2="60" y2="100" stroke="#3a2410" strokeWidth="0.8" />
      {/* Jinete — piernas */}
      <path d="M 42 84 L 40 100 L 45 100 L 47 84 Z" fill={c} />
      <path d="M 53 84 L 55 100 L 60 100 L 58 84 Z" fill={c} />
      {/* Bota */}
      <path d="M 39 96 L 38 102 L 47 102 L 47 96 Z" fill="#2a1a0a" />
      <path d="M 53 96 L 53 102 L 62 102 L 61 96 Z" fill="#2a1a0a" />
      {/* Capa del jinete */}
      <path d="M 42 60 Q 38 75 42 86 L 50 86 L 50 60 Z" fill={c} opacity="0.85" />
      {/* Torso del jinete */}
      <path d="M 45 60 Q 43 70 45 84 L 55 84 Q 57 70 55 60 Z" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Brazo del jinete sujetando las riendas */}
      <path d="M 56 62 Q 64 60 72 65" stroke={c} strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Riendas */}
      <path d="M 72 65 Q 78 64 82 64" stroke="#3a2410" strokeWidth="0.6" fill="none" />
      {/* Cabeza del jinete */}
      <ellipse cx="50" cy="48" rx="6" ry="7" fill="url(#grad-skin)" stroke="#8b6b4a" strokeWidth="0.4" />
      {/* Cabello */}
      <path d="M 44 46 Q 44 54 50 54 L 50 46 Z" fill="#3a2410" />
      <path d="M 56 46 Q 56 54 50 54 L 50 46 Z" fill="#3a2410" />
      {/* Cara */}
      <circle cx="48" cy="48" r="0.8" fill="#222" />
      <circle cx="52" cy="48" r="0.8" fill="#222" />
      <path d="M 50 50 L 49.5 52 L 50.5 52 Z" fill="#c89870" />
      {/* Tocado del jinete (sombrero más pequeño) */}
      <ellipse cx="50" cy="40" rx="11" ry="2.5" fill={c} stroke={cStroke} strokeWidth="0.4" />
      <path d="M 44 40 Q 50 33 56 40 L 54 40 Q 50 36 46 40 Z" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Pluma */}
      <path d="M 56 36 Q 64 32 62 42 Q 59 38 57 40" fill={c} stroke={cStroke} strokeWidth="0.3" />
    </FigureBase>
  );
}

/* ============================
   REY — sentado en trono, con corona, cetro y orbe
   ============================ */
function ReyFigure({ suit }: { suit: Suit }) {
  const c = `url(#grad-${suit}-main)`;
  const cStroke = `var(--card-${suit}-dark)`;
  return (
    <FigureBase suit={suit}>
      {/* Sombra */}
      <ellipse cx="50" cy="135" rx="32" ry="3" fill="rgba(0,0,0,0.18)" />
      {/* Trono: respaldo */}
      <rect x="24" y="50" width="4" height="80" fill="#8b5a2a" />
      <rect x="72" y="50" width="4" height="80" fill="#8b5a2a" />
      <path d="M 26 50 L 74 50 L 74 60 L 26 60 Z" fill="#a86a32" stroke="#5a3a1a" strokeWidth="0.5" />
      {/* Adornos del trono */}
      <circle cx="28" cy="55" r="1.5" fill="#e8c46b" />
      <circle cx="50" cy="55" r="1.5" fill="#e8c46b" />
      <circle cx="72" cy="55" r="1.5" fill="#e8c46b" />
      {/* Asiento */}
      <rect x="22" y="100" width="56" height="6" fill="#8b5a2a" stroke="#5a3a1a" strokeWidth="0.4" />
      {/* Piernas (sentadas, hacia delante) */}
      <path d="M 35 100 L 32 130 L 44 130 L 47 100 Z" fill={c} stroke={cStroke} strokeWidth="0.4" />
      <path d="M 53 100 L 56 130 L 68 130 L 65 100 Z" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Bota con punta */}
      <path d="M 30 128 L 28 132 L 46 132 L 46 128 Z" fill="#2a1a0a" />
      <path d="M 54 128 L 54 132 L 70 132 L 68 128 Z" fill="#2a1a0a" />
      {/* Capa real (detrás) */}
      <path d="M 28 50 Q 18 80 26 110 L 32 110 Q 30 78 36 55 Z" fill={c} opacity="0.85" />
      {/* Túnica principal */}
      <path
        d="M 32 55 Q 30 80 32 105 L 68 105 Q 70 80 68 55 Q 50 60 32 55 Z"
        fill={c}
        stroke={cStroke}
        strokeWidth="0.6"
      />
      {/* Pliegues */}
      <path d="M 42 60 Q 40 80 42 100" stroke={cStroke} strokeWidth="0.4" fill="none" opacity="0.5" />
      <path d="M 58 60 Q 60 80 58 100" stroke={cStroke} strokeWidth="0.4" fill="none" opacity="0.5" />
      {/* Banda del pecho */}
      <path d="M 38 60 L 38 100 L 42 100 L 42 60 Z" fill="#e8c46b" opacity="0.5" />
      {/* Cinturón */}
      <rect x="32" y="92" width="36" height="4" fill="#3a2410" />
      <rect x="48" y="91" width="4" height="6" fill="#e8c46b" />
      {/* Brazo izquierdo (con cetro) */}
      <path d="M 30 60 Q 22 70 22 90 L 26 92 Q 28 72 34 64 Z" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Cetro */}
      <line x1="20" y1="68" x2="14" y2="100" stroke="#e8c46b" strokeWidth="1.5" />
      <circle cx="14" cy="100" r="2.5" fill="#e8c46b" stroke="#a06a20" strokeWidth="0.4" />
      <circle cx="20" cy="68" r="1.5" fill="#c0392b" />
      {/* Brazo derecho (apoyado en trono o en cetro del orbe) */}
      <path d="M 70 60 Q 78 65 80 80 L 76 82 Q 72 70 66 64 Z" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Orbe (globo) */}
      <circle cx="78" cy="80" r="5" fill="#e8c46b" stroke="#a06a20" strokeWidth="0.6" />
      <path d="M 75 78 L 75 82 L 81 82 L 81 78 Z" fill="#c0392b" />
      <path d="M 78 75 L 78 85" stroke="#a06a20" strokeWidth="0.4" />
      <path d="M 73 80 L 83 80" stroke="#a06a20" strokeWidth="0.4" />
      {/* Cuello alto */}
      <path d="M 42 50 L 42 56 L 58 56 L 58 50 Z" fill="#f5f0e1" />
      <path d="M 43 51 L 43 55 L 57 55 L 57 51 Z" fill="none" stroke="#888" strokeWidth="0.3" />
      {/* Cabeza */}
      <ellipse cx="50" cy="40" rx="9" ry="11" fill="url(#grad-skin)" stroke="#8b6b4a" strokeWidth="0.4" />
      {/* Barba (símbolo de rey sabio) */}
      <path d="M 44 47 Q 50 56 56 47 L 56 50 Q 50 58 44 50 Z" fill="#e0e0e0" stroke="#888" strokeWidth="0.3" />
      {/* Cabello / patillas */}
      <path d="M 41 38 Q 41 48 47 48 L 47 38 Z" fill="#3a2410" />
      <path d="M 59 38 Q 59 48 53 48 L 53 38 Z" fill="#3a2410" />
      {/* Cara: ojos, nariz, boca */}
      <ellipse cx="46" cy="40" rx="0.9" ry="1.2" fill="#222" />
      <ellipse cx="54" cy="40" rx="0.9" ry="1.2" fill="#222" />
      <path d="M 50 42 L 49 45 L 51 45 Z" fill="#c89870" />
      <path d="M 47 46 Q 50 47 53 46" stroke="#8b3030" strokeWidth="0.6" fill="none" />
      {/* Corona */}
      <path
        d="M 38 32 L 41 22 L 45 30 L 50 18 L 55 30 L 59 22 L 62 32 Z"
        fill={c}
        stroke={cStroke}
        strokeWidth="0.5"
      />
      <rect x="38" y="30" width="24" height="4" fill={c} stroke={cStroke} strokeWidth="0.4" />
      {/* Gemas de la corona */}
      <circle cx="41" cy="25" r="1.4" fill="#c0392b" />
      <circle cx="50" cy="22" r="1.6" fill="#e8c46b" />
      <circle cx="59" cy="25" r="1.4" fill="#1e3a8a" />
      {/* Cinta de la corona */}
      <circle cx="42" cy="32" r="0.8" fill="#e8c46b" />
      <circle cx="50" cy="32" r="0.8" fill="#e8c46b" />
      <circle cx="58" cy="32" r="0.8" fill="#e8c46b" />
    </FigureBase>
  );
}
