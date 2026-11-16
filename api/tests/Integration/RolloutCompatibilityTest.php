<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateInterval;
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

    private function previousReleaseReserves(): void
    {
        $this->otherSession()->prepare(self::PREVIOUS_RESERVATION)->execute([self::ADMIN, self::ADDRESS, Timestamp::of($this->clock->now())]);
    }

    private function attempt(string $password): ResponseInterface
    {
        return $this->send('POST', '/api/session', ['userName' => self::ADMIN, 'password' => $password], clientAddress: self::ADDRESS);
    }
}
