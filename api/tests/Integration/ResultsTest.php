<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/** Recording and undoing results of a points game, idempotently on the client's UUID. */
final class ResultsTest extends DatabaseTestCase
{
    private const RESULT = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const OTHER_RESULT = '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b';
    private const NOW = '2026-11-14T20:00:00.000Z';
    /** Daniel loses 20 points in Rommé. */
    private const DANIEL_MINUS_20 = ['gameId' => 1, 'personId' => 3, 'points' => -20];

    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        foreach (['Anna', 'Ben', 'Daniel'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $this->session);
        }
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Kniffel', 'kind' => 'points'], $this->session);
    }

    public function testRecordsAResultInTheGamesCurrentRun(): void
    {
        $this->send('POST', '/api/games/1/restart', [], $this->session);

        $recorded = $this->put(self::DANIEL_MINUS_20);

        self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());
        self::assertSame(['id' => self::RESULT, ...self::DANIEL_MINUS_20, 'createdAt' => self::NOW], $this->body($recorded));
        self::assertSame(
            [[
                'id' => self::RESULT,
                'game_id' => '1',
                'person_id' => '3',
                'points' => '-20',
                'run' => '2',
                'account_id' => '1',
                'created_at' => '2026-11-14 20:00:00.000',
            ]],
            $this->rows(
                'SELECT id, CAST(game_id AS CHAR) AS game_id, CAST(person_id AS CHAR) AS person_id, CAST(points AS CHAR) AS points,
                        CAST(run AS CHAR) AS run, CAST(account_id AS CHAR) AS account_id, created_at
                   FROM results',
            ),
        );
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function pointsAtTheLimits(): iterable
    {
        yield 'the lowest' => [-9999];
        yield 'zero' => [0];
        yield 'the highest' => [9999];
    }

    #[DataProvider('pointsAtTheLimits')]
    public function testRecordsEveryWholeNumberFromMinus9999To9999(int $points): void
    {
        $recorded = $this->put([...self::DANIEL_MINUS_20, 'points' => $points]);

        self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());
        self::assertSame($points, $this->body($recorded)['points']);
    }

    public function testTheSameRequestAgainAnswers200WithTheOriginalAndRecordsNothing(): void
    {
        $first = $this->put(self::DANIEL_MINUS_20);
        $this->clock->advance('PT30S');

        $repeated = $this->put(self::DANIEL_MINUS_20);

        self::assertSame(200, $repeated->getStatusCode(), (string) $repeated->getBody());
        self::assertSame($this->body($first), $this->body($repeated));
        self::assertCount(1, $this->rows('SELECT id FROM results'));
    }

    public function testTheSameIdWithOtherContentIs409RequestConflictAndChangesNothing(): void
    {
        $this->put(self::DANIEL_MINUS_20);

        $changed = $this->put([...self::DANIEL_MINUS_20, 'points' => 20]);

        self::assertSame(409, $changed->getStatusCode());
        self::assertSame('urn:performance:problem:request-conflict', $this->body($changed)['type']);
        self::assertSame([['points' => -20]], $this->rows('SELECT points FROM results'));
    }

    public function testAMatchsIdIsTakenForAResult(): void
    {
        $this->send('PUT', '/api/matches/' . self::RESULT, ['gameId' => 2, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'first'], $this->session);

        $result = $this->put(self::DANIEL_MINUS_20);

        self::assertSame(409, $result->getStatusCode(), 'one id, one request, across entries, matches and results');
        self::assertSame([], $this->rows('SELECT id FROM results'));
    }

    public function testUndoDeletesTheResultAndALaterRetryDoesNotRecreateIt(): void
    {
        $first = $this->put(self::DANIEL_MINUS_20);

        $undone = $this->send('DELETE', '/api/results/' . self::RESULT, session: $this->session);
        $retry = $this->put(self::DANIEL_MINUS_20);
        $changed = $this->put([...self::DANIEL_MINUS_20, 'points' => 5]);

        self::assertSame(204, $undone->getStatusCode(), (string) $undone->getBody());
        self::assertSame(200, $retry->getStatusCode(), 'the original answer');
        self::assertSame($this->body($first), $this->body($retry));
        self::assertSame(409, $changed->getStatusCode());
        self::assertSame([], $this->rows('SELECT id FROM results'));
    }

    public function testAReplayAfterTheGameWasDeletedAnswersTheOriginalAndRecreatesNothing(): void
    {
        $first = $this->put(self::DANIEL_MINUS_20);
        $this->send('DELETE', '/api/games/1', session: $this->session);

        $retry = $this->put(self::DANIEL_MINUS_20);

        self::assertSame(200, $retry->getStatusCode(), (string) $retry->getBody());
        self::assertSame($this->body($first), $this->body($retry));
        self::assertSame([], $this->rows('SELECT id FROM results'));
    }

    public function testUndoingAnUnknownResultIs404(): void
    {
        $response = $this->send('DELETE', '/api/results/' . self::RESULT, session: $this->session);

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
    }

    public function testAResultOfAnUnknownGameIs404(): void
    {
        $unknown = $this->put([...self::DANIEL_MINUS_20, 'gameId' => 9]);
        $noGame = $this->put(['personId' => 3, 'points' => -20]);

        foreach ([$unknown, $noGame] as $response) {
            self::assertSame(404, $response->getStatusCode());
            self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
        }
        self::assertSame([], $this->rows('SELECT id FROM results UNION ALL SELECT id FROM idempotency_keys'));
    }

    /**
     * @return iterable<string, array{array<string, mixed>, array<string, string>}>
     */
    public static function invalidResults(): iterable
    {
        $range = 'Ganze Zahl von −9.999 bis 9.999.';
        yield 'points below the range' => [[...self::DANIEL_MINUS_20, 'points' => -10000], ['points' => $range]];
        yield 'points above the range' => [[...self::DANIEL_MINUS_20, 'points' => 10000], ['points' => $range]];
        yield 'points that are no whole number' => [[...self::DANIEL_MINUS_20, 'points' => 1.5], ['points' => $range]];
        yield 'points as text' => [[...self::DANIEL_MINUS_20, 'points' => '20'], ['points' => $range]];
        yield 'no points' => [['gameId' => 1, 'personId' => 3], ['points' => $range]];
        yield 'a duel game' => [[...self::DANIEL_MINUS_20, 'gameId' => 2], ['gameId' => 'Kein Punktespiel.']];
        yield 'an unknown person' => [[...self::DANIEL_MINUS_20, 'personId' => 9], ['personId' => 'Person nicht gefunden.']];
        yield 'no person' => [['gameId' => 1, 'points' => -20], ['personId' => 'Person nicht gefunden.']];
        yield 'no person and no points' => [['gameId' => 1], ['personId' => 'Person nicht gefunden.', 'points' => $range]];
    }

    /**
     * @param array<string, mixed>  $json
     * @param array<string, string> $errors
     */
    #[DataProvider('invalidResults')]
    public function testRefusesAnInvalidResultWith422(array $json, array $errors): void
    {
        $response = $this->put($json);

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('urn:performance:problem:validation', $this->body($response)['type']);
        self::assertSame($errors, $this->body($response)['errors']);
        self::assertSame([], $this->rows('SELECT id FROM results UNION ALL SELECT id FROM idempotency_keys'), 'the id stays free');
    }

    public function testEveryRouteRequiresASession(): void
    {
        self::assertSame(401, $this->send('PUT', '/api/results/' . self::RESULT, self::DANIEL_MINUS_20)->getStatusCode());
        self::assertSame(401, $this->send('DELETE', '/api/results/' . self::RESULT)->getStatusCode());
    }

    public function testEachRecordAndUndoAppendsOneResultEventAndAReplayOrRefusalNone(): void
    {
        $this->createAccount('ben', 'bens-passwort');
        $member = $this->signIn('ben', 'bens-passwort');
        $this->put(self::DANIEL_MINUS_20, session: $member);
        $this->put(self::DANIEL_MINUS_20, session: $member);
        $this->put([...self::DANIEL_MINUS_20, 'points' => 20], session: $member);
        $this->put([...self::DANIEL_MINUS_20, 'gameId' => 2], self::OTHER_RESULT, $member);
        $this->put(['gameId' => 3, 'personId' => 1, 'points' => 250], self::OTHER_RESULT, $member);
        $this->send('DELETE', '/api/results/' . self::RESULT, session: $member);

        $danielMinus20 = ['game' => 'Rommé', 'person' => 'Daniel', 'points' => -20, 'pending' => true];
        self::assertSame(
            [
                ['delete', self::RESULT, $danielMinus20, null],
                ['create', self::OTHER_RESULT, null, ['game' => 'Kniffel', 'person' => 'Anna', 'points' => 250, 'pending' => true]],
                ['create', self::RESULT, null, $danielMinus20],
            ],
            array_map(
                static fn(array $event): array => [$event['operation'], $event['subjectId'], $event['before'], $event['after']],
                $this->resultEvents(),
            ),
        );
        foreach ($this->resultEvents() as $event) {
            self::assertSame(['accountId' => 2, 'userName' => 'ben'], $event['actor']);
            self::assertNull($event['cause']);
        }
    }

    public function testAGameCountsItsResultsOfEveryRun(): void
    {
        $this->put(self::DANIEL_MINUS_20);
        $this->send('POST', '/api/games/1/restart', [], $this->session);
        $this->put([...self::DANIEL_MINUS_20, 'points' => 5], self::OTHER_RESULT);
        $this->put([...self::DANIEL_MINUS_20, 'gameId' => 3], '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c');

        $game = $this->body($this->send('GET', '/api/games/1', session: $this->session));

        self::assertSame(2, $game['resultCount']);
        self::assertSame(0, $game['matchCount']);
    }

    /**
     * A game's deletion takes its results of every run with it. Before they go, each is
     * recorded as deleted, caused by the game's deletion, with the names and the
     * verification state it had.
     */
    public function testDeletingAGameRecordsTheDeletionOfEachOfItsResultsOfEveryRun(): void
    {
        $this->put(self::DANIEL_MINUS_20);
        $this->send('POST', '/api/games/1/restart', [], $this->session);
        $this->put(['gameId' => 1, 'personId' => 1, 'points' => 35], self::OTHER_RESULT);
        $this->verifyDirectly('results', self::OTHER_RESULT);
        $this->put([...self::DANIEL_MINUS_20, 'gameId' => 3], '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c');

        $deleted = $this->send('DELETE', '/api/games/1', session: $this->session);

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        $events = $this->rows(
            "SELECT e.subject_kind, e.subject_id, e.before_json, c.subject_kind AS cause_kind, c.subject_id AS cause_id
               FROM audit_events e LEFT JOIN audit_events c ON c.id = e.cause_id
              WHERE e.operation = 'delete' AND e.subject_kind IN ('game', 'result') ORDER BY e.id",
        );
        self::assertSame(
            [
                ['game', '1', null, null],
                ['result', self::OTHER_RESULT, ['game' => 'Rommé', 'person' => 'Anna', 'points' => 35, 'pending' => false], ['game', '1']],
                ['result', self::RESULT, ['game' => 'Rommé', 'person' => 'Daniel', 'points' => -20, 'pending' => true], ['game', '1']],
            ],
            array_map(
                static fn(array $event): array => [
                    $event['subject_kind'],
                    $event['subject_id'],
                    is_string($event['before_json']) && $event['subject_kind'] === 'result' ? json_decode($event['before_json'], true) : null,
                    $event['cause_kind'] === null ? null : [$event['cause_kind'], $event['cause_id']],
                ],
                $events,
            ),
        );
        self::assertSame([['id' => '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c']], $this->rows('SELECT id FROM results'), "another game's result stays");
    }

    /**
     * The result events of the audit log, newest first.
     *
     * @return list<array<string, mixed>>
     */
    private function resultEvents(): array
    {
        $events = $this->body($this->send('GET', '/api/audit?limit=100', session: $this->session))['events'];
        self::assertIsArray($events);

        /** @var list<array<string, mixed>> */
        return array_values(array_filter($events, static fn(mixed $event): bool => is_array($event) && $event['subjectKind'] === 'result'));
    }

    /**
     * @param array<string, mixed> $content
     */
    private function put(array $content, string $id = self::RESULT, ?string $session = null): ResponseInterface
    {
        return $this->send('PUT', "/api/results/{$id}", $content, $session ?? $this->session);
    }
}
