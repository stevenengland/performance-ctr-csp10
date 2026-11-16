<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import type { Game, GameKind } from '../../../core/api-client';
import { useCreateForm } from '../../../core/create-form';
import { createGame, updateGame } from '../../../core/games';
import { messages } from '../../../core/messages';

/**
`Spiel anlegen` / `Spiel bearbeiten` (draft): the name; the kind, chosen once
(Duell or Punktespiel) and fixed afterwards; and the kind's setting — `Remis
möglich` for a duel, the ranking direction for a points game.
*/
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ game?: Readonly<Game> }>();

const name = ref('');
const kind = ref<GameKind>('duel');
const drawsAllowed = ref(true);
const lowerWins = ref(false);
const { errors, busy, submit } = useCreateForm('name');

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = props.game?.name ?? '';
  kind.value = props.game?.kind ?? 'duel';
  drawsAllowed.value = props.game?.drawsAllowed ?? true;
  lowerWins.value = props.game?.lowerWins ?? false;
  errors.value = {};
});

async function save() {
  const { game } = props;
  const setting =
    kind.value === 'duel'
      ? { drawsAllowed: drawsAllowed.value }
      : { lowerWins: lowerWins.value };
  const done = await submit(() =>
    game
      ? updateGame(game.id, { name: name.value, ...setting })
      : createGame({ name: name.value, kind: kind.value, ...setting }),
  );
  if (done) open.value = false;
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="game ? messages.spiele.edit : messages.spiele.create"
    @submit="save"
  >
    <AppTextField
      v-model="name"
      :label="messages.spiele.name"
      :error="errors.name"
      autocomplete="off"
      autofocus
    />
    <fieldset class="game-dialog__group">
      <legend class="type-caption game-dialog__legend">
        {{ messages.spiele.kind }}
      </legend>
      <div class="game-dialog__kinds">
        <button
          v-for="option in ['duel', 'points'] as const"
          :key="option"
          type="button"
          class="tile game-dialog__kind"
          :class="{ 'tile--pressed': kind === option }"
          :aria-pressed="kind === option"
          :disabled="game !== undefined && kind !== option"
          @click="kind = option"
        >
          <span class="type-row-title">{{
            option === 'duel' ? messages.spiele.duel : messages.spiele.points
          }}</span>
          <span class="type-support">{{
            option === 'duel'
              ? messages.spiele.duelHint
              : messages.spiele.pointsHint
          }}</span>
        </button>
      </div>
      <p v-if="game" class="type-support game-dialog__hint">
        {{ messages.spiele.kindFixed }}
      </p>
      <p v-if="errors.kind" class="type-support game-dialog__error">
        {{ errors.kind }}
      </p>
    </fieldset>
    <v-switch
      v-if="kind === 'duel'"
      v-model="drawsAllowed"
      :label="messages.spiele.drawsAllowed"
      color="primary"
      inset
      hide-details
    />
    <v-radio-group
      v-else
      v-model="lowerWins"
      color="primary"
      hide-details
      class="game-dialog__direction"
    >
      <v-radio :label="messages.spiele.higherWins" :value="false" />
      <v-radio :label="messages.spiele.lowerWins" :value="true" />
    </v-radio-group>
    <template #actions>
      <v-btn variant="text" class="type-row-title" @click="open = false">
        {{ messages.dialog.cancel }}
      </v-btn>
      <v-btn
        type="submit"
        variant="flat"
        color="primary"
        rounded="0"
        class="dialog-button type-row-title"
        :loading="busy"
      >
        {{ messages.dialog.save }}
      </v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.game-dialog__group {
  margin: 4px 0 8px;
  padding: 0;
  border: 0;
}

.game-dialog__legend {
  margin-bottom: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.game-dialog__kinds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.game-dialog__kind {
  gap: 4px;
  min-height: 88px;
}

.game-dialog__hint {
  margin-top: 6px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.game-dialog__error {
  margin-top: 6px;
  color: rgb(var(--v-theme-error));
}
</style>
