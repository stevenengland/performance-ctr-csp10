<?php

declare(strict_types=1);

namespace Performance\Tests\Unit;

use Performance\Domain\BootstrapAdmin;
use Performance\Http\Config;
use PHPUnit\Framework\TestCase;

final class ConfigTest extends TestCase
{
    private string $file;

    protected function setUp(): void
    {
        $this->file = tempnam(sys_get_temp_dir(), 'runtime') ?: self::fail('no temporary file');
    }

    protected function tearDown(): void
    {
        unlink($this->file);
    }

    public function testReadsTheBootstrapAdminTheDeployRendersIntoTheRuntimeConfiguration(): void
    {
        $this->write("'bootstrapAdmin' => ['user' => 'chef', 'passwordHash' => '\$2y\$10\$abc'],");

        $config = Config::load($this->file, __DIR__);

        self::assertEquals(new BootstrapAdmin('chef', '$2y$10$abc'), $config->bootstrapAdmin);
    }

    public function testWithoutACompleteBootstrapAdminThereIsNone(): void
    {
        foreach (['', "'bootstrapAdmin' => ['user' => 'chef'],", "'bootstrapAdmin' => ['user' => ' ', 'passwordHash' => 'x'],"] as $entry) {
            $this->write($entry);

            self::assertNull(Config::load($this->file, __DIR__)->bootstrapAdmin, $entry);
        }
    }

    private function write(string $bootstrapEntry): void
    {
        file_put_contents($this->file, <<<PHP
            <?php
            return [
                'db' => ['host' => 'db', 'name' => 'performance', 'user' => 'performance', 'password' => 'secret'],
                {$bootstrapEntry}
            ];
            PHP);
    }
}
