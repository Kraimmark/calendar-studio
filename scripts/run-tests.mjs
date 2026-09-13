import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTests(path));
    else if (entry.isFile() && entry.name.endsWith('.test.cjs')) files.push(path);
  }
  return files;
}

const files = (await collectTests('tests')).sort();
if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
