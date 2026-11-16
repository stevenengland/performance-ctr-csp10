<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;

final class IdempotencyTest extends DatabaseTestCase
{
    private const ENTRY = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const TWO_BEERS = ['personId' => 1, 'drinkId' => 1, 'quantity' => 2];

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
        self::assertCount(1, $this->rows('SELECT id FROM entry_requests'));
        self::assertSame([['subject_id' => self::ENTRY]], $this->rows("SELECT subject_id FROM audit_events WHERE subject_kind = 'entry'"));
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

        self::assertCount(2, $this->rows('SELECT id FROM entry_requests'));

        $this->clock->advance('PT1S');
        $this->put(self::TWO_BEERS, '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c');

        self::assertSame(
            [['id' => '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b'], ['id' => '1c9a6f4b-2d3e-4f5a-8b1c-2d3e4f5a6b7c']],
            $this->rows('SELECT id FROM entry_requests ORDER BY created_at'),
        );
        self::assertCount(3, $this->rows('SELECT id FROM entries'));
    }

    /**
     * @param array<string, int|null> $content
     */
    private function put(array $content, string $id = self::ENTRY): \Psr\Http\Message\ResponseInterface
    {
        return $this->send('PUT', "/api/entries/{$id}", $content, $this->session);
    }
}
