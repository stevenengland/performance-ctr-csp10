import { argv, exit, stderr, stdout } from 'node:process';
import { targetPolicy } from './contract/policy.ts';
import { renderHtaccess } from './webspace/htaccess.ts';

const USAGE = `Usage: node deploy/cli.ts <command>

Commands:
  render-htaccess <site-url>   Print the web root's .htaccess for the site URL
`;

function renderCommand(siteUrl: string | undefined): number {
  try {
    stdout.write(renderHtaccess(targetPolicy(siteUrl ?? '')));
    return 0;
  } catch (error) {
    stderr.write(`Invalid site URL: ${(error as Error).message}\n`);
    return 1;
  }
}

function main(args: readonly string[]): number {
  const [command, ...rest] = args;
  if (command === 'render-htaccess' && rest.length === 1) {
    return renderCommand(rest[0]);
  }
  stderr.write(USAGE);
  return 2;
}

exit(main(argv.slice(2)));
