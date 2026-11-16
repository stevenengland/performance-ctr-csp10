<?php

declare(strict_types=1);

namespace Performance\Domain\Catalog;

use PDO;
use Performance\Domain\Actor;
use Performance\Domain\AuditLog;
use Performance\Domain\AuditOperation;
use Performance\Domain\AuditSubjectKind;
use Performance\Domain\Clock;
use Performance\Domain\DataRevision;
use Performance\Domain\NotFound;
use Performance\Domain\Timestamp;
use Performance\Domain\ValidationFailed;

/**
 * Person photos: at most one per person, stored as CleanJpeg left it and versioned by the
 * lowercase hex SHA-256 of exactly those bytes. Any member may set or remove any person's photo.
 *
 * Every write locks the person row first and then its photo row, the order a person's
 * deletion and rename take too (lockedPerson), and runs in the revision transaction: a change,
 * its audit event (a person update whose snapshot's `photo` changes) and the revision bump
 * commit together. A write that changes nothing (the same version again, or removing a photo
 * that is not there) commits without a bump and records nothing.
 */
final readonly class PersonPhotos
{
    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private DataRevision $revision,
        private AuditLog $audit,
    ) {}

    /**
     * Sets or replaces the person's photo with the cleaned JPEG.
     *
     * @param string $jpeg the uploaded bytes, cleaned here before anything is locked
     *
     * @throws ValidationFailed on `image` when CleanJpeg rejects the bytes
     * @throws NotFound         when there is no such person
     */
    public function set(Actor $actor, int $personId, string $jpeg): void
    {
        $cleaned = CleanJpeg::clean($jpeg);
        $version = hash('sha256', $cleaned);
        $now = Timestamp::of($this->clock->now());
        $this->revision->writeIfChanged(function () use ($actor, $personId, $cleaned, $version, $now): bool {
            $before = self::lockedPerson($this->pdo, $personId);
            if ($before['photo'] === $version) {
                return false;
            }
            $statement = $this->pdo->prepare(
                'INSERT INTO person_photos (person_id, jpeg, version, updated_at) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE jpeg = VALUES(jpeg), version = VALUES(version), updated_at = VALUES(updated_at)',
            );
            $statement->bindValue(1, $personId, PDO::PARAM_INT);
            $statement->bindValue(2, $cleaned, PDO::PARAM_LOB);
            $statement->bindValue(3, $version);
            $statement->bindValue(4, $now);
            $statement->execute();
            $this->recordChange($actor, $personId, $before, $version);

            return true;
        });
    }

    /**
     * Removes the person's photo, if there is one.
     *
     * @throws NotFound when there is no such person
     */
    public function remove(Actor $actor, int $personId): void
    {
        $this->revision->writeIfChanged(function () use ($actor, $personId): bool {
            $before = self::lockedPerson($this->pdo, $personId);
            if ($before['photo'] === null) {
                return false;
            }
            $this->pdo->prepare('DELETE FROM person_photos WHERE person_id = ?')->execute([$personId]);
            $this->recordChange($actor, $personId, $before, null);

            return true;
        });
    }

    /**
     * Locks a person row for the rest of the transaction, then its photo row, and reads the
     * person as the audit log keeps them: `{name, photo}`, `photo` being the version or null.
     * Every write of a person or its photo takes these locks in this order, in two statements,
     * so the order never depends on how a join is executed.
     *
     * @return array{name: string, photo: string|null}
     *
     * @throws NotFound when there is no such person
     */
    public static function lockedPerson(PDO $pdo, int $personId): array
    {
        $person = $pdo->prepare('SELECT name FROM persons WHERE id = ? FOR UPDATE');
        $person->execute([$personId]);
        $name = $person->fetchColumn();
        if (!is_string($name)) {
            throw new NotFound((string) $personId);
        }
        $photo = $pdo->prepare('SELECT version FROM person_photos WHERE person_id = ? FOR UPDATE');
        $photo->execute([$personId]);
        $version = $photo->fetchColumn();

        return ['name' => $name, 'photo' => is_string($version) ? $version : null];
    }

    /**
     * @param array{name: string, photo: string|null} $before
     */
    private function recordChange(Actor $actor, int $personId, array $before, ?string $version): void
    {
        $this->audit->record($actor, AuditOperation::Update, AuditSubjectKind::Person, (string) $personId, $before, [...$before, 'photo' => $version]);
    }
}
