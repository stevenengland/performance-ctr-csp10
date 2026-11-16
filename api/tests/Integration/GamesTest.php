<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use PDO;
use PDOException;
use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\DataRevision;
use Performance\Domain\GameDependents;
use Performance\Domain\Games\Games;
use Performance\Http\Database;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;

/** Creating, listing, reading, editing, restarting and deleting games. */
final class GamesTest extends DatabaseTestCase
{
    private const NOW = '2026-11-14T20:00:00.000Z';
    private const LOCK_WAIT_TIMEOUT = 1205;

    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
    }

    public function testCreatesADuelAndAPointsGameWithTheirDefaultSettingsInTheirFirstRunFromNow(): void
    {
        $duel = $this->send('POST', '/api/games', ['name' => '  Schach ', 'kind' => 'duel'], $this->session);
        $points = $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);

        self::assertSame(201, $duel->getStatusCode(), (string) $duel->getBody());
        self::assertSame(self::game(1, 'Schach', 'duel'), $this->body($duel));
        self::assertSame(201, $points->getStatusCode(), (string) $points->getBody());
        self::assertSame(self::game(2, 'Rommé', 'points'), $this->body($points));
        self::assertSame(
            [
                ['id' => '1', 'run' => '1', 'started_at' => '2026-11-14 20:00:00.000'],
                ['id' => '2', 'run' => '1', 'started_at' => '2026-11-14 20:00:00.000'],
            ],
            $this->rows('SELECT CAST(id AS CHAR) AS id, CAST(run AS CHAR) AS run, started_at FROM games ORDER BY id'),
        );
    }

    public function testCreatesGamesWithTheSettingOfTheirKind(): void
    {
        $duel = $this->send('POST', '/api/games', ['name' => 'Tischtennis', 'kind' => 'duel', 'drawsAllowed' => false], $this->session);
        $points = $this->send('POST', '/api/games', ['name' => 'Golf', 'kind' => 'points', 'lowerWins' => true], $this->session);

        self::assertSame(self::game(1, 'Tischtennis', 'duel', drawsAllowed: false), $this->body($duel));
        self::assertSame(self::game(2, 'Golf', 'points', lowerWins: true), $this->body($points));
    }

    public function testTheOtherKindsSettingIsIgnored(): void
    {
        $duel = $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel', 'lowerWins' => true], $this->session);
        $points = $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points', 'drawsAllowed' => false], $this->session);

        self::assertSame(self::game(1, 'Schach', 'duel'), $this->body($duel));
        self::assertSame(self::game(2, 'Rommé', 'points'), $this->body($points));
    }

    public function testListsGamesAlphabeticallyIgnoringCase(): void
    {
        foreach (['schach' => 'duel', 'Rommé' => 'points', 'Tischtennis' => 'duel', 'billard' => 'duel'] as $name => $kind) {
            $this->send('POST', '/api/games', ['name' => $name, 'kind' => $kind], $this->session);
        }

        $list = $this->send('GET', '/api/games', session: $this->session);

        self::assertSame(200, $list->getStatusCode());
        self::assertSame(
            [self::game(4, 'billard', 'duel'), self::game(2, 'Rommé', 'points'), self::game(1, 'schach', 'duel'), self::game(3, 'Tischtennis', 'duel')],
            $this->body($list)['games'],
        );
    }

    /**
     * @return iterable<string, array{array<string, mixed>, array<string, string>}>
     */
    public static function invalidGames(): iterable
    {
        yield 'a blank name' => [['name' => '   ', 'kind' => 'duel'], ['name' => '1 bis 40 Zeichen.']];
        yield 'a name of 41 characters' => [['name' => str_repeat('x', 41), 'kind' => 'points'], ['name' => '1 bis 40 Zeichen.']];
        yield 'an unknown kind' => [['name' => 'Schach', 'kind' => 'chess'], ['kind' => 'Duell oder Punktespiel.']];
        yield 'no kind' => [['name' => 'Schach'], ['kind' => 'Duell oder Punktespiel.']];
        yield 'a kind that is no text' => [['name' => 'Schach', 'kind' => 1], ['kind' => 'Duell oder Punktespiel.']];
        yield 'neither name nor kind' => [[], ['name' => '1 bis 40 Zeichen.', 'kind' => 'Duell oder Punktespiel.']];
        yield 'a setting that is no yes or no' => [['name' => 'Schach', 'kind' => 'duel', 'drawsAllowed' => 'ja'], ['drawsAllowed' => 'Ja oder nein.']];
    }

    /**
     * @param array<string, mixed>  $json
     * @param array<string, string> $errors
     */
    #[DataProvider('invalidGames')]
    public function testRefusesAnInvalidGameWith422(array $json, array $errors): void
    {
        $response = $this->send('POST', '/api/games', $json, $this->session);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame('urn:performance:problem:validation', $this->body($response)['type']);
        self::assertSame($errors, $this->body($response)['errors']);
        self::assertSame([], $this->rows('SELECT id FROM games'));
    }

    public function testANameIsUniqueAmongGamesIgnoringCase(): void
    {
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/persons', ['name' => 'Rommé'], $this->session);

        $taken = $this->send('POST', '/api/games', ['name' => ' SCHACH ', 'kind' => 'points'], $this->session);
        $personsName = $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);

        self::assertSame(409, $taken->getStatusCode());
        self::assertSame('urn:performance:problem:duplicate-name', $this->body($taken)['type']);
        self::assertSame(201, $personsName->getStatusCode(), 'games have names of their own');
    }

    public function testReadsAGameWithTheCountOfItsMatchesOrResults(): void
    {
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);

        $duel = $this->send('GET', '/api/games/1', session: $this->session);
        $points = $this->send('GET', '/api/games/2', session: $this->session);
        $unknown = $this->send('GET', '/api/games/3', session: $this->session);

        self::assertSame(200, $duel->getStatusCode());
        self::assertSame([...self::game(1, 'Schach', 'duel'), 'matchCount' => 0, 'resultCount' => 0], $this->body($duel));
        self::assertSame([...self::game(2, 'Rommé', 'points'), 'matchCount' => 0, 'resultCount' => 0], $this->body($points));
        self::assertSame(404, $unknown->getStatusCode());
        self::assertSame('urn:performance:problem:not-found', $this->body($unknown)['type']);
    }

    public function testRenamesAGameAndChangesTheSettingOfItsKind(): void
    {
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);
        $this->clock->advance('P1D');

        $duel = $this->send('PATCH', '/api/games/1', ['name' => ' Blitzschach ', 'drawsAllowed' => false], $this->session);
        $points = $this->send('PATCH', '/api/games/2', ['name' => 'Rommé', 'kind' => 'points', 'lowerWins' => true], $this->session);
        $nameOnly = $this->send('PATCH', '/api/games/1', ['name' => 'Schach'], $this->session);

        self::assertSame(200, $duel->getStatusCode(), (string) $duel->getBody());
        self::assertSame(self::game(1, 'Blitzschach', 'duel', drawsAllowed: false), $this->body($duel));
        self::assertSame(200, $points->getStatusCode(), (string) $points->getBody());
        self::assertSame(self::game(2, 'Rommé', 'points', lowerWins: true), $this->body($points));
        self::assertSame(self::game(1, 'Schach', 'duel', drawsAllowed: false), $this->body($nameOnly), 'an omitted setting stays');
        self::assertSame(
            [self::game(2, 'Rommé', 'points', lowerWins: true), self::game(1, 'Schach', 'duel', drawsAllowed: false)],
            $this->body($this->send('GET', '/api/games', session: $this->session))['games'],
        );
    }

    /**
     * @return iterable<string, array{array<string, mixed>, int, array<string, string>|null}>
     */
    public static function invalidEdits(): iterable
    {
        yield 'another kind' => [['name' => 'Schach', 'kind' => 'points'], 422, ['kind' => 'Die Art eines Spiels ist fest.']];
        yield 'an unknown kind' => [['name' => 'Schach', 'kind' => 'chess'], 422, ['kind' => 'Die Art eines Spiels ist fest.']];
        yield 'a blank name' => [['name' => ''], 422, ['name' => '1 bis 40 Zeichen.']];
        yield 'a setting that is no yes or no' => [['name' => 'Schach', 'drawsAllowed' => 1], 422, ['drawsAllowed' => 'Ja oder nein.']];
        yield "another game's name" => [['name' => 'rommé'], 409, null];
    }

    /**
     * @param array<string, mixed>       $json
     * @param array<string, string>|null $errors
     */
    #[DataProvider('invalidEdits')]
    public function testRefusesAnInvalidEditAndKeepsTheGame(array $json, int $status, ?array $errors): void
    {
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);

        $response = $this->send('PATCH', '/api/games/1', $json, $this->session);

        self::assertSame($status, $response->getStatusCode());
        self::assertSame($errors, $this->body($response)['errors'] ?? null);
        self::assertSame(
            [self::game(2, 'Rommé', 'points'), self::game(1, 'Schach', 'duel')],
            $this->body($this->send('GET', '/api/games', session: $this->session))['games'],
        );
    }

    public function testEditingRestartingOrDeletingAnUnknownGameIs404(): void
    {
        $edit = $this->send('PATCH', '/api/games/1', ['name' => 'Schach'], $this->session);
        $restart = $this->send('POST', '/api/games/1/restart', [], $this->session);
        $delete = $this->send('DELETE', '/api/games/1', session: $this->session);
        $notAnId = $this->send('GET', '/api/games/abc', session: $this->session);

        foreach ([$edit, $restart, $delete, $notAnId] as $response) {
            self::assertSame(404, $response->getStatusCode());
            self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
        }
    }

    public function testEveryRouteRequiresASession(): void
    {
        self::assertSame(401, $this->send('GET', '/api/games')->getStatusCode());
        self::assertSame(401, $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'])->getStatusCode());
        self::assertSame(401, $this->send('POST', '/api/games/1/restart')->getStatusCode());
    }

    public function testARestartStartsTheNextRunFromNow(): void
    {
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points', 'lowerWins' => true], $this->session);
        $this->clock->advance('P1DT2H30M');

        $first = $this->send('POST', '/api/games/1/restart', [], $this->session);
        $this->clock->advance('PT1H');
        $second = $this->send('POST', '/api/games/1/restart', [], $this->session);

        self::assertSame(200, $first->getStatusCode(), (string) $first->getBody());
        self::assertSame(self::game(1, 'Rommé', 'points', lowerWins: true, startedAt: '2026-11-15T22:30:00.000Z'), $this->body($first));
        self::assertSame('2026-11-15T23:30:00.000Z', $this->body($second)['startedAt']);
        self::assertSame(
            [['run' => '3', 'started_at' => '2026-11-15 23:30:00.000']],
            $this->rows('SELECT CAST(run AS CHAR) AS run, started_at FROM games'),
        );
    }

    /**
     * A recording holds the game row under a shared lock while it copies the run; a restart
     * needs the row exclusively, so it waits for the recording instead of slipping between
     * its read of the run and its commit.
     */
    public function testARestartWaitsForTheGameRowThatARecordingHolds(): void
    {
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);
        $recording = $this->otherSession();
        $recording->beginTransaction();
        $recording->prepare('SELECT id FROM games WHERE id = 1 LOCK IN SHARE MODE')->execute();

        try {
            $this->games($this->impatientSession())->restart($this->actor(), 1);
            self::fail('the restart did not wait for the game row');
        } catch (PDOException $failure) {
            self::assertSame(self::LOCK_WAIT_TIMEOUT, $failure->errorInfo[1] ?? null);
        } finally {
            $recording->rollBack();
        }
        self::assertSame([['run' => '1']], $this->rows('SELECT CAST(run AS CHAR) AS run FROM games'));
    }

    public function testDeletesAGame(): void
    {
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);

        $deleted = $this->send('DELETE', '/api/games/1', session: $this->session);

        self::assertSame(204, $deleted->getStatusCode(), (string) $deleted->getBody());
        self::assertSame([self::game(2, 'Rommé', 'points')], $this->body($this->send('GET', '/api/games', session: $this->session))['games']);
        self::assertSame(404, $this->send('GET', '/api/games/1', session: $this->session)->getStatusCode());
    }

    /**
     * The deletion protocol: the game row is locked, the game's deletion recorded, and only
     * then are the game's dependents asked to lock, read and record the rows that go with it,
     * still before the game itself is deleted.
     */
    public function testADeletionAsksTheDependentsWhileTheGameIsLockedAndItsDeletionRecorded(): void
    {
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $pdo = $this->impatientSession();
        $other = $this->otherSession();
        $dependents = new class ($pdo, $other) implements GameDependents {
            /** @var list<array<string, mixed>> what each call found */
            public array $calls = [];

            public function __construct(private PDO $pdo, private PDO $other) {}

            public function count(int $gameId): int
            {
                return 0;
            }

            public function recordRemoval(Actor $actor, int $gameId, int $cause): void
            {
                $event = $this->pdo->prepare('SELECT operation, subject_kind, subject_id FROM audit_events WHERE id = ? LOCK IN SHARE MODE');
                $event->execute([$cause]);
                $game = $this->pdo->prepare('SELECT name FROM games WHERE id = ? LOCK IN SHARE MODE');
                $game->execute([$gameId]);
                try {
                    $this->other->query("SELECT id FROM games WHERE id = {$gameId} LOCK IN SHARE MODE NOWAIT");
                    $locked = false;
                } catch (PDOException) {
                    $locked = true;
                }
                $this->calls[] = [
                    'actor' => $actor->userName,
                    'gameId' => $gameId,
                    'cause' => $event->fetch(PDO::FETCH_ASSOC),
                    'game' => $game->fetchColumn(),
                    'locked' => $locked,
                ];
            }
        };

        $this->games($pdo, $dependents)->delete($this->actor(), 1);

        self::assertSame(
            [[
                'actor' => self::ADMIN,
                'gameId' => 1,
                'cause' => ['operation' => 'delete', 'subject_kind' => 'game', 'subject_id' => '1'],
                'game' => 'Schach',
                'locked' => true,
            ]],
            $dependents->calls,
        );
        self::assertSame([], $this->rows('SELECT id FROM games'));
    }

    public function testADeletionWhoseDependentsFailKeepsTheGameAndRecordsNothing(): void
    {
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $failing = new class implements GameDependents {
            public function count(int $gameId): int
            {
                return 0;
            }

            public function recordRemoval(Actor $actor, int $gameId, int $cause): void
            {
                throw new RuntimeException('dependents failed');
            }
        };

        try {
            $this->games($this->impatientSession(), $failing)->delete($this->actor(), 1);
            self::fail('the failure was swallowed');
        } catch (RuntimeException $failure) {
            self::assertSame('dependents failed', $failure->getMessage());
        }
        self::assertSame([['name' => 'Schach']], $this->rows('SELECT name FROM games'));
        self::assertSame([['operation' => 'create']], $this->rows("SELECT operation FROM audit_events WHERE subject_kind = 'game'"));
    }

    public function testEachWriteRecordsOneEventWithTheGamesSnapshot(): void
    {
        $this->createAccount('daniel', 'daniels-passwort');
        $member = $this->signIn('daniel', 'daniels-passwort');
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $member);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $member);
        $this->send('PATCH', '/api/games/1', ['name' => 'Blitzschach', 'drawsAllowed' => false], $member);
        $this->send('PATCH', '/api/games/2', ['name' => 'Rommé'], $member);
        $this->clock->advance('PT2H');
        $this->send('POST', '/api/games/2/restart', [], $member);
        $this->send('DELETE', '/api/games/1', session: $member);

        $created = ['name' => 'Schach', 'kind' => 'duel', 'drawsAllowed' => true, 'run' => 1, 'startedAt' => self::NOW];
        $updated = [...$created, 'name' => 'Blitzschach', 'drawsAllowed' => false];
        $points = ['name' => 'Rommé', 'kind' => 'points', 'lowerWins' => false, 'run' => 1, 'startedAt' => self::NOW];
        $restarted = [...$points, 'run' => 2, 'startedAt' => '2026-11-14T22:00:00.000Z'];
        self::assertSame(
            [
                ['delete', '1', $updated, null],
                ['update', '2', $points, $restarted],
                ['update', '1', $created, $updated],
                ['create', '2', null, $points],
                ['create', '1', null, $created],
            ],
            array_map(
                static fn(array $event): array => [$event['operation'], $event['subjectId'], $event['before'], $event['after']],
                $this->gameEvents(),
            ),
            'an edit that changes nothing records nothing',
        );
        foreach ($this->gameEvents() as $event) {
            self::assertSame(['accountId' => 2, 'userName' => 'daniel'], $event['actor']);
            self::assertNull($event['cause']);
        }
    }

    /**
     * @return array{id: int, name: string, kind: string, drawsAllowed: bool, lowerWins: bool, startedAt: string}
     */
    private static function game(
        int $id,
        string $name,
        string $kind,
        bool $drawsAllowed = true,
        bool $lowerWins = false,
        string $startedAt = self::NOW,
    ): array {
        return ['id' => $id, 'name' => $name, 'kind' => $kind, 'drawsAllowed' => $drawsAllowed, 'lowerWins' => $lowerWins, 'startedAt' => $startedAt];
    }

    /**
     * The game events of the audit log, newest first.
     *
     * @return list<array<string, mixed>>
     */
    private function gameEvents(): array
    {
        $events = $this->body($this->send('GET', '/api/audit?limit=100', session: $this->signIn()))['events'];
        self::assertIsArray($events);

        /** @var list<array<string, mixed>> */
        return array_values(array_filter($events, static fn(mixed $event): bool => is_array($event) && $event['subjectKind'] === 'game'));
    }

    private function actor(): Actor
    {
        return new Actor(1, self::ADMIN);
    }

    /** A request's database session that gives up waiting for a lock after one second. */
    private function impatientSession(): PDO
    {
        $pdo = Database::open($this->config());
        $pdo->exec('SET SESSION innodb_lock_wait_timeout = 1');

        return $pdo;
    }

    /** Games on its own database session, as a request would have it, with the given dependents. */
    private function games(PDO $pdo, ?GameDependents $dependents = null): Games
    {
        $dependents ??= new class implements GameDependents {
            public function count(int $gameId): int
            {
                return 0;
            }

            public function recordRemoval(Actor $actor, int $gameId, int $cause): void {}
        };

        return new Games($pdo, $this->clock, new DataRevision($pdo), new AuditLog($pdo, $this->clock), $dependents);
    }
}
