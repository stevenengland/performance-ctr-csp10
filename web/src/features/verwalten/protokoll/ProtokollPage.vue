<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { listAuditEvents, type AuditEvent } from '../../../core/api-client';
import { messages } from '../../../core/messages';
import { showProblem } from '../../../core/snackbar';
import { useToday } from '../../../core/today';
import { auditDays, type AuditRow } from './audit-rows';

/**
Protokoll (§7l, admins only): the audit log newest first under day headings, a
page at a time; `Ältere laden` appends the next older page. It covers every day:
the one exception to "today only".
*/
const SKELETON_ROWS = 4;

const events = shallowRef<AuditEvent[]>();
/** The `before` of the next older page; null on the last page. */
const next = shallowRef<number | null>(null);
const loading = ref(false);
/** The first page failed: nothing to show but the failure and a retry. */
const failed = ref(false);
/** Heute and Gestern move on with the day, even while the page stays open. */
const today = useToday();
const days = computed(() =>
  events.value ? auditDays(events.value, today.value) : undefined,
);

const support = (row: AuditRow) =>
  row.cause === undefined ? row.by : `${row.by} · ${row.cause}`;

/**
Reads the next page (the newest at first) and appends it below the loaded ones.
A failed older page keeps what is loaded; a failed first page says so and offers
a retry, as there is nothing else to keep.
*/
async function loadPage() {
  if (loading.value) return;
  loading.value = true;
  failed.value = false;
  try {
    const page = await listAuditEvents(next.value ?? undefined);
    events.value = [...(events.value ?? []), ...page.events];
    next.value = page.next;
  } catch (failure) {
    showProblem(failure);
    failed.value = events.value === undefined;
  } finally {
    loading.value = false;
  }
}

onMounted(loadPage);
</script>

<template>
  <section class="protokoll">
    <div v-if="failed" class="empty-state">
      <p class="type-body">{{ messages.protokoll.notLoaded }}</p>
      <v-btn
        variant="flat"
        color="primary"
        rounded="0"
        class="dialog-button type-row-title"
        @click="loadPage"
      >
        {{ messages.protokoll.retry }}
      </v-btn>
    </div>
    <ul v-else-if="days === undefined" class="list" aria-busy="true">
      <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
        <span class="skeleton" />
      </li>
    </ul>
    <p v-else-if="days.length === 0" class="type-body empty-state">
      {{ messages.protokoll.empty }}
    </p>
    <template v-else>
      <section v-for="(day, index) in days" :key="day.label">
        <h2
          :id="`protokoll-day-${String(index)}`"
          class="type-label protokoll__day"
        >
          {{ day.label }}
        </h2>
        <ul class="list" :aria-labelledby="`protokoll-day-${String(index)}`">
          <li
            v-for="row in day.rows"
            :key="row.id"
            class="list__row protokoll__row"
            :class="{ 'protokoll__row--caused': row.cause }"
            data-test="audit-event"
          >
            <span class="list__main">
              <span class="type-row-title list__title">{{ row.title }}</span>
              <span v-if="row.changes" class="type-body protokoll__change">{{
                row.changes
              }}</span>
              <span class="type-support list__support">{{ support(row) }}</span>
            </span>
            <span
              class="assist-chip type-caption protokoll__operation"
              :class="`protokoll__operation--${row.operation}`"
              >{{ row.operationLabel }}</span
            >
          </li>
        </ul>
      </section>
      <v-btn
        v-if="next !== null"
        class="dialog-button protokoll__more"
        variant="tonal"
        :loading="loading"
        @click="loadPage"
      >
        {{ messages.protokoll.more }}
      </v-btn>
    </template>
    <p class="type-support protokoll__note">{{ messages.protokoll.note }}</p>
  </section>
</template>

<style scoped>
.protokoll {
  padding-bottom: 24px;
}

.protokoll__day,
.protokoll__note {
  margin: 20px 4px 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.protokoll__row {
  align-items: flex-start;
}

/* A consequential event sits under the deletion that caused it. */
.protokoll__row--caused {
  padding-left: 20px;
}

.protokoll__change {
  display: block;
}

.protokoll__operation {
  margin-top: 2px;
}

.protokoll__operation--delete {
  border-color: rgb(var(--v-theme-error));
  color: rgb(var(--v-theme-error));
}

.protokoll__more {
  display: flex;
  margin: 16px auto 0;
}
</style>
