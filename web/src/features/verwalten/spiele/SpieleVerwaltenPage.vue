<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import AppFab from '../../../components/AppFab.vue';
import CatalogList from '../../../components/CatalogList.vue';
import ConfirmDialog from '../../../components/ConfirmDialog.vue';
import { getGame, type Game } from '../../../core/api-client';
import { useConfirmedDelete } from '../../../core/confirmed-delete';
import { deleteGame, loadGames, useGames } from '../../../core/games';
import { messages } from '../../../core/messages';
import { showProblem } from '../../../core/snackbar';
import { settingLine } from '../../spiele/game-view';
import GameDialog from './GameDialog.vue';

/**
Verwalten → Spiele (draft): games alphabetically with their kind and setting,
each editable and deletable; deleting says how many matches or results go with
the game (§6.9).
*/
const games = useGames();
/** `?anlegen` opens the create dialog (the Spiele empty state links here). */
const editing = ref(useRoute().query.anlegen !== undefined);
const edited = shallowRef<Readonly<Game>>();
const removal = useConfirmedDelete(getGame, deleteGame, loadGames);
const { open: confirming, target: removing, busy } = removal;

function openDialog(game?: Readonly<Game>) {
  edited.value = game;
  editing.value = true;
}

onMounted(() => {
  loadGames().catch(showProblem);
});
</script>

<template>
  <section class="catalog-page">
    <CatalogList
      :items="games"
      :label="messages.spiele.title"
      :empty="messages.spiele.empty"
      :support="settingLine"
      @edit="openDialog"
      @remove="removal.ask"
    />
    <AppFab :label="messages.spiele.create" @click="openDialog()" />
    <GameDialog v-model="editing" :game="edited" />
    <ConfirmDialog
      v-model="confirming"
      :title="messages.remove.title(removing?.name ?? '')"
      :body="
        messages.spiele.removeGameBody(
          removing?.name ?? '',
          removing?.kind ?? 'duel',
          (removing?.kind === 'points'
            ? removing?.resultCount
            : removing?.matchCount) ?? 0,
        )
      "
      :action="messages.remove.confirm"
      :busy="busy"
      @confirm="removal.confirm"
    />
  </section>
</template>
