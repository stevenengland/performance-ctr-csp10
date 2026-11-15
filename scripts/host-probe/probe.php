<?php

declare(strict_types=1);

/*
 * Throwaway host probe for slice 1/1 (#2). Uploaded by scripts/host-probe/run.sh into a
 * random folder under the web root, called once over HTTPS, then deleted.
 *
 * It answers only when the request carries the token from the config file that run.sh
 * places above the web root. It never prints credentials, user names, host names or
 * absolute paths: only versions, capabilities and yes/no facts.
 */

const CONFIG_RELATIVE = '__CONFIG_RELATIVE__';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$configPath = __DIR__ . '/' . CONFIG_RELATIVE;
$configReadable = is_readable($configPath);
$config = $configReadable ? json_decode((string) file_get_contents($configPath), true) : null;

if (!is_array($config) || !hash_equals((string) ($config['token'] ?? ''), (string) ($_GET['t'] ?? ''))) {
    http_response_code(404);
    echo json_encode(['error' => 'not found', 'configReadable' => $configReadable]);
    exit;
}

$extensions = [];
foreach (['pdo_mysql', 'mbstring', 'intl', 'json', 'openssl', 'sodium', 'ctype', 'zend opcache'] as $name) {
    $extensions[$name] = extension_loaded($name);
}

$ini = [];
foreach (['open_basedir', 'memory_limit', 'max_execution_time', 'upload_max_filesize', 'post_max_size', 'opcache.enable', 'opcache.validate_timestamps', 'opcache.revalidate_freq', 'date.timezone', 'display_errors', 'output_buffering'] as $key) {
    $value = ini_get($key);
    $ini[$key] = $value === false ? null : $value;
}
$ini['open_basedir'] = $ini['open_basedir'] === null || $ini['open_basedir'] === '' ? 'none' : 'set (' . count(explode(PATH_SEPARATOR, $ini['open_basedir'])) . ' entries)';

$result = [
    'php' => [
        'version' => PHP_VERSION,
        'sapi' => PHP_SAPI,
        'extensions' => $extensions,
        'ini' => $ini,
    ],
    'server' => [
        'software' => $_SERVER['SERVER_SOFTWARE'] ?? null,
        'https' => ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off',
        'forwardedProto' => $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? null,
        'route' => $_GET['route'] ?? null,
    ],
    'filesystem' => [
        'configAboveWebRootReadable' => $configReadable,
        'folderAboveWebRootWritable' => is_writable(dirname($configPath)),
        'probeFolderWritable' => is_writable(__DIR__),
    ],
];

try {
    $db = $config['db'] ?? [];
    $pdo = new PDO(
        sprintf('mysql:host=%s;%sdbname=%s;charset=utf8mb4', $db['host'] ?? '', ($db['port'] ?? '') !== '' ? 'port=' . $db['port'] . ';' : '', $db['name'] ?? ''),
        (string) ($db['user'] ?? ''),
        (string) ($db['pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10],
    );
    $one = static fn (string $sql): mixed => $pdo->query($sql)->fetchColumn();

    $version = (string) $one('SELECT VERSION()');
    $collations = $pdo->query("SHOW COLLATION WHERE Collation IN ('utf8mb4_0900_ai_ci', 'utf8mb4_unicode_ci', 'utf8mb4_unicode_520_ci', 'utf8mb4_uca1400_ai_ci')")->fetchAll(PDO::FETCH_COLUMN);

    $lock = (int) $one("SELECT GET_LOCK('performance_probe', 2)");
    $lockHeldElsewhere = $one("SELECT IS_USED_LOCK('performance_probe')") !== null;
    $released = (int) $one("SELECT RELEASE_LOCK('performance_probe')");

    $ddl = false;
    $fk = false;
    try {
        $pdo->exec('CREATE TABLE IF NOT EXISTS probe_parent (id INT PRIMARY KEY) ENGINE=InnoDB');
        $pdo->exec('CREATE TABLE IF NOT EXISTS probe_child (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES probe_parent(id) ON DELETE CASCADE) ENGINE=InnoDB');
        $ddl = true;
        $fk = (int) $one("SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'probe_child'") === 1;
    } finally {
        $pdo->exec('DROP TABLE IF EXISTS probe_child');
        $pdo->exec('DROP TABLE IF EXISTS probe_parent');
    }

    $result['database'] = [
        'connected' => true,
        'engine' => stripos($version . ' ' . (string) $one('SELECT @@version_comment'), 'mariadb') !== false ? 'MariaDB' : 'MySQL',
        'version' => $version,
        'versionComment' => $one('SELECT @@version_comment'),
        'defaultStorageEngine' => $one('SELECT @@default_storage_engine'),
        'characterSetServer' => $one('SELECT @@character_set_server'),
        'collationServer' => $one('SELECT @@collation_server'),
        'caseInsensitiveCollations' => $collations,
        'sqlMode' => $one('SELECT @@sql_mode'),
        'timeZone' => $one('SELECT @@time_zone'),
        'timeZoneTablesLoaded' => $one("SELECT CONVERT_TZ('2026-01-01 00:00:00', 'UTC', 'Europe/Berlin')") !== null,
        'getLockAcquired' => $lock === 1,
        'getLockVisible' => $lockHeldElsewhere,
        'releaseLock' => $released === 1,
        'ddlAllowed' => $ddl,
        'foreignKeysWork' => $fk,
        'informationSchemaReadable' => $one('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()') !== false,
    ];
} catch (Throwable $e) {
    $result['database'] = [
        'connected' => false,
        'errorClass' => $e::class,
        'sqlState' => $e instanceof PDOException ? ($e->errorInfo[0] ?? null) : null,
    ];
}

echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
