<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;

/**
 * Deleting a person keeps every match they played: their side is cleared, the other side's
 * outcome still counts, and the audit log records what happened to each match. Deleting an
 * account keeps the matches it recorded.
 */
final class PersonDeletionTest extends DatabaseTestCase
{
    private const ANNA_BEATS_BEN = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const BEN_DRAWS_CARLA = '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b';
    private const CARLA_BEATS_ANNA = '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c';
    private const ANNA = 1;
    private const BEN = 2;
    private const CARLA = 3;
    private const DANIEL = 4;

    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        foreach (['Anna', 'Ben', 'Carla', 'Daniel'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->session);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->record(self::ANNA_BEATS_BEN, self::ANNA, self::BEN, 'first');
        $this->record(self::BEN_DRAWS_CARLA, self::BEN, self::CARLA, 'draw');
        $this->record(self::CARLA_BEATS_ANNA, self::CARLA, self::ANNA, 'first');
    }

    public function testDeletingAPersonKeepsTheirMatchesWithTheirSideClearedAndRanksThemNowhere(): void
    {
        $deleted = $this->send('DELETE', '/api/persons/' . self::BEN, session: $this->session);

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        self::assertSame(
            [
                [self::BEN_DRAWS_CARLA, null, (string) self::CARLA, 'draw'],
                [self::CARLA_BEATS_ANNA, (string) self::CARLA, (string) self::ANNA, 'first'],
                [self::ANNA_BEATS_BEN, (string) self::ANNA, null, 'first'],
            ],
            $this->matches(),
        );
        self::assertSame(['Carla', 'Anna'], array_column($this->standings(), 'name'), 'Ben ranks nowhere');
    }

    /**
     * The ranking uses each match's stored outcome, so clearing one side leaves the other
     * side's win, draw or loss exactly as it was.
     */
    public function testTheSurvivingSidesWinDrawOrLossIsUnchangedAfterTheOtherSideIsCleared(): void
    {
        $before = array_values(array_filter($this->standings(), static fn(array $row): bool => $row['personId'] !== self::BEN));

        $this->send('DELETE', '/api/persons/' . self::BEN, session: $this->session);

        self::assertSame($before, $this->standings());
        self::assertSame(
            [
                ['personId' => self::CARLA, 'points' => 1.5, 'wins' => 1, 'draws' => 1, 'losses' => 0, 'played' => 2],
                ['personId' => self::ANNA, 'points' => 1, 'wins' => 1, 'draws' => 0, 'losses' => 1, 'played' => 2],
            ],
            array_map(static fn(array $row): array => array_diff_key($row, ['name' => true]), $this->standings()),
        );
    }

    public function testAMatchWhoseTwoPlayersAreBothDeletedStaysStoredAndCountsForNoOne(): void
    {
        $this->send('DELETE', '/api/persons/' . self::ANNA, session: $this->session);
        $this->send('DELETE', '/api/persons/' . self::BEN, session: $this->session);

        self::assertContains([self::ANNA_BEATS_BEN, null, null, 'first'], $this->matches());
        self::assertSame(
            [['personId' => self::CARLA, 'points' => 1.5]],
            array_map(static fn(array $row): array => ['personId' => $row['personId'], 'points' => $row['points']], $this->standings()),
        );
    }

    /**
     * The person's deletion is recorded first, then its entries, then one update per match
     * that named the person: before still names them, after has their side cleared, and each
     * is caused by the person's deletion. Matches of others record nothing.
     */
    public function testTheDeletionRecordsOneUpdatePerAffectedMatchCausedByThePersonsDeletion(): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);
        $entry = '7d3e2f1a-0b9c-4d8e-9f7a-6b5c4d3e2f1a';
        $this->send('PUT', "/api/entries/{$entry}", ['personId' => self::BEN, 'drinkId' => 1, 'quantity' => 1], $this->session);

        $this->send('DELETE', '/api/persons/' . self::BEN, session: $this->session);

        $events = $this->rows(
            "SELECT e.id, e.subject_kind, e.subject_id, e.operation, e.before_json, e.after_json, e.cause_id
               FROM audit_events e WHERE e.id > (SELECT MAX(id) FROM audit_events WHERE subject_kind = 'entry' AND operation = 'create')
              ORDER BY e.id",
        );
        $cause = $events[0]['id'];
        self::assertSame(
            [
                ['person', (string) self::BEN, 'delete', ['name' => 'Ben'], null, null],
                ['entry', $entry, 'delete', 'the entry', null, $cause],
                [
                    'match',
                    self::BEN_DRAWS_CARLA,
                    'update',
                    ['game' => 'Schach', 'first' => 'Ben', 'second' => 'Carla', 'outcome' => 'draw'],
                    ['game' => 'Schach', 'first' => null, 'second' => 'Carla', 'outcome' => 'draw'],
                    $cause,
                ],
                [
                    'match',
                    self::ANNA_BEATS_BEN,
                    'update',
                    ['game' => 'Schach', 'first' => 'Anna', 'second' => 'Ben', 'outcome' => 'first'],
                    ['game' => 'Schach', 'first' => 'Anna', 'second' => null, 'outcome' => 'first'],
                    $cause,
                ],
            ],
            array_map(
                static fn(array $event): array => [
                    $event['subject_kind'],
                    $event['subject_id'],
                    $event['operation'],
                    $event['subject_kind'] === 'entry' ? 'the entry' : self::decoded($event['before_json']),
                    self::decoded($event['after_json']),
                    $event['cause_id'],
                ],
                $events,
            ),
        );
    }

    public function testDeletingAnAccountKeepsTheMatchesItRecordedWithTheRecordingAccountCleared(): void
    {
        $this->createAccount('daniel', 'daniels-startpasswort');
        $daniel = $this->signIn('daniel', 'daniels-startpasswort');
        $match = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
        $this->record($match, self::DANIEL, self::ANNA, 'second', $daniel);
        $standings = $this->standings();

        $deleted = $this->send('DELETE', '/api/accounts/2', session: $this->session);

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        self::assertSame([['id' => $match, 'account_id' => null]], $this->rows("SELECT id, account_id FROM matches WHERE id = '{$match}'"));
        self::assertSame($standings, $this->standings());
    }

    private function record(string $id, int $first, int $second, string $outcome, ?string $session = null): void
    {
        $response = $this->send(
            'PUT',
            "/api/matches/{$id}",
            ['gameId' => 1, 'firstPersonId' => $first, 'secondPersonId' => $second, 'outcome' => $outcome],
            $session ?? $this->session,
        );
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
    }

    /**
     * Every stored match as id, first and second person id, and outcome, in id order.
     *
     * @return list<list<mixed>>
     */
    private function matches(): array
    {
        return array_map(
            static fn(array $row): array => array_values($row),
            $this->rows(
                'SELECT id, CAST(first_person_id AS CHAR) AS first, CAST(second_person_id AS CHAR) AS second, outcome
                   FROM matches ORDER BY id',
            ),
        );
    }

    /**
     * The game's ranking rows.
     *
     * @return list<array<string, mixed>>
     */
    private function standings(): array
    {
        $rows = $this->body($this->send('GET', '/api/games/1/standings', session: $this->session))['rows'];
        self::assertIsArray($rows);

        /** @var list<array<string, mixed>> */
        return $rows;
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function decoded(mixed $json): ?array
    {
        if (!is_string($json)) {
            return null;
        }
        $decoded = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        self::assertIsArray($decoded);

        /** @var array<string, mixed> */
        return $decoded;
    }
}
