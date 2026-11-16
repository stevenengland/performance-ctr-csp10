<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use DateInterval;
use Performance\Domain\Sessions;
use Performance\Domain\Timestamp;
use Performance\Tests\Support\DatabaseTestCase;
use Psr\Http\Message\ResponseInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Slim\Psr7\Factory\ServerRequestFactory;

final class SessionTest extends DatabaseTestCase
{
    public function testSigningInSetsAStrictHttpOnlySecureCookieValidFor180Days(): void
    {
        $response = $this->send('POST', '/api/session', ['userName' => self::ADMIN, 'password' => self::ADMIN_PASSWORD]);

        $cookie = $response->getHeaderLine('Set-Cookie');
        self::assertMatchesRegularExpression('/^session=[0-9a-f]{64}; /', $cookie);
        foreach (['Path=/', 'Max-Age=15552000', 'HttpOnly', 'Secure', 'SameSite=Strict'] as $attribute) {
            self::assertStringContainsString("; {$attribute}", $cookie);
        }
    }

    public function testTheSessionCookieIdentifiesTheSignedInAccount(): void
    {
        $session = $this->signIn();

        $response = $this->send('GET', '/api/session', session: $session);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['id' => 1, 'userName' => self::ADMIN, 'isAdmin' => true], $this->body($response));
    }

    public function testSigningInDeletesExpiredSessions(): void
    {
        $expired = $this->signIn();
        $this->clock->advance('P181D');

        $current = $this->signIn();

        self::assertSame(
            [['token_hash' => hash('sha256', $current)]],
            $this->rows('SELECT token_hash FROM sessions'),
            'only the new session is left, the expired one is gone',
        );
        self::assertNotSame($expired, $current);
    }

    public function testUserNamesIgnoreCaseAndSurroundingSpaces(): void
    {
        $response = $this->send('POST', '/api/session', ['userName' => ' CHEF ', 'password' => self::ADMIN_PASSWORD]);

        self::assertSame(200, $response->getStatusCode());
    }

    /**
     * @return iterable<string, array{string, string|null, string|null}>
     */
    public static function protectedRoutes(): iterable
    {
        yield 'current account' => ['GET', '/api/session', null];
        yield 'sign out' => ['DELETE', '/api/session', null];
        yield 'change password' => ['PUT', '/api/session/password', 'json'];
        yield 'list accounts' => ['GET', '/api/accounts', null];
        yield 'create account' => ['POST', '/api/accounts', 'json'];
    }

    #[DataProvider('protectedRoutes')]
    public function testEveryRouteButSignInAndHealthAnswers401WithoutAValidSession(string $method, string $path, ?string $body): void
    {
        $this->signIn();
        $json = $body === null ? null : ['password' => 'irgendetwas-langes'];

        foreach ([null, 'unknown-token', str_repeat('a', 64)] as $session) {
            $response = $this->send($method, $path, $json, $session);

            self::assertSame(401, $response->getStatusCode(), "{$method} {$path}");
            self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
            self::assertSame(
                ['type' => 'urn:performance:problem:unauthenticated', 'title' => 'Nicht angemeldet', 'status' => 401],
                $this->body($response),
            );
        }
    }

    public function testHealthNeedsNoSession(): void
    {
        self::assertSame(200, $this->get('/api/health')->getStatusCode());
    }

    public function testSigningOutRevokesTheSessionOnTheServer(): void
    {
        $session = $this->signIn();

        $signOut = $this->send('DELETE', '/api/session', session: $session);

        self::assertSame(204, $signOut->getStatusCode());
        self::assertStringStartsWith('session=; ', $signOut->getHeaderLine('Set-Cookie'));
        self::assertStringContainsString('Max-Age=0', $signOut->getHeaderLine('Set-Cookie'));
        self::assertSame(401, $this->send('GET', '/api/session', session: $session)->getStatusCode());
    }

    public function testSigningOutLeavesTheAccountsOtherSessionsAlone(): void
    {
        $phone = $this->signIn();
        $laptop = $this->signIn();

        $this->send('DELETE', '/api/session', session: $phone);

        self::assertSame(200, $this->send('GET', '/api/session', session: $laptop)->getStatusCode());
    }

    public function testASessionStaysValidFor180DaysAndUseExtendsIt(): void
    {
        $session = $this->signIn();

        $this->clock->advance('P179DT23H');
        $used = $this->send('GET', '/api/session', session: $session);
        self::assertSame(200, $used->getStatusCode());
        self::assertStringContainsString('Max-Age=15552000', $used->getHeaderLine('Set-Cookie'), 'the cookie is extended too');

        $this->clock->advance('P179DT23H');
        self::assertSame(200, $this->send('GET', '/api/session', session: $session)->getStatusCode());

        $this->clock->advance('P180DT1S');
        self::assertSame(401, $this->send('GET', '/api/session', session: $session)->getStatusCode());
    }

    /**
     * Polling must not write: within a day of its last renewal a request neither changes the
     * session nor sets the cookie. The first request a day or more later renews both, to the
     * same expiry.
     */
    public function testUseRenewsTheSessionAndItsCookieAtMostOnceADay(): void
    {
        $session = $this->signIn();
        $stored = $this->rows('SELECT last_seen_at, expires_at FROM sessions');

        $this->clock->advance('PT23H59M');
        $polled = $this->send('GET', '/api/session', session: $session);

        self::assertSame(200, $polled->getStatusCode());
        self::assertSame('', $polled->getHeaderLine('Set-Cookie'), 'no cookie within the day');
        self::assertSame($stored, $this->rows('SELECT last_seen_at, expires_at FROM sessions'), 'and no write');

        $this->clock->advance('PT1M');
        $renewed = $this->send('GET', '/api/session', session: $session);

        self::assertSame(200, $renewed->getStatusCode());
        self::assertStringContainsString('Max-Age=' . Sessions::lifetimeSeconds(), $renewed->getHeaderLine('Set-Cookie'));
        $expiresAt = $this->clock->now()->add(new DateInterval('P180D'));
        self::assertSame(
            [['last_seen_at' => Timestamp::of($this->clock->now()), 'expires_at' => Timestamp::of($expiresAt)]],
            $this->rows('SELECT last_seen_at, expires_at FROM sessions'),
            'the database expires the session when the renewed cookie does',
        );
    }

    /**
     * A route that fails (here 422) after its request renewed the session still renews the
     * cookie, or the browser would drop it at the old expiry while the session lives on and the
     * next renewal is a day away.
     */
    public function testAFailingRouteStillRenewsTheCookieOfARenewedSession(): void
    {
        $session = $this->signIn();
        $this->clock->advance('P179DT23H30M');

        $refused = $this->send('PUT', '/api/session/password', [
            'currentPassword' => self::ADMIN_PASSWORD,
            'newPassword' => 'kurz',
        ], $session);

        self::assertSame(422, $refused->getStatusCode());
        self::assertSame('application/problem+json', $refused->getHeaderLine('Content-Type'));
        self::assertStringContainsString('Max-Age=' . Sessions::lifetimeSeconds(), $refused->getHeaderLine('Set-Cookie'));

        $this->clock->advance('PT1M');
        $next = $this->send('GET', '/api/session', session: $session);
        self::assertSame(200, $next->getStatusCode());
        self::assertSame('', $next->getHeaderLine('Set-Cookie'), 'renewed once, by the failed request');
        $this->clock->advance('PT1H');
        self::assertSame(200, $this->send('GET', '/api/session', session: $session)->getStatusCode(), 'past the old expiry');
    }

    /** A session used only within the day of its sign-in ends 180 days after the sign-in. */
    public function testUseThatRenewsNothingDoesNotPostponeTheExpiry(): void
    {
        $session = $this->signIn();
        $this->clock->advance('PT12H');
        self::assertSame(200, $this->send('GET', '/api/session', session: $session)->getStatusCode());

        $this->clock->advance('P179DT12H');

        self::assertSame(401, $this->send('GET', '/api/session', session: $session)->getStatusCode());
    }

    public function testTheDatabaseStoresOnlyTheTokensHash(): void
    {
        $session = $this->signIn();

        $stored = $this->rows('SELECT * FROM sessions');

        self::assertCount(1, $stored);
        self::assertSame(hash('sha256', $session), $stored[0]['token_hash']);
        self::assertStringNotContainsString($session, json_encode($stored, JSON_THROW_ON_ERROR));
    }

    public function testChangingTheOwnPasswordRevokesTheAccountsOtherSessions(): void
    {
        $phone = $this->signIn();
        $laptop = $this->signIn();

        $response = $this->send('PUT', '/api/session/password', [
            'currentPassword' => self::ADMIN_PASSWORD,
            'newPassword' => 'ein-neues-passwort',
        ], $phone);

        self::assertSame(204, $response->getStatusCode());
        self::assertSame(200, $this->send('GET', '/api/session', session: $phone)->getStatusCode());
        self::assertSame(401, $this->send('GET', '/api/session', session: $laptop)->getStatusCode());
        $this->signIn(self::ADMIN, 'ein-neues-passwort');
        self::assertSame(401, $this->send('POST', '/api/session', ['userName' => self::ADMIN, 'password' => self::ADMIN_PASSWORD])->getStatusCode());
    }

    public function testAShortNewPasswordIs422WithAFieldError(): void
    {
        $session = $this->signIn();

        $response = $this->send('PUT', '/api/session/password', [
            'currentPassword' => self::ADMIN_PASSWORD,
            'newPassword' => 'kurz',
        ], $session);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame([
            'type' => 'urn:performance:problem:validation',
            'title' => 'Bitte Eingaben prüfen',
            'status' => 422,
            'errors' => ['newPassword' => 'Mindestens 10 Zeichen.'],
        ], $this->body($response));
        $this->signIn();
    }

    /**
     * The review's case: changing `a…a` + `old` to `a…a` + `new` (72 a) changed nothing
     * bcrypt sees, and the old password still signed in.
     */
    public function testANewPasswordOver72BytesIs422AndTheOldOneKeepsWorking(): void
    {
        $prefix = str_repeat('a', 72);
        $this->createAccount('anna', $prefix);
        $anna = $this->signIn('anna', $prefix);

        $response = $this->send('PUT', '/api/session/password', [
            'currentPassword' => $prefix,
            'newPassword' => $prefix . 'new',
        ], $anna);

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['newPassword' => 'Höchstens 72 Byte (Umlaute zählen doppelt).'], $this->body($response)['errors'] ?? null);
        self::assertSame(200, $this->send('GET', '/api/session', session: $anna)->getStatusCode());
    }

    /** No stored password is longer than 72 bytes, so a longer one is never the right one, whatever its first 72 bytes are. */
    public function testASignInWithMoreThan72BytesIsRefusedLikeAWrongPassword(): void
    {
        $prefix = str_repeat('a', 72);
        $this->createAccount('anna', $prefix);

        $response = $this->send('POST', '/api/session', ['userName' => 'anna', 'password' => $prefix . 'old']);

        self::assertSame(401, $response->getStatusCode());
        self::assertSame(
            $this->body($this->send('POST', '/api/session', ['userName' => 'anna', 'password' => 'ganz-falsch-1'])),
            $this->body($response),
        );
    }

    public function testAWrongCurrentPasswordIs422AndChangesNothing(): void
    {
        $session = $this->signIn();

        $response = $this->send('PUT', '/api/session/password', [
            'currentPassword' => 'nicht-das-passwort',
            'newPassword' => 'ein-neues-passwort',
        ], $session);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame(['currentPassword' => 'Passwort falsch.'], $this->body($response)['errors']);
        $this->signIn();
    }

    public function testWrongUserNameAndWrongPasswordGetTheSameAnswer(): void
    {
        $this->signIn();

        $wrongName = $this->send('POST', '/api/session', ['userName' => 'niemand', 'password' => self::ADMIN_PASSWORD]);
        $wrongPassword = $this->send('POST', '/api/session', ['userName' => self::ADMIN, 'password' => 'falsches-passwort']);

        self::assertSame(401, $wrongName->getStatusCode());
        self::assertSame(
            ['type' => 'urn:performance:problem:invalid-credentials', 'title' => 'Benutzername oder Passwort falsch.', 'status' => 401],
            $this->body($wrongName),
        );
        self::assertSame($wrongName->getStatusCode(), $wrongPassword->getStatusCode());
        self::assertSame((string) $wrongName->getBody(), (string) $wrongPassword->getBody());
        self::assertSame($wrongName->getHeaders(), $wrongPassword->getHeaders());
    }

    public function testFiveFailuresForAUserNameAndAddressIn15MinutesThrottleSignIn(): void
    {
        $this->signIn();
        for ($failure = 1; $failure <= 5; ++$failure) {
            $this->clock->advance('PT2M');
            self::assertSame(401, $this->attempt(self::ADMIN, 'falsches-passwort')->getStatusCode());
        }

        $throttled = $this->attempt(self::ADMIN, self::ADMIN_PASSWORD);

        self::assertSame(429, $throttled->getStatusCode());
        self::assertSame((string) (Sessions::FAILURE_WINDOW_MINUTES * 60), $throttled->getHeaderLine('Retry-After'));
        self::assertSame(
            ['type' => 'urn:performance:problem:too-many-attempts', 'title' => 'Zu viele Versuche. Bitte später erneut.', 'status' => 429],
            $this->body($throttled),
        );
        self::assertSame(200, $this->attempt(self::ADMIN, self::ADMIN_PASSWORD, '198.51.100.7')->getStatusCode(), 'another address is not throttled');
        $this->clock->advance('PT8M');
        self::assertSame(200, $this->attempt(self::ADMIN, self::ADMIN_PASSWORD)->getStatusCode(), 'the first failure left the window');
    }

    public function testASuccessfulSignInForgetsEarlierFailures(): void
    {
        for ($failure = 1; $failure <= 4; ++$failure) {
            $this->attempt(self::ADMIN, 'falsches-passwort');
        }
        $this->signIn();

        for ($failure = 1; $failure <= 4; ++$failure) {
            $this->attempt(self::ADMIN, 'falsches-passwort');
        }

        self::assertSame(200, $this->attempt(self::ADMIN, self::ADMIN_PASSWORD)->getStatusCode());
    }

    /**
     * A pending attempt is one whose password is still being checked, or whose request died
     * meanwhile. A success keeps it, and it counts until it leaves the window.
     */
    public function testAPendingAttemptSurvivesASuccessAndCountsUntilItLeavesTheWindow(): void
    {
        $this->signIn();
        $this->otherSession()->prepare('INSERT INTO login_attempts (user_name, client_address, attempted_at, pending) VALUES (?, ?, ?, 1)')
            ->execute([self::ADMIN, '192.0.2.10', Timestamp::of($this->clock->now())]);

        self::assertSame(200, $this->attempt(self::ADMIN, self::ADMIN_PASSWORD)->getStatusCode());

        self::assertCount(1, $this->rows('SELECT id FROM login_attempts WHERE pending = 1'), 'the success keeps the pending attempt');
        for ($failure = 1; $failure < Sessions::MAX_FAILURES; ++$failure) {
            self::assertSame(401, $this->attempt(self::ADMIN, 'falsches-passwort')->getStatusCode());
        }
        self::assertSame(429, $this->attempt(self::ADMIN, self::ADMIN_PASSWORD)->getStatusCode(), 'it counts as the fifth');
        $this->clock->advance('PT' . (Sessions::FAILURE_WINDOW_MINUTES + 1) . 'M');
        self::assertSame(200, $this->attempt(self::ADMIN, self::ADMIN_PASSWORD)->getStatusCode(), 'until it left the window');
    }

    public function testRequestBodiesThatAreNotJsonAre415(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('POST', '/api/session')
            ->withHeader('Content-Type', 'application/x-www-form-urlencoded');
        $request->getBody()->write('userName=chef&password=bootstrap-passwort');

        $response = $this->app()->handle($request);

        self::assertSame(415, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame('urn:performance:problem:unsupported-media-type', $this->body($response)['type']);
    }

    public function testAFormPostWithoutASessionIs401BeforeItsBodyIsLookedAt(): void
    {
        foreach (['/api/persons', '/api/accounts'] as $path) {
            $request = (new ServerRequestFactory())->createServerRequest('POST', $path)
                ->withHeader('Content-Type', 'application/x-www-form-urlencoded');
            $request->getBody()->write('name=Daniel');

            self::assertSame(401, $this->app()->handle($request)->getStatusCode(), $path);
        }
    }

    public function testAFormPostWithASessionIs415(): void
    {
        $session = $this->signIn();
        $request = (new ServerRequestFactory())->createServerRequest('POST', '/api/persons')
            ->withHeader('Content-Type', 'application/x-www-form-urlencoded')
            ->withCookieParams(['session' => $session]);
        $request->getBody()->write('name=Daniel');

        self::assertSame(415, $this->app()->handle($request)->getStatusCode());
    }

    public function testABodyWithoutAContentTypeIs415(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('POST', '/api/session');
        $request->getBody()->write('{"userName":"chef","password":"bootstrap-passwort"}');

        self::assertSame(415, $this->app()->handle($request)->getStatusCode());
    }

    public function testMalformedJsonIs400(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('POST', '/api/session')
            ->withHeader('Content-Type', 'application/json; charset=utf-8');
        $request->getBody()->write('{"userName":');

        $response = $this->app()->handle($request);

        self::assertSame(400, $response->getStatusCode());
        self::assertSame('urn:performance:problem:bad-request', $this->body($response)['type']);
    }

    private function attempt(string $userName, string $password, string $address = '192.0.2.10'): ResponseInterface
    {
        return $this->send('POST', '/api/session', ['userName' => $userName, 'password' => $password], clientAddress: $address);
    }
}
