#!/usr/bin/env node
/**
 * Fails CI if a Nest HTTP route lacks @Public(), @ActorOnly(), or @RequirePermission(...).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'apps', 'api', 'src');
const SKIP_DIR = new Set(['node_modules', 'dist']);
const HTTP_DECORATOR = /@(Get|Post|Put|Patch|Delete|Head|Options)\(/;
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
    if (!entry.endsWith('.controller.ts')) continue;
    auditController(full);
  }
}

function auditController(path) {
  const source = readFileSync(path, 'utf8');
  const classMatch = source.match(/((?:^[ \t]*@[^\n]+\n)+)^[ \t]*export class/m);
  const classDecorators = classMatch ? classMatch[1].split('\n').map((l) => l.trim()).filter(Boolean) : [];
  const classGuard =
    classDecorators.some((d) => d.includes('@RequirePermission(')) ||
    classDecorators.some((d) => d.includes('@ActorOnly()'));
  const lines = source.split('\n');
  let pendingDecorators = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith('@')) {
      pendingDecorators.push(line);
      continue;
    }
    const methodMatch = line.match(/^(async\s+)?(\w+)\s*\(/);
    if (!methodMatch) {
      if (line && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('export')) {
        pendingDecorators = [];
      }
      continue;
    }
    const name = methodMatch[2];
    if (['constructor', 'onModuleInit', 'onModuleDestroy', 'configure'].includes(name)) {
      pendingDecorators = [];
      continue;
    }
    const isHttpRoute = pendingDecorators.some((d) => HTTP_DECORATOR.test(d));
    if (!isHttpRoute) {
      pendingDecorators = [];
      continue;
    }
    const hasGuard =
      classGuard ||
      pendingDecorators.some((d) => d.includes('@Public()')) ||
      pendingDecorators.some((d) => d.includes('@ActorOnly()')) ||
      pendingDecorators.some((d) => d.includes('@RequirePermission('));
    if (!hasGuard) {
      offenders.push(`${relative(join(ROOT, '..', '..'), path)}:${i + 1} ${name}()`);
    }
    pendingDecorators = [];
  }
}

walk(ROOT);

if (offenders.length > 0) {
  console.error('Un guarded HTTP routes (add @Public, @ActorOnly, or @RequirePermission):\n');
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}

console.log('All HTTP controller routes declare a permission or public/actor-only guard.');
