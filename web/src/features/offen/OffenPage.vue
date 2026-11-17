<script setup lang="ts">
import {
  computed,
  reactive,
  ref,
  shallowRef,
  watch,
  type DeepReadonly,
} from 'vue';
import {
  ApiProblem,
  listPending,
  rejectEntry,
  rejectMatch,
  rejectResult,
  verifyEntry,
  verifyMatch,
  verifyResult,
  type PendingItem,
} from '../../core/api-client';
import { formatTime } from '../../core/format';
import { messages } from '../../core/messages';
import { useOnline } from '../../core/online';
import { refreshPending, usePendingQueue } from '../../core/pending-queue';
import { refreshScoreboard } from '../../core/scoreboard-feed';
import { showProblem, showSnackbar } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { pendingRows, type PendingRow } from './pending-rows';

/**
Offen (§7s): the rows the signed-in account may verify, of every day, newest
first. The first page is the polled queue that also feeds the badge; `Ältere
laden` appends the pages after it, and a new first page reads the appended
rows again from where it ends, so they stay shown. `Bestätigen`
and `Ablehnen` remove the row; one that is gone already (404), or verified
already when rejecting it (409), counts as handled; a refusal (403) or any
other failure is shown and the row stays. Offline, nothing can be verified or
rejected, like saving. While the latest refresh of the queue failed, the top
bar shows when it was last confirmed (§6.6).
*/
const SKELETON_ROWS = 3;

type Decision = 'verify' | 'reject';

/** How each decision is sent for each kind of row, which answers mean "already handled", and what no answer says. */
const DECISIONS: Record<
  Decision,
  {
    send: Record<PendingItem['kind'], (id: string) => Promise<void>>;
    handled: readonly number[];
    unanswered: string;
  }
> = {
  verify: {
    send: { entry: verifyEntry, match: verifyMatch, result: verifyResult },
    handled: [404],
    unanswered: messages.offen.notVerified,
  },
  reject: {
    send: { entry: rejectEntry, match: rejectMatch, result: rejectResult },
    handled: [404, 409],
    unanswered: messages.offen.notRejected,
  },
};

const online = useOnline();
const queue = usePendingQueue();
/** Pages after the first, loaded with `Ältere laden`, and where the next one starts. */
const older = shallowRef<readonly DeepReadonly<PendingItem>[]>([]);
const olderNext = shallowRef<string | null>();
/** Older pages being loaded or read again. */
const readsUnderWay = ref(0);
/** Counts the first pages seen and the loads begun: a read that a newer one overtook is dropped. */
let generation = 0;
/** Rows verified or rejected (or found handled) here, hidden while the lists still show them. */
const handled = reactive(new Set<string>());
/** The decision under way per row. */
const deciding = reactive(new Map<string, Decision>());

const first = computed(() => queue.value.page);
const next = computed(() =>
  olderNext.value === undefined ? first.value?.next : olderNext.value,
);
const rows = computed(() => {
  if (!first.value) return undefined;
  const items = [...first.value.items, ...older.value];
  return pendingRows(items.filter(({ id }) => !handled.has(id)));
});

provideTopBar(() => {
  const { stale, updatedAt } = queue.value;
  return {
    stale:
      stale && updatedAt ? messages.stand(formatTime(updatedAt)) : undefined,
  };
});

/** Forgets the handled rows that neither list shows any more. */
function forgetHandledGone() {
  const shown = new Set(
    [...(first.value?.items ?? []), ...older.value].map(({ id }) => id),
  );
  for (const id of handled) if (!shown.has(id)) handled.delete(id);
}

/**
Reads the older pages, from `cursor` on, until at least `wanted` rows or the
end; undefined if a newer read overtook this one meanwhile.
*/
async function readOlder(
  cursor: string | null | undefined,
  wanted: number,
  read: number,
) {
  const items: PendingItem[] = [];
  let from = cursor;
  readsUnderWay.value += 1;
  try {
    while (from && items.length < wanted) {
      const page = await listPending(from);
      if (read !== generation) return undefined;
      items.push(...page.items);
      from = page.next;
    }
    return { items, next: from ?? null };
  } finally {
    readsUnderWay.value -= 1;
  }
}

/**
A new first page reads the loaded older rows again from where it ends, so rows
handled or recorded meanwhile neither hide nor drop the others. If that read
fails, the rows shown stay; acting on one gone meanwhile counts as handled.
*/
watch(first, async (page) => {
  generation += 1;
  const read = generation;
  const wanted = older.value.length;
  if (!page || wanted === 0) {
    older.value = [];
    olderNext.value = undefined;
    forgetHandledGone();
    return;
  }
  try {
    const again = await readOlder(page.next, wanted, read);
    if (!again) return;
    const onFirst = new Set(page.items.map(({ id }) => id));
    older.value = again.items.filter(({ id }) => !onFirst.has(id));
    olderNext.value = again.next;
    forgetHandledGone();
  } catch {
    // The rows shown stay until the next first page reads them again.
  }
});

async function loadOlder() {
  const cursor = next.value;
  if (!cursor || readsUnderWay.value > 0) return;
  generation += 1;
  try {
    const page = await readOlder(cursor, 1, generation);
    if (!page) return;
    older.value = [...older.value, ...page.items];
    olderNext.value = page.next;
  } catch (failure) {
    showProblem(failure);
  }
}

/** Whether the row is off this account's queue now: the decision was made, or the row was handled already. */
async function decided(row: PendingRow, decision: Decision): Promise<boolean> {
  const { send, handled: alreadyHandled, unanswered } = DECISIONS[decision];
  try {
    await send[row.kind](row.id);
    return true;
  } catch (failure) {
    if (!(failure instanceof ApiProblem)) {
      showSnackbar({ text: unanswered });
      return false;
    }
    if (alreadyHandled.includes(failure.status)) return true;
    showProblem(failure);
    return false;
  }
}

async function decide(row: PendingRow, decision: Decision) {
  if (!online.value || deciding.has(row.id)) return;
  deciding.set(row.id, decision);
  try {
    if (await decided(row, decision)) {
      handled.add(row.id);
      await Promise.all([refreshPending(), refreshScoreboard()]);
    }
  } finally {
    deciding.delete(row.id);
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
          variant="text"
          class="dialog-button type-row-title"
          :aria-label="row.rejectLabel"
          :disabled="!online || deciding.get(row.id) === 'verify'"
          :loading="deciding.get(row.id) === 'reject'"
          @click="decide(row, 'reject')"
        >
          {{ messages.offen.reject }}
        </v-btn>
        <v-btn
          variant="tonal"
          class="dialog-button type-row-title"
          :aria-label="row.verifyLabel"
          :disabled="!online || deciding.get(row.id) === 'reject'"
          :loading="deciding.get(row.id) === 'verify'"
          @click="decide(row, 'verify')"
        >
          {{ messages.offen.verify }}
        </v-btn>
      </li>
    </ul>
    <v-btn
      v-if="rows && next"
      class="dialog-button offen__more"
      variant="tonal"
      :loading="readsUnderWay > 0"
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
