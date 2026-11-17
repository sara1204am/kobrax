#!/usr/bin/env node
// Corre todas las pruebas unitarias (src/**/*.spec.ts). `node --test` solo expande globs desde Node 21; el CI usa Node 20, así que se listan aquí.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.name.endsWith('.spec.ts') ? [full] : [];
  });
const files = walk(join(root, 'src')).sort();
const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
