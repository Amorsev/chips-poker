import { cardLabel, isRedSuit, SUIT_SYMBOL } from '../lib/format';

interface PlayingCardProps {
  card?: string;
  hidden?: boolean;
  small?: boolean;
  delay?: number;
  muted?: boolean;
}

export function PlayingCard({ card, hidden = false, small = false, delay = 0, muted = false }: PlayingCardProps) {
  if (hidden || !card) {
    return (
      <div
        className={`playing-card card-back ${small ? 'is-small' : ''} ${muted ? 'is-muted' : ''}`}
        style={{ animationDelay: `${delay}ms` }}
      >
        <span className="card-back-pattern">♠</span>
      </div>
    );
  }

  const { rank, suit } = cardLabel(card);
  return (
    <div
      className={`playing-card ${small ? 'is-small' : ''} ${isRedSuit(card) ? 'is-red' : ''} ${
        muted ? 'is-muted' : ''
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="card-corner">
        <b>{rank}</b>
        <i>{SUIT_SYMBOL[suit]}</i>
      </span>
      <span className="card-suit">{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}

export function CardRow({
  cards,
  hiddenCount = 0,
  small = false,
  muted = false
}: {
  cards: string[];
  hiddenCount?: number;
  small?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`card-row ${small ? 'is-small' : ''}`}>
      {cards.map((card, index) => (
        <PlayingCard key={`${card}-${index}`} card={card} small={small} delay={index * 55} muted={muted} />
      ))}
      {Array.from({ length: hiddenCount }).map((_, index) => (
        <PlayingCard key={`hidden-${index}`} hidden small={small} delay={(cards.length + index) * 55} />
      ))}
    </div>
  );
}
