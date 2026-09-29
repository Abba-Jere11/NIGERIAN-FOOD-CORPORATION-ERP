import type { DatabaseTarget } from '../env';

/** Identifiers are interpolated into DDL, so they are validated, not trusted. */
export function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`"${name}" is not a valid PostgreSQL identifier`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function targetFromArgv(argv: string[] = process.argv.slice(2)): DatabaseTarget | undefined {
  if (argv.includes('--test')) return 'test';
  if (argv.includes('--dev') || argv.includes('--development')) return 'development';
  return undefined;
}

export function targetsFromArgv(argv: string[] = process.argv.slice(2)): DatabaseTarget[] {
  const explicit = targetFromArgv(argv);
  return explicit ? [explicit] : ['development', 'test'];
}

export function reportFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n${message}\n`);
  process.exitCode = 1;
  process.exit(1);
}
