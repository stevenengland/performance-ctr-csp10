<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTextField from '../../components/AppTextField.vue';
import TallyMarks from '../../components/TallyMarks.vue';
import { messages } from '../../core/messages';
import { returnPath, signIn } from '../../core/session';
import { signInError } from './sign-in-error';

/** The brand mark under the app name (§7a), as on Konto. */
const BRAND_STROKES = 13;

const route = useRoute();
const router = useRouter();
const userName = ref('');
const password = ref('');
const error = ref<string>();
const busy = ref(false);

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = undefined;
  try {
    await signIn(userName.value, password.value);
    await router.replace(returnPath(route.query.weiter));
  } catch (failure) {
    error.value = signInError(failure);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="anmelden">
    <form class="anmelden__form" novalidate @submit.prevent="submit">
      <h1 class="anmelden__name">{{ messages.anmelden.appName }}</h1>
      <TallyMarks :count="BRAND_STROKES" :height="30" class="anmelden__tally" />
      <AppTextField
        v-model="userName"
        :label="messages.anmelden.userName"
        autocomplete="username"
        autofocus
      />
      <AppTextField
        v-model="password"
        :label="messages.anmelden.password"
        autocomplete="current-password"
        password
      />
      <p
        v-if="error"
        class="type-support anmelden__error"
        role="alert"
        data-testid="sign-in-error"
      >
        {{ error }}
      </p>
      <v-btn
        type="submit"
        color="primary"
        variant="flat"
        size="large"
        rounded="0"
        block
        :loading="busy"
        class="anmelden__submit type-row-title"
      >
        {{ messages.anmelden.submit }}
      </v-btn>
    </form>
  </main>
</template>

<style scoped>
/* No card (§7a): plain surface, vertically centred, left-aligned, at most 400 dp wide. */
.anmelden {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
  padding: 24px;
}

.anmelden__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  max-width: 400px;
}

.anmelden__name {
  font-family: var(--font-display);
  font-size: 64px;
  font-weight: 900;
  line-height: 58px;
  letter-spacing: 0.015em;
  text-transform: uppercase;
  /* As narrow as its longest part, so it always breaks at the soft hyphen. */
  width: min-content;
  hyphens: manual;
}

.anmelden__tally {
  margin: -4px 0 14px;
  color: rgb(var(--v-theme-primary));
}

.anmelden__error {
  color: rgb(var(--v-theme-error));
}

.anmelden__submit {
  height: 52px;
  border-radius: 10px;
  letter-spacing: normal;
  text-transform: none;
}
</style>
