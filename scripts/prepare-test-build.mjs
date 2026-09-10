import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('.tmp/domain-test', { recursive: true });
await writeFile('.tmp/domain-test/package.json', '{"type":"commonjs"}\n', 'utf8');
