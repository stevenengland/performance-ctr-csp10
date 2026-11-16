<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import CountTile from '../../components/CountTile.vue';
import type { Game } from '../../core/api-client';
import { loadPersons, usePersons } from '../../core/catalog';
import { loadGames, useGames, useStandings } from '../../core/games';
import { messages } from '../../core/messages';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { leaveGone, step } from './game-flow';
import { gameStandings, recordPath, type GameStanding } from './game-view';

/**
Picking a person, one decision per screen: a duel's first player (`/partie`,
`Wer spielt?`, §7p), its second without the first (`/partie/:firstId`,
`Gegen wen?`), or the person of a points game's result (`/ergebnis`, `Für wen?`,
§7q). Each tile shows the person's standing in this game, kept current by the
game's shared poller while the step is open.
*/
const props = withDefaults(
  defineProps<{
    gameId: string;
    firstId?: string;
    /** The kind of game the route records for. */
    kind?: Game['kind'];
  }>(),
  { firstId: undefined, kind: 'duel' },
);
const SKELETON_TILES = 4;

const router = useRouter();
const persons = usePersons();
const games = useGames();
const gameId = computed(() => Number(props.gameId));
const game = computed(() =>
  games.value?.find((candidate) => candidate.id === gameId.value),
);
const ranking = useStandings(gameId.value);
const firstId = computed(() =>
  props.firstId === undefined ? undefined : Number(props.firstId),
);
const first = computed(() =>
  persons.value?.find((candidate) => candidate.id === firstId.value),
);
const choices = computed(() =>
  persons.value?.filter((person) => person.id !== firstId.value),
);
const standings = computed(() =>
  ranking.value.value ? gameStandings(ranking.value.value) : [],
);

const question = computed(() => {
  if (props.kind === 'points') return messages.spiele.personQuestion;
  return firstId.value === undefined
    ? messages.spiele.firstQuestion
    : messages.spiele.secondQuestion;
});

provideTopBar(() => ({
  title: game.value?.name,
  context:
    props.kind === 'points'
      ? messages.spiele.recordResult
      : first.value
        ? messages.spiele.pairing(first.value.name, '…')
        : messages.spiele.recordMatch,
}));

function standingOf(personId: number): GameStanding | undefined {
  return standings.value.find((standing) => standing.personId === personId);
}

function choose(personId: number) {
  const firstStep = recordPath({ id: gameId.value, kind: props.kind });
  if (firstId.value === undefined) {
    step(router, `${firstStep}/${String(personId)}`, firstStep);
  } else {
    step(router, `${firstStep}/${String(firstId.value)}/${String(personId)}`);
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadPersons(), loadGames()]);
    const gone =
      game.value?.kind !== props.kind ||
      (firstId.value !== undefined && !first.value);
    if (gone) leaveGone(router);
  } catch (failure) {
    showProblem(failure);
  }
});
</script>

<template>
  <section>
    <h2 class="type-question page-question">{{ question }}</h2>
    <ul v-if="choices === undefined" class="tile-grid" aria-busy="true">
      <li v-for="tile in SKELETON_TILES" :key="tile" class="skeleton-tile" />
    </ul>
    <ul v-else class="tile-grid">
      <li v-for="person in choices" :key="person.id">
        <CountTile
          variant="person"
          :name="person.name"
          :label="`${person.name}, ${standingOf(person.id)?.valueText ?? messages.zaehlen.nothingYet}`"
          :support="standingOf(person.id)?.short ?? messages.zaehlen.nothingYet"
          :numeral="standingOf(person.id)?.value"
          @click="choose(person.id)"
        />
      </li>
    </ul>
  </section>
</template>
