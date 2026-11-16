<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateInterval;
use PDO;
use Performance\Domain\Sessions;
use Performance\Domain\Timestamp;
use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;

/**
 * The previous release and the current one overlap during a rollout (ADR 0006): requests
 * already running on the previous release's PHP finish on the migrated schema, and the
 * previous release's web client keeps calling the new API until it reloads. These tests run
 * what the previous release does against this release's schema and API.
 */
final class RolloutCompatibilityTest extends DatabaseTestCase
{
    private const ADDRESS = '192.0.2.10';
    private const ENTRY = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';

    /** The previous release's reservation of a sign-in attempt (before `login_attempts.pending`). */
    private const PREVIOUS_RESERVATION = 'INSERT INTO login_attempts (user_name, client_address, attempted_at) VALUES (?, ?, ?)';

    /** The previous release's record of a person's creation (AuditLog before the games). */
    private const PREVIOUS_AUDIT_EVENT = "INSERT INTO audit_events (occurred_at, operation, subject_kind, subject_id, actor_account_id, actor_user_name,
            before_json, after_json, snapshot_version, cause_id)
        VALUES (?, 'create', 'person', '1', 1, 'chef', NULL, '{\"name\":\"Daniel\"}', 1, NULL)";

    public function testAttemptsThePreviousReleaseRecordedCountAsFailuresAndASuccessForgetsThem(): void
    {
        $this->signIn();
        for ($failure = 1; $failure < Sessions::MAX_FAILURES; ++$failure) {
            $this->previousReleaseReserves();
        }

        self::assertSame(200, $this->attempt(self::ADMIN_PASSWORD)->getStatusCode(), 'four failures do not throttle');
        self::assertSame([], $this->rows('SELECT id FROM login_attempts'), 'a success forgets them like its own');

        for ($failure = 1; $failure <= Sessions::MAX_FAILURES; ++$failure) {
            $this->previousReleaseReserves();
        }
        self::assertSame(429, $this->attempt(self::ADMIN_PASSWORD)->getStatusCode(), 'five throttle');
    }

    /**
     * The previous client keeps the cookie of its sign-in and is not sent a new one on every
     * request any more: it stays signed in, and the cookie it holds expires when the session does.
     */
    public function testAClientThatOnlyKeepsTheSignInCookieStaysSignedInUntilTheSessionExpires(): void
    {
        $signedInAt = $this->clock->now();
        $session = $this->signIn();

        for ($poll = 1; $poll <= 6; ++$poll) {
            $this->clock->advance('PT1H');
            $answer = $this->send('GET', '/api/session', session: $session);
            self::assertSame(200, $answer->getStatusCode());
            self::assertSame('', $answer->getHeaderLine('Set-Cookie'));
        }

        self::assertSame(
            [['expires_at' => Timestamp::of($signedInAt->add(new DateInterval('P180D')))]],
            $this->rows('SELECT expires_at FROM sessions'),
            'the database expires the session when the sign-in cookie does',
        );
    }

    /**
     * The previous release keeps recording entry ids in `entry_requests` while this one records
     * them in `idempotency_keys`: a retry that reaches this release still replays, never adds
     * the entry again, and answers a conflict for other content.
     */
    public function testAnEntryThePreviousReleaseRecordedReplaysOnThisRelease(): void
    {
        $session = $this->signIn();
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $session);
        $other = $this->otherSession();
        $recordedAt = Timestamp::of($this->clock->now());
        $other->prepare('INSERT INTO entry_requests (id, fingerprint, created_at) VALUES (?, ?, ?)')
            ->execute([self::ENTRY, hash('sha256', '[1,1,2]'), $recordedAt]);
        $other->prepare('INSERT INTO entries (id, person_id, drink_id, quantity, account_id, created_at) VALUES (?, 1, 1, 2, 1, ?)')
            ->execute([self::ENTRY, $recordedAt]);
        $this->clock->advance('PT30S');

        $retry = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2], $session);
        $changed = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 3], $session);

        self::assertSame(200, $retry->getStatusCode());
        self::assertSame('2026-11-14T20:00:00.000Z', $this->body($retry)['createdAt']);
        self::assertSame(409, $changed->getStatusCode());
        self::assertSame([['id' => self::ENTRY, 'quantity' => 2]], $this->rows('SELECT id, quantity FROM entries'));
        self::assertSame([], $this->rows('SELECT id FROM idempotency_keys'));
    }

    /**
     * The games migrations add the `games` table, which the previous release never touches, and
     * drop the check that limited audit subjects to the previous release's kinds. The previous
     * release keeps recording its events as before, and a reader of the log gets them next to
     * this release's game events.
     */
    public function testThePreviousReleaseKeepsRecordingItsEventsNextToGameEvents(): void
    {
        $session = $this->signIn();
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $session);
        $this->otherSession()->prepare(self::PREVIOUS_AUDIT_EVENT)->execute([Timestamp::of($this->clock->now())]);

        /** @var list<array<string, mixed>> $events */
        $events = $this->body($this->send('GET', '/api/audit', session: $session))['events'];

        self::assertSame(
            [['person', 'create', ['name' => 'Daniel']], ['game', 'create', ['name' => 'Schach', 'kind' => 'duel', 'drawsAllowed' => true, 'run' => 1, 'startedAt' => '2026-11-14T20:00:00.000Z']]],
            array_map(static fn(array $event): array => [$event['subjectKind'], $event['operation'], $event['after']], $events),
        );
    }

    /**
     * The four-eyes release drops the check that limited audit operations to create, update and
     * delete (PRD #61). The previous release keeps recording its events as before, and a reader
     * of the log gets them next to this release's verifications.
     */
    public function testThePreviousReleaseKeepsRecordingItsEventsNextToVerifications(): void
    {
        $session = $this->signIn();
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $session);
        $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1], $session);
        $this->createAccount('anna', 'annas-startpasswort');
        $verified = $this->send('PUT', '/api/entries/' . self::ENTRY . '/verification', [], $this->signIn('anna', 'annas-startpasswort'));
        self::assertSame(204, $verified->getStatusCode(), (string) $verified->getBody());
        $this->otherSession()->prepare(self::PREVIOUS_AUDIT_EVENT)->execute([Timestamp::of($this->clock->now())]);

        /** @var list<array<string, mixed>> $events */
        $events = $this->body($this->send('GET', '/api/audit?limit=2', session: $session))['events'];

        self::assertSame(
            [['person', 'create'], ['entry', 'verify']],
            array_map(static fn(array $event): array => [$event['subjectKind'], $event['operation']], $events),
        );
    }

    /**
     * The matches migration adds a table the previous release does not know. Its foreign keys
     * still act when the previous release deletes a person or an account: the match stays,
     * with that side and the recording account cleared, and nothing the previous release does
     * fails on it.
     */
    public function testThePreviousReleaseDeletesAPersonAndAnAccountThatMatchesReference(): void
    {
        $this->createAccount('daniel', 'daniels-passwort');
        $member = $this->signIn('daniel', 'daniels-passwort');
        $this->send('POST', '/api/persons', ['name' => 'Anna'], $member);
        $this->send('POST', '/api/persons', ['name' => 'Ben'], $member);
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $member);
        $recorded = $this->send('PUT', '/api/matches/' . self::ENTRY, ['gameId' => 1, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'draw'], $member);
        self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());
        $other = $this->otherSession();

        // The previous release's person and account deletions, as far as they touch the database.
        $other->exec('DELETE FROM persons WHERE id = 2');
        $other->exec('DELETE FROM accounts WHERE id = 2');

        self::assertSame(
            [['first_person_id' => '1', 'second_person_id' => null, 'account_id' => null, 'outcome' => 'draw']],
            $this->rows('SELECT CAST(first_person_id AS CHAR) AS first_person_id, second_person_id, account_id, outcome FROM matches'),
        );
    }

    /**
     * The results migration adds a table the previous release does not know. Its foreign keys
     * still act when the previous release deletes a person or an account: the person's results
     * go with them, another person's result stays with the recording account cleared, and
     * nothing the previous release does fails on it.
     */
    public function testThePreviousReleaseDeletesAPersonAndAnAccountThatResultsReference(): void
    {
        $this->createAccount('daniel', 'daniels-passwort');
        $member = $this->signIn('daniel', 'daniels-passwort');
        $this->send('POST', '/api/persons', ['name' => 'Anna'], $member);
        $this->send('POST', '/api/persons', ['name' => 'Ben'], $member);
        $this->send('POST', '/api/games', ['name' => 'Rommé', 'kind' => 'points'], $member);
        foreach ([self::ENTRY => 1, '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b' => 2] as $id => $person) {
            $recorded = $this->send('PUT', "/api/results/{$id}", ['gameId' => 1, 'personId' => $person, 'points' => -20], $member);
            self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());
        }
        $other = $this->otherSession();

        // The previous release's person and account deletions, as far as they touch the database.
        $other->exec('DELETE FROM persons WHERE id = 2');
        $other->exec('DELETE FROM accounts WHERE id = 2');

        self::assertSame(
            [['person_id' => '1', 'account_id' => null, 'points' => '-20']],
            $this->rows('SELECT CAST(person_id AS CHAR) AS person_id, account_id, CAST(points AS CHAR) AS points FROM results'),
        );
    }

    /**
     * The person photos migration adds a table the previous release does not know. Its person
     * list, rename and delete keep working on persons with a photo, and its delete takes the
     * photo with the person (the foreign key cascades). Its renames record `{name}` as before;
     * a snapshot without `photo` means unknown (PRD #14).
     */
    public function testThePreviousReleaseListsRenamesAndDeletesPersonsWithAPhoto(): void
    {
        $session = $this->signIn();
        $photo = (string) file_get_contents(dirname(__DIR__) . '/Support/photos/metadata.jpg');
        foreach (['Anna', 'Ben'] as $id => $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $session);
            $set = $this->send('PUT', '/api/persons/' . ($id + 1) . '/photo', ['image' => base64_encode($photo)], $session);
            self::assertSame(200, $set->getStatusCode(), (string) $set->getBody());
        }
        $other = $this->otherSession();

        // The previous release's person list, rename and delete, as far as they touch the database.
        $list = $other->query('SELECT CAST(id AS CHAR) AS id, name FROM persons ORDER BY name, id');
        self::assertNotFalse($list);
        $listed = $list->fetchAll(PDO::FETCH_ASSOC);
        $other->beginTransaction();
        $other->prepare('SELECT name FROM persons WHERE id = ? FOR UPDATE')->execute([1]);
        $other->prepare('UPDATE persons SET name = ?, updated_at = ? WHERE id = ?')->execute(['Berta', Timestamp::of($this->clock->now()), 1]);
        $other->commit();
        $other->exec('DELETE FROM persons WHERE id = 2');

        self::assertSame([['id' => '1', 'name' => 'Anna'], ['id' => '2', 'name' => 'Ben']], $listed);
        self::assertSame([['id' => '1', 'name' => 'Berta']], $this->rows('SELECT CAST(id AS CHAR) AS id, name FROM persons'));
        self::assertSame([['person_id' => '1']], $this->rows('SELECT CAST(person_id AS CHAR) AS person_id FROM person_photos'));
    }

    /**
     * The verification migrations add `pending` with the default 0 (PRD #61). An entry the
     * previous release still inserts names no `pending`, so it counts at once, as it did there;
     * an entry this release records waits for verification next to it.
     */
    public function testAnEntryThePreviousReleaseInsertsCountsNextToAPendingOne(): void
    {
        $session = $this->signIn();
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $session);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $session);
        $this->otherSession()->prepare('INSERT INTO entries (id, person_id, drink_id, quantity, account_id, created_at) VALUES (?, 1, 1, 2, 1, ?)')
            ->execute([self::ENTRY, Timestamp::of($this->clock->now())]);
        $recorded = $this->send('PUT', '/api/entries/0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b', ['personId' => 1, 'drinkId' => 1, 'quantity' => 3], $session);
        self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());

        $board = $this->body($this->send('GET', '/api/scoreboard?from=2026-11-14T00:00:00Z', session: $session));

        self::assertIsList($board['rows']);
        self::assertCount(1, $board['rows']);
        self::assertIsArray($board['rows'][0]);
        self::assertSame(['score' => 2, 'count' => 2], array_intersect_key($board['rows'][0], ['score' => 0, 'count' => 0]));
    }

    /**
     * The verification migrations add `pending` to matches with the default 0 (PRD #61). A match
     * the previous release still inserts names no `pending`, so it counts at once, as it did
     * there; a match this release records waits for verification next to it and counts for
     * neither player.
     */
    public function testAMatchThePreviousReleaseInsertsCountsNextToAPendingOne(): void
    {
        $session = $this->signIn();
        foreach (['Anna', 'Ben'] as $name) {
            $this->send('POST', '/api/persons', ['name' => $name], $session);
        }
        $this->send('POST', '/api/games', ['name' => 'Schach', 'kind' => 'duel'], $session);
        $this->otherSession()->prepare(
            "INSERT INTO matches (id, game_id, first_person_id, second_person_id, outcome, run, account_id, created_at) VALUES (?, 1, 1, 2, 'first', 1, 1, ?)",
        )->execute([self::ENTRY, Timestamp::of($this->clock->now())]);
        $recorded = $this->send('PUT', '/api/matches/0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b', ['gameId' => 1, 'firstPersonId' => 1, 'secondPersonId' => 2, 'outcome' => 'second'], $session);
        self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());

        $standings = $this->body($this->send('GET', '/api/games/1/standings', session: $session));

        self::assertIsList($standings['rows']);
        self::assertSame(
            [['name' => 'Anna', 'points' => 1, 'played' => 1, 'pendingCount' => 1], ['name' => 'Ben', 'points' => 0, 'played' => 1, 'pendingCount' => 1]],
            array_map(static fn(mixed $row): array => is_array($row) ? array_intersect_key($row, ['name' => 0, 'points' => 0, 'played' => 0, 'pendingCount' => 0]) : [], $standings['rows']),
        );
    }

    /**
     * The verification migrations add `pending` to results with the default 0 (PRD #61). A
     * result the previous release still inserts names no `pending`, so it counts at once, as it
     * did there; a result this release records waits for verification next to it and stays out
     * of the sum.
     */
    public function testAResultThePreviousReleaseInsertsCountsNextToAPendingOne(): void
    {
        $session = $this->signIn();
        $this->send('POST', '/api/persons', ['name' => 'Anna'], $session);
        $this->send('POST', '/api/games', ['name' => 'Wizard', 'kind' => 'points'], $session);
        $this->otherSession()->prepare(
            'INSERT INTO results (id, game_id, person_id, points, run, account_id, created_at) VALUES (?, 1, 1, 30, 1, 1, ?)',
        )->execute([self::ENTRY, Timestamp::of($this->clock->now())]);
        $recorded = $this->send('PUT', '/api/results/0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b', ['gameId' => 1, 'personId' => 1, 'points' => -50], $session);
        self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());

        $standings = $this->body($this->send('GET', '/api/games/1/standings', session: $session));

        self::assertSame([['personId' => 1, 'name' => 'Anna', 'sum' => 30, 'results' => 1, 'pendingCount' => 1]], $standings['rows']);
    }

    private function previousReleaseReserves(): void
    {
        $this->otherSession()->prepare(self::PREVIOUS_RESERVATION)->execute([self::ADMIN, self::ADDRESS, Timestamp::of($this->clock->now())]);
    }

    private function attempt(string $password): ResponseInterface
    {
        return $this->send('POST', '/api/session', ['userName' => self::ADMIN, 'password' => $password], clientAddress: self::ADDRESS);
    }
}
