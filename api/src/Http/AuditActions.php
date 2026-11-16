<?php

declare(strict_types=1);

namespace Performance\Http;

use Performance\Domain\AuditEvent;
use Performance\Domain\AuditLog;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `GET /api/audit?before=<id>&limit=<n>` (admins only): a page of audit events, newest first,
 * and the `before` of the next older page. Reading the log changes nothing, not even the data
 * revision. The route has no writing method, so the log cannot be changed through the API.
 */
final readonly class AuditActions
{
    /** Snapshot keys whose values the domain keeps as fixed-scale decimal strings. */
    private const DECIMAL_KEYS = ['points', 'multiplier'];

    public function __construct(private Database $database) {}

    public function list(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        parse_str($request->getUri()->getQuery(), $query);
        $page = $this->database->audit()->page(
            self::integer($query, 'before'),
            self::integer($query, 'limit') ?? AuditLog::PAGE_SIZE,
        );

        return Json::write($response, ['events' => array_map(self::event(...), $page->events), 'next' => $page->next]);
    }

    /**
     * An optional whole-number query parameter: null when it is missing; anything but an
     * integer reads as 0, which the audit log then rejects.
     *
     * @param array<mixed> $query
     */
    private static function integer(array $query, string $name): ?int
    {
        $value = $query[$name] ?? null;
        if ($value === null) {
            return null;
        }

        return is_string($value) && preg_match('/^-?[0-9]{1,18}$/D', $value) === 1 ? (int) $value : 0;
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
            'cause' => $event->cause === null ? null : [
                'id' => $event->cause->id,
                'subjectKind' => $event->cause->subjectKind->value,
                'name' => $event->cause->name,
            ],
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
