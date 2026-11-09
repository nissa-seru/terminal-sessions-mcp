// Probe: through the session itself, give each shell, on a terminal of its own through `script`, the integration, then time
// `run` of texts whose typed line grows, each typed at the far prompt's B mark as `run` types it. Also reads MAX_CANON and
// MAX_INPUT on the far terminal. Build with the cap lifted first. Times are a probe's, not a test's.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as integration from '../next/dist/src/session/integration.js';
import { openSession } from '../next/dist/src/session/session.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'far-cost-')));
const which = (n) => {
  try {
    return execFileSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
};
let ids = 0;
let n = 0;
const tail = (s) => s.lines(Math.max(0, s.lines(0).to - 14)).lines.map((l) => `   | ${l.slice(0, 140)}`).join('\n');

async function one(name) {
  const shell = which(name);
  if (!shell) return console.log(`== ${name}: absent`);
  const home = path.join(tmp, `home-${++n}`);
  fs.mkdirSync(home);
  if (name === 'zsh') fs.writeFileSync(path.join(home, '.zshenv'), 'skip_global_compinit=1\n');
  if (name === 'fish') for (const d of ['.local/share/fish', '.cache/fish']) fs.mkdirSync(path.join(home, d, 'generated_completions'), { recursive: true });
  const s = await openSession({ name: 'm', shell, cwd: home, cols: 100, rows: 30, env: { PATH: process.env.PATH, HOME: home, TERM: 'xterm-256color', LANG: 'C.UTF-8' }, parent: tmp, nextCommandId: () => ++ids, waitMs: 10_000 });
  try {
    const argv = name === 'fish' ? `'${shell}' --no-config -i -C 'function fish_prompt; echo -n "far> "; end'` : name === 'zsh' ? `'${shell}' -f -i` : `'${shell}' --norc --noprofile -i`;
    const launcher = path.join(tmp, `far-${n}`);
    fs.writeFileSync(launcher, `#!/bin/sh\nexec env -i HOME='${home}' PATH='${process.env.PATH}' TERM=xterm-256color LANG=C.UTF-8 PS1='far> ' ${argv}\n`, { mode: 0o755 });
    const relay = process.platform === 'darwin' ? `script -q /dev/null ${launcher}` : `script -qfc ${launcher} /dev/null`;
    const from = s.lines(0).to - 1;
    await s.run(relay, { waitMs: 200 });
    const w = await s.wait({ kind: 'match', pattern: /^far> ?$/ }, { waitMs: 10_000, from });
    if (w.by !== 'match') return console.log(`== ${name}: no far prompt\n${tail(s)}`);
    const t0 = Date.now();
    const r = await s.integrate({ waitMs: 30_000 });
    console.log(`== ${name} integrate: ${r.kind}${r.kind === 'incomplete' ? ` at ${r.step}` : ` ${r.version}`} in ${Date.now() - t0} ms`);
    if (r.kind !== 'integrated') return console.log(tail(s));
    const mc = await s.run('getconf MAX_CANON /dev/tty; getconf MAX_INPUT /dev/tty', { waitMs: 5000 });
    if (mc.kind === 'ended') console.log(`== ${name} far terminal MAX_CANON and MAX_INPUT: ${s.lines(mc.command.from, mc.command.to).lines.join(' ')}`);
    for (const size of [256, 512, 768, 1024, 2048, 4096, 6144, 8192, 12288, 16384, 24576, 32768]) {
      const text = `: ${'y'.repeat(size)}`;
      const typed = integration.farCommand(name, text).length;
      const t = Date.now();
      const rr = await s.run(text, { waitMs: 30_000 });
      const ms = Date.now() - t;
      console.log(`== ${name} typed=${typed}: ${rr.kind}${rr.kind === 'refused' ? ` ${JSON.stringify(rr.tooLong ?? rr.front)}` : ` in ${ms} ms`}`);
      if (rr.kind !== 'ended' || ms > 5000) {
        if (rr.kind !== 'ended') console.log(tail(s));
        break;
      }
    }
  } finally {
    await s.close({ force: true });
  }
}

for (const name of (process.argv[2] ?? 'bash,zsh,fish').split(',')) await one(name);
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
process.exit(0);
