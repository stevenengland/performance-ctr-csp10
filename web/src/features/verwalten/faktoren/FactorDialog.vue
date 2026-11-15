<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import type { Factor } from '../../../core/api-client';
import { createFactor, updateFactor } from '../../../core/catalog';
import { useCreateForm } from '../../../core/create-form';
import { formatDecimalInput, parseDecimal } from '../../../core/format';
import { messages } from '../../../core/messages';

/**
`Faktor anlegen` / `Faktor bearbeiten` (§7i): name and multiplier with a decimal
comma or point, shown after `×`. Input that is no number goes to the server as
such, which answers with the field error.
*/
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ factor?: Readonly<Factor> }>();

const name = ref('');
const multiplier = ref('');
const { errors, busy, submit } = useCreateForm('name');

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = props.factor?.name ?? '';
  multiplier.value = props.factor
    ? formatDecimalInput(props.factor.multiplier)
    : '';
  errors.value = {};
});

async function save() {
  const value = parseDecimal(multiplier.value);
  const { factor } = props;
  const done = await submit(() =>
    factor
      ? updateFactor(factor.id, name.value, value)
      : createFactor(name.value, value),
  );
  if (done) open.value = false;
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="factor ? messages.faktoren.edit : messages.faktoren.create"
    @submit="save"
  >
    <AppTextField
      v-model="name"
      :label="messages.faktoren.name"
      :error="errors.name"
      autocomplete="off"
      autofocus
    />
    <AppTextField
      v-model="multiplier"
      :label="messages.faktoren.multiplier"
      :error="errors.multiplier"
      autocomplete="off"
      inputmode="decimal"
      prefix="×"
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
