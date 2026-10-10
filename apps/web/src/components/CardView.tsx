import type { Card } from '@guinote/engine';

interface Props {
  card: Card;
  faceDown?: boolean;
  small?: boolean;
}

/**
 * Formato de los sprites: `{rank zero-padded}-{suit}.png` (p.ej. `01-oros.png`,
 * `12-bastos.png`). El dorso es `reverso.png`. El motor solo usa ranks 1-7 y
 * 10-12, pero los sprites 08 y 09 también están en el directorio por si se
 * amplia el juego.
 */
function spriteFileName(rank: number, suit: string): string {
  return `${String(rank).padStart(2, '0')}-${suit}`;
}

export function CardView({ card, faceDown, small }: Props) {
  const fileName = faceDown
    ? 'reverso'
    : spriteFileName(card.rank, card.suit);
  return (
    <img
      className={`card-img ${small ? 'small' : ''}`}
      src={`/cards/sprite/${fileName}.png`}
      alt={faceDown ? 'carta boca abajo' : `${card.rank} de ${card.suit}`}
      draggable={false}
    />
  );
}
