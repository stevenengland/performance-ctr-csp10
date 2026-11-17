<script setup lang="ts">
import { mdiDeleteOutline } from '@mdi/js';
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import {
  ApiProblem,
  deleteEntry,
  listEntries,
  type HistoryEntry,
  type TimeWindow,
} from '../../core/api-client';
import { loadPersons, usePersons } from '../../core/catalog';
import { todayFrom } from '../../core/day-window';
import { messages } from '../../core/messages';
import {
  calendarDateOf,
  contextLine,
  isToday,
  type Period,
  periodKey,
  queryOf,
} from '../../core/period';
import { refreshScoreboard } from '../../core/scoreboard-feed';
import { showProblem, showSnackbar } from '../../core/snackbar';
import { useToday } from '../../core/today';
import { provideTopBar } from '../../core/top-bar';
import { dayOfTag, historyRows, type HistoryRow } from './history';

/**
Verlauf (§7g): a person's entries of a day, newest first, those that wait for
verification marked `offen`, each deletable behind the confirmation dialog (§6.9).
The day is today (since local midnight), or the past day `?tag=2026-11-14` that a
place on the Rangliste opens while that day is shown, held as its calendar date.
A deletion reaches the counters and the Rangliste through the scoreboard feed.
*/
const props = defineProps<{ personId: string }>();
const SKELETON_ROWS = 3;
const NOT_FOUND = 404;

const router = useRouter();
const route = useRoute();
const today = useToday();
const todayDate = computed(() => calendarDateOf(today.value));
const day = computed<Extract<Period, { kind: 'day' }>>(() => ({
  kind: 'day',
  date: dayOfTag(route.query.tag, todayDate.value),
}));
const showsToday = computed(() => isToday(day.value, todayDate.value));
const persons = usePersons();
const personId = computed(() => Number(props.personId));
const person = computed(() =>
  persons.value?.find((candidate) => candidate.id === personId.value),
);
const entries = shallowRef<HistoryEntry[]>();
const rows = computed(() =>
  entries.value ? historyRows(entries.value) : undefined,
);

const confirming = ref(false);
const removing = shallowRef<HistoryRow>();
const busy = ref(false);

provideTopBar(() => ({
  title: person.value?.name,
  context: contextLine(day.value, todayDate.value),
}));

/** The person was deleted (on another phone): back to the Rangliste (§4, §9). */
function leaveGone() {
  void router.replace('/rangliste');
  showSnackbar({ text: messages.zaehlen.gone });
}

/** Today's entries since local midnight, as before; a past day's window is built from its date for each read. */
function windowOfDay(): TimeWindow {
  return showsToday.value ? { from: todayFrom() } : queryOf(day.value);
}

/** Reads the shown day's entries; an answer for a day no longer shown is dropped. */
async function load() {
  const shown = periodKey(day.value);
  const answer = await listEntries(personId.value, windowOfDay());
  if (periodKey(day.value) === shown) entries.value = answer;
}

function ask(row: HistoryRow) {
  removing.value = row;
  confirming.value = true;
}

/** Deletes the entry; one already deleted elsewhere counts as deleted. */
async function confirm() {
  const row = removing.value;
  if (!row || busy.value) return;
  busy.value = true;
  try {
    await deleteEntry(row.id).catch((failure: unknown) => {
      if (!(failure instanceof ApiProblem && failure.status === NOT_FOUND)) {
        throw failure;
      }
    });
    confirming.value = false;
    showSnackbar({ text: messages.verlauf.removed });
    await Promise.all([load(), refreshScoreboard()]);
  } catch (failure) {
    showProblem(failure);
  } finally {
    busy.value = false;
  }
}

/** A read failed: a missing person leads back, anything else is shown. */
function readFailed(failure: unknown) {
  if (failure instanceof ApiProblem && failure.status === NOT_FOUND) {
    leaveGone();
  } else {
    showProblem(failure);
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadPersons(), load()]);
    if (!person.value) leaveGone();
  } catch (failure) {
    readFailed(failure);
  }
});

/** Today's entries are read anew when the page is used after midnight; a past day stays. */
watch(
  () => periodKey(day.value),
  () => {
    load().catch(readFailed);
  },
);
</script>

<template>
  <section>
    <ul v-if="rows === undefined" class="list" aria-busy="true">
      <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
        <span class="skeleton" />
      </li>
    </ul>
    <p v-else-if="rows.length === 0" class="type-body empty-state">
      {{ showsToday ? messages.verlauf.empty : messages.verlauf.emptyThatDay }}
    </p>
    <ul
      v-else
      class="list"
      :aria-label="messages.verlauf.list(person?.name ?? '')"
    >
      <li v-for="row in rows" :key="row.id" class="list__row" data-test="entry">
        <span class="list__main">
          <span class="type-row-title list__title">{{ row.title }}</span>
          <span class="type-support list__support">{{ row.details }}</span>
        </span>
        <span
          v-if="row.pending"
          class="assist-chip type-caption"
          data-test="pending"
          >{{ row.pending }}</span
        >
        <v-btn
          :icon="mdiDeleteOutline"
          :aria-label="row.removeLabel"
          variant="text"
          @click="ask(row)"
        />
      </li>
    </ul>
    <ConfirmDialog
      v-model="confirming"
      :title="messages.verlauf.removeTitle"
      :body="removing?.removeBody ?? ''"
      :action="messages.remove.confirm"
      :busy="busy"
      @confirm="confirm"
    />
  </section>
</template>
