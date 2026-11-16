<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\AuditEvent;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `GET /api/audit` (admins only): the newest audit events, newest first. Reading the log
 * changes nothing, not even the data revision.
 */
final readonly class AuditActions
{
    /** Snapshot keys whose values the domain keeps as fixed-scale decimal strings. */
    private const DECIMAL_KEYS = ['points', 'multiplier'];

    public function __construct(private Database $database) {}

    public function list(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, ['events' => array_map(self::event(...), $this->database->audit()->page())]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function event(AuditEvent $event): array
    {
        return [
            'id' => $event->id,
            'occurredAt' => Instant::format($event->occurredAt),
            'operation' => $event->operation->value,
            'subjectKind' => $event->subjectKind->value,
            'subjectId' => $event->subjectId,
            'actor' => ['accountId' => $event->actor->accountId, 'userName' => $event->actor->userName],
            'before' => self::snapshot($event->before),
            'after' => self::snapshot($event->after),
            // No write records a consequence of another yet, so no event has a cause.
            'cause' => null,
        ];
    }

    /**
     * A stored snapshot as the API shows it: its decimals as numbers, nested ones included.
     *
     * @param array<mixed>|null $snapshot
     *
     * @return array<mixed>|null
     */
    private static function snapshot(?array $snapshot): ?array
    {
        if ($snapshot === null) {
            return null;
        }
        foreach ($snapshot as $key => $value) {
            if (is_array($value)) {
                $snapshot[$key] = self::snapshot($value);
            } elseif (is_string($value) && in_array($key, self::DECIMAL_KEYS, true)) {
                $snapshot[$key] = Decimal::json($value);
            }
        }

        return $snapshot;
    }
}
