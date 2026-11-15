<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;

final class AccountAdminTest extends DatabaseTestCase
{
    public function testAnAdminResetsAPasswordAndSignsTheAccountOutEverywhere(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $phone = $this->signIn('anna', 'annas-startpasswort');
        $laptop = $this->signIn('anna', 'annas-startpasswort');

        $response = $this->send('PATCH', '/api/accounts/2', ['password' => 'neues-passwort-1'], $this->signIn());

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['id' => 2, 'userName' => 'anna', 'isAdmin' => false], $this->body($response));
        foreach ([$phone, $laptop] as $session) {
            self::assertSame(401, $this->send('GET', '/api/session', session: $session)->getStatusCode());
        }
        $old = $this->send('POST', '/api/session', ['userName' => 'anna', 'password' => 'annas-startpasswort']);
        self::assertSame(401, $old->getStatusCode());
        $this->signIn('anna', 'neues-passwort-1');
    }

    public function testAnAdminGrantsAndRevokesAdminRights(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $admin = $this->signIn();

        $granted = $this->send('PATCH', '/api/accounts/2', ['isAdmin' => true], $admin);

        self::assertSame(200, $granted->getStatusCode(), (string) $granted->getBody());
        self::assertSame(['id' => 2, 'userName' => 'anna', 'isAdmin' => true], $this->body($granted));
        $anna = $this->signIn('anna', 'annas-startpasswort');
        self::assertSame(200, $this->send('GET', '/api/accounts', session: $anna)->getStatusCode());

        $revoked = $this->send('PATCH', '/api/accounts/2', ['isAdmin' => false], $admin);

        self::assertSame(['id' => 2, 'userName' => 'anna', 'isAdmin' => false], $this->body($revoked));
        self::assertSame(403, $this->send('GET', '/api/accounts', session: $anna)->getStatusCode());
        self::assertSame([
            ['id' => 2, 'userName' => 'anna', 'isAdmin' => false],
            ['id' => 1, 'userName' => self::ADMIN, 'isAdmin' => true],
        ], $this->body($this->send('GET', '/api/accounts', session: $admin))['accounts']);
    }

    public function testAnAdminMayDemoteItselfWhileAnotherAdminRemains(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $admin = $this->signIn();
        $this->send('PATCH', '/api/accounts/2', ['isAdmin' => true], $admin);

        $response = $this->send('PATCH', '/api/accounts/1', ['isAdmin' => false], $admin);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(403, $this->send('GET', '/api/accounts', session: $admin)->getStatusCode());
    }

    public function testDeletingAnAccountRevokesItsSessionsAndKeepsItsEntriesWithoutTheirLoggedByReference(): void
    {
        $admin = $this->signIn();
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $admin);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1.5], $admin);
        $entry = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
        $added = $this->send('PUT', "/api/entries/{$entry}", ['personId' => 1, 'drinkId' => 1, 'quantity' => 2], $anna);
        self::assertSame(201, $added->getStatusCode(), (string) $added->getBody());
        $from = '2026-11-14T00:00:00.000Z';
        $scores = $this->body($this->send('GET', "/api/scoreboard?from={$from}", session: $admin));

        $response = $this->send('DELETE', '/api/accounts/2', session: $admin);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(401, $this->send('GET', '/api/session', session: $anna)->getStatusCode());
        self::assertSame(401, $this->send('POST', '/api/session', ['userName' => 'anna', 'password' => 'annas-startpasswort'])->getStatusCode());
        self::assertSame(
            [['id' => 1, 'userName' => self::ADMIN, 'isAdmin' => true]],
            $this->body($this->send('GET', '/api/accounts', session: $admin))['accounts'],
        );
        $history = $this->body($this->send('GET', "/api/entries?personId=1&from={$from}", session: $admin))['entries'];
        self::assertIsArray($history);
        self::assertCount(1, $history);
        self::assertIsArray($history[0]);
        self::assertSame($entry, $history[0]['id']);
        self::assertNull($history[0]['accountName']);
        self::assertSame($scores, $this->body($this->send('GET', "/api/scoreboard?from={$from}", session: $admin)));
    }

    public function testTheLastAdminCannotBeDemotedOrDeleted(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $admin = $this->signIn();

        foreach ([['PATCH', ['isAdmin' => false]], ['DELETE', null]] as [$method, $json]) {
            $response = $this->send($method, '/api/accounts/1', $json, $admin);

            self::assertSame(409, $response->getStatusCode(), $method);
            self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
            self::assertSame(
                ['type' => 'urn:performance:problem:last-admin', 'title' => 'Der letzte Admin kann nicht entfernt werden.', 'status' => 409],
                $this->body($response),
            );
        }
        self::assertSame(
            [['user_name' => self::ADMIN, 'is_admin' => 1], ['user_name' => 'anna', 'is_admin' => 0]],
            $this->rows('SELECT user_name, is_admin FROM accounts ORDER BY id'),
        );
        self::assertSame(200, $this->send('GET', '/api/session', session: $admin)->getStatusCode());
    }

    public function testARefusedDemotionLeavesAPasswordResetInTheSameRequestUndone(): void
    {
        $admin = $this->signIn();

        $response = $this->send('PATCH', '/api/accounts/1', ['isAdmin' => false, 'password' => 'neues-passwort-1'], $admin);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame(200, $this->send('GET', '/api/session', session: $admin)->getStatusCode());
        $this->signIn();
    }

    public function testAnotherAdminCanBeDeletedAndDemotedAndALastAdminMayStillResetItsPassword(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $admin = $this->signIn();
        $this->send('PATCH', '/api/accounts/2', ['isAdmin' => true], $admin);

        self::assertSame(204, $this->send('DELETE', '/api/accounts/2', session: $admin)->getStatusCode());

        $reset = $this->send('PATCH', '/api/accounts/1', ['isAdmin' => true, 'password' => 'neues-passwort-1'], $admin);
        self::assertSame(['id' => 1, 'userName' => self::ADMIN, 'isAdmin' => true], $this->body($reset));
        $this->signIn(self::ADMIN, 'neues-passwort-1');
    }

    public function testAShortResetPasswordIs422AndChangesNothing(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');

        $response = $this->send('PATCH', '/api/accounts/2', ['password' => 'kurz', 'isAdmin' => true], $this->signIn());

        self::assertSame(422, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame(['password' => 'Mindestens 10 Zeichen.'], $this->body($response)['errors']);
        self::assertSame(['id' => 2, 'userName' => 'anna', 'isAdmin' => false], $this->body($this->send('GET', '/api/session', session: $anna)));
    }

    /** The review's case: bcrypt ignores everything after 72 bytes, so the old password would still sign in. */
    public function testAResetPasswordOver72BytesIs422AndTheOldPasswordStaysTheOnlyOne(): void
    {
        $old = str_repeat('a', 72);
        $this->createAccount('anna', $old);

        $response = $this->send('PATCH', '/api/accounts/2', ['password' => $old . 'new'], $this->signIn());

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['password' => 'Höchstens 72 Byte (Umlaute zählen doppelt).'], $this->body($response)['errors']);
        $this->signIn('anna', $old);
    }

    public function testAPasswordThatIsNoTextIs422AndAnEmptyChangeLeavesTheAccountAsItIs(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $admin = $this->signIn();

        $number = $this->send('PATCH', '/api/accounts/2', ['password' => 12345678901], $admin);
        $nothing = $this->send('PATCH', '/api/accounts/2', [], $admin);

        self::assertSame(['password' => 'Mindestens 10 Zeichen.'], $this->body($number)['errors']);
        self::assertSame(200, $nothing->getStatusCode());
        self::assertSame(['id' => 2, 'userName' => 'anna', 'isAdmin' => false], $this->body($nothing));
        $this->signIn('anna', 'annas-startpasswort');
    }

    public function testAnAdminFlagThatIsNoBooleanIs422(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');

        $response = $this->send('PATCH', '/api/accounts/2', ['isAdmin' => 'ja'], $this->signIn());

        self::assertSame(422, $response->getStatusCode());
        self::assertSame(['isAdmin' => 'Ja oder nein.'], $this->body($response)['errors']);
    }

    public function testUnknownAccountsAre404(): void
    {
        $admin = $this->signIn();

        foreach (['/api/accounts/99', '/api/accounts/0', '/api/accounts/abc'] as $path) {
            foreach ([['PATCH', ['isAdmin' => true]], ['DELETE', null]] as [$method, $json]) {
                $response = $this->send($method, $path, $json, $admin);

                self::assertSame(404, $response->getStatusCode(), "{$method} {$path}");
                self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
            }
        }
    }

    public function testANonAdminGets403AndNobodySignedInGets401(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $this->createAccount('ben', 'bens-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');

        foreach ([['PATCH', ['isAdmin' => true]], ['PATCH', ['password' => 'neues-passwort-1']], ['DELETE', null]] as [$method, $json]) {
            $forbidden = $this->send($method, '/api/accounts/3', $json, $anna);
            $anonymous = $this->send($method, '/api/accounts/3', $json);

            self::assertSame(403, $forbidden->getStatusCode(), $method);
            self::assertSame(
                ['type' => 'urn:performance:problem:forbidden', 'title' => 'Nur für Admins', 'status' => 403],
                $this->body($forbidden),
            );
            self::assertSame(401, $anonymous->getStatusCode(), $method);
            self::assertSame('application/problem+json', $anonymous->getHeaderLine('Content-Type'));
        }
        self::assertSame(
            [['user_name' => self::ADMIN, 'is_admin' => 1], ['user_name' => 'anna', 'is_admin' => 0], ['user_name' => 'ben', 'is_admin' => 0]],
            $this->rows('SELECT user_name, is_admin FROM accounts ORDER BY id'),
        );
        $this->signIn('ben', 'bens-startpasswort');
    }
}
