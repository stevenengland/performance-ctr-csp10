<script setup lang="ts">
import { mdiBackspaceOutline } from '@mdi/js';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { loadPersons, usePersons } from '../../core/catalog';
import { formatNumber } from '../../core/format';
import { loadGames, useGames, useStandings } from '../../core/games';
import { messages } from '../../core/messages';
import { useOnline } from '../../core/online';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { backToFirstStepFrom, leaveGone, resultSaver } from './game-flow';
import { gameStandings, resultPath, resultText } from './game-view';

/**
Points step 2 — `Wie viele Punkte?` (§7q): the app's own number pad, because a
phone's number pad has no minus key. Up to four digits and a sign (−9 999 to
9 999), shown large; a keyboard works too. `Speichern` saves and returns to
`Für wen?` for the next player; offline, nothing can be saved.
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
const ranking = useStandings(gameId.value);
const soFar = computed(() => {
  const standing = ranking.value.value
    ? gameStandings(ranking.value.value).find(
        ({ personId }) => personId === person.value?.id,
      )
    : undefined;
  return standing
    ? messages.spiele.soFar(standing.valueText)
    : messages.spiele.noResults;
});
const saver = resultSaver(gameId.value);

const digits = ref('');
const negative = ref(false);
const saving = ref(false);
const points = computed(() =>
  digits.value === ''
    ? undefined
    : (negative.value ? -1 : 1) * Number(digits.value),
);
/** `0` before the first digit; the sign shows as soon as it is set (`−`, `−0`, `−20`). */
const shown = computed(() => {
  const sign = negative.value ? '−' : '';
  return digits.value === ''
    ? sign || '0'
    : sign + formatNumber(Number(digits.value));
});
const ready = computed(
  () => online.value && points.value !== undefined && person.value,
);

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

function toggleSign() {
  negative.value = !negative.value;
}

async function save() {
  const chosen = person.value;
  if (saving.value || !ready.value || points.value === undefined || !chosen) {
    return;
  }
  saving.value = true;
  await saver.save(
    { gameId: gameId.value, personId: chosen.id, points: points.value },
    resultText(chosen.name, points.value),
    backToFirstStepFrom(router, resultPath(gameId.value)),
  );
  saving.value = false;
}

const TEXT_FIELD =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const CONTROL = 'button, a[href], [role="button"], [role="link"], summary';

/**
Whether the focused element handles the key itself: a text field every key, any
other control Enter, which activates it (a pad key, a link, a snackbar action).
*/
function focusedHandles(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return (
    target.closest(TEXT_FIELD) !== null ||
    (event.key === 'Enter' && target.closest(CONTROL) !== null)
  );
}

/** A shortcut (Ctrl, Cmd, Alt: zoom, switching tabs) or a key an input method is composing is not typing. Shift is: some layouts need it for digits. */
function isTyping(event: KeyboardEvent): boolean {
  return !(event.ctrlKey || event.metaKey || event.altKey || event.isComposing);
}

/** A keyboard works too: digits, `-` for the sign, Backspace and Enter — unless the focused control takes the key or it is a shortcut. */
function onKey(event: KeyboardEvent) {
  if (!isTyping(event) || focusedHandles(event)) return;
  if (/^\d$/.test(event.key)) type(Number(event.key));
  else if (event.key === '-') toggleSign();
  else if (event.key === 'Backspace') erase();
  else if (event.key === 'Enter') void save();
  else return;
  event.preventDefault();
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  try {
    await Promise.all([loadPersons(), loadGames()]);
    if (game.value?.kind !== 'points' || !person.value) leaveGone(router);
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
      <span class="type-support points-step__caption">{{ soFar }}</span>
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
        @click="toggleSign"
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
      :disabled="!ready"
      :loading="saving"
      @click="save"
    >
      {{ messages.spiele.save }}
    </v-btn>
  </section>
</template>

<style scoped>
/* Wider windows only widen grids (§5): the pad keeps a phone's width. */
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
