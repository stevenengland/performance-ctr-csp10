<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import AppFab from '../../../components/AppFab.vue';
import ConfirmDialog from '../../../components/ConfirmDialog.vue';
import {
  ApiProblem,
  deleteAccount,
  listAccounts,
  updateAccount,
  type Account,
} from '../../../core/api-client';
import { useConfirmedDelete } from '../../../core/confirmed-delete';
import { messages } from '../../../core/messages';
import { forgetSession, useSession } from '../../../core/session';
import { showProblem, showSnackbar } from '../../../core/snackbar';
import AccountMenu from './AccountMenu.vue';
import CreateAccountDialog from './CreateAccountDialog.vue';
import ResetPasswordDialog from './ResetPasswordDialog.vue';

/**
Verwalten → Konten (§7j, admins only): accounts by user name, each with a menu to
reset its password, grant or revoke admin rights and delete it (§6.9). The last
admin's removing entries are disabled; the server refuses them anyway (409).
*/

/** Skeleton rows while the list loads (§6.10). */
const SKELETON_ROWS = 3;

const router = useRouter();
const session = useSession();
const accounts = shallowRef<Account[]>();
const creating = ref(false);
const resetting = ref(false);
const resetTarget = shallowRef<Readonly<Account>>();
const lastAdmin = computed(
  () => accounts.value?.filter(({ isAdmin }) => isAdmin).length === 1,
);

async function load() {
  try {
    accounts.value = await listAccounts();
  } catch (failure) {
    if (failure instanceof ApiProblem && failure.status !== 401) {
      showSnackbar({ text: failure.title });
    }
  }
}

/** The delete dialog names the account; the entries it logged stay. */
const removal = useConfirmedDelete(
  async (id) => {
    const account = accounts.value?.find((candidate) => candidate.id === id);
    if (!account) throw new Error(`account ${String(id)} is not listed`);
    return { id, name: account.userName };
  },
  async (id) => {
    await deleteAccount(id);
    await load();
  },
  load,
);
const { open: confirming, target: removing, busy } = removal;

function askReset(account: Readonly<Account>) {
  resetTarget.value = account;
  resetting.value = true;
}

async function toggleAdmin(account: Readonly<Account>) {
  try {
    const changed = await updateAccount(account.id, {
      isAdmin: !account.isAdmin,
    });
    showSnackbar({
      text: changed.isAdmin
        ? messages.konten.granted(changed.userName)
        : messages.konten.revoked(changed.userName),
    });
    if (changed.id === session.value?.id && !changed.isAdmin) {
      // No admin any more: Konten is not for this account now.
      forgetSession();
      await router.replace('/verwalten');
      return;
    }
  } catch (failure) {
    showProblem(failure);
  }
  await load();
}

onMounted(load);
</script>

<template>
  <section class="konten">
    <ul v-if="accounts" class="list" :aria-label="messages.konten.title">
      <li v-for="account in accounts" :key="account.id" class="list__row">
        <span class="list__main">
          <span class="type-row-title list__title">{{ account.userName }}</span>
        </span>
        <span v-if="account.isAdmin" class="admin-chip type-caption">{{
          messages.konten.admin
        }}</span>
        <AccountMenu
          :account="account"
          :last-admin="account.isAdmin && lastAdmin"
          @reset="askReset(account)"
          @toggle-admin="toggleAdmin(account)"
          @remove="removal.ask({ id: account.id, name: account.userName })"
        />
      </li>
    </ul>
    <ul v-else class="list" aria-busy="true">
      <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
        <span class="skeleton" />
      </li>
    </ul>
    <AppFab :label="messages.konten.create" @click="creating = true" />
    <CreateAccountDialog v-model="creating" @created="load" />
    <ResetPasswordDialog
      v-model="resetting"
      :account="resetTarget"
      @reset="
        (account) =>
          showSnackbar({ text: messages.konten.resetDone(account.userName) })
      "
    />
    <ConfirmDialog
      v-model="confirming"
      :title="messages.konten.removeTitle(removing?.name ?? '')"
      :body="messages.konten.removeBody(removing?.name ?? '')"
      :action="messages.remove.confirm"
      :busy="busy"
      @confirm="removal.confirm"
    />
  </section>
</template>

<style scoped>
.konten {
  /* Room for the FAB under the last row. */
  padding-bottom: 88px;
}
</style>
