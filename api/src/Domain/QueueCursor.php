<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Where the next page of the pending queue starts: the last row shown so far, by the queue's
 * order (recording instant descending, then kind, then id). A row handled meanwhile does not
 * move it, so later pages stay reachable. Clients get it as an opaque token (URL-safe base64
 * of the three values) and hand it back unchanged.
 */
final readonly class QueueCursor
{
    private const TIME_FORMAT = 'Y-m-d H:i:s.v';
    /** The shape TIME_FORMAT writes; checked first, since the date parser throws on a null byte. */
    private const TIME = '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/D';
    private const ID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D';

    public function __construct(
        public DateTimeImmutable $createdAt,
        public VerifiableKind $kind,
        public string $id,
    ) {}

    public static function after(PendingItem $item): self
    {
        return new self($item->createdAt, $item->kind, $item->id);
    }

    public function token(): string
    {
        $json = json_encode([Timestamp::of($this->createdAt), $this->kind->value, $this->id], JSON_THROW_ON_ERROR);

        return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }

    /** The cursor a token names, or null when it names none. */
    public static function of(string $token): ?self
    {
        $json = base64_decode(strtr($token, '-_', '+/'), true);
        $values = $json === false ? null : json_decode($json, true);
        if (!is_array($values) || !array_is_list($values) || count($values) !== 3) {
            return null;
        }
        [$createdAt, $kind, $id] = $values;
        $kind = is_string($kind) ? VerifiableKind::tryFrom($kind) : null;
        if ($kind === null || !is_string($id) || preg_match(self::ID, $id) !== 1) {
            return null;
        }
        if (!is_string($createdAt) || preg_match(self::TIME, $createdAt) !== 1) {
            return null;
        }
        $instant = DateTimeImmutable::createFromFormat('!' . self::TIME_FORMAT, $createdAt, new DateTimeZone('UTC'));

        return $instant !== false && $instant->format(self::TIME_FORMAT) === $createdAt ? new self($instant, $kind, $id) : null;
    }

    /**
     * Where the kind's rows go on: at the cursor's instant a later kind's rows all follow, an
     * earlier kind's none, and the cursor's own kind's those after its id.
     */
    public function boundFor(VerifiableKind $kind): PendingBound
    {
        $order = strcmp($kind->value, $this->kind->value);

        return new PendingBound($this->createdAt, match (true) {
            $order > 0 => '',
            $order < 0 => null,
            default => $this->id,
        });
    }

    /** Whether `$a` comes before `$b` in the queue: newer first, then by kind, then by id. */
    public static function compare(PendingItem $a, PendingItem $b): int
    {
        return [$b->createdAt, $a->kind->value, $a->id] <=> [$a->createdAt, $b->kind->value, $b->id];
    }
}
