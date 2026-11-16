<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * The audit log, through HTTP only: a change is made through its real route and read back
 * through `GET /api/audit`.
 */
final class AuditLogTest extends DatabaseTestCase
{
    private const MEMBER = 'daniel';
    private const MEMBER_PASSWORD = 'daniels-passwort';
    private const NOW = '2026-11-14T20:00:00.000Z';

    private string $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->signIn();
    }

    /**
     * @return iterable<string, array{string, array<string, mixed>, array<string, mixed>, array<string, mixed>, array<string, mixed>}>
     */
    public static function catalogItems(): iterable
    {
        yield 'drink' => [
            'drinks',
            ['name' => ' Bier ', 'points' => 1],
            ['name' => 'Bier', 'points' => 1],
            ['name' => 'Bier', 'points' => 0.5],
            ['name' => 'Bier', 'points' => 0.5],
        ];
        yield 'person' => [
            'persons',
            ['name' => ' Daniel '],
            ['name' => 'Daniel'],
            ['name' => 'Dani'],
            ['name' => 'Dani'],
        ];
        yield 'factor' => [
            'factors',
            ['name' => 'Happy Hour', 'multiplier' => 2],
            ['name' => 'Happy Hour', 'multiplier' => 2],
            ['name' => 'Happy Hour XL', 'multiplier' => 3.5],
            ['name' => 'Happy Hour XL', 'multiplier' => 3.5],
        ];
    }

    /**
     * @param array<string, mixed> $created  the create request
     * @param array<string, mixed> $original the snapshot of the created item
     * @param array<string, mixed> $changed  the update request
     * @param array<string, mixed> $updated  the snapshot of the updated item
     */
    #[DataProvider('catalogItems')]
    public function testCreatingUpdatingAndDeletingAnItemRecordsOneEventEachWithTheActingAccount(
        string $collection,
        array $created,
        array $original,
        array $changed,
        array $updated,
    ): void {
        $member = $this->member();

        self::assertSame(201, $this->send('POST', "/api/{$collection}", $created, $member)->getStatusCode());
        self::assertSame(200, $this->send('PATCH', "/api/{$collection}/1", $changed, $member)->getStatusCode());
        self::assertSame(204, $this->send('DELETE', "/api/{$collection}/1", session: $member)->getStatusCode());

        $kind = substr($collection, 0, -1);
        $actor = ['accountId' => 2, 'userName' => self::MEMBER];
        self::assertSame(
            [
                self::event(3, 'delete', $kind, '1', $actor, $updated, null),
                self::event(2, 'update', $kind, '1', $actor, $original, $updated),
                self::event(1, 'create', $kind, '1', $actor, null, $original),
            ],
            $this->events(),
        );
    }

    public function testAnEventKeepsTheActorAndTheValuesOfItsTimeAfterTheyChange(): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->member());
        $this->send('PATCH', '/api/drinks/1', ['name' => 'Helles', 'points' => 1], $this->admin);
        $this->send('DELETE', '/api/accounts/2', session: $this->admin);

        $created = $this->events()[1];

        self::assertSame(['accountId' => 2, 'userName' => self::MEMBER], $created['actor']);
        self::assertSame(['name' => 'Bier', 'points' => 1], $created['after']);
    }

    public function testTheLogIsForAdminsOnly(): void
    {
        $anonymous = $this->send('GET', '/api/audit');
        $member = $this->send('GET', '/api/audit', session: $this->member());

        self::assertSame(401, $anonymous->getStatusCode());
        self::assertSame(403, $member->getStatusCode());
        self::assertSame('urn:performance:problem:forbidden', $this->body($member)['type']);
    }

    public function testWritesThatFailOrChangeNothingRecordNoEvent(): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->admin);
        $this->send('POST', '/api/drinks', ['name' => 'Wein', 'points' => 2], $this->admin);
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->admin);
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->admin);
        $recorded = $this->events();

        $failed = [
            422 => [
                $this->send('POST', '/api/drinks', ['name' => '', 'points' => 1], $this->admin),
                $this->send('PATCH', '/api/persons/1', ['name' => str_repeat('x', 41)], $this->admin),
                $this->send('PATCH', '/api/factors/1', ['name' => 'Happy Hour', 'multiplier' => 0], $this->admin),
            ],
            409 => [
                $this->send('POST', '/api/drinks', ['name' => 'BIER', 'points' => 3], $this->admin),
                $this->send('PATCH', '/api/drinks/2', ['name' => 'bier', 'points' => 2], $this->admin),
            ],
            404 => [
                $this->send('PATCH', '/api/drinks/9', ['name' => 'Sekt', 'points' => 1], $this->admin),
                $this->send('DELETE', '/api/persons/9', session: $this->admin),
                $this->send('DELETE', '/api/factors/9', session: $this->admin),
            ],
        ];
        $unchanged = [
            $this->send('PATCH', '/api/drinks/1', ['name' => ' Bier ', 'points' => 1.0], $this->admin),
            $this->send('PATCH', '/api/persons/1', ['name' => 'Daniel'], $this->admin),
            $this->send('PATCH', '/api/factors/1', ['name' => 'Happy Hour', 'multiplier' => 2], $this->admin),
        ];

        foreach ($failed as $status => $responses) {
            foreach ($responses as $response) {
                self::assertSame($status, $response->getStatusCode(), (string) $response->getBody());
            }
        }
        foreach ($unchanged as $response) {
            self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        }
        self::assertCount(4, $recorded);
        self::assertSame($recorded, $this->events());
    }

    public function testWhenTheEventCannotBeStoredTheChangeAndTheRevisionBumpRollBack(): void
    {
        // Breaks the audit table under the API: every new event violates this constraint.
        $this->otherSession()->exec('ALTER TABLE audit_events ADD CONSTRAINT audit_events_broken CHECK (snapshot_version = 0)');

        $response = $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->admin);

        self::assertSame(500, $response->getStatusCode());
        self::assertSame([], $this->rows('SELECT id FROM drinks'));
        self::assertSame([], $this->rows('SELECT revision FROM data_revision'));
        $this->otherSession()->exec('ALTER TABLE audit_events DROP CONSTRAINT audit_events_broken');
        self::assertSame([], $this->events());
    }

    public function testWhenTheTransactionFailsAfterTheEventTheChangeAndTheEventRollBack(): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->admin);
        $recorded = $this->events();
        // Breaks the revision bump, which runs after the change and its event, before the commit.
        $this->otherSession()->exec('ALTER TABLE data_revision ADD CONSTRAINT data_revision_broken CHECK (revision <= 1)');

        $response = $this->send('PATCH', '/api/drinks/1', ['name' => 'Bier', 'points' => 0.5], $this->admin);

        self::assertSame(500, $response->getStatusCode());
        self::assertSame([['points' => '1.00']], $this->rows('SELECT points FROM drinks'));
        self::assertSame([['revision' => 1]], $this->rows('SELECT revision FROM data_revision'));
        self::assertCount(1, $recorded);
        self::assertSame($recorded, $this->events());
    }

    public function testSnapshotsAreStoredWithFixedScaleDecimalsAndVersion1AndReadAsNumbers(): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1.5], $this->admin);
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->admin);
        $this->send('PATCH', '/api/factors/1', ['name' => 'Happy Hour', 'multiplier' => 0.25], $this->admin);

        self::assertSame(
            [
                ['before_json' => null, 'after_json' => '{"name":"Bier","points":"1.50"}', 'snapshot_version' => 1],
                ['before_json' => null, 'after_json' => '{"name":"Happy Hour","multiplier":"2.00"}', 'snapshot_version' => 1],
                [
                    'before_json' => '{"name":"Happy Hour","multiplier":"2.00"}',
                    'after_json' => '{"name":"Happy Hour","multiplier":"0.25"}',
                    'snapshot_version' => 1,
                ],
            ],
            $this->rows('SELECT before_json, after_json, snapshot_version FROM audit_events ORDER BY id'),
        );
        $events = $this->events();
        self::assertSame(['name' => 'Happy Hour', 'multiplier' => 0.25], $events[0]['after']);
        self::assertSame(['name' => 'Happy Hour', 'multiplier' => 2], $events[0]['before']);
        self::assertSame(['name' => 'Bier', 'points' => 1.5], $events[2]['after']);
    }

    /** Signs in a second account, which is not an admin, and returns its session. */
    private function member(): string
    {
        $this->createAccount(self::MEMBER, self::MEMBER_PASSWORD);

        return $this->signIn(self::MEMBER, self::MEMBER_PASSWORD);
    }

    /**
     * The events an admin reads, newest first.
     *
     * @return list<array<string, mixed>>
     */
    private function events(): array
    {
        $response = $this->send('GET', '/api/audit', session: $this->admin);
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());

        /** @var list<array<string, mixed>> */
        return $this->body($response)['events'];
    }

    /**
     * @param array{accountId: int, userName: string} $actor
     * @param array<string, mixed>|null               $before
     * @param array<string, mixed>|null               $after
     *
     * @return array<string, mixed>
     */
    private static function event(int $id, string $operation, string $kind, string $subjectId, array $actor, ?array $before, ?array $after): array
    {
        return [
            'id' => $id,
            'occurredAt' => self::NOW,
            'operation' => $operation,
            'subjectKind' => $kind,
            'subjectId' => $subjectId,
            'actor' => $actor,
            'before' => $before,
            'after' => $after,
            'cause' => null,
        ];
    }
}
