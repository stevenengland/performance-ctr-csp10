<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CountTile from '../../components/CountTile.vue';
import { loadPersons, usePersons } from '../../core/catalog';
import { loadGames, useGames, useStandings } from '../../core/games';
import { messages } from '../../core/messages';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { leaveGone, step } from './game-flow';
import { gameStandings, recordPath } from './game-view';

/**
Picking a person (draft), one decision per screen: a duel's first player
(`/partie`), its second player without the first (`/partie/:firstId`), or the
person of a points result (`/ergebnis`). Each tile shows the person's current
standing in this game.
*/
const props = defineProps<{ gameId: string; firstId?: string }>();
const SKELETON_TILES = 4;

const route = useRoute();
const router = useRouter();
const persons = usePersons();
const games = useGames();
const gameId = computed(() => Number(props.gameId));
const game = computed(() =>
  games.value?.find((candidate) => candidate.id === gameId.value),
);
const feed = useStandings(gameId.value);
const isDuel = computed(() => route.path.includes('/partie'));
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
  feed.value.value ? gameStandings(feed.value.value) : [],
);

const question = computed(() => {
  if (!isDuel.value) return messages.spiele.personQuestion;
  return firstId.value === undefined
    ? messages.spiele.firstQuestion
    : messages.spiele.secondQuestion;
});

provideTopBar(() => ({
  title: game.value?.name,
  context: isDuel.value
    ? first.value
      ? messages.spiele.pairing(first.value.name, '…')
      : messages.spiele.recordMatch
    : messages.spiele.recordResult,
}));

function standingOf(personId: number) {
  return standings.value.find((standing) => standing.personId === personId);
}

function choose(personId: number) {
  const current = game.value;
  if (!current) return;
  const firstStep = recordPath(current);
  if (isDuel.value && firstId.value !== undefined) {
    step(router, `${route.path}/${String(personId)}`);
  } else {
    step(router, `${firstStep}/${String(personId)}`, firstStep);
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadPersons(), loadGames()]);
    const gone =
      !game.value ||
      (firstId.value !== undefined && !first.value) ||
      (game.value.kind === 'duel') !== isDuel.value;
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
          :label="
            standingOf(person.id)
              ? `${person.name}, ${standingOf(person.id)?.valueText}`
              : `${person.name}, ${messages.zaehlen.nothingYet}`
          "
          :support="standingOf(person.id)?.short ?? messages.zaehlen.nothingYet"
          :numeral="standingOf(person.id)?.value"
          @click="choose(person.id)"
        />
      </li>
    </ul>
  </section>
</template>
