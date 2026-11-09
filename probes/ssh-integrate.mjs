// Probe: integrate through a real ssh to this machine, for a far bash, zsh and fish, then run, stop and exit there.
// Run on a Linux runner with sshd up and the runner's own key authorized (see the setup in the run).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openSession } from '../next/dist/src/session/session.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sshint-')));
const home = os.homedir();
let ids = 0;
const j = (v) => JSON.stringify(v);
const front = (f) => j({ state: f.state, within: f.within, process: f.process?.argv?.slice?.(0, 40) });
const tail = (s, n = 8) => s.lines(Math.max(0, s.lines(0).to - n)).lines.map((l) => `   | ${l.slice(0, 160)}`).join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { PATH: process.env.PATH, HOME: home, USER: os.userInfo().username, LOGNAME: os.userInfo().username, TERM: 'xterm-256color', LANG: 'C.UTF-8' };

async function ran(s, text, waitMs = 10_000) {
  const r = await s.run(text, { waitMs });
  const c = r.command;
  const out = c && c.to !== undefined ? s.lines(c.from, c.to).lines : undefined;
  console.log(`  run ${j(text)}: ${r.kind}; status ${c?.end?.status}; cwd ${j(c?.end?.cwd)}; output ${j(out)}; front ${front(r.front)}${r.tooLong ? `; tooLong ${j(r.tooLong)}` : ''}`);
  return r;
}

for (const far of ['bash', 'zsh', 'fish']) {
  console.log(`== far ${far}`);
  const s = await openSession({ name: far, shell: '/bin/bash', cwd: home, cols: 120, rows: 30, env, parent: tmp, nextCommandId: () => ++ids, waitMs: 10_000 });
  try {
    const from = s.lines(0).to - 1;
    const line = far === 'bash' ? 'ssh -tt -o BatchMode=yes localhost' : `ssh -tt -o BatchMode=yes localhost ${far}`;
    const r0 = await s.run(line, { waitMs: 500 });
    console.log(`  ${line}: ${r0.kind}`);
    const w = await s.wait({ kind: 'match', pattern: /[$%>#] ?$/ }, { waitMs: 15_000, from });
    await sleep(1500);
    console.log(`  far prompt: ${w.by}; front ${front(s.front())}\n${tail(s, 4)}`);
    const t0 = Date.now();
    const ir = await s.integrate({ waitMs: 20_000 });
    console.log(`  integrate: ${ir.kind}${ir.step ? ` ${ir.step}/${ir.by}` : ''}; shell ${ir.shell} ${ir.version ?? ''}; printed ${j(ir.printed)}; ${Date.now() - t0} ms; front ${front(ir.front)}`);
    if (ir.kind !== 'integrated') {
      console.log(tail(s, 20));
      continue;
    }
    await ran(s, 'echo far-$USER');
    await ran(s, 'false');
    await ran(s, "sh -c 'exit 3' | cat");
    await ran(s, 'cd /tmp');
    await ran(s, 'pwd');
    const long = await ran(s, `echo ${'x'.repeat(9000)}`);
    const r5 = await s.run('sleep 30', { waitMs: 1000 });
    console.log(`  run "sleep 30": ${r5.kind}; front ${front(r5.front)}`);
    const sig = await s.stop('SIGTERM');
    console.log(`  stop SIGTERM there: within ${sig.within}; steps ${sig.steps.length}`);
    const st = await s.stop();
    console.log(`  stop: steps ${j(st.steps.map((x) => ({ sent: x.sent, state: x.front.state, within: x.front.within })))}; within ${st.within}; front ${front(st.front)}`);
    await sleep(500);
    const c5 = r5.command;
    console.log(`  sleep's ending: status ${c5?.end?.status}`);
    await ran(s, 'echo again');
    const ex = await s.run('exit', { waitMs: 10_000 });
    console.log(`  run "exit": ${ex.kind}; front ${front(ex.front)}`);
    await sleep(1000);
    console.log(`  after exit: front ${front(s.front())}`);
    await ran(s, 'echo local-$$');
  } catch (e) {
    console.log(`  !! ${e?.stack ?? e}\n${tail(s, 20)}`);
  } finally {
    const c = await s.close({ force: true });
    console.log(`  close: ${j(c).slice(0, 200)}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
