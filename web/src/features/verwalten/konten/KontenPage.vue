<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import AppFab from '../../../components/AppFab.vue';
import {
  ApiProblem,
  listAccounts,
  type Account,
} from '../../../core/api-client';
import { messages } from '../../../core/messages';
import { showSnackbar } from '../../../core/snackbar';
import CreateAccountDialog from './CreateAccountDialog.vue';

/** Skeleton rows while the list loads (§6.10). */
const SKELETON_ROWS = 3;

const accounts = shallowRef<Account[]>();
const creating = ref(false);

async function load() {
  try {
    accounts.value = await listAccounts();
  } catch (failure) {
    if (failure instanceof ApiProblem && failure.status !== 401) {
      showSnackbar({ text: failure.title });
    }
  }
}

onMounted(load);
</script>

<template>
  <section class="konten">
    <ul v-if="accounts" class="list" :aria-label="messages.konten.title">
      <li v-for="account in accounts" :key="account.id" class="list__row">
        <span class="type-row-title list__main">{{ account.userName }}</span>
        <span v-if="account.isAdmin" class="admin-chip type-caption">{{
          messages.konten.admin
        }}</span>
      </li>
    </ul>
    <ul v-else class="list" aria-busy="true">
      <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
        <span class="skeleton" />
      </li>
    </ul>
    <AppFab :label="messages.konten.create" @click="creating = true" />
    <CreateAccountDialog v-model="creating" @created="load" />
  </section>
</template>

<style scoped>
.konten {
  /* Room for the FAB under the last row. */
  padding-bottom: 88px;
}
</style>
