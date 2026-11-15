import { ref, type Ref } from 'vue';
import { ApiProblem } from './api-client';
import { messages } from './messages';
import { showSnackbar } from './snackbar';

export type FieldErrorMap = Partial<Record<string, string>>;

/** Field errors to show inline (§6.11): a 422's map; a taken name (409) under its field. */
export function inlineErrors(
  failure: unknown,
  duplicateField: string,
): FieldErrorMap | undefined {
  if (!(failure instanceof ApiProblem)) return undefined;
  if (failure.status === 422) return { ...failure.errors };
  if (failure.status === 409) return { [duplicateField]: failure.title };
  return undefined;
}

/**
The submit of a create dialog: runs `create` once at a time; field errors from the
server go inline under their fields, anything else to the snackbar. Resolves to
whether it was created.
*/
export function useCreateForm(duplicateField: string): {
  errors: Ref<FieldErrorMap>;
  busy: Ref<boolean>;
  submit: (create: () => Promise<unknown>) => Promise<boolean>;
} {
  const errors = ref<FieldErrorMap>({});
  const busy = ref(false);

  async function submit(create: () => Promise<unknown>): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    errors.value = {};
    try {
      await create();
      return true;
    } catch (failure) {
      const inline = inlineErrors(failure, duplicateField);
      if (inline) errors.value = inline;
      else
        showSnackbar({
          text:
            failure instanceof ApiProblem
              ? failure.title
              : messages.anmelden.unreachable,
        });
      return false;
    } finally {
      busy.value = false;
    }
  }

  return { errors, busy, submit };
}
