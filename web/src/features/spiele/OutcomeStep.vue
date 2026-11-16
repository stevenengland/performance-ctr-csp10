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
import { backToFirstStepFrom, leaveGone, matchSaver } from './game-flow';
import { matchPath, outcomeText } from './game-view';

/**
Duel step 3 — Ergebnis (§7p): `Anna gewinnt`, `Remis` (raspberry, only while the
game allows draws) and `Ben gewinnt`. The tap saves, like the factor step: the
tapped tile turns amber while the others wait; without an answer the step stays,
its tiles enabled again. Offline, nothing can be saved.
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
const saver = matchSaver(gameId.value);
const saving = ref<Outcome>();
const ready = computed(
  () => online.value && game.value && first.value && second.value,
);

const choices = computed<{ outcome: Outcome; name: string }[]>(() => {
  if (!first.value || !second.value) return [];
  const draw = { outcome: 'draw' as const, name: messages.spiele.draw };
  return [
    { outcome: 'first', name: messages.spiele.wins(first.value.name) },
    ...(game.value?.drawsAllowed ? [draw] : []),
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
  if (saving.value || !first.value || !second.value) return;
  saving.value = outcome;
  await saver.save(
    {
      gameId: gameId.value,
      firstPersonId: first.value.id,
      secondPersonId: second.value.id,
      outcome,
    },
    messages.spiele.savedMatch(
      messages.spiele.pairing(first.value.name, second.value.name),
      outcomeText(outcome, first.value.name, second.value.name),
    ),
    backToFirstStepFrom(router, matchPath(gameId.value)),
  );
  saving.value = undefined;
}

/** Disabled offline, and while another outcome is being saved. */
function disabled(outcome: Outcome): boolean {
  return (
    !ready.value || (saving.value !== undefined && saving.value !== outcome)
  );
}

onMounted(async () => {
  try {
    await Promise.all([loadPersons(), loadGames()]);
    const gone = game.value?.kind !== 'duel' || !first.value || !second.value;
    if (gone) leaveGone(router);
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
/* One column, like the factor step (§7e); a phone's width on wide windows. */
.outcome-list {
  display: grid;
  gap: 12px;
  max-width: 480px;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
