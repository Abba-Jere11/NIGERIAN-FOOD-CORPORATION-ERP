#!/usr/bin/env node
/**
 * Fails CI if application code branches on a role name.
 * Allowed: comments, tests, and isSystemActorRef.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'apps');
const FORBIDDEN = /\.role\s*==|role\s*===|role\s*==/;
const ALLOW_FILE = /\.(test|spec)\.(ts|tsx)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.next', 'e2e']);

const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (ALLOW_FILE.test(entry)) continue;
    const source = readFileSync(full, 'utf8');
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const lines = withoutComments.split('\n');
    lines.forEach((line, index) => {
      if (line.includes('isSystemActorRef')) return;
      if (FORBIDDEN.test(line)) {
        offenders.push(`${relative(join(ROOT, '..'), full)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

walk(ROOT);

if (offenders.length > 0) {
  console.error('Role-name branches are forbidden in apps/ (use can() / isSystemActorRef):\n');
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}

console.log('No role-name branches in apps/.');
