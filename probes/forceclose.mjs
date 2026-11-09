// Probe: close with force in fish, as the setsid test does it, many times; which listing came back undefined, and how long each took.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openSession } from '../next/dist/src/session/session.js';
import * as proc from '../next/dist/src/session/proc.js';
const times = { onTerminal: [], descendants: [], held: [] };

const N = Number(process.env.N ?? 60);
const shellName = process.argv[2] ?? 'fish';
const shell = execFileSync('sh', ['-c', `command -v ${shellName}`], { encoding: 'utf8' }).trim();
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fc-')));
let ids = 0;
let bad = 0;
for (let i = 0; i < N; i++) {
  const home = path.join(tmp, `home-${i}`);
  fs.mkdirSync(home);
  for (const d of ['.local/share/fish', '.cache/fish']) fs.mkdirSync(path.join(home, d, 'generated_completions'), { recursive: true });
  const logs = [];
  const s = await openSession({ name: 'f', shell, cwd: home, cols: 100, rows: 30, env: { PATH: process.env.PATH, HOME: home, TERM: 'xterm-256color', LANG: 'C.UTF-8' }, parent: tmp, nextCommandId: () => ++ids, waitMs: 10_000, log: (l) => logs.push(l) });
  const file = path.join(tmp, `pid-${i}`);
  const hold = `sh -c 'while [ ! -s "$0" ]; do sleep 0.05; done' '${file}'`;
  const r = await s.run(`sh -c 'python3 -c "import os, sys, time; os.setsid(); open(sys.argv[1], \\"w\\").write(str(os.getpid())); time.sleep(300)" "$0"; :' '${file}' & ${hold}`, { waitMs: 10_000 });
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(file, 'utf8'));
  } catch {}
  const t0 = Date.now();
  const exit = await s.close({ force: true });
  const ms = Date.now() - t0;
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  for (const l of logs) {
    const m = /onTerminal=\S+ (\d+)ms descendants=\S+ (\d+)ms/.exec(l);
    if (m) (times.onTerminal.push(+m[1]), times.descendants.push(+m[2]));
    const h = /held\(SIGKILL\)=\S+ of \d+ listed (\d+)ms/.exec(l);
    if (h) times.held.push(+h[1]);
  }
  if (exit.unlisted || i < 2) {
    if (exit.unlisted) bad++;
    console.log(`#${i} run=${r.kind} pid=${pid} close ${ms}ms unlisted=${exit.unlisted} unreached=${JSON.stringify(exit.unreached)} aliveAfter=${alive} | ${logs.filter((l) => l.startsWith('PROBE')).join(' | ')}`);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}
const q = (a) => { const b = [...a].sort((x, y) => x - y); return `n=${b.length} median=${b[Math.floor(b.length / 2)]} p95=${b[Math.floor(b.length * 0.95)]} max=${b.at(-1)}`; };
console.log(`== ${shellName}: ${bad} of ${N} unlisted; ms onTerminal ${q(times.onTerminal)}; descendants ${q(times.descendants)}; held ${q(times.held)}; failures ${JSON.stringify(proc.failures.slice(0, 10))}`);
