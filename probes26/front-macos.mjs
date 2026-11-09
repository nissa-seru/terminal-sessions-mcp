// How long a session's front() takes on this machine (a ps spawn on macOS), 60 calls.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const root = process.argv[2];
const { openSession } = await import(path.join(root, 'next/dist/src/session/session.js'));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fm-')));
const home = path.join(tmp, 'home');
fs.mkdirSync(home);
let ids = 0;
const s = await openSession({ name: 'm', shell: '/bin/bash', cwd: home, cols: 100, rows: 30, env: { PATH: process.env.PATH, HOME: home, TERM: 'xterm-256color', LANG: 'C.UTF-8' }, parent: tmp, nextCommandId: () => ++ids, waitMs: 10_000 });
const ms = [];
for (let i = 0; i < 60; i++) {
  const t0 = performance.now();
  s.front();
  ms.push(performance.now() - t0);
  await new Promise((r) => setTimeout(r, 20));
}
ms.sort((a, b) => a - b);
const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(1);
console.log(`${process.platform} node ${process.version}: front() over 60 calls: min ${q(0)} p50 ${q(0.5)} p90 ${q(0.9)} max ${ms[ms.length - 1].toFixed(1)} ms`);
await s.close({ force: true });
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
