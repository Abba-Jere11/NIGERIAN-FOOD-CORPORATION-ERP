import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Server Components cannot pass functions to Client Components. The inventory
 * smart forms originally did this with `review={() => ...}`.
 */
const ROOT = join(import.meta.dirname);
const SKIP = new Set(['node_modules', '.next', 'e2e']);
const FUNCTION_PROPS = [
  /\breview=\{(?:function|\()/,
  /\brender=\{(?:function|\()/,
  /\brenderItem=\{(?:function|\()/,
  /\brenderCell=\{(?:function|\()/,
  /\bformatter=\{(?:function|\()/,
  /\bvalidate=\{(?:function|\()/,
  /\browKey=\{(?:function|\()/,
  /\browHref=\{(?:function|\()/,
];

function walk(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (full.endsWith('.tsx') || full.endsWith('.ts')) files.push(full);
  }
}

function isClientModule(source: string): boolean {
  const head = source.slice(0, 400);
  return /(?:^|\n)['"]use client['"]/.test(head);
}

describe('RSC client boundaries', () => {
  it('does not pass function props from Server Components into Client Components', () => {
    const files: string[] = [];
    walk(ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (isClientModule(source)) continue;
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      for (const pattern of FUNCTION_PROPS) {
        if (pattern.test(source)) {
          offenders.push(`${relative(ROOT, file)} matches ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
