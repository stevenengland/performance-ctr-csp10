<?php

declare(strict_types=1);

namespace Performance\Tests\Support;

/**
 * What the verification of a row looks like to members, read through the API: who the audit
 * log names for each decision on it. For a DatabaseTestCase whose bootstrap admin is never
 * deleted.
 */
trait ObservedVerification
{
    /**
     * The accounts the audit log names as the actors of a row's `verify` events, oldest first,
     * as the bootstrap admin reads the log.
     *
     * @return list<mixed>
     */
    private function verifiersOf(string $subjectId): array
    {
        $events = $this->body($this->send('GET', '/api/audit?limit=100', session: $this->signIn()))['events'];
        self::assertIsList($events);
        $verifiers = [];
        foreach (array_reverse($events) as $event) {
            self::assertIsArray($event);
            if ($event['subjectId'] === $subjectId && $event['operation'] === 'verify') {
                self::assertIsArray($event['actor']);
                $verifiers[] = $event['actor']['accountId'];
            }
        }

        return $verifiers;
    }
}
