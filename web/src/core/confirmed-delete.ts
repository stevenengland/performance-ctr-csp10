import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { messages } from './messages';
import { showProblem, showSnackbar } from './snackbar';

interface Named {
  id: number;
  name: string;
}

/**
Deleting master data behind the confirmation dialog (§6.9): `ask` reads the
item's current state (its entry count) for the dialog, `confirm` deletes it and
says `<Name> gelöscht`. A failure shows the problem title; when the item could
not be read, `reload` refreshes the list, since it is likely gone.
*/
export function useConfirmedDelete<T extends Named>(
  read: (id: number) => Promise<T>,
  remove: (id: number) => Promise<void>,
  reload: () => Promise<void>,
): {
  open: Ref<boolean>;
  target: ShallowRef<T | undefined>;
  busy: Ref<boolean>;
  ask: (item: Readonly<Named>) => Promise<void>;
  confirm: () => Promise<void>;
} {
  const open = ref(false);
  const target = shallowRef<T>();
  const busy = ref(false);

  async function ask(item: Readonly<Named>) {
    try {
      target.value = await read(item.id);
      open.value = true;
    } catch (failure) {
      showProblem(failure);
      await reload().catch(showProblem);
    }
  }

  async function confirm() {
    const item = target.value;
    if (!item || busy.value) return;
    busy.value = true;
    try {
      await remove(item.id);
      open.value = false;
      showSnackbar({ text: messages.remove.done(item.name) });
    } catch (failure) {
      showProblem(failure);
    } finally {
      busy.value = false;
    }
  }

  return { open, target, busy, ask, confirm };
}
