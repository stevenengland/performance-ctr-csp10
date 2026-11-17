<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use Performance\Tests\Support\DatabaseTestCase;

/**
 * Deleting an account while rows it recorded still wait (PRD #61, user story 21): the recorder
 * is unknown from then on, so any other account may verify or reject those rows, and the audit
 * log still names who recorded each row and who decided on it.
 */
final class DeletedRecorderDecisionTest extends DatabaseTestCase
{
    private const ANNA_ID = 2;
    private const BEN_ID = 3;

    private string $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->signIn();
        $this->createAccount('anna', 'annas-startpasswort');
        $this->createAccount('ben', 'bens-startpasswort');
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->admin);
        $this->send('POST', '/api/persons', ['name' => 'Erik'], $this->admin);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->admin);
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->admin);
        $this->send('POST', '/api/games', ['name' => 'Wizard', 'kind' => 'points'], $this->admin);
    }

    /**
     * @return iterable<string, array{string, array<string, int|string>, string, string}>
     */
    public static function decisions(): iterable
    {
        $rows = [
            'entry' => ['entries', ['personId' => 1, 'drinkId' => 1, 'quantity' => 1]],
            'match' => ['matches', ['gameId' => 1, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'first']],
            'result' => ['results', ['gameId' => 2, 'personId' => 1, 'points' => 30]],
        ];
        foreach ($rows as $kind => [$route, $data]) {
            yield "{$kind} verified" => [$route, $data, 'PUT', 'verify'];
            yield "{$kind} rejected" => [$route, $data, 'DELETE', 'reject'];
        }
    }

    /**
     * @param array<string, int|string> $data
     */
    #[DataProvider('decisions')]
    public function testAnyOtherAccountDecidesOnARowWhoseRecorderWasDeletedAndTheAuditLogKeepsBoth(
        string $route,
        array $data,
        string $method,
        string $operation,
    ): void {
        $id = '00000000-0000-4000-8000-000000000001';
        $recorded = $this->send('PUT', "/api/{$route}/{$id}", $data, $this->signIn('anna', 'annas-startpasswort'));
        self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());
        self::assertSame(204, $this->send('DELETE', '/api/accounts/' . self::ANNA_ID, session: $this->admin)->getStatusCode());

        $decided = $this->send($method, "/api/{$route}/{$id}/verification", $method === 'PUT' ? [] : null, $this->signIn('ben', 'bens-startpasswort'));

        self::assertSame(204, $decided->getStatusCode(), (string) $decided->getBody());
        self::assertSame(
            [
                ['create', ['accountId' => self::ANNA_ID, 'userName' => 'anna']],
                [$operation, ['accountId' => self::BEN_ID, 'userName' => 'ben']],
            ],
            $this->eventsOn($id),
        );
    }

    /**
     * The operation and actor of every audit event on the row, oldest first.
     *
     * @return list<array{mixed, mixed}>
     */
    private function eventsOn(string $subjectId): array
    {
        $events = $this->body($this->send('GET', '/api/audit?limit=100', session: $this->admin))['events'];
        self::assertIsList($events);
        $found = [];
        foreach (array_reverse($events) as $event) {
            self::assertIsArray($event);
            if ($event['subjectId'] === $subjectId) {
                $found[] = [$event['operation'], $event['actor']];
            }
        }

        return $found;
    }
}
