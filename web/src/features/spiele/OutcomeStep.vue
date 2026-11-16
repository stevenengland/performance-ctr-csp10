<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import CountTile from '../../components/CountTile.vue';
import type { Outcome } from '../../core/api-client';
import { loadPersons, usePersons } from '../../core/catalog';
import { loadGames, useGames } from '../../core/games';
import { messages } from '../../core/messages';
import { useOnline } from '../../core/online';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { backToFirstStepFrom, leaveGone, saveRecording } from './game-flow';
import { outcomeText, recordPath } from './game-view';

/**
Duel step 3 — Ergebnis (draft): `Anna gewinnt`, `Remis` (only while the game
allows draws) and `Ben gewinnt`. The tap saves, like the factor step: the tapped
tile turns amber while the others wait; offline, nothing can be saved.
*/
const props = defineProps<{
  gameId: string;
  firstId: string;
  secondId: string;
}>();

const router = useRouter();
const online = useOnline();
const persons = usePersons();
const games = useGames();
const gameId = computed(() => Number(props.gameId));
const game = computed(() =>
  games.value?.find((candidate) => candidate.id === gameId.value),
);
const personOf = (id: string) =>
  persons.value?.find((candidate) => candidate.id === Number(id));
const first = computed(() => personOf(props.firstId));
const second = computed(() => personOf(props.secondId));
const saving = ref<Outcome>();
const ready = computed(
  () => online.value && game.value && first.value && second.value,
);

const choices = computed<{ outcome: Outcome; name: string }[]>(() => {
  if (!first.value || !second.value) return [];
  return [
    { outcome: 'first', name: messages.spiele.wins(first.value.name) },
    ...(game.value?.drawsAllowed
      ? [{ outcome: 'draw' as const, name: messages.spiele.draw }]
      : []),
    { outcome: 'second', name: messages.spiele.wins(second.value.name) },
  ];
});

provideTopBar(() => ({
  title: game.value?.name,
  context:
    first.value && second.value
      ? messages.spiele.pairing(first.value.name, second.value.name)
      : undefined,
}));

async function choose(outcome: Outcome) {
  const current = game.value;
  if (saving.value || !current || !first.value || !second.value) return;
  saving.value = outcome;
  const pairing = messages.spiele.pairing(first.value.name, second.value.name);
  await saveRecording(
    {
      kind: 'match',
      body: {
        gameId: current.id,
        firstPersonId: first.value.id,
        secondPersonId: second.value.id,
        outcome,
      },
    },
    messages.spiele.savedMatch(
      pairing,
      outcomeText(outcome, first.value.name, second.value.name),
    ),
    backToFirstStepFrom(router, recordPath(current)),
  );
  saving.value = undefined;
}

function disabled(outcome: Outcome): boolean {
  return (
    !ready.value || (saving.value !== undefined && saving.value !== outcome)
  );
}

onMounted(async () => {
  try {
    await Promise.all([loadPersons(), loadGames()]);
    if (!game.value || !first.value || !second.value) leaveGone(router);
  } catch (failure) {
    showProblem(failure);
  }
});
</script>

<template>
  <section>
    <h2 class="type-question page-question">
      {{ messages.spiele.outcomeQuestion }}
    </h2>
    <ul class="outcome-list">
      <li v-for="choice in choices" :key="choice.outcome">
        <CountTile
          :variant="choice.outcome === 'draw' ? 'factor' : 'plain'"
          :name="choice.name"
          :label="choice.name"
          :support="
            choice.outcome === 'draw'
              ? messages.spiele.drawSupport
              : messages.spiele.winSupport
          "
          :pressed="saving === choice.outcome"
          :disabled="disabled(choice.outcome)"
          @click="choose(choice.outcome)"
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* One column, a phone's width on wide windows (§7e). */
.outcome-list {
  display: grid;
  gap: 12px;
  max-width: 480px;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
