<script setup lang="ts">
import { mdiDeleteOutline, mdiUndo } from '@mdi/js';
import { computed, ref, shallowRef, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import PersonAvatar from '../../../components/PersonAvatar.vue';
import type { Person } from '../../../core/api-client';
import { createPerson } from '../../../core/catalog';
import { useCreateForm } from '../../../core/create-form';
import { messages } from '../../../core/messages';
import {
  personSave,
  type PersonSave,
  type PersonSaveOutcome,
  type PhotoChange,
} from './person-save';

/**
`Person anlegen` / `Person bearbeiten` (§7i): a name; field errors and a taken
name inline. Editing shows the person's avatar at 112 px above the name: `Foto
entfernen` shows the initials until `Foto behalten` brings the photo back, and
only `Speichern` sends the removal (through `person-save`). When the name
committed and the photo did not, the dialog stays on the person and says so under
the photo; `Speichern` again sends only the photo.
*/
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ person?: Readonly<Person> }>();

const KEEP: PhotoChange = { kind: 'keep' };

const name = ref('');
const photo = shallowRef<PhotoChange>(KEEP);
const photoError = ref<string>();
/** This dialog session's saves of the edited person. */
let saving: PersonSave | undefined;
const { errors, busy, submit } = useCreateForm('name');

const photoUrl = computed(() =>
  photo.value.kind === 'remove' ? null : (props.person?.photoUrl ?? null),
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = props.person?.name ?? '';
  photo.value = KEEP;
  photoError.value = undefined;
  errors.value = {};
  saving = props.person && personSave(props.person);
});

async function save() {
  if (!saving) {
    if (await submit(() => createPerson(name.value))) open.value = false;
    return;
  }
  const edit = saving;
  let outcome = 'saved' as PersonSaveOutcome;
  photoError.value = undefined;
  const done = await submit(async () => {
    outcome = await edit.save({ name: name.value, photo: photo.value });
  });
  if (!done) return;
  if (outcome === 'photoNotSaved') {
    photoError.value = messages.personen.photoNotSaved;
  } else {
    open.value = false;
  }
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="person ? messages.personen.edit : messages.personen.create"
    @submit="save"
  >
    <div v-if="person" class="person-photo">
      <PersonAvatar :name="name" :photo-url="photoUrl" :size="112" />
      <div class="person-photo__actions">
        <v-btn
          v-if="photoUrl !== null"
          variant="text"
          class="type-row-title"
          :prepend-icon="mdiDeleteOutline"
          :disabled="busy"
          @click="photo = { kind: 'remove' }"
        >
          {{ messages.personen.removePhoto }}
        </v-btn>
        <v-btn
          v-else-if="photo.kind === 'remove'"
          variant="text"
          class="type-row-title"
          :prepend-icon="mdiUndo"
          :disabled="busy"
          @click="photo = KEEP"
        >
          {{ messages.personen.keepPhoto }}
        </v-btn>
      </div>
      <p
        v-if="photoError"
        class="type-support person-photo__error"
        role="alert"
      >
        {{ photoError }}
      </p>
    </div>
    <AppTextField
      v-model="name"
      :label="messages.personen.name"
      :error="errors.name"
      autocomplete="off"
      autofocus
    />
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
.person-photo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.person-photo__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
}

.person-photo__error {
  color: rgb(var(--v-theme-error));
}
</style>
