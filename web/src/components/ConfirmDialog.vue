<script setup lang="ts">
import { messages } from '../core/messages';
import AppDialog from './AppDialog.vue';

/**
The confirmation dialog of a destructive action (design spec §6.9): the title states
the action, the body its consequence; `Abbrechen` and the action in `error`.
*/
const open = defineModel<boolean>({ required: true });
defineProps<{ title: string; body: string; action: string; busy?: boolean }>();
const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
  <AppDialog v-model="open" :title="title" @submit="emit('confirm')">
    <p class="type-body">{{ body }}</p>
    <template #actions>
      <v-btn variant="text" class="type-row-title" @click="open = false">
        {{ messages.dialog.cancel }}
      </v-btn>
      <v-btn
        type="submit"
        variant="flat"
        color="error"
        rounded="0"
        class="dialog-button type-row-title"
        :loading="busy"
      >
        {{ action }}
      </v-btn>
    </template>
  </AppDialog>
</template>
