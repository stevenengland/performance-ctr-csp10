<script setup lang="ts">
import { mdiCameraOutline, mdiDeleteOutline, mdiUndo } from '@mdi/js';
import { computed, ref, shallowRef, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import PersonAvatar from '../../../components/PersonAvatar.vue';
import type { Person } from '../../../core/api-client';
import {
  createPerson,
  savePersonPhoto,
  updatePerson,
} from '../../../core/catalog';
import { useCreateForm } from '../../../core/create-form';
import { messages } from '../../../core/messages';
import {
  CENTRED,
  decodePhoto,
  encodePhoto,
  type Framing,
} from '../../../core/person-photo';
import PhotoCrop from './PhotoCrop.vue';

/**
`Person anlegen` / `Person bearbeiten` (§7i): a photo and a name. Any member may
set, replace or remove any person's photo. A chosen photo is framed in the dialog
and saved with `Speichern` after the name; `Abbrechen` discards it. Field errors
and a taken name show inline.
*/
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ person?: Readonly<Person> }>();

/** What `Speichern` does to the photo. */
type PhotoChange =
  | { kind: 'keep' }
  | { kind: 'new'; picture: ImageBitmap; framing: Framing }
  | { kind: 'remove' };

const name = ref('');
const photo = shallowRef<PhotoChange>({ kind: 'keep' });
const photoError = ref<string>();
const fileInput = ref<HTMLInputElement>();
/** A person created by an earlier `Speichern` whose photo failed: saving again edits it. */
const created = shallowRef<Person>();
const { errors, busy, submit } = useCreateForm('name');

const target = computed(() => created.value ?? props.person);
const currentUrl = computed(() =>
  photo.value.kind === 'remove' ? null : (target.value?.photoUrl ?? null),
);
const hasPhoto = computed(
  () => photo.value.kind === 'new' || currentUrl.value !== null,
);
const pickLabel = computed(() => {
  if (photo.value.kind === 'new') return messages.personen.otherPhoto;
  return hasPhoto.value
    ? messages.personen.changePhoto
    : messages.personen.choosePhoto;
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = props.person?.name ?? '';
  photo.value = { kind: 'keep' };
  photoError.value = undefined;
  created.value = undefined;
  errors.value = {};
});

function pick() {
  fileInput.value?.click();
}

async function chosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  photoError.value = undefined;
  try {
    photo.value = {
      kind: 'new',
      picture: await decodePhoto(file),
      framing: CENTRED,
    };
  } catch {
    photoError.value = messages.personen.photoUnreadable;
  }
}

function setFraming(framing: Framing) {
  if (photo.value.kind === 'new') photo.value = { ...photo.value, framing };
}

function remove() {
  photo.value =
    photo.value.kind === 'new' && target.value?.photoUrl == null
      ? { kind: 'keep' }
      : { kind: 'remove' };
}

async function save() {
  const change = photo.value;
  const done = await submit(async () => {
    const existing = target.value;
    let id: number;
    if (existing) {
      await updatePerson(existing.id, name.value);
      id = existing.id;
    } else {
      created.value = await createPerson(name.value);
      id = created.value.id;
    }
    try {
      if (change.kind === 'new') {
        await savePersonPhoto(
          id,
          await encodePhoto(change.picture, change.framing),
        );
      } else if (change.kind === 'remove') {
        await savePersonPhoto(id, null);
      }
    } catch (failure) {
      photoError.value = messages.personen.photoFailed;
      throw failure;
    }
  });
  if (done) open.value = false;
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="target ? messages.personen.edit : messages.personen.create"
    @submit="save"
  >
    <div class="person-photo">
      <PhotoCrop
        v-if="photo.kind === 'new'"
        :model-value="photo.framing"
        :picture="photo.picture"
        :name="name"
        @update:model-value="setFraming"
      />
      <PersonAvatar v-else :name="name" :photo-url="currentUrl" :size="112" />
      <div class="person-photo__actions">
        <v-btn
          variant="text"
          class="type-row-title"
          :prepend-icon="mdiCameraOutline"
          @click="pick"
        >
          {{ pickLabel }}
        </v-btn>
        <v-btn
          v-if="hasPhoto"
          variant="text"
          class="type-row-title"
          :prepend-icon="mdiDeleteOutline"
          @click="remove"
        >
          {{ messages.personen.removePhoto }}
        </v-btn>
        <v-btn
          v-else-if="photo.kind === 'remove'"
          variant="text"
          class="type-row-title"
          :prepend-icon="mdiUndo"
          @click="photo = { kind: 'keep' }"
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
        @change="chosen"
      />
    </div>
    <AppTextField
      v-model="name"
      :label="messages.personen.name"
      :error="errors.name"
      autocomplete="off"
      :autofocus="!person"
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
