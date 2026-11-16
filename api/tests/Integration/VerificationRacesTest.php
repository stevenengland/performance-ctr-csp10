<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use Performance\Tests\Support\InterleavedWrites;

/**
 * Verifications of an entry written by requests that run at the same moment as other writes,
 * each in its own process on the real database: whatever the order, they end in exactly one
 * consistent state (PRD #61).
 */
final class VerificationRacesTest extends DatabaseTestCase
{
    use InterleavedWrites;

    private const ENTRY = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const SUCCEEDED = 0;
    private const NOT_FOUND = 3;
    /** Anna records the entry; the bootstrap admin (1) and Ben (3) may verify it. */
    private const ANNA = 2;
    private const BEN = 3;

    protected function setUp(): void
    {
        parent::setUp();
        $chef = $this->signIn();
        $this->createAccount('anna', 'annas-startpasswort');
        $this->createAccount('ben', 'bens-startpasswort');
        $this->send('POST', '/api/persons', ['name' => 'Daniel'], $chef);
        $this->send('POST', '/api/drinks', ['name' => 'Bier', 'points' => 1], $chef);
        $recorded = $this->send('PUT', '/api/entries/' . self::ENTRY, ['personId' => 1, 'drinkId' => 1, 'quantity' => 1], $this->signIn('anna', 'annas-startpasswort'));
        self::assertSame(201, $recorded->getStatusCode(), (string) $recorded->getBody());
    }

    public function testOfConcurrentVerificationsExactlyOneRecordsItsEventAndBumpsTheRevision(): void
    {
        $revision = $this->revision();

        $exitCodes = $this->interleave('entries', self::ENTRY, [['verify-entry', self::ENTRY], ['verify-entry', self::ENTRY, self::BEN], ['verify-entry', self::ENTRY]]);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame(['create', 'verify'], $this->entryEvents());
        self::assertSame($revision + 1, $this->revision());
        self::assertSame([['pending' => 0, 'verified_by_account_id' => 1]], $this->entryState());
    }

    /**
     * The undo removes the entry whether it was verified or not; a verification after it finds
     * nothing.
     */
    public function testAVerificationRacingTheUndoEndsInOneConsistentState(): void
    {
        [$verify, $undo] = $this->interleave('entries', self::ENTRY, [['verify-entry', self::ENTRY], ['undo-entry', self::ENTRY]]);
        $lateVerify = $this->send('PUT', '/api/entries/' . self::ENTRY . '/verification', [], $this->signIn());

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], [$verify, $undo]);
        self::assertSame(404, $lateVerify->getStatusCode());
        self::assertSame(['create', 'verify', 'delete'], $this->entryEvents());
        self::assertSame([], $this->entryState());
    }

    /**
     * The person's deletion and the verification lock the entry and the person in opposite
     * orders; the loser of the deadlock runs again. Either the verified entry goes with the
     * person, or the verification finds it gone.
     */
    public function testAVerificationRacingThePersonsDeletionEndsInOneConsistentState(): void
    {
        [$verify, $deletion] = $this->interleave('entries', self::ENTRY, [['verify-entry', self::ENTRY], ['delete-person', '1']]);

        self::assertSame(self::SUCCEEDED, $deletion);
        self::assertContains($verify, [self::SUCCEEDED, self::NOT_FOUND]);
        self::assertSame($verify === self::SUCCEEDED ? ['create', 'verify', 'delete'] : ['create', 'delete'], $this->entryEvents());
        self::assertSame([], $this->entryState());
    }

    /**
     * The recorder's deletion clears the entry's recorder, so it locks the entry as the
     * verification does: whichever commits first, the entry ends verified by Ben with its
     * recorder cleared, since an entry whose recorder was deleted may be verified by anyone.
     */
    public function testAVerificationRacingTheRecordersDeletionEndsVerified(): void
    {
        $exitCodes = $this->interleave('entries', self::ENTRY, [['verify-entry', self::ENTRY, self::BEN], ['delete-account', (string) self::ANNA]]);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame(['create', 'verify'], $this->entryEvents());
        self::assertSame([['pending' => 0, 'account_id' => null, 'verified_by_account_id' => self::BEN]], $this->verification());
    }

    /**
     * The verification reads its own account under a shared lock, which the account's deletion
     * waits for or holds: a verifier deleted first is recorded as unknown, the same state as one
     * deleted a moment after it verified.
     */
    public function testAVerificationRacingTheVerifiersDeletionEndsVerifiedByAnUnknownAccount(): void
    {
        $exitCodes = $this->interleave('accounts', (string) self::BEN, [['delete-account', (string) self::BEN], ['verify-entry', self::ENTRY, self::BEN]]);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame(['create', 'verify'], $this->entryEvents());
        self::assertSame([['pending' => 0, 'account_id' => self::ANNA, 'verified_by_account_id' => null]], $this->verification());
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function verification(): array
    {
        return $this->rows('SELECT pending, account_id, verified_by_account_id FROM entries');
    }

    /**
     * @return list<mixed>
     */
    private function entryEvents(): array
    {
        return array_column($this->rows("SELECT operation FROM audit_events WHERE subject_kind = 'entry' ORDER BY id"), 'operation');
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function entryState(): array
    {
        return $this->rows('SELECT pending, verified_by_account_id FROM entries');
    }

    private function revision(): int
    {
        return (int) $this->rows('SELECT revision FROM data_revision')[0]['revision'];
    }
}
