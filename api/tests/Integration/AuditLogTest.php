<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Domain\AuditLog;
use Performance\Tests\Support\DatabaseTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/**
 * The audit log, through HTTP only: a change is made through its real route and read back
 * through `GET /api/audit`.
 */
final class AuditLogTest extends DatabaseTestCase
{
    private const MEMBER = 'daniel';
    private const MEMBER_PASSWORD = 'daniels-passwort';
    private const NOW = '2026-11-14T20:00:00.000Z';
    private const ENTRY = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const OTHER_ENTRY = '0b9d8c7a-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
    private const THIRD_ENTRY = 'c3a1e2b4-5d6f-4a7b-8c9d-0e1f2a3b4c5d';
    private const RACE_ROUNDS = 3;
    private const RACE_ADDERS = 4;

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

    public function testTheLogPagesBackNewestFirstWithBeforeAndLimit(): void
    {
        foreach (['Bier', 'Wein', 'Sekt', 'Saft'] as $name) {
            $this->send('POST', '/api/drinks', ['name' => $name, 'points' => 1], $this->admin);
        }

        $newest = $this->page('?limit=2');
        $older = $this->page('?limit=2&before=' . $newest['next']);

        self::assertSame([4, 3], array_column($newest['events'], 'id'));
        self::assertSame(3, $newest['next']);
        self::assertSame([2, 1], array_column($older['events'], 'id'));
        self::assertNull($older['next'], 'a last page that is exactly full points to no empty page');
        self::assertSame(['events' => [], 'next' => null], $this->page('?before=1'));
        self::assertSame([4, 3, 2, 1], array_column($this->page('?before=99')['events'], 'id'));
    }

    public function testAPageHoldsTwentyEventsByDefaultAndAtMostAHundred(): void
    {
        // 3 catalog events, the drink's deletion as event 4, and 110 entry deletions as events 5 to 114.
        $this->entryCatalog();
        $this->seedEntries(110);
        $this->send('DELETE', '/api/drinks/1', session: $this->admin);

        $default = $this->page();
        $largest = $this->page('?limit=100');
        $rest = $this->page('?limit=100&before=' . $largest['next']);

        self::assertSame(range(114, 95), array_column($default['events'], 'id'));
        self::assertSame(95, $default['next']);
        self::assertSame(range(114, 15), array_column($largest['events'], 'id'));
        self::assertSame(15, $largest['next']);
        self::assertSame(range(14, 1), array_column($rest['events'], 'id'));
        self::assertNull($rest['next']);
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function invalidPaging(): iterable
    {
        yield 'before 0' => ['?before=0', 'before'];
        yield 'negative before' => ['?before=-3', 'before'];
        yield 'empty before' => ['?before=', 'before'];
        yield 'before as text' => ['?before=abc', 'before'];
        yield 'fractional before' => ['?before=2.5', 'before'];
        yield 'before as a list' => ['?before[]=2', 'before'];
        yield 'limit 0' => ['?limit=0', 'limit'];
        yield 'limit 101' => ['?limit=101', 'limit'];
        yield 'negative limit' => ['?limit=-1', 'limit'];
        yield 'empty limit' => ['?limit=', 'limit'];
        yield 'limit as text' => ['?limit=zehn', 'limit'];
        yield 'fractional limit' => ['?limit=1.5', 'limit'];
        yield 'huge limit' => ['?limit=99999999999999999999', 'limit'];
    }

    #[DataProvider('invalidPaging')]
    public function testAnInvalidBeforeOrLimitIsRejectedWith422(string $query, string $field): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->admin);

        $response = $this->send('GET', '/api/audit' . $query, session: $this->admin);

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        $problem = $this->body($response);
        self::assertSame('urn:performance:problem:validation', $problem['type']);
        self::assertIsArray($problem['errors']);
        self::assertSame([$field], array_keys($problem['errors']));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function writingMethods(): iterable
    {
        yield 'POST' => ['POST'];
        yield 'PUT' => ['PUT'];
        yield 'PATCH' => ['PATCH'];
        yield 'DELETE' => ['DELETE'];
    }

    #[DataProvider('writingMethods')]
    public function testTheLogCannotBeWrittenThroughTheApi(string $method): void
    {
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->admin);
        $recorded = $this->events();
        $revision = $this->scoreboardTag();
        $event = self::event(2, 'delete', 'drink', '1', ['accountId' => 1, 'userName' => 'admin'], ['name' => 'Bier', 'points' => 1], null);

        $response = $this->send($method, '/api/audit', $event, $this->admin);
        $addressed = $this->send($method, '/api/audit/1', $event, $this->admin);

        self::assertSame(405, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('GET', $response->getHeaderLine('Allow'));
        self::assertSame(404, $addressed->getStatusCode(), (string) $addressed->getBody());
        self::assertSame($recorded, $this->events());
        self::assertSame($revision, $this->scoreboardTag());
    }

    public function testEventsStayUnchangedAfterTheAccountAndTheItemsTheyMentionAreDeleted(): void
    {
        $member = $this->member();
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $member);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1.5], $member);
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $member);
        $this->putEntry(self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2, 'factorId' => 1], $member);
        $recorded = $this->events();

        foreach (['/api/accounts/2', '/api/factors/1', '/api/drinks/1', '/api/persons/1'] as $path) {
            $response = $this->send('DELETE', $path, session: $this->admin);
            self::assertSame(204, $response->getStatusCode(), "{$path}: " . (string) $response->getBody());
        }

        $actor = ['accountId' => 2, 'userName' => self::MEMBER];
        self::assertSame(
            [
                self::event(4, 'create', 'entry', self::ENTRY, $actor, null, self::entrySnapshot(2, ['name' => 'Happy Hour', 'multiplier' => 2])),
                self::event(3, 'create', 'factor', '1', $actor, null, ['name' => 'Happy Hour', 'multiplier' => 2]),
                self::event(2, 'create', 'drink', '1', $actor, null, ['name' => 'Bier', 'points' => 1.5]),
                self::event(1, 'create', 'person', '1', $actor, null, ['name' => 'Daniel']),
            ],
            $recorded,
        );
        self::assertSame($recorded, $this->page('?before=5')['events']);
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

    public function testAddingAnEntryRecordsOneCreateEventWithThePersonDrinkPointsQuantityAndFactorOfThatMoment(): void
    {
        $this->entryCatalog();
        $member = $this->member();

        $this->putEntry(self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2, 'factorId' => 1], $member);
        $this->putEntry(self::OTHER_ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1], $this->admin);
        $this->send('PATCH', '/api/drinks/1', ['name' => 'Helles', 'points' => 2], $this->admin);

        $actor = ['accountId' => 2, 'userName' => self::MEMBER];
        $adminActor = ['accountId' => 1, 'userName' => self::ADMIN];
        self::assertSame(
            [
                self::event(5, 'create', 'entry', self::OTHER_ENTRY, $adminActor, null, self::entrySnapshot(1, null)),
                self::event(4, 'create', 'entry', self::ENTRY, $actor, null, self::entrySnapshot(2, ['name' => 'Happy Hour', 'multiplier' => 2])),
            ],
            array_slice($this->events(), 1, 2),
        );
        self::assertSame(
            ['{"person":"Daniel","drink":"Bier","points":"1.50","quantity":2,"factor":{"name":"Happy Hour","multiplier":"2.00"}}'],
            array_column($this->rows("SELECT after_json FROM audit_events WHERE subject_id = '" . self::ENTRY . "'"), 'after_json'),
        );
    }

    public function testDeletingAnEntryRecordsOneDeleteEventWithTheDeletingAccountAndTheEntryAsItWasThen(): void
    {
        $this->entryCatalog();
        $this->putEntry(self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 3, 'factorId' => 1], $this->admin);
        $this->send('PATCH', '/api/factors/1', ['name' => 'Happy Hour', 'multiplier' => 2.5], $this->admin);
        $member = $this->member();

        $response = $this->send('DELETE', '/api/entries/' . self::ENTRY, session: $member);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        [$deleted, $factorChanged, $created] = $this->events();
        self::assertSame(
            self::event(
                6,
                'delete',
                'entry',
                self::ENTRY,
                ['accountId' => 2, 'userName' => self::MEMBER],
                self::entrySnapshot(3, ['name' => 'Happy Hour', 'multiplier' => 2.5]),
                null,
            ),
            $deleted,
        );
        self::assertSame('factor', $factorChanged['subjectKind']);
        self::assertSame(self::entrySnapshot(3, ['name' => 'Happy Hour', 'multiplier' => 2]), $created['after']);
    }

    public function testEntryRequestsThatReplayConflictOrFailRecordNoEvent(): void
    {
        $this->entryCatalog();
        $this->putEntry(self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2], $this->admin);
        $recorded = $this->events();

        $responses = [
            200 => $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2], $this->admin),
            409 => $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 3], $this->admin),
            422 => $this->send('PUT', '/api/entries/' . self::OTHER_ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 0], $this->admin),
        ];
        $missingParent = $this->send('PUT', '/api/entries/' . self::OTHER_ENTRY, ['personId' => 9, 'drinkId' => 1, 'quantity' => 1], $this->admin);
        $unknown = $this->send('DELETE', '/api/entries/' . self::OTHER_ENTRY, session: $this->admin);

        foreach ($responses as $status => $response) {
            self::assertSame($status, $response->getStatusCode(), (string) $response->getBody());
        }
        self::assertSame(422, $missingParent->getStatusCode(), (string) $missingParent->getBody());
        self::assertSame(404, $unknown->getStatusCode(), (string) $unknown->getBody());
        self::assertSame('entry', $recorded[0]['subjectKind']);
        self::assertSame($recorded, $this->events());
    }

    /**
     * @return iterable<string, array{string, string, array<string, mixed>, string}>
     */
    public static function cascadingDeletions(): iterable
    {
        yield 'drink' => ['drinks', 'drink', ['name' => 'Bier', 'points' => 1.5], 'Bier'];
        yield 'person' => ['persons', 'person', ['name' => 'Daniel'], 'Daniel'];
    }

    /**
     * @param array<string, mixed> $snapshot the deleted item's snapshot
     */
    #[DataProvider('cascadingDeletions')]
    public function testDeletingADrinkOrAPersonRecordsOneDeleteEventPerRemovedEntryCausedByTheDeletion(
        string $collection,
        string $kind,
        array $snapshot,
        string $name,
    ): void {
        $this->entryCatalog();
        $this->send('POST', '/api/persons', ['name' => 'Anna'], $this->admin);
        $this->send('POST', '/api/drinks', ['name' => 'Wein', 'points' => 2], $this->admin);
        $this->putEntry(self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2, 'factorId' => 1], $this->admin);
        $this->putEntry(self::OTHER_ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1], $this->admin);
        $this->putEntry(self::THIRD_ENTRY, ['personId' => 2, 'drinkId' => 2, 'quantity' => 1], $this->admin);
        $member = $this->member();

        $response = $this->send('DELETE', "/api/{$collection}/1", session: $member);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        $actor = ['accountId' => 2, 'userName' => self::MEMBER];
        $cause = ['id' => 9, 'subjectKind' => $kind, 'name' => $name];
        self::assertSame(
            [
                self::event(11, 'delete', 'entry', self::ENTRY, $actor, self::entrySnapshot(2, ['name' => 'Happy Hour', 'multiplier' => 2]), null, $cause),
                self::event(10, 'delete', 'entry', self::OTHER_ENTRY, $actor, self::entrySnapshot(1, null), null, $cause),
                self::event(9, 'delete', $kind, '1', $actor, $snapshot, null),
            ],
            array_slice($this->events(), 0, 3),
        );
        self::assertSame([['id' => self::THIRD_ENTRY]], $this->rows('SELECT id FROM entries'));
    }

    public function testDeletingAFactorRecordsOneUpdateEventPerEntryThatLosesItCausedByTheDeletion(): void
    {
        $this->entryCatalog();
        $this->putEntry(self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 2, 'factorId' => 1], $this->admin);
        $this->putEntry(self::OTHER_ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1, 'factorId' => 1], $this->admin);
        $this->putEntry(self::THIRD_ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 3], $this->admin);
        $member = $this->member();

        $response = $this->send('DELETE', '/api/factors/1', session: $member);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        $actor = ['accountId' => 2, 'userName' => self::MEMBER];
        $happyHour = ['name' => 'Happy Hour', 'multiplier' => 2];
        $cause = ['id' => 7, 'subjectKind' => 'factor', 'name' => 'Happy Hour'];
        self::assertSame(
            [
                self::event(9, 'update', 'entry', self::ENTRY, $actor, self::entrySnapshot(2, $happyHour), self::entrySnapshot(2, null), $cause),
                self::event(8, 'update', 'entry', self::OTHER_ENTRY, $actor, self::entrySnapshot(1, $happyHour), self::entrySnapshot(1, null), $cause),
                self::event(7, 'delete', 'factor', '1', $actor, $happyHour, null),
            ],
            array_slice($this->events(), 0, 3),
        );
        self::assertSame(
            [['after_json' => '{"person":"Daniel","drink":"Bier","points":"1.50","quantity":2,"factor":null}', 'cause_id' => 7]],
            $this->rows('SELECT after_json, cause_id FROM audit_events WHERE id = 9'),
        );
        self::assertSame([['factor_id' => null], ['factor_id' => null], ['factor_id' => null]], $this->rows('SELECT factor_id FROM entries'));
    }

    public function testAConsequentialEventOnAPageWithoutItsCauseStillNamesTheCause(): void
    {
        $this->entryCatalog();
        $this->seedEntries(AuditLog::PAGE_SIZE + 1);

        $this->send('DELETE', '/api/drinks/1', session: $this->admin);

        $events = $this->events();
        self::assertCount(AuditLog::PAGE_SIZE, $events);
        self::assertSame(array_fill(0, AuditLog::PAGE_SIZE, 'entry'), array_column($events, 'subjectKind'));
        self::assertSame(
            array_fill(0, AuditLog::PAGE_SIZE, ['id' => 4, 'subjectKind' => 'drink', 'name' => 'Bier']),
            array_column($events, 'cause'),
        );
        self::assertSame([5, 4, 3, 2, 1], array_column($this->page('?before=' . $this->page()['next'])['events'], 'id'), 'the cause sits on the next page');
    }

    /**
     * More entries than the deletion reads at a time (2 000) and stores per statement (500):
     * every one is recorded once, in id order, whichever chunk and batch it falls into.
     */
    public function testADeletionAffecting2500EntriesSucceedsAndRecordsEachOnceInIdOrder(): void
    {
        $this->entryCatalog();
        $this->seedEntries(2500);

        $response = $this->send('DELETE', '/api/persons/1', session: $this->admin);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        $removed = array_column($this->rows(
            "SELECT subject_id FROM audit_events WHERE subject_kind = 'entry' AND operation = 'delete' AND cause_id = 4 ORDER BY id",
        ), 'subject_id');
        $ids = array_map(static fn(int $i): string => sprintf('00000000-0000-4000-8000-%012d', $i), range(1, 2500));
        self::assertSame($ids, $removed);
        self::assertSame([], $this->rows('SELECT id FROM entries'));
    }

    /**
     * @return iterable<string, array{'person'|'drink'|'factor'}>
     */
    public static function racedDeletions(): iterable
    {
        yield 'person' => ['person'];
        yield 'drink' => ['drink'];
        yield 'factor' => ['factor'];
    }

    /**
     * Entry adds and a deletion of the person, drink or factor they reference start at the same
     * instant, in separate processes, round after round. Whatever the interleaving, every entry
     * that was added has exactly one event caused by the deletion, and none still references it.
     *
     * @param 'person'|'drink'|'factor' $kind
     */
    #[DataProvider('racedDeletions')]
    public function testADeletionRacingEntryAddsRecordsEveryEntryItRemovedOrChangedExactlyOnce(string $kind): void
    {
        for ($round = 1; $round <= self::RACE_ROUNDS; ++$round) {
            $parents = [
                'person' => $this->createdId($this->send('POST', '/api/persons', ['name' => "Person {$round}"], $this->admin)),
                'drink' => $this->createdId($this->send('POST', '/api/drinks', ['name' => "Getränk {$round}", 'points' => 1], $this->admin)),
                'factor' => $this->createdId($this->send('POST', '/api/factors', ['name' => "Faktor {$round}", 'multiplier' => 2], $this->admin)),
            ];
            $lastBefore = $this->lastEventId();
            $entry = ['personId' => $parents['person'], 'drinkId' => $parents['drink'], 'quantity' => 1, 'factorId' => $parents['factor']];
            $this->putEntry(self::uuid(), $entry, $this->admin);
            $this->putEntry(self::uuid(), $entry, $this->admin);

            $this->raceDeletion($kind, $parents, 0.02 * $round);

            $message = "{$kind} deletion, round {$round}";
            $events = array_filter($this->allEvents(), static fn(array $event): bool => $event['id'] > $lastBefore);
            $created = self::subjectIds(array_filter(
                $events,
                static fn(array $event): bool => $event['subjectKind'] === 'entry' && $event['operation'] === 'create',
            ));
            $deletion = array_column(array_filter(
                $events,
                static fn(array $event): bool => $event['subjectKind'] === $kind && $event['subjectId'] === (string) $parents[$kind]
                    && $event['operation'] === 'delete',
            ), 'id');
            self::assertCount(1, $deletion, $message);
            $consequences = array_filter(
                $events,
                static fn(array $event): bool => is_array($event['cause']) && $event['cause']['id'] === $deletion[0],
            );
            $expected = $kind === 'factor' ? 'update' : 'delete';

            self::assertSame($created, self::subjectIds($consequences), $message);
            self::assertSame(array_fill(0, count($consequences), $expected), array_column($consequences, 'operation'), $message);
            $surviving = array_column($this->rows(
                "SELECT id FROM entries WHERE person_id = {$parents['person']} OR drink_id = {$parents['drink']} ORDER BY id",
            ), 'id');
            $withFactor = $this->rows("SELECT id FROM entries WHERE factor_id = {$parents['factor']}");

            self::assertSame($kind === 'factor' ? $created : [], $surviving, $message);
            self::assertSame([], $withFactor, $message);
            $this->otherSession()->exec('DELETE FROM entries');
        }
    }

    /** A person, a drink worth 1.5 points and a factor of 2, created by the admin. */
    private function entryCatalog(): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $this->admin);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1.5], $this->admin);
        $this->send('POST', '/api/factors', ['name' => 'Happy Hour', 'multiplier' => 2], $this->admin);
    }

    /**
     * @param array<string, int> $request
     */
    private function putEntry(string $id, array $request, string $session): void
    {
        $response = $this->send('PUT', '/api/entries/' . $id, $request, $session);
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
    }

    /**
     * An entry of Daniel's Bier (1.5 points) as the API shows it.
     *
     * @param array{name: string, multiplier: int|float}|null $factor
     *
     * @return array<string, mixed>
     */
    private static function entrySnapshot(int $quantity, ?array $factor): array
    {
        return ['person' => 'Daniel', 'drink' => 'Bier', 'points' => 1.5, 'quantity' => $quantity, 'factor' => $factor];
    }

    /**
     * Starts the entry adders and the deletion in separate processes: the adders at one instant,
     * the deletion `$delay` seconds later, so it lands among the adds.
     *
     * @param array{person: int, drink: int, factor: int} $parents
     */
    private function raceDeletion(string $kind, array $parents, float $delay): void
    {
        $script = __DIR__ . '/../Support/deletion-race.php';
        $startAt = microtime(true) + 1.0;
        $ids = [(string) $parents['person'], (string) $parents['drink'], (string) $parents['factor'], '1'];
        $runs = array_fill(0, self::RACE_ADDERS, [(string) $startAt, 'add', ...$ids]);
        $runs[] = [(string) ($startAt + $delay), "delete-{$kind}", ...$ids];
        $processes = [];
        foreach ($runs as $arguments) {
            $process = proc_open([PHP_BINARY, $script, ...$arguments], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            self::assertIsResource($process);
            $processes[] = [$process, $pipes, $arguments[1]];
        }
        foreach ($processes as [$process, $pipes, $role]) {
            $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            self::assertSame(0, proc_close($process), "{$role}: {$output}");
        }
    }

    /**
     * Inserts entries of Daniel's Bier straight into the table, as many as a test needs.
     */
    private function seedEntries(int $count): void
    {
        $rows = [];
        for ($i = 1; $i <= $count; ++$i) {
            $rows[] = sprintf("('00000000-0000-4000-8000-%012d', 1, 1, 1, NULL, 1, '2026-11-14 19:00:00.000')", $i);
        }
        $this->otherSession()->exec(
            'INSERT INTO entries (id, person_id, drink_id, quantity, factor_id, account_id, created_at) VALUES ' . implode(', ', $rows),
        );
    }

    private function createdId(ResponseInterface $response): int
    {
        self::assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        $id = $this->body($response)['id'];
        self::assertIsInt($id);

        return $id;
    }

    /** A random lower-case UUID v4, as a client makes an entry id. */
    private static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr(ord($bytes[6]) & 0x0F | 0x40);
        $bytes[8] = chr(ord($bytes[8]) & 0x3F | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    private function lastEventId(): int
    {
        $id = $this->page('?limit=1')['events'][0]['id'] ?? 0;
        self::assertIsInt($id);

        return $id;
    }

    /**
     * The subject ids of events, sorted.
     *
     * @param array<array<string, mixed>> $events
     *
     * @return list<string>
     */
    private static function subjectIds(array $events): array
    {
        $ids = [];
        foreach ($events as $event) {
            self::assertIsString($event['subjectId']);
            $ids[] = $event['subjectId'];
        }
        sort($ids);

        return $ids;
    }

    /** The scoreboard's ETag, which names the data revision. */
    private function scoreboardTag(): string
    {
        $response = $this->send('GET', '/api/scoreboard?from=' . rawurlencode(self::NOW), session: $this->admin);
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());

        return $response->getHeaderLine('ETag');
    }

    /** Signs in a second account, which is not an admin, and returns its session. */
    private function member(): string
    {
        $this->createAccount(self::MEMBER, self::MEMBER_PASSWORD);

        return $this->signIn(self::MEMBER, self::MEMBER_PASSWORD);
    }

    /**
     * The newest page of events an admin reads, newest first.
     *
     * @return list<array<string, mixed>>
     */
    private function events(): array
    {
        return $this->page()['events'];
    }

    /**
     * A page an admin reads, for a query string such as `?before=5&limit=2`.
     *
     * @return array{events: list<array<string, mixed>>, next: int|null}
     */
    private function page(string $query = ''): array
    {
        $response = $this->send('GET', '/api/audit' . $query, session: $this->admin);
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        $page = $this->body($response);
        self::assertSame(['events', 'next'], array_keys($page));

        /** @var array{events: list<array<string, mixed>>, next: int|null} */
        return $page;
    }

    /**
     * Every event an admin reads, newest first, page after page of the largest size.
     *
     * @return list<array<string, mixed>>
     */
    private function allEvents(): array
    {
        $events = [];
        $next = null;
        do {
            $page = $this->page('?limit=' . AuditLog::MAX_PAGE_SIZE . ($next === null ? '' : "&before={$next}"));
            array_push($events, ...$page['events']);
            $next = $page['next'];
        } while ($next !== null);

        return $events;
    }

    /**
     * @param array{accountId: int, userName: string} $actor
     * @param array<string, mixed>|null               $before
     * @param array<string, mixed>|null               $after
     * @param array<string, mixed>|null               $cause
     *
     * @return array<string, mixed>
     */
    private static function event(
        int $id,
        string $operation,
        string $kind,
        string $subjectId,
        array $actor,
        ?array $before,
        ?array $after,
        ?array $cause = null,
    ): array {
        return [
            'id' => $id,
            'occurredAt' => self::NOW,
            'operation' => $operation,
            'subjectKind' => $kind,
            'subjectId' => $subjectId,
            'actor' => $actor,
            'before' => $before,
            'after' => $after,
            'cause' => $cause,
        ];
    }
}
