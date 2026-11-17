<?php

declare(strict_types=1);

namespace Performance\Tests\Integration;

use Performance\Tests\Support\DatabaseTestCase;
use Performance\Tests\Support\InterleavedWrites;
use Performance\Tests\Support\ObservedVerification;

/**
 * Verifications of an entry written by requests that run at the same moment as other writes,
 * each in its own process on the real database: whatever the order, they end in exactly one
 * consistent state (PRD #61).
 */
final class VerificationRacesTest extends DatabaseTestCase
{
    use InterleavedWrites;
    use ObservedVerification;

    private const ENTRY = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    private const SUCCEEDED = 0;
    private const NOT_FOUND = 3;
    private const ALREADY_VERIFIED = 4;
    /** Anna records the entry; the bootstrap admin (1) and Ben (3) may verify it. */
    private const ANNA = 2;
    private const BEN = 3;
    /** Daniel's entry, verified: his Verlauf shows it counting, and the Rangliste ranks him. */
    private const VERIFIED = ['history' => [['pending' => false, 'accountName' => 'anna']], 'ranked' => ['Daniel'], 'unranked' => []];
    /** The entry is gone, Daniel is not: his Verlauf is empty, and the Rangliste has nobody. */
    private const GONE = ['history' => [], 'ranked' => [], 'unranked' => []];
    /** Daniel is deleted, and his entry with him: his Verlauf is not found, and the Rangliste has nobody. */
    private const GONE_WITH_DANIEL = ['history' => null, 'ranked' => [], 'unranked' => []];

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
        self::assertSame(self::VERIFIED, $this->observed());
        self::assertSame([1], $this->verifiersOf(self::ENTRY));
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
        self::assertSame(self::GONE, $this->observed());
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
        self::assertSame(self::GONE_WITH_DANIEL, $this->observed());
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
        self::assertSame(['history' => [['pending' => false, 'accountName' => null]], 'ranked' => ['Daniel'], 'unranked' => []], $this->observed());
        self::assertSame([self::BEN], $this->verifiersOf(self::ENTRY));
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
        self::assertSame(self::VERIFIED, $this->observed());
        self::assertSame([self::BEN], $this->verifiersOf(self::ENTRY), 'the audit log keeps the deleted verifier');
        // No route shows who verified a row; read directly that the deleted verifier is unknown.
        self::assertSame([['verified_by_account_id' => null]], $this->rows('SELECT verified_by_account_id FROM entries'));
    }

    public function testOfConcurrentRejectionsExactlyOneRemovesTheEntryAndRecordsItsEvent(): void
    {
        $revision = $this->revision();

        $exitCodes = $this->interleave('entries', self::ENTRY, [['reject-entry', self::ENTRY], ['reject-entry', self::ENTRY, self::BEN], ['reject-entry', self::ENTRY]]);

        sort($exitCodes);
        self::assertSame([self::SUCCEEDED, self::NOT_FOUND, self::NOT_FOUND], $exitCodes);
        self::assertSame(['create', 'reject'], $this->entryEvents());
        self::assertSame($revision + 1, $this->revision());
        self::assertSame(self::GONE, $this->observed());
    }

    /**
     * Whichever locks the entry first decides: a verified entry can no longer be rejected
     * (409), and a rejected one is no longer there to verify (404).
     */
    public function testAVerificationRacingARejectionEndsInOneConsistentState(): void
    {
        [$verify, $reject] = $this->interleave('entries', self::ENTRY, [['verify-entry', self::ENTRY], ['reject-entry', self::ENTRY, self::BEN]]);

        self::assertContains([$verify, $reject], [[self::SUCCEEDED, self::ALREADY_VERIFIED], [self::NOT_FOUND, self::SUCCEEDED]]);
        self::assertSame($verify === self::SUCCEEDED ? self::VERIFIED : self::GONE, $this->observed());
        self::assertSame($verify === self::SUCCEEDED ? [1] : [], $this->verifiersOf(self::ENTRY));
        self::assertSame($verify === self::SUCCEEDED ? ['create', 'verify'] : ['create', 'reject'], $this->entryEvents());
    }

    /** The undo and the rejection both remove the entry; whichever comes second finds it gone. */
    public function testARejectionRacingTheUndoEndsInOneConsistentState(): void
    {
        [$reject, $undo] = $this->interleave('entries', self::ENTRY, [['reject-entry', self::ENTRY], ['undo-entry', self::ENTRY]]);

        self::assertContains([$reject, $undo], [[self::SUCCEEDED, self::NOT_FOUND], [self::NOT_FOUND, self::SUCCEEDED]]);
        self::assertSame($reject === self::SUCCEEDED ? ['create', 'reject'] : ['create', 'delete'], $this->entryEvents());
        self::assertSame(self::GONE, $this->observed());
    }

    /**
     * The person's deletion and the rejection lock the entry and the person in opposite
     * orders; the loser of the deadlock runs again. Either the rejection removed the entry
     * before the person went, or the entry went with the person and the rejection finds it
     * gone.
     */
    public function testARejectionRacingThePersonsDeletionEndsInOneConsistentState(): void
    {
        [$reject, $deletion] = $this->interleave('entries', self::ENTRY, [['reject-entry', self::ENTRY], ['delete-person', '1']]);

        self::assertSame(self::SUCCEEDED, $deletion);
        self::assertContains($reject, [self::SUCCEEDED, self::NOT_FOUND]);
        self::assertSame($reject === self::SUCCEEDED ? ['create', 'reject'] : ['create', 'delete'], $this->entryEvents());
        self::assertSame(self::GONE_WITH_DANIEL, $this->observed());
    }

    /**
     * The recorder's deletion clears the entry's recorder, so it locks the entry as the
     * rejection does: whichever commits first, the entry ends rejected, since an entry whose
     * recorder was deleted may be rejected by anyone.
     */
    public function testARejectionRacingTheRecordersDeletionEndsRejected(): void
    {
        $exitCodes = $this->interleave('entries', self::ENTRY, [['reject-entry', self::ENTRY, self::BEN], ['delete-account', (string) self::ANNA]]);

        self::assertSame([self::SUCCEEDED, self::SUCCEEDED], $exitCodes);
        self::assertSame(['create', 'reject'], $this->entryEvents());
        self::assertSame(self::GONE, $this->observed());
    }

    /**
     * Daniel's entries as his Verlauf shows them (null once Daniel is deleted), and who the
     * Rangliste ranks and who it lists without a rank, as the bootstrap admin sees them.
     *
     * @return array{history: list<array{pending: mixed, accountName: mixed}>|null, ranked: list<mixed>, unranked: list<mixed>}
     */
    private function observed(): array
    {
        $session = $this->signIn();
        $verlauf = $this->send('GET', '/api/entries?personId=1&from=2026-11-14T00:00:00.000Z', session: $session);
        $history = null;
        if ($verlauf->getStatusCode() !== 404) {
            $entries = $this->body($verlauf)['entries'];
            self::assertIsList($entries);
            $history = array_map(static function (mixed $entry): array {
                self::assertIsArray($entry);

                return ['pending' => $entry['pending'], 'accountName' => $entry['accountName']];
            }, $entries);
        }
        $scoreboard = $this->body($this->send('GET', '/api/scoreboard?from=2026-11-14T00:00:00.000Z', session: $session));
        self::assertIsList($scoreboard['rows']);
        self::assertIsList($scoreboard['unranked']);

        return [
            'history' => $history,
            'ranked' => array_column($scoreboard['rows'], 'name'),
            'unranked' => array_column($scoreboard['unranked'], 'name'),
        ];
    }

    /**
     * @return list<mixed>
     */
    private function entryEvents(): array
    {
        return array_column($this->rows("SELECT operation FROM audit_events WHERE subject_kind = 'entry' ORDER BY id"), 'operation');
    }

    private function revision(): int
    {
        $revision = $this->rows('SELECT revision FROM data_revision')[0]['revision'];
        self::assertIsInt($revision);

        return $revision;
    }
}
