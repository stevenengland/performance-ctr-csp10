<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Domain\Catalog\CleanJpeg;
use Performance\Http\App;
use Performance\Http\ClientVersionGate;
use Performance\Http\PersonPhotoActions;
use Performance\Tests\Support\DatabaseTestCase;
use Performance\Tests\Support\InterleavedWrites;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Factory\ResponseFactory;
use Slim\Psr7\Factory\ServerRequestFactory;

/**
 * A person's photo through HTTP: `PUT`, `GET` and `DELETE /api/persons/{id}/photo`, observed through
 * the stored row, the audit log and the scoreboard's ETag; races in their own processes.
 */
final class PersonPhotoTest extends DatabaseTestCase
{
    use InterleavedWrites;

    private const MEMBER = 'daniel';
    private const MEMBER_PASSWORD = 'daniels-passwort';
    private const PHOTO = '/api/persons/1/photo';
    private const SUCCEEDED = 0;
    private const NOT_FOUND = 3;

    private string $admin;
    private string $member;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->signIn();
        $this->createAccount(self::MEMBER, self::MEMBER_PASSWORD);
        $this->member = $this->signIn(self::MEMBER, self::MEMBER_PASSWORD);
        $created = $this->send('POST', '/api/persons', ['name' => 'Anna'], $this->admin);
        self::assertSame(201, $created->getStatusCode(), (string) $created->getBody());
    }

    /**
     * The upload carries EXIF and GPS; what is stored, and hashed into the version, is the
     * photo without them.
     */
    public function testAMembersUploadStoresTheCleanedPhotoAndRecordsOnePersonUpdate(): void
    {
        $tag = $this->scoreboardTag();

        $response = $this->put('metadata.jpg', $this->member);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['id' => 1, 'name' => 'Anna', 'photoUrl' => self::versioned('A')], $this->body($response));
        $cleaned = self::fixture('metadata-cleaned.jpg');
        self::assertSame([['person_id' => '1', 'jpeg' => $cleaned, 'version' => hash('sha256', $cleaned)]], $this->storedPhotos());
        self::assertStringNotContainsString('Exif', $cleaned);
        self::assertSame(
            [['update', self::MEMBER, ['name' => 'Anna', 'photo' => null], ['name' => 'Anna', 'photo' => 'A']]],
            $this->photoEvents(),
        );
        self::assertNotSame($tag, $this->scoreboardTag());
    }

    public function testReplacingRecordsTheOldAndTheNewVersionAndRemovingRecordsNoPhoto(): void
    {
        $this->put('metadata.jpg', $this->member);

        $replaced = $this->put('progressive.jpg', $this->member);
        $removed = $this->send('DELETE', self::PHOTO, session: $this->member);

        self::assertSame(200, $replaced->getStatusCode(), (string) $replaced->getBody());
        self::assertSame(204, $removed->getStatusCode(), (string) $removed->getBody());
        self::assertSame('', (string) $removed->getBody());
        self::assertSame([], $this->storedPhotos());
        self::assertSame(
            [
                ['update', self::MEMBER, ['name' => 'Anna', 'photo' => null], ['name' => 'Anna', 'photo' => 'A']],
                ['update', self::MEMBER, ['name' => 'Anna', 'photo' => 'A'], ['name' => 'Anna', 'photo' => 'B']],
                ['update', self::MEMBER, ['name' => 'Anna', 'photo' => 'B'], ['name' => 'Anna', 'photo' => null]],
            ],
            $this->photoEvents(),
        );
    }

    public function testRemovingAPhotoThatIsNotThereChangesNothing(): void
    {
        $tag = $this->scoreboardTag();

        $response = $this->send('DELETE', self::PHOTO, session: $this->member);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame($tag, $this->scoreboardTag(), 'no revision bump');
        self::assertSame([], $this->photoEvents());
    }

    /** `metadata-cleaned.jpg` is what cleaning `metadata.jpg` gives: the same version. */
    public function testUploadingTheSamePhotoAgainChangesNothing(): void
    {
        $this->put('metadata.jpg', $this->member);
        $tag = $this->scoreboardTag();

        $again = $this->put('metadata-cleaned.jpg', $this->member);

        self::assertSame(200, $again->getStatusCode(), (string) $again->getBody());
        self::assertSame(['id' => 1, 'name' => 'Anna', 'photoUrl' => self::versioned('A')], $this->body($again));
        self::assertSame($tag, $this->scoreboardTag(), 'no revision bump');
        self::assertCount(1, $this->photoEvents());
    }

    /** The second upload waits for the first's person lock and then finds its version stored. */
    public function testParallelIdenticalUploadsBumpTheRevisionOnceAndRecordOneEvent(): void
    {
        $revision = $this->revision();

        $exitCodes = $this->interleave('persons', '1', [['set-photo', '1'], ['set-photo', '1']]);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame($revision + 1, $this->revision());
        self::assertSame([['update', 'race', ['name' => 'Anna', 'photo' => null], ['name' => 'Anna', 'photo' => 'B']]], $this->photoEvents());
    }

    /**
     * Two persons' first photos at once: each write holds a gap lock on the empty photo table
     * and waits for the other's to insert, so InnoDB rolls one back, and the whole-transaction
     * retry runs it again (ADR 0007). Whether a deadlock happens is not the point; both land.
     */
    public function testParallelFirstUploadsOfTwoPersonsBothLand(): void
    {
        $created = $this->send('POST', '/api/persons', ['name' => 'Berta'], $this->admin);
        self::assertSame(201, $created->getStatusCode(), (string) $created->getBody());
        $revision = $this->revision();

        $exitCodes = $this->interleave('persons', ['1', '2'], [['set-photo', '1'], ['set-photo', '2']]);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame(
            [['1', 'B'], ['2', 'B']],
            array_map(fn(array $row): array => [$row['person_id'], $this->label($row['version'])], $this->storedPhotos()),
        );
        self::assertSame($revision + 2, $this->revision());
        $events = $this->photoEvents();
        self::assertCount(2, $events);
        self::assertContains(['update', 'race', ['name' => 'Anna', 'photo' => null], ['name' => 'Anna', 'photo' => 'B']], $events);
        self::assertContains(['update', 'race', ['name' => 'Berta', 'photo' => null], ['name' => 'Berta', 'photo' => 'B']], $events);
    }

    /** The client never composes a photo URL: the one the person carries serves the photo as it is. */
    public function testThePersonListAndThePersonNameTheStoredVersionsUrlWhichServesThePhoto(): void
    {
        $this->put('metadata.jpg', $this->member);

        $listed = $this->send('GET', '/api/persons', session: $this->member);
        $read = $this->send('GET', '/api/persons/1', session: $this->member);

        self::assertSame([['id' => 1, 'name' => 'Anna', 'photoUrl' => self::versioned('A')]], $this->body($listed)['persons']);
        self::assertSame(self::versioned('A'), $this->body($read)['photoUrl']);
        $served = $this->send('GET', $this->photoUrl($read), session: $this->member);
        self::assertSame(200, $served->getStatusCode(), (string) $served->getBody());
        self::assertSame(self::fixture('metadata-cleaned.jpg'), (string) $served->getBody());
    }

    public function testAfterAReplacementThePersonNamesTheNewVersionAndAfterRemovalNone(): void
    {
        $this->put('metadata.jpg', $this->member);

        $replaced = $this->put('progressive.jpg', $this->member);
        $afterReplacement = $this->send('GET', '/api/persons/1', session: $this->member);
        $this->send('DELETE', self::PHOTO, session: $this->member);
        $afterRemoval = $this->send('GET', '/api/persons/1', session: $this->member);

        self::assertSame(self::versioned('B'), $this->body($replaced)['photoUrl']);
        self::assertSame(self::versioned('B'), $this->body($afterReplacement)['photoUrl']);
        self::assertNull($this->body($afterRemoval)['photoUrl']);
        self::assertSame(
            [['id' => 1, 'name' => 'Anna', 'photoUrl' => null]],
            $this->body($this->send('GET', '/api/persons', session: $this->member))['persons'],
        );
    }

    public function testARenameAnswersThePhotoItLeftAlone(): void
    {
        $this->put('metadata.jpg', $this->member);

        $renamed = $this->send('PATCH', '/api/persons/1', ['name' => 'Berta'], $this->member);

        self::assertSame(200, $renamed->getStatusCode(), (string) $renamed->getBody());
        self::assertSame(['id' => 1, 'name' => 'Berta', 'photoUrl' => self::versioned('A')], $this->body($renamed));
    }

    /** Installed below the web root's top, the API builds every photo URL under its base path. */
    public function testUnderABasePathThePhotoUrlStartsWithItAndServesThePhoto(): void
    {
        $app = App::create($this->config(), '/performance', $this->clock);
        $image = base64_encode(self::fixture('metadata.jpg'));

        $set = $this->send('PUT', '/performance' . self::PHOTO, ['image' => $image], $this->member, $app);

        self::assertSame(200, $set->getStatusCode(), (string) $set->getBody());
        self::assertSame('/performance' . self::versioned('A'), $this->photoUrl($set));
        $listed = $this->send('GET', '/performance/api/persons', session: $this->member, app: $app);
        self::assertSame([['id' => 1, 'name' => 'Anna', 'photoUrl' => '/performance' . self::versioned('A')]], $this->body($listed)['persons']);
        $served = $this->send('GET', $this->photoUrl($set), session: $this->member, app: $app);
        self::assertSame(200, $served->getStatusCode(), (string) $served->getBody());
        self::assertSame(self::fixture('metadata-cleaned.jpg'), (string) $served->getBody());
    }

    /** The Rangliste shows each person's photo by the URL their row carries; a person without one has none. */
    public function testEachScoreboardRowNamesThePersonsPhotoUrl(): void
    {
        $this->send('POST', '/api/persons', ['name' => 'Ben'], $this->admin);
        $this->countOneDrinkFor(1, 2);

        $this->put('metadata.jpg', $this->member);

        self::assertSame(['Anna' => self::versioned('A'), 'Ben' => null], $this->rowPhotos($this->scoreboard()));
    }

    public function testUnderABasePathTheScoreboardsPhotoUrlStartsWithIt(): void
    {
        $this->countOneDrinkFor(1);
        $this->put('metadata.jpg', $this->member);

        $rows = $this->scoreboard(app: App::create($this->config(), '/performance', $this->clock), basePath: '/performance');

        self::assertSame(['Anna' => '/performance' . self::versioned('A')], $this->rowPhotos($rows));
    }

    /**
     * A photo write bumps the revision, so another phone's Rangliste gets the new photo on its next
     * refresh; the same photo again leaves the revision and that phone's 304.
     */
    public function testAPhotoChangeAnswersTheScoreboardsOldTagWithTheNewPhotoUrlAndTheSamePhotoAgainWith304(): void
    {
        $this->countOneDrinkFor(1);
        $this->put('metadata.jpg', $this->member);
        $before = $this->scoreboard();

        $this->put('progressive.jpg', $this->member);
        $replaced = $this->scoreboard($before->getHeaderLine('ETag'));
        $this->put('progressive.jpg', $this->member);
        $same = $this->scoreboard($replaced->getHeaderLine('ETag'));
        $this->send('DELETE', self::PHOTO, session: $this->member);
        $removed = $this->scoreboard($replaced->getHeaderLine('ETag'));

        self::assertSame(['Anna' => self::versioned('B')], $this->rowPhotos($replaced));
        self::assertSame(304, $same->getStatusCode(), (string) $same->getBody());
        self::assertSame(['Anna' => null], $this->rowPhotos($removed));
    }

    public function testTheStoredVersionsUrlServesExactlyTheStoredBytesCachedForAYear(): void
    {
        $this->put('metadata.jpg', $this->member);

        $response = $this->send('GET', self::versioned('A'), session: $this->member);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('image/jpeg', $response->getHeaderLine('Content-Type'));
        self::assertSame(self::fixture('metadata-cleaned.jpg'), (string) $response->getBody());
        self::assertSame('private, max-age=31536000, immutable', $response->getHeaderLine('Cache-Control'));
    }

    /**
     * An `<img>` sends no `X-Client-Version`, so it counts as the oldest client. Once the floor
     * rises past it, every other route refuses such a request, but the photo still loads.
     */
    public function testARaisedClientFloorStillServesThePhotoToAnImageThatSendsNoVersion(): void
    {
        $this->put('metadata.jpg', $this->member);
        $raised = new class ($this->app()) implements RequestHandlerInterface {
            public function __construct(private RequestHandlerInterface $app) {}

            /** The application behind a gate whose floor is far past the last version that sent none. */
            public function handle(ServerRequestInterface $request): ResponseInterface
            {
                return (new ClientVersionGate(new ResponseFactory(), '', minClientVersion: '9.0.0'))->process($request, $this->app);
            }
        };

        $photo = $this->send('GET', self::versioned('A'), session: $this->member, app: $raised);
        $persons = $this->send('GET', '/api/persons', session: $this->member, app: $raised);

        self::assertSame(200, $photo->getStatusCode(), (string) $photo->getBody());
        self::assertSame(self::fixture('metadata-cleaned.jpg'), (string) $photo->getBody());
        self::assertSame(400, $persons->getStatusCode());
        self::assertSame('urn:performance:problem:client-outdated', $this->body($persons)['type']);
    }

    /**
     * Every request is a cold client's: nothing cached, no conditional headers. Re-uploading A
     * gives it A's version again, so A's old URL serves exactly A's bytes again.
     */
    public function testOnlyTheStoredVersionIsServedAndReuploadingMakesItsOldUrlValidAgain(): void
    {
        $this->put('metadata.jpg', $this->member);
        $this->put('progressive.jpg', $this->member);

        $replacedA = $this->send('GET', self::versioned('A'), session: $this->member);
        $storedB = $this->send('GET', self::versioned('B'), session: $this->member);
        $this->put('metadata.jpg', $this->member);
        $reuploadedA = $this->send('GET', self::versioned('A'), session: $this->member);
        $replacedB = $this->send('GET', self::versioned('B'), session: $this->member);

        $this->assertNotFoundProblem($replacedA);
        self::assertSame(200, $storedB->getStatusCode(), (string) $storedB->getBody());
        self::assertSame(CleanJpeg::clean(self::fixture('progressive.jpg')), (string) $storedB->getBody());
        self::assertSame(200, $reuploadedA->getStatusCode(), (string) $reuploadedA->getBody());
        self::assertSame(self::fixture('metadata-cleaned.jpg'), (string) $reuploadedA->getBody());
        $this->assertNotFoundProblem($replacedB);
    }

    /**
     * Person 1 has photo A where the case needs one; person 2 does not exist.
     *
     * @return iterable<string, array{bool, string}>
     */
    public static function unservedPhotos(): iterable
    {
        $a = self::version('A');
        $b = self::version('B');

        yield 'no version' => [true, self::PHOTO];
        yield 'an empty version' => [true, self::PHOTO . '?v='];
        yield 'the version in upper case' => [true, self::PHOTO . '?v=' . strtoupper($a)];
        yield 'the version cut short' => [true, self::PHOTO . '?v=' . substr($a, 0, 63)];
        yield 'the version with a character more' => [true, self::PHOTO . '?v=' . $a . '0'];
        yield 'not hex' => [true, self::PHOTO . '?v=' . str_repeat('g', 64)];
        yield 'a list of versions' => [true, self::PHOTO . '?v[]=' . $a];
        yield 'another version' => [true, self::PHOTO . '?v=' . $b];
        yield 'a person without a photo' => [false, self::PHOTO . '?v=' . $a];
        yield 'an unknown person' => [true, '/api/persons/2/photo?v=' . $a];
    }

    #[DataProvider('unservedPhotos')]
    public function testAnyOtherPhotoUrlIsANotFoundProblemThatIsNotStored(bool $withPhoto, string $path): void
    {
        if ($withPhoto) {
            $this->put('metadata.jpg', $this->member);
        }

        $response = $this->send('GET', $path, session: $this->member);

        $this->assertNotFoundProblem($response);
    }

    public function testWithoutASessionThePhotoIsNotServed(): void
    {
        $this->put('metadata.jpg', $this->member);

        $response = $this->send('GET', self::versioned('A'));

        self::assertSame(401, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('urn:performance:problem:unauthenticated', $this->body($response)['type']);
        self::assertSame('no-store', $response->getHeaderLine('Cache-Control'));
    }

    /** Only the served photo is cacheable: the photo routes' other answers, success or problem, are not. */
    public function testEveryOtherAnswerIsNotStored(): void
    {
        $responses = [
            'set' => $this->put('metadata.jpg', $this->member),
            'persons' => $this->send('GET', '/api/persons', session: $this->member),
            'invalid photo' => $this->send('PUT', self::PHOTO, ['image' => 'kein Foto'], $this->member),
            'method not allowed' => $this->send('POST', self::versioned('A'), [], $this->member),
            'removed' => $this->send('DELETE', self::PHOTO, session: $this->member),
        ];

        self::assertSame(
            ['set' => 200, 'persons' => 200, 'invalid photo' => 422, 'method not allowed' => 405, 'removed' => 204],
            array_map(static fn(ResponseInterface $response): int => $response->getStatusCode(), $responses),
        );
        foreach ($responses as $name => $response) {
            self::assertSame('no-store', $response->getHeaderLine('Cache-Control'), $name);
        }
    }

    public function testAnUnknownPersonIs404(): void
    {
        $put = $this->put('metadata.jpg', $this->member, '/api/persons/2/photo');
        $delete = $this->send('DELETE', '/api/persons/2/photo', session: $this->member);

        foreach ([$put, $delete] as $response) {
            self::assertSame(404, $response->getStatusCode(), (string) $response->getBody());
            self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
        }
        self::assertSame([], $this->storedPhotos());
    }

    public function testWithoutASessionThePhotoCannotBeChanged(): void
    {
        $this->put('metadata.jpg', $this->member);

        $put = $this->send('PUT', self::PHOTO, ['image' => base64_encode(self::fixture('progressive.jpg'))]);
        $delete = $this->send('DELETE', self::PHOTO);

        self::assertSame(401, $put->getStatusCode());
        self::assertSame(401, $delete->getStatusCode());
        self::assertSame(['A'], array_map(fn(array $row): string => $this->label($row['version']), $this->storedPhotos()));
    }

    public function testABodyThatIsNotJsonIs415(): void
    {
        $response = $this->putRaw(self::fixture('metadata.jpg'), 'image/jpeg');

        self::assertSame(415, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([], $this->storedPhotos());
    }

    /**
     * The body is not even JSON: a 413 proves it was refused before it was parsed (a parsed
     * one would be 400).
     */
    public function testABodyOverTheLimitIs413BeforeItIsParsed(): void
    {
        $response = $this->putRaw(str_repeat('x', PersonPhotoActions::MAX_BODY_BYTES + 1));

        self::assertSame(413, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('urn:performance:problem:content-too-large', $this->body($response)['type']);
        self::assertSame('Foto zu groß.', $this->body($response)['title']);
        self::assertSame('no-store', $response->getHeaderLine('Cache-Control'));
    }

    public function testADeclaredLengthOverTheLimitIs413WithoutReadingTheBody(): void
    {
        $body = json_encode(['image' => base64_encode(self::fixture('metadata.jpg'))], JSON_THROW_ON_ERROR);

        $response = $this->putRaw($body, contentLength: (string) (PersonPhotoActions::MAX_BODY_BYTES + 1));

        self::assertSame(413, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([], $this->storedPhotos());
    }

    /** A body of exactly the limit passes the bound; its `image` is then too long. */
    public function testABodyOfExactlyTheLimitIsParsed(): void
    {
        $prefix = '{"image":"';
        $suffix = '"}';
        $image = str_repeat('A', PersonPhotoActions::MAX_BODY_BYTES - strlen($prefix) - strlen($suffix));

        $response = $this->putRaw($prefix . $image . $suffix);

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['image' => CleanJpeg::INVALID], $this->body($response)['errors']);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidImages(): iterable
    {
        // 65 539 bytes are 87 388 characters of base64, the first length over the limit.
        // Line breaks and missing padding are refused although the photo itself is valid.
        yield 'longer than the base64 of 64 KiB' => [base64_encode(str_repeat("\x00", 65_539))];
        yield 'not base64' => ['kein Foto'];
        yield 'base64 with line breaks' => [chunk_split(base64_encode(self::fixture('metadata.jpg')), 76, "\r\n")];
        yield 'base64 without its padding' => [rtrim(base64_encode(self::fixture('metadata.jpg')), '=')];
        yield 'missing' => [''];
        yield 'not 256 × 256' => [base64_encode(self::fixture('not-square.jpg'))];
        yield 'four components' => [base64_encode(self::fixture('cmyk.jpg'))];
        yield 'no JPEG' => [base64_encode('GIF89a')];
    }

    #[DataProvider('invalidImages')]
    public function testAnImageThatIsNotAValidPhotoIs422OnImage(string $image): void
    {
        $response = $this->send('PUT', self::PHOTO, ['image' => $image], $this->member);

        self::assertSame(422, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(['image' => CleanJpeg::INVALID], $this->body($response)['errors']);
        self::assertSame([], $this->storedPhotos());
        self::assertSame([], $this->photoEvents());
    }

    /**
     * Every person event's snapshot is `{name, photo}`, read under the write's locks: a rename
     * carries the unchanged version and a deletion the version it deleted.
     */
    public function testEveryPersonEventCarriesTheNameAndThePhoto(): void
    {
        $this->put('metadata.jpg', $this->member);
        $this->send('PATCH', '/api/persons/1', ['name' => 'Berta'], $this->member);
        $this->send('DELETE', '/api/persons/1', session: $this->member);

        self::assertSame(
            [
                ['create', self::ADMIN, null, ['name' => 'Anna', 'photo' => null]],
                ['update', self::MEMBER, ['name' => 'Anna', 'photo' => null], ['name' => 'Anna', 'photo' => 'A']],
                ['update', self::MEMBER, ['name' => 'Anna', 'photo' => 'A'], ['name' => 'Berta', 'photo' => 'A']],
                ['delete', self::MEMBER, ['name' => 'Berta', 'photo' => 'A'], null],
            ],
            $this->personEvents(),
        );
    }

    public function testDeletingAPersonDeletesTheirPhoto(): void
    {
        $this->put('metadata.jpg', $this->member);

        $response = $this->send('DELETE', '/api/persons/1', session: $this->member);

        self::assertSame(204, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([], $this->storedPhotos());
    }

    /**
     * Each race in both orders: the writes take the person row, then its photo row, so they
     * run in turn, without a deadlock, and each records what it found when it got the lock.
     * The racing photo is `B`; an `A` was set before where the race needs one.
     *
     * @return iterable<string, array{bool, list<array{string, string}>, list<int>, list<array{string, array<string, mixed>|null, array<string, mixed>|null}>}>
     */
    public static function races(): iterable
    {
        $anna = static fn(?string $photo): array => ['name' => 'Anna', 'photo' => $photo];
        $berta = static fn(?string $photo): array => ['name' => 'Berta', 'photo' => $photo];

        yield 'set, then delete the person' => [
            false,
            [['set-photo', '1'], ['delete-person', '1']],
            [self::SUCCEEDED, self::SUCCEEDED],
            [['update', $anna(null), $anna('B')], ['delete', $anna('B'), null]],
        ];
        yield 'delete the person, then set' => [
            false,
            [['delete-person', '1'], ['set-photo', '1']],
            [self::SUCCEEDED, self::NOT_FOUND],
            [['delete', $anna(null), null]],
        ];
        yield 'remove, then delete the person' => [
            true,
            [['remove-photo', '1'], ['delete-person', '1']],
            [self::SUCCEEDED, self::SUCCEEDED],
            [['update', $anna('A'), $anna(null)], ['delete', $anna(null), null]],
        ];
        yield 'delete the person, then remove' => [
            true,
            [['delete-person', '1'], ['remove-photo', '1']],
            [self::SUCCEEDED, self::NOT_FOUND],
            [['delete', $anna('A'), null]],
        ];
        yield 'rename, then replace' => [
            true,
            [['rename-person', '1'], ['set-photo', '1']],
            [self::SUCCEEDED, self::SUCCEEDED],
            [['update', $anna('A'), $berta('A')], ['update', $berta('A'), $berta('B')]],
        ];
        yield 'replace, then rename' => [
            true,
            [['set-photo', '1'], ['rename-person', '1']],
            [self::SUCCEEDED, self::SUCCEEDED],
            [['update', $anna('A'), $anna('B')], ['update', $anna('B'), $berta('B')]],
        ];
    }

    /**
     * @param list<array{string, string}>                                                     $writes
     * @param list<int>                                                                       $exitCodes
     * @param list<array{string, array<string, mixed>|null, array<string, mixed>|null}> $events    by the racing writes, oldest first
     */
    #[DataProvider('races')]
    public function testAPhotoWriteRacingAPersonWriteRunsInTurnAndRecordsWhatItFound(bool $withPhoto, array $writes, array $exitCodes, array $events): void
    {
        if ($withPhoto) {
            $this->put('metadata.jpg', $this->member);
        }
        $deadlocks = $this->deadlocks();

        self::assertSame($exitCodes, $this->interleave('persons', '1', $writes));

        self::assertSame($deadlocks, $this->deadlocks(), 'no deadlock');
        $stillThere = $this->rows('SELECT name FROM persons') !== [];
        $photos = array_map(fn(array $row): string => $this->label($row['version']), $this->storedPhotos());
        self::assertSame($stillThere ? ['B'] : [], $photos, 'no orphan photo');
        $racing = array_values(array_filter($this->personEvents(), static fn(array $event): bool => $event[1] === 'race'));
        self::assertSame($events, array_map(static fn(array $event): array => [$event[0], $event[2], $event[3]], $racing));
    }

    private function put(string $fixture, string $session, string $path = self::PHOTO): ResponseInterface
    {
        return $this->send('PUT', $path, ['image' => base64_encode(self::fixture($fixture))], $session);
    }

    /** A photo `PUT` of exactly these bytes, as a client that does not send JSON could make it. */
    private function putRaw(string $body, string $contentType = 'application/json', ?string $contentLength = null): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest('PUT', self::PHOTO)
            ->withHeader('Content-Type', $contentType)
            ->withCookieParams(['session' => $this->member]);
        $request->getBody()->write($body);
        if ($contentLength !== null) {
            $request = $request->withHeader('Content-Length', $contentLength);
        }

        return $this->app()->handle($request);
    }

    /**
     * The URL of a photo by its label (see label()), as the server builds it.
     *
     * @param 'A'|'B' $label
     */
    private static function versioned(string $label): string
    {
        return self::PHOTO . '?v=' . self::version($label);
    }

    /**
     * The version of photo `A` or `B` (see label()).
     *
     * @param 'A'|'B' $label
     */
    private static function version(string $label): string
    {
        return hash('sha256', match ($label) {
            'A' => self::fixture('metadata-cleaned.jpg'),
            'B' => CleanJpeg::clean(self::fixture('progressive.jpg')),
        });
    }

    /** The `photoUrl` of a person answer that names a photo. */
    private function photoUrl(ResponseInterface $response): string
    {
        $url = $this->body($response)['photoUrl'];
        self::assertIsString($url, (string) $response->getBody());

        return $url;
    }

    private function assertNotFoundProblem(ResponseInterface $response): void
    {
        self::assertSame(404, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        self::assertSame('urn:performance:problem:not-found', $this->body($response)['type']);
        self::assertSame('no-store', $response->getHeaderLine('Cache-Control'));
    }

    private static function fixture(string $name): string
    {
        $bytes = file_get_contents(dirname(__DIR__) . '/Support/photos/' . $name);
        self::assertIsString($bytes);

        return $bytes;
    }

    /**
     * The test's photos by the label the assertions use: `A` is `metadata.jpg` (stored as
     * `metadata-cleaned.jpg`), `B` is `progressive.jpg`, the one concurrent-write.php sets.
     */
    private function label(mixed $version): string
    {
        $labels = [self::version('A') => 'A', self::version('B') => 'B'];
        self::assertIsString($version);
        self::assertArrayHasKey($version, $labels);

        return $labels[$version];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function storedPhotos(): array
    {
        return $this->rows('SELECT CAST(person_id AS CHAR) AS person_id, jpeg, version FROM person_photos ORDER BY person_id');
    }

    /**
     * The person events, oldest first, as `[operation, user name, before, after]` with each
     * snapshot's photo version shown as its label.
     *
     * @return list<array{string, string, array<string, mixed>|null, array<string, mixed>|null}>
     */
    private function personEvents(): array
    {
        $response = $this->send('GET', '/api/audit?limit=100', session: $this->admin);
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        $events = $this->body($response)['events'];
        self::assertIsArray($events);
        $person = [];
        foreach (array_reverse($events) as $event) {
            self::assertIsArray($event);
            if ($event['subjectKind'] !== 'person') {
                continue;
            }
            self::assertIsString($event['operation']);
            self::assertIsArray($event['actor']);
            self::assertIsString($event['actor']['userName']);
            $person[] = [$event['operation'], $event['actor']['userName'], $this->labelled($event['before']), $this->labelled($event['after'])];
        }

        return $person;
    }

    /**
     * The person events that changed the photo and nothing else.
     *
     * @return list<array{string, string, array<string, mixed>|null, array<string, mixed>|null}>
     */
    private function photoEvents(): array
    {
        return array_values(array_filter(
            $this->personEvents(),
            static fn(array $event): bool => $event[0] === 'update' && $event[2] !== null && $event[3] !== null && $event[2]['name'] === $event[3]['name'],
        ));
    }

    /**
     * @return array<string, mixed>|null
     */
    private function labelled(mixed $snapshot): ?array
    {
        if ($snapshot === null) {
            return null;
        }
        self::assertIsArray($snapshot);
        $labelled = [];
        foreach ($snapshot as $key => $value) {
            $labelled[(string) $key] = $key === 'photo' && $value !== null ? $this->label($value) : $value;
        }

        return $labelled;
    }

    private function scoreboardTag(): string
    {
        $response = $this->scoreboard();
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());

        return $response->getHeaderLine('ETag');
    }

    /** Today's scoreboard, conditional on a tag if one is given, as a phone refreshes its Rangliste. */
    private function scoreboard(?string $ifNoneMatch = null, ?RequestHandlerInterface $app = null, string $basePath = ''): ResponseInterface
    {
        $request = (new ServerRequestFactory())
            ->createServerRequest('GET', $basePath . '/api/scoreboard?from=' . rawurlencode('2026-11-13T23:00:00.000Z'))
            ->withCookieParams(['session' => $this->member]);
        if ($ifNoneMatch !== null) {
            $request = $request->withHeader('If-None-Match', $ifNoneMatch);
        }

        return ($app ?? $this->app())->handle($request);
    }

    /** One drink counted today for each of these persons, so each stands on the scoreboard. */
    private function countOneDrinkFor(int ...$personIds): void
    {
        $drink = $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $this->admin);
        self::assertSame(201, $drink->getStatusCode(), (string) $drink->getBody());
        foreach (array_values($personIds) as $index => $personId) {
            $id = sprintf('00000000-0000-4000-8000-%012d', $index + 1);
            $entry = $this->send('PUT', "/api/entries/{$id}", ['personId' => $personId, 'drinkId' => 1, 'quantity' => 1], $this->member);
            self::assertSame(201, $entry->getStatusCode(), (string) $entry->getBody());
            $this->verifyDirectly('entries', $id);
        }
    }

    /**
     * Each scoreboard row's `photoUrl` by the person's name, in rank order.
     *
     * @return array<string, mixed>
     */
    private function rowPhotos(ResponseInterface $response): array
    {
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        $rows = $this->body($response)['rows'];
        self::assertIsArray($rows);
        $photos = [];
        foreach ($rows as $row) {
            self::assertIsArray($row);
            self::assertIsString($row['name']);
            self::assertArrayHasKey('photoUrl', $row);
            $photos[$row['name']] = $row['photoUrl'];
        }

        return $photos;
    }

    private function revision(): int
    {
        $rows = $this->rows('SELECT CAST(revision AS CHAR) AS revision FROM data_revision');
        if ($rows === []) {
            return 0;
        }
        self::assertIsNumeric($rows[0]['revision']);

        return (int) $rows[0]['revision'];
    }

    private function deadlocks(): int
    {
        $status = $this->otherSession()->query("SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks'");
        self::assertNotFalse($status);

        return (int) $status->fetchColumn(1);
    }
}
