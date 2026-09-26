import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = ['kole-lookup-console', 'KoleLookup']
  .map(name => resolve(root, '..', name))
  .find(folder => {
    try {
      return existsSync(resolve(folder, 'server.js')) &&
        JSON.parse(readFileSync(resolve(folder, 'package.json'), 'utf8')).name === 'kole-lookup-console';
    } catch { return false; }
  });

if (!backend) {
  console.error('Place the backend next to this project in a folder named kole-lookup-console or KoleLookup.');
  process.exit(1);
}

const runner = spawn(process.execPath, [
  resolve(root, 'node_modules/concurrently/dist/bin/concurrently.js'),
  '--kill-others', '--names', 'mobile,server', '--prefix-colors', 'cyan,yellow',
  'vite --strictPort', `npm --prefix "${backend}" start`,
], { cwd: root, stdio: 'inherit', windowsHide: true });
runner.on('error', () => {
  console.error('Unable to start development servers. Run npm ci in both projects first.');
  process.exitCode = 1;
});
runner.on('exit', code => { process.exitCode = code ?? 1; });
