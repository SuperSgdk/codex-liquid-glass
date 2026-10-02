// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const directory of ['src', 'scripts', 'web', 'tests']) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:mjs|js)$/.test(entry.name)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(root, directory, entry.name)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
const typeScriptCompiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
for (const argumentsList of [[typeScriptCompiler, '--project', 'tsconfig.json'], ['scripts/build.mjs'], ['--test', ...((await readdir(path.join(root, 'tests'))).filter(name => name.endsWith('.test.mjs')).map(name => `tests/${name}`))]]) {
  const result = spawnSync(process.execPath, argumentsList, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
