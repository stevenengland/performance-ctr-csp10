<?php

declare(strict_types=1);

namespace Performance\Http;

use RuntimeException;

/**
 * Runtime configuration: database credentials from the file the deploy renders
 * outside the web root, and the version of the release that serves the request.
 */
final readonly class Config
{
    /**
     * @param list<string> $migrationDirectories
     */
    public function __construct(
        public string $databaseDsn,
        public string $databaseUser,
        public string $databasePassword,
        public string $appVersion,
        public array $migrationDirectories,
    ) {}

    /**
     * Reads the runtime configuration file (a PHP file returning `['db' => [host, port?, name, user, password]]`)
     * and the release's version file `release.php` (absent outside a built release).
     */
    public static function load(string $configFile, string $releaseRoot): self
    {
        $config = is_file($configFile) ? require $configFile : null;
        if (!is_array($config) || !is_array($config['db'] ?? null)) {
            throw new RuntimeException('The runtime configuration file is missing or invalid');
        }
        $db = $config['db'];
        $releaseFile = $releaseRoot . '/release.php';
        $release = is_file($releaseFile) ? require $releaseFile : [];

        return new self(
            databaseDsn: sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                self::text($db, 'host'),
                is_int($db['port'] ?? null) ? $db['port'] : 3306,
                self::text($db, 'name'),
            ),
            databaseUser: self::text($db, 'user'),
            databasePassword: self::text($db, 'password'),
            appVersion: is_array($release) && is_string($release['appVersion'] ?? null)
                ? $release['appVersion']
                : '0.0.0-dev',
            migrationDirectories: [$releaseRoot . '/migrations'],
        );
    }

    /**
     * @param array<mixed> $values
     */
    private static function text(array $values, string $key): string
    {
        $value = $values[$key] ?? null;
        if (!is_string($value) || $value === '') {
            throw new RuntimeException("The runtime configuration lacks db.{$key}");
        }

        return $value;
    }
}
