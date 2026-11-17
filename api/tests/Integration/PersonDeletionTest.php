<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;

/**
 * Deleting a person keeps every match they played: their side is cleared, the other side's
 * outcome still counts, and the audit log records what happened to each match. Their results
 * go with them, each recorded as deleted. Deleting an account keeps the matches and results
 * it recorded.
 */
final class PersonDeletionTest extends DatabaseTestCase
{
    private const ANNA_BEATS_BEN = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const BEN_DRAWS_CARLA = '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b';
    private const CARLA_BEATS_ANNA = '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c';
    /** Results, in id order. */
    private const RESULT = '3a4b5c6d-7e8f-4a0b-9c1d-2e3f4a5b6c7d';
    private const OTHER_RESULT = '4b5c6d7e-8f9a-4b1c-8d2e-3f4a5b6c7d8e';
    private const THIRD_RESULT = '5c6d7e8f-9a0b-4c2d-9e3f-4a5b6c7d8e9f';
    private const FOURTH_RESULT = '6d7e8f9a-0b1c-4d3e-8f4a-5b6c7d8e9f0a';
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
            $this->storedMatches(),
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
                ['personId' => self::CARLA, 'points' => 1.5, 'wins' => 1, 'draws' => 1, 'losses' => 0, 'played' => 2, 'pendingCount' => 0],
                ['personId' => self::ANNA, 'points' => 1, 'wins' => 1, 'draws' => 0, 'losses' => 1, 'played' => 2, 'pendingCount' => 0],
            ],
            array_map(static fn(array $row): array => array_diff_key($row, ['name' => true]), $this->standings()),
        );
    }

    public function testAMatchWhoseTwoPlayersAreBothDeletedStaysStoredAndCountsForNoOne(): void
    {
        $this->send('DELETE', '/api/persons/' . self::ANNA, session: $this->session);
        $this->send('DELETE', '/api/persons/' . self::BEN, session: $this->session);

        self::assertContains([self::ANNA_BEATS_BEN, null, null, 'first'], $this->storedMatches());
        self::assertSame(
            [['personId' => self::CARLA, 'points' => 1.5]],
            array_map(static fn(array $row): array => ['personId' => $row['personId'], 'points' => $row['points']], $this->standings()),
        );
    }

    public function testReadingAPersonCountsTheirMatchesOnEitherSideNextToTheirEntries(): void
    {
        self::assertSame(
            ['id' => self::BEN, 'name' => 'Ben', 'photoUrl' => null, 'entryCount' => 0, 'matchCount' => 2, 'resultCount' => 0],
            $this->body($this->send('GET', '/api/persons/' . self::BEN, session: $this->session)),
        );
        self::assertSame(0, $this->body($this->send('GET', '/api/persons/' . self::DANIEL, session: $this->session))['matchCount']);
    }

    public function testReadingAPersonCountsTheirResultsOfEveryGameAndRun(): void
    {
        $this->pointsGames();
        $this->score(self::RESULT, 2, self::BEN, 15);
        $this->send('POST', '/api/games/2/restart', [], $this->session);
        $this->score(self::OTHER_RESULT, 2, self::BEN, -5);
        $this->score(self::THIRD_RESULT, 3, self::BEN, 120);
        $this->score(self::FOURTH_RESULT, 3, self::CARLA, 80);

        $ben = $this->body($this->send('GET', '/api/persons/' . self::BEN, session: $this->session));

        self::assertSame(3, $ben['resultCount']);
        self::assertSame(2, $ben['matchCount']);
    }

    public function testDeletingAPersonDeletesTheirResultsOfEveryGameAndRunAndRanksThemNowhere(): void
    {
        $this->pointsGames();
        $this->score(self::RESULT, 2, self::BEN, 15);
        $this->send('POST', '/api/games/2/restart', [], $this->session);
        $this->score(self::OTHER_RESULT, 2, self::BEN, -5);
        $this->score(self::THIRD_RESULT, 2, self::CARLA, 80);

        $deleted = $this->send('DELETE', '/api/persons/' . self::BEN, session: $this->session);

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        self::assertSame([['id' => self::THIRD_RESULT]], $this->rows('SELECT id FROM results'));
        self::assertSame(['Carla'], array_column($this->standings(2), 'name'));
    }

    /**
     * After the person's deletion and its matches' updates, one delete per result of the
     * person, in result id order, each caused by the person's deletion with the names it had.
     * Results of others record nothing. A pending result's snapshot says it was pending.
     */
    public function testTheDeletionRecordsOneDeletePerResultCausedByThePersonsDeletion(): void
    {
        $this->pointsGames();
        $this->score(self::RESULT, 2, self::BEN, 15);
        $this->score(self::OTHER_RESULT, 3, self::BEN, -5, verified: false);
        $this->score(self::THIRD_RESULT, 2, self::CARLA, 80);

        $this->send('DELETE', '/api/persons/' . self::BEN, session: $this->session);

        $events = $this->rows(
            "SELECT e.id, e.subject_kind, e.subject_id, e.operation, e.before_json, e.after_json, e.cause_id
               FROM audit_events e WHERE e.id >= (SELECT MAX(id) FROM audit_events WHERE subject_kind = 'person' AND operation = 'delete')
              ORDER BY e.id",
        );
        $cause = $events[0]['id'];
        self::assertSame(
            [
                ['person', (string) self::BEN, 'delete', null],
                ['match', self::BEN_DRAWS_CARLA, 'update', $cause],
                ['match', self::ANNA_BEATS_BEN, 'update', $cause],
                ['result', self::RESULT, 'delete', $cause],
                ['result', self::OTHER_RESULT, 'delete', $cause],
            ],
            array_map(static fn(array $event): array => [$event['subject_kind'], $event['subject_id'], $event['operation'], $event['cause_id']], $events),
        );
        self::assertSame(
            [['game' => 'Rommé', 'person' => 'Ben', 'points' => 15, 'pending' => false], ['game' => 'Kniffel', 'person' => 'Ben', 'points' => -5, 'pending' => true]],
            array_map(static fn(array $event): ?array => self::decoded($event['before_json']), array_slice($events, 3)),
        );
        self::assertSame([null, null], array_map(static fn(array $event): ?array => self::decoded($event['after_json']), array_slice($events, 3)));
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
                ['person', (string) self::BEN, 'delete', ['name' => 'Ben', 'photo' => null], null, null],
                ['entry', $entry, 'delete', 'the entry', null, $cause],
                [
                    'match',
                    self::BEN_DRAWS_CARLA,
                    'update',
                    ['game' => 'Schach', 'first' => 'Ben', 'second' => 'Carla', 'outcome' => 'draw', 'pending' => false],
                    ['game' => 'Schach', 'first' => null, 'second' => 'Carla', 'outcome' => 'draw', 'pending' => false],
                    $cause,
                ],
                [
                    'match',
                    self::ANNA_BEATS_BEN,
                    'update',
                    ['game' => 'Schach', 'first' => 'Anna', 'second' => 'Ben', 'outcome' => 'first', 'pending' => false],
                    ['game' => 'Schach', 'first' => 'Anna', 'second' => null, 'outcome' => 'first', 'pending' => false],
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

    public function testDeletingAnAccountKeepsTheResultsItRecordedWithTheRecordingAccountCleared(): void
    {
        $this->pointsGames();
        $this->createAccount('daniel', 'daniels-startpasswort');
        $this->score(self::RESULT, 2, self::DANIEL, 15, $this->signIn('daniel', 'daniels-startpasswort'));
        $standings = $this->standings(2);

        $deleted = $this->send('DELETE', '/api/accounts/2', session: $this->session);

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        self::assertSame([['id' => self::RESULT, 'account_id' => null]], $this->rows('SELECT id, account_id FROM results'));
        self::assertSame($standings, $this->standings(2));
    }

    /** Rommé (game 2) and Kniffel (game 3), next to Schach. */
    private function pointsGames(): void
    {
        foreach (['Rommé', 'Kniffel'] as $name) {
            $this->send('POST', '/api/games', ['name' => $name, 'kind' => 'points'], $this->session);
        }
    }

    /** Records a result, verified unless said otherwise, so it counts: these tests are about deletions, not about the four-eyes rule. */
    private function score(string $id, int $game, int $person, int $points, ?string $session = null, bool $verified = true): void
    {
        $response = $this->send('PUT', "/api/results/{$id}", ['gameId' => $game, 'personId' => $person, 'points' => $points], $session ?? $this->session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        if ($verified) {
            $this->verifyDirectly('results', $id);
        }
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
        // Verified, so it counts: these tests are about deletions, not about the four-eyes rule.
        $this->verifyDirectly('matches', $id);
    }

    /**
     * Every stored match as id, first and second person id, and outcome, in id order.
     *
     * @return list<list<mixed>>
     */
    private function storedMatches(): array
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
     * A game's ranking rows, Schach's unless another game is named.
     *
     * @return list<array<string, mixed>>
     */
    private function standings(int $game = 1): array
    {
        $rows = $this->body($this->send('GET', "/api/games/{$game}/standings", session: $this->session))['rows'];
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
