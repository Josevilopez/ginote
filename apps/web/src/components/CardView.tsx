import type { Card } from '@guinote/engine';

interface Props {
  card: Card;
  faceDown?: boolean;
  small?: boolean;
}

/**
 * Mapeo: rank → id de la imagen. Solo se usan 1-7, 10, 11, 12 en guiñote.
 */
const RANK_NAME: Record<number, string> = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  10: '10', 11: '11', 12: '12',
};

export function CardView({ card, faceDown, small }: Props) {
  const fileName = faceDown
    ? 'back'
    : `${card.suit}-${RANK_NAME[card.rank] ?? card.rank}`;
  return (
    <img
      className={`card-img ${small ? 'small' : ''}`}
      src={`/cards/sprite/${fileName}.png`}
      alt={faceDown ? 'carta boca abajo' : `${card.rank} de ${card.suit}`}
      draggable={false}
    />
  );
}
