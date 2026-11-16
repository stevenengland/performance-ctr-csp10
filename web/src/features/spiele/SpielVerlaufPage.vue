<script setup lang="ts">
import { mdiDeleteOutline } from '@mdi/js';
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import {
  ApiProblem,
  deleteMatch,
  deleteResult,
  listMatches,
  listResults,
} from '../../core/api-client';
import { loadGames, refreshStandings, useGames } from '../../core/games';
import { messages } from '../../core/messages';
import { showProblem, showSnackbar } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { leaveGone } from './game-flow';
import {
  historyContextLine,
  matchRows,
  resultRows,
  type GameHistoryRow,
} from './game-view';

/**
A game's Verlauf (§7r): its matches or results since the last (re)start, newest
first, a page at a time with `Ältere laden`; each deletable behind the
confirmation dialog (§6.9). A deletion reaches the game's ranking at once.
*/
const props = defineProps<{ gameId: string }>();
const SKELETON_ROWS = 3;
const NOT_FOUND = 404;

const router = useRouter();
const games = useGames();
const gameId = computed(() => Number(props.gameId));
const game = computed(() =>
  games.value?.find((candidate) => candidate.id === gameId.value),
);
const points = computed(() => game.value?.kind === 'points');
const rows = shallowRef<GameHistoryRow[]>();
/** The `before` of the next older page; null once the last page is shown. */
const next = ref<string | null>(null);
const loadingMore = ref(false);

const confirming = ref(false);
const removing = shallowRef<GameHistoryRow>();
const busy = ref(false);

provideTopBar(() => ({
  context: game.value ? historyContextLine(game.value) : undefined,
}));

const isNotFound = (failure: unknown) =>
  failure instanceof ApiProblem && failure.status === NOT_FOUND;

/** The page after `before` (the newest without it); remembers the next cursor. */
async function page(before?: string): Promise<GameHistoryRow[]> {
  if (points.value) {
    const answer = await listResults(gameId.value, before);
    next.value = answer.next;
    return resultRows(answer.items);
  }
  const answer = await listMatches(gameId.value, before);
  next.value = answer.next;
  return matchRows(answer.items);
}

async function more() {
  if (next.value === null || loadingMore.value) return;
  loadingMore.value = true;
  try {
    rows.value = [...(rows.value ?? []), ...(await page(next.value))];
  } catch (failure) {
    showProblem(failure);
  } finally {
    loadingMore.value = false;
  }
}

function ask(row: GameHistoryRow) {
  removing.value = row;
  confirming.value = true;
}

/**
Deletes the match or result; one already deleted elsewhere counts as deleted.
The row leaves the list in place, so the older pages loaded stay.
*/
async function confirm() {
  const row = removing.value;
  if (!row || busy.value) return;
  busy.value = true;
  try {
    await (points.value ? deleteResult(row.id) : deleteMatch(row.id)).catch(
      (failure: unknown) => {
        if (!isNotFound(failure)) throw failure;
      },
    );
    confirming.value = false;
    rows.value = rows.value?.filter((candidate) => candidate.id !== row.id);
    showSnackbar({
      text: points.value
        ? messages.spiele.removedResult
        : messages.spiele.removedMatch,
    });
    await refreshStandings(gameId.value);
  } catch (failure) {
    showProblem(failure);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    await loadGames();
    if (!game.value) {
      leaveGone(router);
      return;
    }
    rows.value = await page();
  } catch (failure) {
    if (isNotFound(failure)) leaveGone(router);
    else showProblem(failure);
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
    <p
      v-else-if="rows.length === 0 && next === null"
      class="type-body empty-state"
    >
      {{ points ? messages.spiele.noneYetPoints : messages.spiele.noneYetDuel }}
    </p>
    <template v-else>
      <ul class="list" :aria-label="messages.spiele.history">
        <li
          v-for="row in rows"
          :key="row.id"
          class="list__row"
          data-test="game-history-row"
        >
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
      <v-btn
        v-if="next !== null"
        variant="text"
        class="type-row-title verlauf-more"
        :loading="loadingMore"
        @click="more"
      >
        {{ messages.spiele.more }}
      </v-btn>
    </template>
    <ConfirmDialog
      v-model="confirming"
      :title="
        points
          ? messages.spiele.removeResultTitle
          : messages.spiele.removeMatchTitle
      "
      :body="removing?.removeBody ?? ''"
      :action="messages.remove.confirm"
      :busy="busy"
      @confirm="confirm"
    />
  </section>
</template>

<style scoped>
.verlauf-more {
  margin-top: 8px;
  letter-spacing: normal;
  text-transform: none;
}
</style>
