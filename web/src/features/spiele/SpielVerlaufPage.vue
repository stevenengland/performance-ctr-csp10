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
  matchRows,
  resultRows,
  sinceLabel,
  type GameHistoryRow,
} from './game-view';

/**
A game's Verlauf (draft): every match or result since the last restart, newest
first, 20 at a time with `Ältere laden`; each deletable behind the confirmation
dialog (§6.9). A deleted person's side reads `gelöschte Person`.
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
const rows = shallowRef<GameHistoryRow[]>();
const next = ref<string | null>(null);
const loadingMore = ref(false);

const confirming = ref(false);
const removing = shallowRef<GameHistoryRow>();
const busy = ref(false);

provideTopBar(() => ({
  context: game.value
    ? `${game.value.name} · ${sinceLabel(game.value.startedAt)}`
    : undefined,
}));

async function page(before?: string): Promise<GameHistoryRow[]> {
  if (game.value?.kind === 'points') {
    const answer = await listResults(gameId.value, before);
    next.value = answer.next;
    return resultRows(answer.items);
  }
  const answer = await listMatches(gameId.value, before);
  next.value = answer.next;
  return matchRows(answer.items);
}

async function load() {
  rows.value = await page();
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

async function confirm() {
  const row = removing.value;
  if (!row || busy.value || !game.value) return;
  busy.value = true;
  const points = game.value.kind === 'points';
  try {
    await (points ? deleteResult(row.id) : deleteMatch(row.id)).catch(
      (failure: unknown) => {
        if (!(failure instanceof ApiProblem && failure.status === NOT_FOUND)) {
          throw failure;
        }
      },
    );
    confirming.value = false;
    showSnackbar({
      text: points
        ? messages.spiele.removedResult
        : messages.spiele.removedMatch,
    });
    await Promise.all([load(), refreshStandings(gameId.value)]);
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
    await load();
  } catch (failure) {
    showProblem(failure);
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
      {{
        game?.kind === 'points'
          ? messages.spiele.noneYetPoints
          : messages.spiele.noneYetDuel
      }}
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
        game?.kind === 'points'
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
