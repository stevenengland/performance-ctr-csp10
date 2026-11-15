<script setup lang="ts">
import { mdiDeleteOutline } from '@mdi/js';
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import {
  ApiProblem,
  deleteEntry,
  listEntries,
  type HistoryEntry,
} from '../../core/api-client';
import { loadPersons, usePersons } from '../../core/catalog';
import { todayFrom } from '../../core/day-window';
import { messages } from '../../core/messages';
import { refreshScoreboard } from '../../core/scoreboard-feed';
import { showProblem, showSnackbar } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { historyRows, type HistoryRow } from './history';

/**
Verlauf · Heute (§7g): a person's entries since local midnight, newest first, each
deletable behind the confirmation dialog (§6.9). A deletion reaches the counters
and the Rangliste through the scoreboard feed.
*/
const props = defineProps<{ personId: string }>();
const SKELETON_ROWS = 3;
const NOT_FOUND = 404;

const router = useRouter();
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

provideTopBar(() => ({ title: person.value?.name }));

/** The person was deleted (on another phone): back to the Rangliste (§4, §9). */
function leaveGone() {
  void router.replace('/rangliste');
  showSnackbar({ text: messages.zaehlen.gone });
}

async function load() {
  entries.value = await listEntries(personId.value, todayFrom());
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

onMounted(async () => {
  try {
    await Promise.all([loadPersons(), load()]);
    if (!person.value) leaveGone();
  } catch (failure) {
    if (failure instanceof ApiProblem && failure.status === NOT_FOUND) {
      leaveGone();
    } else {
      showProblem(failure);
    }
  }
});
</script>

<template>
  <section>
    <ul v-if="rows === undefined" class="list" aria-busy="true">
      <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
        <span class="skeleton" />
      </li>
    </ul>
    <p v-else-if="rows.length === 0" class="type-body empty-state">
      {{ messages.verlauf.empty }}
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
