<script setup lang="ts">
import { mdiDotsVertical } from '@mdi/js';
import type { Account } from '../../../core/api-client';
import { messages } from '../../../core/messages';

/**
The trailing menu of an account's row (§7j): reset the password, grant or revoke
admin rights, delete. For the last admin, the entries that would remove it are
disabled with `Letzter Admin`; the server enforces the rule regardless.
*/
defineProps<{ account: Readonly<Account>; lastAdmin: boolean }>();
const emit = defineEmits<{ reset: []; toggleAdmin: []; remove: [] }>();
</script>

<template>
  <v-menu location="bottom end">
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        :icon="mdiDotsVertical"
        :aria-label="messages.konten.actions(account.userName)"
        variant="text"
      />
    </template>
    <v-list class="account-menu" bg-color="surface-container" role="menu">
      <v-list-item role="menuitem" @click="emit('reset')">
        <v-list-item-title class="type-row-title">{{
          messages.konten.resetPassword
        }}</v-list-item-title>
      </v-list-item>
      <v-list-item
        role="menuitem"
        :disabled="lastAdmin"
        :aria-disabled="lastAdmin ? 'true' : undefined"
        @click="emit('toggleAdmin')"
      >
        <v-list-item-title class="type-row-title">{{
          account.isAdmin
            ? messages.konten.revokeAdmin
            : messages.konten.grantAdmin
        }}</v-list-item-title>
        <v-list-item-subtitle v-if="lastAdmin" class="type-support">{{
          messages.konten.lastAdmin
        }}</v-list-item-subtitle>
      </v-list-item>
      <v-list-item
        role="menuitem"
        :disabled="lastAdmin"
        :aria-disabled="lastAdmin ? 'true' : undefined"
        @click="emit('remove')"
      >
        <v-list-item-title class="type-row-title">{{
          messages.konten.remove
        }}</v-list-item-title>
        <v-list-item-subtitle v-if="lastAdmin" class="type-support">{{
          messages.konten.lastAdmin
        }}</v-list-item-subtitle>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<style scoped>
.account-menu {
  min-width: 232px;
  border-radius: 10px;
}
</style>
