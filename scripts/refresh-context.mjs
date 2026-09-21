import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = spawnSync('which', ['graphify'], { encoding: 'utf8' });
let interpreter = 'python3';
if (binary.status === 0) {
  const shebang = readFileSync(binary.stdout.trim(), 'utf8').split('\n')[0];
  const candidate = shebang.match(/^#!(\/[a-zA-Z0-9/_.-]+)$/)?.[1];
  if (candidate) interpreter = candidate;
}
const result = spawnSync(interpreter, ['scripts/build-context.py', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
