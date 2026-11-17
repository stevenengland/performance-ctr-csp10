import { computed, onScopeDispose, shallowRef, watchEffect } from 'vue';
import { useRoute } from 'vue-router';

/** What a screen shows in the top app bar instead of its route's title (§6.1). */
export interface TopBarContent {
  title?: string;
  context?: string;
  /** The chosen person's total score today, formatted (add-flow steps 2–4). */
  score?: string;
  /** `Stand: HH:mm` while the shown data is stale (Rangliste, a game, Offen; §6.6). */
  stale?: string;
}

const shown = shallowRef<{ path: string; content: TopBarContent }>();

/**
Lets the calling screen fill the top app bar while it is open, e.g. the add flow's
chosen person as the title. It is bound to the screen's route, so a screen that is
leaving can never overwrite the next one's bar.
*/
export function provideTopBar(content: () => TopBarContent): void {
  const path = useRoute().fullPath;
  watchEffect(() => {
    shown.value = { path, content: content() };
  });
  onScopeDispose(() => {
    if (shown.value?.path === path) shown.value = undefined;
  });
}

/** The current route's top-bar content, if its screen provides one. */
export function useTopBarContent() {
  const route = useRoute();
  return computed(() =>
    shown.value?.path === route.fullPath ? shown.value.content : undefined,
  );
}
