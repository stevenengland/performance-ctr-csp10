<script setup lang="ts">
import { mdiCameraOutline, mdiDeleteOutline, mdiUndo } from '@mdi/js';
import { computed, ref, shallowRef, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import PersonAvatar from '../../../components/PersonAvatar.vue';
import { ApiProblem, type Person } from '../../../core/api-client';
import { useCreateForm } from '../../../core/create-form';
import { messages } from '../../../core/messages';
import { PhotoUnreadable } from '../../../core/person-photo';
import { personSave, type PhotoChange } from './person-save';
import PhotoCrop from './PhotoCrop.vue';
import { usePhotoDraft } from './photo-draft';

/**
`Person anlegen` / `Person bearbeiten` (§7i): the person's avatar at 112 px
(initials of the typed name until there is a photo) above a name; field errors
and a taken name inline. `Foto wählen` / `Foto ändern` opens the platform's
picker; the chosen photo is framed in `PhotoCrop` (`Anderes Foto` picks again)
and only `Speichern` uploads it, through `person-save`. `Foto entfernen` drops a
chosen photo or shows the initials until `Foto behalten` brings the photo back.
A file that cannot be opened, and a photo the server refuses, show under the
photo and keep what was there; the photo controls are frozen while saving. When
the name committed and the photo did not, the dialog stays on the person (a new
one is then edited) and says so, with the photo's reason when there is one; `Speichern` again sends only the photo, and
`Abbrechen` keeps what committed.
*/
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ person?: Readonly<Person> }>();

const name = ref('');
/** A removal of the person's current photo waits for `Speichern`. */
const removing = ref(false);
const photoError = ref<string>();
const fileInput = ref<HTMLInputElement>();
const draft = usePhotoDraft();
const { picture, framing, encoded } = draft;
/** This dialog session's saves: of the edited person, or of a new one. */
let saving = personSave(undefined);
/** The person as last acknowledged in this session; none before a new one is created. */
const current = shallowRef<Readonly<Person>>();
const { errors, busy, submit } = useCreateForm('name');

const photoUrl = computed(() =>
  removing.value ? null : (current.value?.photoUrl ?? null),
);
const pickLabel = computed(() => {
  if (picture.value) return messages.personen.otherPhoto;
  return photoUrl.value === null
    ? messages.personen.choosePhoto
    : messages.personen.changePhoto;
});
const photoChange = computed<PhotoChange>(() => {
  if (picture.value) return { kind: 'new', encode: draft.encode };
  return removing.value ? { kind: 'remove' } : { kind: 'keep' };
});

watch(open, (isOpen) => {
  draft.discard();
  if (!isOpen) return;
  name.value = props.person?.name ?? '';
  removing.value = false;
  photoError.value = undefined;
  errors.value = {};
  saving = personSave(props.person);
  current.value = props.person;
});

async function chosen() {
  const input = fileInput.value;
  const file = input?.files?.[0];
  if (!input || !file) return;
  input.value = '';
  photoError.value = undefined;
  try {
    if (await draft.pick(file)) removing.value = false;
  } catch {
    photoError.value = messages.personen.photoUnreadable;
  }
}

function removePhoto() {
  draft.discard();
  removing.value = current.value?.photoUrl != null;
}

/** The message under the photo for a failure of the photo alone; anything else is the form's. */
function photoFailure(failure: unknown): string | undefined {
  if (failure instanceof PhotoUnreadable) {
    return messages.personen.photoUnreadable;
  }
  if (!(failure instanceof ApiProblem)) return undefined;
  if (failure.status === 413) return failure.title;
  return failure.status === 422 ? failure.errors.image : undefined;
}

async function save() {
  const session = saving;
  let message: string | undefined;
  photoError.value = undefined;
  draft.cancelPicks();
  const done = await submit(async () => {
    try {
      const outcome = await session.save({
        name: name.value,
        photo: photoChange.value,
      });
      if (outcome.kind === 'photoNotSaved') {
        // Followed by the photo's own reason when the server or the browser gave one.
        const reason = photoFailure(outcome.failure);
        message = [messages.personen.photoNotSaved, reason]
          .filter((part) => part !== undefined)
          .join(' ');
      }
    } catch (failure) {
      message = photoFailure(failure);
      if (message === undefined) throw failure;
    } finally {
      // Unless the dialog was closed and opened again meanwhile.
      if (session === saving) current.value = session.person;
    }
  });
  if (!done) return;
  if (message === undefined) open.value = false;
  else photoError.value = message;
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="current ? messages.personen.edit : messages.personen.create"
    @submit="save"
  >
    <div class="person-photo">
      <PhotoCrop
        v-if="picture"
        v-model="framing"
        :picture="picture"
        :disabled="busy || encoded"
      />
      <PersonAvatar v-else :name="name" :photo-url="photoUrl" :size="112" />
      <div class="person-photo__actions">
        <v-btn
          variant="text"
          class="type-row-title"
          :prepend-icon="mdiCameraOutline"
          :disabled="busy"
          @click="fileInput?.click()"
        >
          {{ pickLabel }}
        </v-btn>
        <v-btn
          v-if="picture || photoUrl !== null"
          variant="text"
          class="type-row-title"
          :prepend-icon="mdiDeleteOutline"
          :disabled="busy"
          @click="removePhoto"
        >
          {{ messages.personen.removePhoto }}
        </v-btn>
        <v-btn
          v-else-if="removing"
          variant="text"
          class="type-row-title"
          :prepend-icon="mdiUndo"
          :disabled="busy"
          @click="removing = false"
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
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        hidden
        :disabled="busy"
        @change="chosen"
      />
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
