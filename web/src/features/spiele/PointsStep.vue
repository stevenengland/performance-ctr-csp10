<script setup lang="ts">
import { mdiBackspaceOutline } from '@mdi/js';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { loadPersons, usePersons } from '../../core/catalog';
import { formatSigned } from '../../core/format';
import { loadGames, useGames, useStandings } from '../../core/games';
import { messages } from '../../core/messages';
import { useOnline } from '../../core/online';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { backToFirstStepFrom, leaveGone, saveRecording } from './game-flow';
import { gameStandings, recordPath } from './game-view';

/**
Points step 2 — Punkte (draft): the app's own number pad, because phone number
pads have no minus key. Up to four digits and a sign (−9 999 to 9 999), shown large;
`Speichern` saves and goes back to the person step for the next player.
*/
const props = defineProps<{ gameId: string; personId: string }>();
const MAX_DIGITS = 4;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const router = useRouter();
const online = useOnline();
const persons = usePersons();
const games = useGames();
const gameId = computed(() => Number(props.gameId));
const game = computed(() =>
  games.value?.find((candidate) => candidate.id === gameId.value),
);
const person = computed(() =>
  persons.value?.find((candidate) => candidate.id === Number(props.personId)),
);
const feed = useStandings(gameId.value);
const current = computed(() =>
  feed.value.value
    ? gameStandings(feed.value.value).find(
        (standing) => standing.personId === person.value?.id,
      )
    : undefined,
);

const digits = ref('');
const negative = ref(false);
const saving = ref(false);
const value = computed(() =>
  digits.value === ''
    ? undefined
    : (negative.value ? -1 : 1) * Number(digits.value),
);
const shown = computed(() => {
  if (value.value === undefined) return negative.value ? '−' : '0';
  return negative.value && value.value === 0 ? '−0' : formatSigned(value.value);
});

provideTopBar(() => ({
  title: game.value?.name,
  context: person.value?.name,
}));

function type(digit: number) {
  if (digits.value.length >= MAX_DIGITS) return;
  digits.value =
    digits.value === '0' ? String(digit) : digits.value + String(digit);
}

function erase() {
  if (digits.value === '') negative.value = false;
  digits.value = digits.value.slice(0, -1);
}

async function save() {
  const points = value.value;
  const chosen = game.value;
  if (saving.value || points === undefined || !chosen || !person.value) return;
  saving.value = true;
  await saveRecording(
    {
      kind: 'result',
      body: { gameId: chosen.id, personId: person.value.id, points },
    },
    messages.spiele.savedResult(
      person.value.name,
      messages.spiele.sumPoints(formatSigned(points), points),
    ),
    backToFirstStepFrom(router, recordPath(chosen)),
  );
  saving.value = false;
}

/** A keyboard works too (the preview on a laptop). */
function onKey(event: KeyboardEvent) {
  if (/^\d$/.test(event.key)) type(Number(event.key));
  else if (event.key === 'Backspace') erase();
  else if (event.key === '-') negative.value = !negative.value;
  else if (event.key === 'Enter') void save();
  else return;
  event.preventDefault();
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  try {
    await Promise.all([loadPersons(), loadGames()]);
    if (!game.value || !person.value || game.value.kind !== 'points') {
      leaveGone(router);
    }
  } catch (failure) {
    showProblem(failure);
  }
});
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <section class="points-step">
    <h2 class="type-question page-question">
      {{ messages.spiele.pointsQuestion }}
    </h2>
    <p class="points-step__display">
      <output class="points-step__value" aria-live="polite">{{ shown }}</output>
      <span class="type-support points-step__caption">{{
        current
          ? messages.spiele.soFar(current.valueText)
          : messages.spiele.noResults
      }}</span>
    </p>
    <div class="points-pad">
      <button
        v-for="digit in DIGITS"
        :key="digit"
        type="button"
        class="tile points-pad__key"
        :aria-label="messages.spiele.digit(digit)"
        @click="type(digit)"
      >
        {{ digit }}
      </button>
      <button
        type="button"
        class="tile points-pad__key"
        :class="{ 'tile--pressed': negative }"
        :aria-label="messages.spiele.sign"
        :aria-pressed="negative"
        @click="negative = !negative"
      >
        ±
      </button>
      <button
        type="button"
        class="tile points-pad__key"
        :aria-label="messages.spiele.digit(0)"
        @click="type(0)"
      >
        0
      </button>
      <button
        type="button"
        class="tile points-pad__key"
        :aria-label="messages.spiele.erase"
        @click="erase"
      >
        <v-icon :icon="mdiBackspaceOutline" size="32" />
      </button>
    </div>
    <v-btn
      block
      size="x-large"
      variant="flat"
      color="primary"
      rounded="0"
      class="dialog-button type-row-title"
      :disabled="!online || value === undefined || !person"
      :loading="saving"
      @click="save"
    >
      {{ messages.spiele.save }}
    </v-btn>
  </section>
</template>

<style scoped>
/* Wider windows only widen grids (§5): the pad keeps its phone width. */
.points-step {
  max-width: 480px;
}

.points-step__display {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 4px 0 16px;
}

.points-step__value {
  font-family: var(--font-display);
  font-size: 96px;
  font-weight: 900;
  line-height: 92px;
  font-variant-numeric: tabular-nums;
}

.points-step__caption {
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface-variant));
}

.points-pad {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}

.points-pad__key {
  align-items: center;
  justify-content: center;
  min-height: 64px;
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 900;
  line-height: 36px;
}
</style>
