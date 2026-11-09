// Probe: stop(signal) with suspend signals, CONT, and a signal the job ignores, in each shell, through the session.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openSession } from '../next/dist/src/session/session.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-')));
const which = (n) => {
  try {
    return execFileSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
};
let ids = 0;
let n = 0;
const brief = (f) => `${f.state}${f.process ? ` ${f.process.argv.slice(0, 40)}` : ''}`;
const tail = (s, k = 4) => s.lines(Math.max(0, s.lines(0).to - k)).lines.map((l) => `   | ${l.slice(0, 120)}`).join('\n');
const ended = (s, id) => {
  const c = s.command(id);
  return c?.end ? `ended status=${c.end.status} ms=${c.end.ms}` : 'not ended';
};

async function one(name) {
  const shell = which(name);
  if (!shell) return console.log(`== ${name}: absent`);
  const home = path.join(tmp, `home-${++n}`);
  fs.mkdirSync(home);
  if (name === 'zsh') fs.writeFileSync(path.join(home, '.zshenv'), 'skip_global_compinit=1\n');
  if (name === 'fish') for (const d of ['.local/share/fish', '.cache/fish']) fs.mkdirSync(path.join(home, d, 'generated_completions'), { recursive: true });
  const s = await openSession({ name: 'g', shell, cwd: home, cols: 120, rows: 30, env: { PATH: process.env.PATH, HOME: home, TERM: 'xterm-256color', LANG: 'C.UTF-8' }, parent: tmp, nextCommandId: () => ++ids, waitMs: 10_000 });
  try {
    for (const sig of ['SIGTSTP', 'SIGSTOP', 'SIGTTIN', 'SIGTTOU']) {
      const r = await s.run('sleep 100', { waitMs: 300 });
      const id = r.command.id;
      const t0 = Date.now();
      const o = await s.stop(sig);
      const ms = Date.now() - t0;
      await new Promise((res) => setTimeout(res, 300));
      console.log(`== ${name} ${sig}: ${ms} ms; steps ${o.steps.map((st) => `${st.sent}->${brief(st.front)}${st.refused ? ` refused ${st.refused}` : ''}`).join(', ')}; ${ended(s, id)}; front now ${brief(s.front())}`);
      const j = await s.run('jobs', { waitMs: 5000 });
      console.log(`   jobs: ${JSON.stringify(s.lines(j.command.from, j.command.to).lines)}`);
      const c = await s.stop('SIGCONT');
      console.log(`   stop(SIGCONT) at the prompt: steps ${c.steps.length}; front ${brief(c.front)}`);
      const fg = await s.run('fg', { waitMs: 1000 });
      console.log(`   run fg: ${fg.kind}; front ${brief(s.front())}`);
      const k = await s.stop();
      console.log(`   stop(): ${k.steps.map((st) => `${st.sent}->${brief(st.front)}`).join(', ')}; ${ended(s, fg.command.id)}`);
    }
    const r = await s.run(`sh -c 'trap "" USR1; sleep 100'`, { waitMs: 300 });
    const t0 = Date.now();
    const o = await s.stop('SIGUSR1');
    console.log(`== ${name} ignored SIGUSR1: ${Date.now() - t0} ms; steps ${o.steps.map((st) => `${st.sent}->${brief(st.front)}`).join(', ')}; ${ended(s, r.command.id)}; next ${o.next}`);
    const r2 = await s.run(`sh -c 'trap "echo GOT-USR1" USR1; while :; do sleep 0.1; done'`, { waitMs: 300 });
    const t1 = Date.now();
    const o2 = await s.stop('SIGUSR1');
    console.log(`== ${name} handled SIGUSR1: ${Date.now() - t1} ms; steps ${o2.steps.map((st) => `${st.sent}->${brief(st.front)}`).join(', ')}; ${ended(s, r2.command.id)}\n${tail(s, 3)}`);
    await s.stop();
    const o3 = await s.stop('SIGBOGUS');
    console.log(`== ${name} SIGBOGUS at prompt: ${JSON.stringify(o3.steps)}`);
    await s.run('sleep 100', { waitMs: 300 });
    try {
      const o4 = await s.stop('SIGBOGUS');
      console.log(`== ${name} SIGBOGUS on a job: ${JSON.stringify(o4.steps.map((st) => ({ sent: st.sent, refused: st.refused })))}`);
    } catch (e) {
      console.log(`== ${name} SIGBOGUS on a job threw: ${e.code ?? e.message}`);
    }
    await s.stop();
  } finally {
    await s.close({ force: true });
  }
}
for (const name of (process.argv[2] ?? 'bash zsh fish').split(' ')) await one(name);
