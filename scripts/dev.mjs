// Starts the local API and the website together; Control-C stops both.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('server/.venv/bin/python')) {
  console.error('The Python environment is missing. See README: "Set up once".');
  process.exit(1);
}
// The API reloads when its code changes; long jobs run in the worker so they're never cut off.
const procs = [
  spawn('npm', ['run', 'api'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'worker'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'web'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGINT'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => code && code !== 130 && stop()));
console.log('\n  Chassis → http://localhost:4311\n');
