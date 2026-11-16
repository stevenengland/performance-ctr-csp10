<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import {
  ApiProblem,
  listPending,
  verifyEntry,
  type PendingItem,
} from '../../core/api-client';
import { messages } from '../../core/messages';
import { useOnline } from '../../core/online';
import { refreshPending, usePendingQueue } from '../../core/pending-queue';
import { refreshScoreboard } from '../../core/scoreboard-feed';
import { showProblem, showSnackbar } from '../../core/snackbar';
import { pendingRows, type PendingRow } from './pending-rows';

/**
Offen (§7s): the rows the signed-in account may verify, of every day, newest
first. The first page is the polled queue that also feeds the badge; `Ältere
laden` appends the pages after it until the first page changes. `Bestätigen`
removes the row; one that is gone already (404) counts as handled, a refusal
(403) or any other failure is shown and the row stays. Offline, nothing can be
verified, like saving.
*/
const SKELETON_ROWS = 3;
const NOT_FOUND = 404;

const online = useOnline();
const queue = usePendingQueue();
/** Pages after the first, loaded with `Ältere laden`, and where the next one starts. */
const older = shallowRef<PendingItem[]>([]);
const olderNext = shallowRef<string | null>();
const loadingOlder = ref(false);
/** Rows verified (or found gone) here, hidden until the queue answers without them. */
const handled = reactive(new Set<string>());
const verifying = reactive(new Set<string>());

const first = computed(() => queue.value.page);
const next = computed(() =>
  olderNext.value === undefined ? first.value?.next : olderNext.value,
);
const rows = computed(() => {
  if (!first.value) return undefined;
  const items = [...first.value.items, ...older.value];
  return pendingRows(items.filter(({ id }) => !handled.has(id)));
});

/** A new first page starts the list anew: what was appended may have moved. */
watch(first, () => {
  older.value = [];
  olderNext.value = undefined;
  handled.clear();
});

async function loadOlder() {
  const cursor = next.value;
  if (!cursor || loadingOlder.value) return;
  loadingOlder.value = true;
  try {
    const page = await listPending(cursor);
    older.value = [...older.value, ...page.items];
    olderNext.value = page.next;
  } catch (failure) {
    showProblem(failure);
  } finally {
    loadingOlder.value = false;
  }
}

/** Whether the server holds the row as verified now: it said so, or the row is gone. */
async function verified(row: PendingRow): Promise<boolean> {
  try {
    await verifyEntry(row.id);
    return true;
  } catch (failure) {
    if (failure instanceof ApiProblem && failure.status === NOT_FOUND) {
      return true;
    }
    if (failure instanceof ApiProblem) showProblem(failure);
    else showSnackbar({ text: messages.offen.notVerified });
    return false;
  }
}

async function verify(row: PendingRow) {
  if (!online.value || verifying.has(row.id)) return;
  verifying.add(row.id);
  try {
    if (await verified(row)) {
      handled.add(row.id);
      await Promise.all([refreshPending(), refreshScoreboard()]);
    }
  } finally {
    verifying.delete(row.id);
  }
}
</script>

<template>
  <section class="offen">
    <ul v-if="rows === undefined" class="list" aria-busy="true">
      <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
        <span class="skeleton" />
      </li>
    </ul>
    <p v-else-if="rows.length === 0" class="type-body empty-state">
      {{ messages.offen.empty }}
    </p>
    <ul v-else class="list" :aria-label="messages.offen.list">
      <li
        v-for="row in rows"
        :key="row.id"
        class="list__row"
        data-test="pending-row"
      >
        <span class="list__main">
          <span class="type-row-title list__title">{{ row.title }}</span>
          <span class="type-support list__support">{{ row.details }}</span>
        </span>
        <v-btn
          variant="tonal"
          class="dialog-button type-row-title"
          :aria-label="row.verifyLabel"
          :disabled="!online"
          :loading="verifying.has(row.id)"
          @click="verify(row)"
        >
          {{ messages.offen.verify }}
        </v-btn>
      </li>
    </ul>
    <v-btn
      v-if="rows && next"
      class="dialog-button offen__more"
      variant="tonal"
      :loading="loadingOlder"
      @click="loadOlder"
    >
      {{ messages.offen.more }}
    </v-btn>
  </section>
</template>

<style scoped>
.offen {
  padding-bottom: 24px;
}

.offen__more {
  display: flex;
  margin: 16px auto 0;
}
</style>
