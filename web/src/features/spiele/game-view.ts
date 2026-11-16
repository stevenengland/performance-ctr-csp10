import type { DeepReadonly } from 'vue';
import type { Game } from '../../core/api-client';
import { messages } from '../../core/messages';

function kindLabel(kind: Game['kind']): string {
  return kind === 'duel' ? messages.spiele.duel : messages.spiele.points;
}

/** The game's setting in Verwalten → Spiele: `Duell · Remis möglich`. */
export function settingLine(game: DeepReadonly<Game>): string {
  const setting =
    game.kind === 'duel'
      ? game.drawsAllowed
        ? messages.spiele.drawsAllowed
        : messages.spiele.noDraws
      : game.lowerWins
        ? messages.spiele.lowerWins
        : messages.spiele.higherWins;
  return messages.spiele.setting(kindLabel(game.kind), setting);
}
