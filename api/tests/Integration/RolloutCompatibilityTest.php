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

    /** The previous release's reservation of a sign-in attempt (before `login_attempts.pending`). */
    private const PREVIOUS_RESERVATION = 'INSERT INTO login_attempts (user_name, client_address, attempted_at) VALUES (?, ?, ?)';

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

    private function previousReleaseReserves(): void
    {
        $this->otherSession()->prepare(self::PREVIOUS_RESERVATION)->execute([self::ADMIN, self::ADDRESS, Timestamp::of($this->clock->now())]);
    }

    private function attempt(string $password): ResponseInterface
    {
        return $this->send('POST', '/api/session', ['userName' => self::ADMIN, 'password' => $password], clientAddress: self::ADDRESS);
    }
}
