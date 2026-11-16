<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/** Recording and undoing matches of a duel game, idempotently on the client's UUID. */
final class MatchesTest extends DatabaseTestCase
{
    private const MATCH = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const OTHER_MATCH = '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b';
    private const NOW = '2026-11-14T20:00:00.000Z';
    /** Anna beats Ben in Schach. */
    private const ANNA_WINS = ['gameId' => 1, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'first'];

    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        foreach (['Anna', 'Ben', 'Daniel'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->session);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Tischtennis', 'kind' => 'duel', 'drawsAllowed' => false], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);
    }

    public function testRecordsAMatchInTheGamesCurrentRun(): void
    {
        $this->send('POST', '/api/games/1/restart', [], $this->session);

        $recorded = $this->put(self::ANNA_WINS);

        self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());
        self::assertSame(['id' => self::MATCH, ...self::ANNA_WINS, 'createdAt' => self::NOW], $this->body($recorded));
        self::assertSame(
            [[
                'id' => self::MATCH,
                'game_id' => '1',
                'first_person_id' => '1',
                'second_person_id' => '2',
                'outcome' => 'first',
                'run' => '2',
                'account_id' => '1',
                'created_at' => '2026-11-14 20:00:00.000',
            ]],
            $this->rows(
                'SELECT id, CAST(game_id AS CHAR) AS game_id, CAST(first_person_id AS CHAR) AS first_person_id,
                        CAST(second_person_id AS CHAR) AS second_person_id, outcome, CAST(run AS CHAR) AS run,
                        CAST(account_id AS CHAR) AS account_id, created_at
                   FROM matches',
            ),
        );
    }

    public function testTheSameRequestAgainAnswers200WithTheOriginalAndRecordsNothing(): void
    {
        $first = $this->put(self::ANNA_WINS);
        $this->clock->advance('PT30S');

        $repeated = $this->put(self::ANNA_WINS);

        self::assertSame(200, $repeated->getStatusCode(), (string) $repeated->getBody());
        self::assertSame($this->body($first), $this->body($repeated));
        self::assertCount(1, $this->rows('SELECT id FROM matches'));
    }

    public function testTheSameIdWithOtherContentIs409RequestConflictAndChangesNothing(): void
    {
        $this->put(self::ANNA_WINS);

        $changed = $this->put([...self::ANNA_WINS, 'outcome' => 'second']);

        self::assertSame(409, $changed->getStatusCode());
        self::assertSame('urn:performance:problem:request-conflict', $this->body($changed)['type']);
        self::assertSame([['outcome' => 'first']], $this->rows('SELECT outcome FROM matches'));
    }

    public function testAnEntrysIdIsTakenForAMatch(): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);
        $this->send('PUT', '/api/entries/' . self::MATCH, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1], $this->session);

        $match = $this->put(self::ANNA_WINS);

        self::assertSame(409, $match->getStatusCode(), 'one id, one request, across entries and matches');
        self::assertSame([], $this->rows('SELECT id FROM matches'));
    }

    public function testUndoDeletesTheMatchAndALaterRetryDoesNotRecreateIt(): void
    {
        $first = $this->put(self::ANNA_WINS);

        $undone = $this->send('DELETE', '/api/matches/' . self::MATCH, session: $this->session);
        $retry = $this->put(self::ANNA_WINS);
        $changed = $this->put([...self::ANNA_WINS, 'outcome' => 'draw']);

        self::assertSame(204, $undone->getStatusCode(), (string) $undone->getBody());
        self::assertSame(200, $retry->getStatusCode(), 'the original answer');
        self::assertSame($this->body($first), $this->body($retry));
        self::assertSame(409, $changed->getStatusCode());
        self::assertSame([], $this->rows('SELECT id FROM matches'));
    }

    public function testAReplayAfterTheGameWasDeletedAnswersTheOriginalAndRecreatesNothing(): void
    {
        $first = $this->put(self::ANNA_WINS);
        $this->send('DELETE', '/api/games/1', session: $this->session);

        $retry = $this->put(self::ANNA_WINS);

        self::assertSame(200, $retry->getStatusCode(), (string) $retry->getBody());
        self::assertSame($this->body($first), $this->body($retry));
        self::assertSame([], $this->rows('SELECT id FROM matches'));
    }

    public function testUndoingAnUnknownMatchIs404(): void
    {
        $response = $this->send('DELETE', '/api/matches/' . self::MATCH, session: $this->session);

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
    }

    public function testAMatchOfAnUnknownGameIs404(): void
    {
        $unknown = $this->put([...self::ANNA_WINS, 'gameId' => 9]);
        $noGame = $this->put(['firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'first']);

        foreach ([$unknown, $noGame] as $response) {
            self::assertSame(404, $response->getStatusCode());
            self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
        }
        self::assertSame([], $this->rows('SELECT id FROM matches UNION ALL SELECT id FROM idempotency_keys'));
    }

    /**
     * @return iterable<string, array{array<string, mixed>, array<string, string>}>
     */
    public static function invalidMatches(): iterable
    {
        yield 'the same person twice' => [[...self::ANNA_WINS, 'secondPersonId' => 1],['secondPersonId' => 'Zwei verschiedene Personen.']];
        yield 'a draw while draws are off' => [['gameId' => 2, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'draw'], ['outcome' => 'Remis ist in diesem Spiel nicht möglich.']];
        yield 'a points game' => [[...self::ANNA_WINS, 'gameId' => 3], ['gameId' => 'Kein Duell.']];
        yield 'an unknown first person' => [[...self::ANNA_WINS, 'firstPersonId' => 9], ['firstPersonId' => 'Person nicht gefunden.']];
        yield 'an unknown second person' => [[...self::ANNA_WINS, 'secondPersonId' => 9], ['secondPersonId' => 'Person nicht gefunden.']];
        yield 'no persons' => [['gameId' => 1, 'outcome' => 'first'], ['firstPersonId' => 'Person nicht gefunden.', 'secondPersonId' => 'Person nicht gefunden.']];
        yield 'an unknown outcome' => [[...self::ANNA_WINS, 'outcome' => 'won'], ['outcome' => 'Sieg des Ersten, des Zweiten oder Remis.']];
    }

    /**
     * @param array<string, mixed>  $json
     * @param array<string, string> $errors
     */
    #[DataProvider('invalidMatches')]
    public function testRefusesAnInvalidMatchWith422(array $json, array $errors): void
    {
        $response = $this->put($json);

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('urn:performance:problem:validation', $this->body($response)['type']);
        self::assertSame($errors, $this->body($response)['errors']);
        self::assertSame([], $this->rows('SELECT id FROM matches UNION ALL SELECT id FROM idempotency_keys'), 'the id stays free');
    }

    public function testADrawCountsWhereDrawsAreAllowed(): void
    {
        $response = $this->put([...self::ANNA_WINS, 'outcome' => 'draw']);

        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
    }

    public function testEveryRouteRequiresASession(): void
    {
        self::assertSame(401, $this->send('PUT', '/api/matches/' . self::MATCH, self::ANNA_WINS)->getStatusCode());
        self::assertSame(401, $this->send('DELETE', '/api/matches/' . self::MATCH)->getStatusCode());
    }

    public function testEachRecordAndUndoAppendsOneMatchEventAndAReplayOrRefusalNone(): void
    {
        $this->createAccount('daniel', 'daniels-passwort');
        $member = $this->signIn('daniel', 'daniels-passwort');
        $this->put(self::ANNA_WINS, session: $member);
        $this->put(self::ANNA_WINS, session: $member);
        $this->put([...self::ANNA_WINS, 'outcome' => 'second'], session: $member);
        $this->put([...self::ANNA_WINS, 'gameId' => 2, 'outcome' => 'draw'], self::OTHER_MATCH, $member);
        $this->put(['gameId' => 1, 'firstPersonId' => 3, 'secondPersonId' => 2, 'outcome' => 'draw'], self::OTHER_MATCH, $member);
        $this->send('DELETE', '/api/matches/' . self::MATCH, session: $member);

        $annaWins = ['game' => 'Schach', 'first' => 'Anna', 'second' => 'Ben', 'outcome' => 'first'];
        self::assertSame(
            [
                ['delete', self::MATCH, $annaWins, null],
                ['create', self::OTHER_MATCH, null, ['game' => 'Schach', 'first' => 'Daniel', 'second' => 'Ben', 'outcome' => 'draw']],
                ['create', self::MATCH, null, $annaWins],
            ],
            array_map(
                static fn(array $event): array => [$event['operation'], $event['subjectId'], $event['before'], $event['after']],
                $this->matchEvents(),
            ),
        );
        foreach ($this->matchEvents() as $event) {
            self::assertSame(['accountId' => 2, 'userName' => 'daniel'], $event['actor']);
            self::assertNull($event['cause']);
        }
    }

    public function testAGameCountsItsMatchesOfEveryRun(): void
    {
        $this->put(self::ANNA_WINS);
        $this->send('POST', '/api/games/1/restart', [], $this->session);
        $this->put([...self::ANNA_WINS, 'outcome' => 'draw'], self::OTHER_MATCH);
        $this->put([...self::ANNA_WINS, 'gameId' => 2], '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c');

        $game = $this->body($this->send('GET', '/api/games/1', session: $this->session));

        self::assertSame(2, $game['matchCount']);
        self::assertSame(0, $game['resultCount']);
    }

    /**
     * A game's deletion takes its matches of every run with it. Before they go, each is
     * recorded as deleted, caused by the game's deletion, with the names it had; a side
     * already cleared by a person's deletion stays null.
     */
    public function testDeletingAGameRecordsTheDeletionOfEachOfItsMatchesOfEveryRun(): void
    {
        $this->put(self::ANNA_WINS);
        $this->send('POST', '/api/games/1/restart', [], $this->session);
        $this->put(['gameId' => 1, 'firstPersonId' => 3, 'secondPersonId' => 2, 'outcome' => 'draw'], self::OTHER_MATCH);
        $this->put([...self::ANNA_WINS, 'gameId' => 2], '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c');
        $this->send('DELETE', '/api/persons/3', session: $this->session);

        $deleted = $this->send('DELETE', '/api/games/1', session: $this->session);

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        $events = $this->rows(
            "SELECT e.subject_kind, e.subject_id, e.operation, e.before_json, c.subject_kind AS cause_kind, c.subject_id AS cause_id
               FROM audit_events e LEFT JOIN audit_events c ON c.id = e.cause_id
              WHERE e.operation = 'delete' AND e.subject_kind IN ('game', 'match') ORDER BY e.id",
        );
        self::assertSame(
            [
                ['game', '1', null, null],
                ['match', self::OTHER_MATCH, ['game' => 'Schach', 'first' => null, 'second' => 'Ben', 'outcome' => 'draw'], ['game', '1']],
                ['match', self::MATCH, ['game' => 'Schach', 'first' => 'Anna', 'second' => 'Ben', 'outcome' => 'first'], ['game', '1']],
            ],
            array_map(
                static fn(array $event): array => [
                    $event['subject_kind'],
                    $event['subject_id'],
                    is_string($event['before_json']) && $event['subject_kind'] === 'match' ? json_decode($event['before_json'], true) : null,
                    $event['cause_kind'] === null ? null : [$event['cause_kind'], $event['cause_id']],
                ],
                $events,
            ),
        );
        self::assertSame([['id' => '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c']], $this->rows('SELECT id FROM matches'), "another game's match stays");
    }

    /**
     * The match events of the audit log, newest first.
     *
     * @return list<array<string, mixed>>
     */
    private function matchEvents(): array
    {
        $events = $this->body($this->send('GET', '/api/audit?limit=100', session: $this->session))['events'];
        self::assertIsArray($events);

        /** @var list<array<string, mixed>> */
        return array_values(array_filter($events, static fn(mixed $event): bool => is_array($event) && $event['subjectKind'] === 'match'));
    }

    /**
     * @param array<string, mixed> $content
     */
    private function put(array $content, string $id = self::MATCH, ?string $session = null): ResponseInterface
    {
        return $this->send('PUT', "/api/matches/{$id}", $content, $session ?? $this->session);
    }
}
