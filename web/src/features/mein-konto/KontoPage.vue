<script setup lang="ts">
import { mdiLockReset, mdiLogout } from '@mdi/js';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CLIENT_VERSION } from '../../app';
import TallyMarks from '../../components/TallyMarks.vue';
import { ApiProblem } from '../../core/api-client';
import { useServerHealth } from '../../core/health';
import { messages } from '../../core/messages';
import { signOut, SIGN_IN_PATH, useSession } from '../../core/session';
import { showSnackbar } from '../../core/snackbar';
import ChangePasswordDialog from './ChangePasswordDialog.vue';

/** The brand mark beside the app name, as on Anmelden. */
const BRAND_STROKES = 13;

const router = useRouter();
const account = useSession();
const server = useServerHealth();
const changing = ref(false);
const serverLine = computed(() =>
  server.value
    ? messages.konto.server(server.value.appVersion)
    : messages.konto.serverUnknown,
);

async function leave() {
  try {
    await signOut();
    await router.replace(SIGN_IN_PATH);
  } catch (failure) {
    showSnackbar({
      text:
        failure instanceof ApiProblem
          ? failure.title
          : messages.anmelden.unreachable,
    });
  }
}
</script>

<template>
  <section class="konto">
    <p class="type-name-hero konto__brand">{{ messages.appName }}</p>
    <TallyMarks :count="BRAND_STROKES" :height="30" class="konto__tally" />

    <div class="konto__account">
      <p class="type-support konto__muted">{{ messages.konto.signedInAs }}</p>
      <p class="konto__name">
        <span class="type-row-title" data-testid="account-name">{{
          account?.userName
        }}</span>
        <span v-if="account?.isAdmin" class="assist-chip type-caption">{{
          messages.konto.admin
        }}</span>
      </p>
    </div>
    <ul class="konto__actions">
      <li>
        <button
          type="button"
          class="konto__action type-row-title"
          @click="changing = true"
        >
          <v-icon :icon="mdiLockReset" size="24" />
          {{ messages.konto.changePassword }}
        </button>
      </li>
      <li>
        <button
          type="button"
          class="konto__action type-row-title"
          @click="leave"
        >
          <v-icon :icon="mdiLogout" size="24" />
          {{ messages.konto.signOut }}
        </button>
      </li>
    </ul>

    <p class="type-row-title konto__version">
      {{ messages.konto.version(CLIENT_VERSION) }}
    </p>
    <p class="type-support konto__muted" data-testid="server-version">
      {{ serverLine }}
    </p>
    <ChangePasswordDialog v-model="changing" />
  </section>
</template>

<style scoped>
.konto {
  padding-top: 16px;
}

.konto__tally {
  margin: 10px 0 24px;
  color: rgb(var(--v-theme-primary));
}

.konto__muted {
  color: rgb(var(--v-theme-on-surface-variant));
}

.konto__account {
  padding: 12px 4px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.konto__name {
  display: flex;
  align-items: center;
  gap: 10px;
}

.konto__actions {
  margin: 0 0 24px;
  padding: 0;
  list-style: none;
}

.konto__action {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-height: 56px;
  padding: 12px 4px;
  border: 0;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  background: none;
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
  cursor: pointer;
}

.konto__version {
  margin-top: 8px;
}
</style>
