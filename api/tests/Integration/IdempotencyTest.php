<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

final class IdempotencyTest extends DatabaseTestCase
{
    private const ENTRY = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const TWO_BEERS = ['personId' => 1, 'drinkId' => 1, 'quantity' => 2];
    /** Daniel's win over Erik in Schach (game 1), and Daniel's −20 in Rommé (game 2), under the entry's id. */
    private const GAME_ROWS = [
        'match' => ['path' => '/api/matches/', 'verlauf' => '/api/games/1/matches', 'game' => 1, 'content' => ['gameId' => 1, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'first']],
        'result' => ['path' => '/api/results/', 'verlauf' => '/api/games/2/results', 'game' => 2, 'content' => ['gameId' => 2, 'personId' => 1, 'points' => -20]],
    ];
    /** Who plays in each kind of row, by name. */
    private const PLAYERS = ['match' => ['Daniel', 'Erik'], 'result' => ['Daniel']];

    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->signIn();
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->session);
    }

    public function testRepeatingTheSameRequestCreatesNoSecondEntryAndReturnsTheOriginalOutcome(): void
    {
        $first = $this->put(self::TWO_BEERS);
        $this->clock->advance('PT30S');

        $repeated = $this->put(self::TWO_BEERS);

        self::assertSame(201, $first->getStatusCode());
        self::assertSame(200, $repeated->getStatusCode());
        self::assertSame($this->body($first), $this->body($repeated));
        self::assertCount(1, $this->rows('SELECT id FROM entries'));
    }

    public function testParallelIdenticalRequestsCreateExactlyOneEntry(): void
    {
        $script = __DIR__ . '/../Support/entry-race.php';
        $startAt = microtime(true) + 1.0;
        $processes = [];
        for ($i = 0; $i < 8; ++$i) {
            $process = proc_open(
                [PHP_BINARY, $script, (string) $startAt, self::ENTRY, '1', '1', '2', '1'],
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
            );
            self::assertIsResource($process);
            $processes[] = [$process, $pipes];
        }
        foreach ($processes as [$process, $pipes]) {
            $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            self::assertSame(0, proc_close($process), (string) $output);
        }

        self::assertSame([['id' => self::ENTRY, 'quantity' => 2]], $this->rows('SELECT id, quantity FROM entries'));
        self::assertCount(1, $this->rows('SELECT id FROM idempotency_keys'));
        self::assertSame([['subject_id' => self::ENTRY]], $this->rows("SELECT subject_id FROM audit_events WHERE subject_kind = 'entry'"));
    }

    public function testParallelRequestsWithTheSameIdAndDifferentContentRecordOneEntryAndAnswerTheOthers409(): void
    {
        $quantities = [2, 3, 2, 3, 2, 3, 2, 3];

        $outcomes = $this->race($quantities);

        $entries = $this->rows('SELECT id, quantity FROM entries');
        self::assertCount(1, $entries);
        $recorded = $entries[0]['quantity'];
        self::assertSame(['created'], array_values(array_filter($outcomes, static fn(string $outcome): bool => $outcome === 'created')));
        foreach ($quantities as $process => $quantity) {
            if ($quantity === $recorded) {
                self::assertContains($outcomes[$process], ['created', 'replayed']);
            } else {
                self::assertSame('conflict', $outcomes[$process], 'the other content is a conflict');
            }
        }
        self::assertCount(1, $this->rows('SELECT id FROM idempotency_keys'));
    }

    public function testAfterSevenDaysTheIdOfAnUndoneEntryIsForgottenAndCreatesItAgain(): void
    {
        $this->put(self::TWO_BEERS);
        $this->send('DELETE', '/api/entries/' . self::ENTRY, session: $this->session);
        $this->clock->advance('P7D');

        $withinTheWindow = $this->put(self::TWO_BEERS);
        $this->clock->advance('PT1S');
        $afterTheWindow = $this->put(self::TWO_BEERS);

        self::assertSame(200, $withinTheWindow->getStatusCode(), 'a retry within seven days replays');
        self::assertSame(201, $afterTheWindow->getStatusCode(), 'after them the id is forgotten');
        self::assertSame([['id' => self::ENTRY]], $this->rows('SELECT id FROM entries'));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function decisions(): iterable
    {
        yield 'rejected by another account' => ['reject'];
        yield 'deleted' => ['delete'];
        yield 'verified by another account' => ['verify'];
    }

    /**
     * Within seven days of the recording a replay answers as the recording did, whatever
     * happened to the entry since: a rejected or deleted entry stays gone, a verified one stays
     * the only one and keeps counting.
     */
    #[DataProvider('decisions')]
    public function testAReplayWithinSevenDaysAnswersTheOriginalOutcomeWhateverHappenedToTheEntry(string $decision): void
    {
        $first = $this->put(self::TWO_BEERS);
        $this->decide($decision);
        $this->clock->advance('P7D');

        $replay = $this->put(self::TWO_BEERS);

        self::assertSame(200, $replay->getStatusCode(), (string) $replay->getBody());
        self::assertSame($this->body($first), $this->body($replay));
        self::assertSame($decision === 'verify' ? [[self::ENTRY, false]] : [], $this->history());
    }

    /** After the seven days the id is forgotten, so the same request records the entry again, pending as every new one. */
    #[DataProvider('removals')]
    public function testAReplayAfterSevenDaysRecordsANewPendingEntry(string $removal): void
    {
        $this->put(self::TWO_BEERS);
        $this->decide($removal);
        $this->clock->advance('P7D');
        $this->clock->advance('PT1S');

        $afterTheWindow = $this->put(self::TWO_BEERS);

        self::assertSame(201, $afterTheWindow->getStatusCode(), (string) $afterTheWindow->getBody());
        self::assertSame([[self::ENTRY, true]], $this->history());
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function removals(): iterable
    {
        yield 'rejected by another account' => ['reject'];
        yield 'deleted' => ['delete'];
    }

    /**
     * @return iterable<string, array{'match'|'result', string}>
     */
    public static function gameRowDecisions(): iterable
    {
        foreach (['match', 'result'] as $kind) {
            foreach (self::decisions() as $name => [$decision]) {
                yield "a {$kind} {$name}" => [$kind, $decision];
            }
        }
    }

    /**
     * Matches and results share the retry keys with entries: within seven days of the
     * recording a replay answers as the recording did, so a rejected or undone row stays gone
     * and a verified one stays the only one and keeps counting.
     *
     * @param 'match'|'result' $kind
     */
    #[DataProvider('gameRowDecisions')]
    public function testAReplayOfAMatchOrResultWithinSevenDaysAnswersTheOriginalOutcomeWhateverHappenedToIt(string $kind, string $decision): void
    {
        $this->setUpGames();
        $first = $this->putGameRow($kind);
        $this->decideOnGameRow($kind, $decision);
        $this->clock->advance('P7D');

        $replay = $this->putGameRow($kind);

        self::assertSame(200, $replay->getStatusCode(), (string) $replay->getBody());
        self::assertSame($this->body($first), $this->body($replay));
        self::assertSame(
            $decision === 'verify'
                ? ['history' => [[self::ENTRY, false]], 'ranked' => self::PLAYERS[$kind], 'unranked' => []]
                : ['history' => [], 'ranked' => [], 'unranked' => []],
            $this->gameObserved($kind),
        );
    }

    /**
     * @return iterable<string, array{'match'|'result', string}>
     */
    public static function gameRowRemovals(): iterable
    {
        foreach (['match', 'result'] as $kind) {
            foreach (self::removals() as $name => [$removal]) {
                yield "a {$kind} {$name}" => [$kind, $removal];
            }
        }
    }

    /**
     * After the seven days the id is forgotten, so the same request records the match or
     * result again, pending as every new one: its players wait without a rank.
     *
     * @param 'match'|'result' $kind
     */
    #[DataProvider('gameRowRemovals')]
    public function testAReplayOfAMatchOrResultAfterSevenDaysRecordsANewPendingRow(string $kind, string $removal): void
    {
        $this->setUpGames();
        $this->putGameRow($kind);
        $this->decideOnGameRow($kind, $removal);
        $this->clock->advance('P7D');
        $this->clock->advance('PT1S');

        $afterTheWindow = $this->putGameRow($kind);

        self::assertSame(201, $afterTheWindow->getStatusCode(), (string) $afterTheWindow->getBody());
        self::assertSame(['history' => [[self::ENTRY, true]], 'ranked' => [], 'unranked' => self::PLAYERS[$kind]], $this->gameObserved($kind));
    }

    public function testTheSameIdWithDifferentContentIs409AndChangesNothing(): void
    {
        $this->put(self::TWO_BEERS);

        $response = $this->put(['personId' => 1, 'drinkId' => 1, 'quantity' => 3]);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame(
            ['type' => 'urn:performance:problem:entry-conflict', 'title' => 'Eintrag wurde schon mit anderem Inhalt gespeichert.', 'status' => 409],
            $this->body($response),
        );
        self::assertSame([['quantity' => 2]], $this->rows('SELECT quantity FROM entries'));
    }

    public function testTheFactorIsPartOfTheRequestSoAnotherFactorUnderTheSameIdIs409(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);
        $this->send('POST', '/api/factors', ['name' => 'Geburtstag', 'multiplier' => 1.5], $this->session);
        $happyHour = [...self::TWO_BEERS, 'factorId' => 1];
        $this->put($happyHour);

        $same = $this->put($happyHour);
        $birthday = $this->put([...self::TWO_BEERS, 'factorId' => 2]);
        $none = $this->put(self::TWO_BEERS);

        self::assertSame(200, $same->getStatusCode());
        self::assertSame(1, $this->body($same)['factorId']);
        self::assertSame(409, $birthday->getStatusCode());
        self::assertSame(409, $none->getStatusCode());
        self::assertSame([['factor_id' => 1]], $this->rows('SELECT factor_id FROM entries'));
    }

    public function testNoFactorAndAnExplicitNullAreTheSameRequest(): void
    {
        $this->put(self::TWO_BEERS);

        $repeated = $this->put([...self::TWO_BEERS, 'factorId' => null]);

        self::assertSame(200, $repeated->getStatusCode());
    }

    public function testAReplayAfterTheFactorWasDeletedAnswersTheOriginalOutcome(): void
    {
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->session);
        $happyHour = [...self::TWO_BEERS, 'factorId' => 1];
        $first = $this->put($happyHour);
        $this->send('DELETE', '/api/factors/1', session: $this->session);

        $replay = $this->put($happyHour);

        self::assertSame(200, $replay->getStatusCode());
        self::assertSame($this->body($first), $this->body($replay));
        self::assertCount(1, $this->rows('SELECT id FROM entries'));
    }

    public function testAReplayAfterTheEntryWasDeletedDoesNotRecreateIt(): void
    {
        $first = $this->put(self::TWO_BEERS);
        $this->send('DELETE', '/api/entries/' . self::ENTRY, session: $this->session);

        $replay = $this->put(self::TWO_BEERS);
        $changed = $this->put(['personId' => 1, 'drinkId' => 1, 'quantity' => 3]);

        self::assertSame(200, $replay->getStatusCode());
        self::assertSame($this->body($first), $this->body($replay));
        self::assertSame(409, $changed->getStatusCode());
        self::assertSame([], $this->rows('SELECT id FROM entries'));
    }

    public function testRequestsAreKeptSevenDaysAndPurgedOnALaterAdd(): void
    {
        $this->put(self::TWO_BEERS);
        $this->clock->advance('P7D');
        $this->put(self::TWO_BEERS, '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b');

        self::assertCount(2, $this->rows('SELECT id FROM idempotency_keys'));

        $this->clock->advance('PT1S');
        $this->put(self::TWO_BEERS, '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c');

        self::assertSame(
            [['id' => '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b'], ['id' => '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c']],
            $this->rows('SELECT id FROM idempotency_keys ORDER BY created_at'),
        );
        self::assertCount(3, $this->rows('SELECT id FROM entries'));
    }

    /**
     * Keys stored before the shared store existed stay in `entry_requests` (ADR 0006: expand,
     * not rename) under the entry fingerprint of that time: sha256 of `[personId,drinkId,quantity]`.
     */
    public function testAKeyStoredBeforeTheSharedStoreStillReplaysAndNeverRecreatesItsUndoneEntry(): void
    {
        $this->otherSession()->prepare('INSERT INTO entry_requests (id, fingerprint, created_at) VALUES (?, ?, ?)')
            ->execute([self::ENTRY, hash('sha256', '[1,1,2]'), '2026-11-14 20:00:00.000']);
        $this->clock->advance('PT1H');

        $replay = $this->put(self::TWO_BEERS);
        $changed = $this->put(['personId' => 1, 'drinkId' => 1, 'quantity' => 3]);

        self::assertSame(200, $replay->getStatusCode());
        self::assertSame('2026-11-14T20:00:00.000Z', $this->body($replay)['createdAt'], 'the original instant');
        self::assertSame(409, $changed->getStatusCode());
        self::assertSame([], $this->rows('SELECT id FROM entries UNION ALL SELECT id FROM idempotency_keys'));
    }

    public function testKeysStoredBeforeTheSharedStoreArePurgedAfterSevenDaysToo(): void
    {
        $this->otherSession()->prepare('INSERT INTO entry_requests (id, fingerprint, created_at) VALUES (?, ?, ?)')
            ->execute([self::ENTRY, hash('sha256', '[1,1,2]'), '2026-11-14 20:00:00.000']);
        $this->clock->advance('P7D');
        $this->clock->advance('PT1S');

        $afterTheWindow = $this->put(self::TWO_BEERS);

        self::assertSame(201, $afterTheWindow->getStatusCode());
        self::assertSame([], $this->rows('SELECT id FROM entry_requests'));
        self::assertSame([['id' => self::ENTRY]], $this->rows('SELECT id FROM idempotency_keys'));
    }

    /**
     * Sends the entry from one process per quantity, all at the same instant.
     *
     * @param list<int> $quantities
     *
     * @return list<string> each process's outcome: created, replayed or conflict
     */
    private function race(array $quantities): array
    {
        $script = __DIR__ . '/../Support/entry-race.php';
        $startAt = microtime(true) + 1.0;
        $processes = [];
        foreach ($quantities as $quantity) {
            $process = proc_open(
                [PHP_BINARY, $script, (string) $startAt, self::ENTRY, '1', '1', (string) $quantity, '1'],
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
            );
            self::assertIsResource($process);
            $processes[] = [$process, $pipes];
        }
        $outcomes = [];
        foreach ($processes as [$process, $pipes]) {
            $outcome = (string) stream_get_contents($pipes[1]);
            $errors = (string) stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            self::assertSame(0, proc_close($process), $outcome . $errors);
            $outcomes[] = $outcome;
        }

        return $outcomes;
    }

    /** Rejects, deletes or verifies the entry; Anna, another account, rejects and verifies. */
    private function decide(string $decision): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');
        $response = match ($decision) {
            'reject' => $this->send('DELETE', '/api/entries/' . self::ENTRY . '/verification', session: $anna),
            'delete' => $this->send('DELETE', '/api/entries/' . self::ENTRY, session: $this->session),
            'verify' => $this->send('PUT', '/api/entries/' . self::ENTRY . '/verification', [], $anna),
            default => self::fail("Unknown decision {$decision}"),
        };
        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
    }

    /**
     * Daniel's entries since the recording, as his Verlauf lists them: id and whether it waits.
     *
     * @return list<array{mixed, mixed}>
     */
    private function history(): array
    {
        $entries = $this->body($this->send('GET', '/api/entries?personId=1&from=2026-11-14T00:00:00.000Z', session: $this->session))['entries'];
        self::assertIsList($entries);

        return array_map(
            static function (mixed $entry): array {
                self::assertIsArray($entry);

                return [$entry['id'], $entry['pending']];
            },
            $entries,
        );
    }

    /** Erik (person 2), the duel game Schach (1) and the points game Rommé (2), beside Daniel. */
    private function setUpGames(): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Erik'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $this->session);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $this->session);
    }

    /** @param 'match'|'result' $kind */
    private function putGameRow(string $kind): ResponseInterface
    {
        return $this->send('PUT', self::GAME_ROWS[$kind]['path'] . self::ENTRY, self::GAME_ROWS[$kind]['content'], $this->session);
    }

    /**
     * Rejects, undoes or verifies the match or result; Anna, another account, rejects and verifies.
     *
     * @param 'match'|'result' $kind
     */
    private function decideOnGameRow(string $kind, string $decision): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');
        $row = self::GAME_ROWS[$kind]['path'] . self::ENTRY;
        $response = match ($decision) {
            'reject' => $this->send('DELETE', "{$row}/verification", session: $anna),
            'delete' => $this->send('DELETE', $row, session: $this->session),
            'verify' => $this->send('PUT', "{$row}/verification", [], $anna),
            default => self::fail("Unknown decision {$decision}"),
        };
        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
    }

    /**
     * The game's rows as its Verlauf lists them (id and whether it waits), and who its standings
     * rank and who they list without a rank.
     *
     * @param 'match'|'result' $kind
     *
     * @return array{history: list<array{mixed, mixed}>, ranked: list<mixed>, unranked: list<mixed>}
     */
    private function gameObserved(string $kind): array
    {
        $game = self::GAME_ROWS[$kind]['game'];
        $items = $this->body($this->send('GET', self::GAME_ROWS[$kind]['verlauf'], session: $this->session))['items'];
        self::assertIsList($items);
        $standings = $this->body($this->send('GET', "/api/games/{$game}/standings", session: $this->session));
        self::assertIsList($standings['rows']);
        self::assertIsList($standings['unranked']);

        return [
            'history' => array_map(static function (mixed $item): array {
                self::assertIsArray($item);

                return [$item['id'], $item['pending']];
            }, $items),
            'ranked' => array_column($standings['rows'], 'name'),
            'unranked' => array_column($standings['unranked'], 'name'),
        ];
    }

    /**
     * @param array<string, int|null> $content
     */
    private function put(array $content, string $id = self::ENTRY): ResponseInterface
    {
        return $this->send('PUT', "/api/entries/{$id}", $content, $this->session);
    }
}
