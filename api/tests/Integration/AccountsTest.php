<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;

final class AccountsTest extends DatabaseTestCase
{
    public function testAnAdminCreatesAnAccountThatCanSignInOnItsOwn(): void
    {
        $admin = $this->signIn();

        $created = $this->send('POST', '/api/accounts', ['userName' => ' anna ', 'password' => 'annas-startpasswort'], $admin);

        self::assertSame(201, $created->getStatusCode());
        self::assertSame(['id' => 2, 'userName' => 'anna', 'isAdmin' => false], $this->body($created));
        $anna = $this->signIn('anna', 'annas-startpasswort');
        self::assertSame(['id' => 2, 'userName' => 'anna', 'isAdmin' => false], $this->body($this->send('GET', '/api/session', session: $anna)));
    }

    public function testListsAccountsByUserName(): void
    {
        $admin = $this->signIn();
        foreach (['mara', 'Ben', 'anna'] as $name) {
            $this->send('POST', '/api/accounts', ['userName' => $name, 'password' => 'ein-startpasswort'], $admin);
        }

        $response = $this->send('GET', '/api/accounts', session: $admin);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame([
            ['id' => 4, 'userName' => 'anna', 'isAdmin' => false],
            ['id' => 3, 'userName' => 'Ben', 'isAdmin' => false],
            ['id' => 1, 'userName' => 'chef', 'isAdmin' => true],
            ['id' => 2, 'userName' => 'mara', 'isAdmin' => false],
        ], $this->body($response)['accounts']);
    }

    public function testADuplicateUserNameIgnoringCaseIs409(): void
    {
        $admin = $this->signIn();
        $this->send('POST', '/api/accounts', ['userName' => 'anna', 'password' => 'annas-startpasswort'], $admin);

        $response = $this->send('POST', '/api/accounts', ['userName' => 'ANNA', 'password' => 'ein-anderes-passwort'], $admin);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame(
            ['type' => 'urn:performance:problem:duplicate-user-name', 'title' => 'Benutzername ist bereits vergeben.', 'status' => 409],
            $this->body($response),
        );
    }

    public function testAShortPasswordOrAMissingUserNameIs422WithFieldErrors(): void
    {
        $admin = $this->signIn();

        $response = $this->send('POST', '/api/accounts', ['userName' => '   ', 'password' => 'kurz'], $admin);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame(
            ['userName' => '1 bis 40 Zeichen.', 'password' => 'Mindestens 10 Zeichen.'],
            $this->body($response)['errors'],
        );
        self::assertCount(1, $this->rows('SELECT id FROM accounts'));
    }

    public function testAPasswordWithANulCharacterIs422NotAServerError(): void
    {
        $session = $this->signIn();

        $response = $this->send('POST', '/api/accounts', ['userName' => 'nul', 'password' => "abcdefghij\0kl", 'isAdmin' => false], $session);

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['password' => 'Darf kein Nullzeichen enthalten.'], $this->body($response)['errors'] ?? null);
    }

    public function testAUserNameLongerThan40CharactersIs422(): void
    {
        $response = $this->send('POST', '/api/accounts', ['userName' => str_repeat('ä', 41), 'password' => 'ein-startpasswort'], $this->signIn());

        self::assertSame(['userName' => '1 bis 40 Zeichen.'], $this->body($response)['errors']);
    }

    public function testANonAdminGets403OnAccountRoutes(): void
    {
        $this->createAccount('anna', 'annas-startpasswort');
        $anna = $this->signIn('anna', 'annas-startpasswort');

        foreach ([['GET', null], ['POST', ['userName' => 'ben', 'password' => 'bens-startpasswort']]] as [$method, $json]) {
            $response = $this->send($method, '/api/accounts', $json, $anna);

            self::assertSame(403, $response->getStatusCode(), $method);
            self::assertSame(
                ['type' => 'urn:performance:problem:forbidden', 'title' => 'Nur für Admins', 'status' => 403],
                $this->body($response),
            );
        }
        self::assertCount(2, $this->rows('SELECT id FROM accounts'));
    }
}
