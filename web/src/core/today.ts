import { onScopeDispose, shallowRef, type ShallowRef } from 'vue';
import { startOfToday } from './day-window';

/** Local midnight of the day after `today`, daylight saving aware. */
function startOfTomorrow(today: Date): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
}

/**
The start of "Heute" (local midnight, see `startOfToday`), kept current: it moves
on at the next local midnight and, as a timer does not run in a suspended tab or
installed app, also when the page is shown or focused again. It changes only
when the day does, so what is computed from it is not recomputed within a day.
*/
export function useToday(): Readonly<ShallowRef<Date>> {
  const today = shallowRef(startOfToday());
  let timer: ReturnType<typeof setTimeout> | undefined;

  function refresh() {
    const now = new Date();
    const current = startOfToday(now);
    if (current.getTime() !== today.value.getTime()) today.value = current;
    clearTimeout(timer);
    timer = setTimeout(
      refresh,
      startOfTomorrow(current).getTime() - now.getTime(),
    );
  }

  refresh();
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', refresh);
  onScopeDispose(() => {
    clearTimeout(timer);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('pageshow', refresh);
    document.removeEventListener('visibilitychange', refresh);
  });
  return today;
}
