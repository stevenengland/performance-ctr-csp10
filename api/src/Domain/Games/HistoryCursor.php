<?php

declare(strict_types=1);

namespace Performance\Domain\Games;

use DateTimeImmutable;
use DateTimeZone;
use Performance\Domain\Timestamp;

/**
 * Where the next older page of a game's Verlauf starts: the run being paged and the time and
 * id of the oldest row shown so far. Clients get it as an opaque token (URL-safe base64 of the
 * three values) and hand it back unchanged as `before`.
 */
final readonly class HistoryCursor
{
    private const TIME_FORMAT = 'Y-m-d H:i:s.v';
    /** The shape TIME_FORMAT writes; checked first, since the date parser throws on a null byte. */
    private const TIME = '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/D';
    private const ID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D';

    public function __construct(
        public int $run,
        public DateTimeImmutable $createdAt,
        public string $id,
    ) {}

    public function token(): string
    {
        $json = json_encode([$this->run, Timestamp::of($this->createdAt), $this->id], JSON_THROW_ON_ERROR);

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
        [$run, $createdAt, $id] = $values;
        if (!is_int($run) || $run < 1 || !is_string($id) || preg_match(self::ID, $id) !== 1) {
            return null;
        }
        if (!is_string($createdAt) || preg_match(self::TIME, $createdAt) !== 1) {
            return null;
        }
        $instant = DateTimeImmutable::createFromFormat('!' . self::TIME_FORMAT, $createdAt, new DateTimeZone('UTC'));

        return $instant !== false && $instant->format(self::TIME_FORMAT) === $createdAt ? new self($run, $instant, $id) : null;
    }
}
