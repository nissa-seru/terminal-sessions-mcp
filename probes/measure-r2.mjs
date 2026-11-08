// Measurements for the r40d4 round: drain (3, 40, 41: cost per prompt), longline (1: memory and CPU for
// one line with no newline, a watch pending), macloop (15: event-loop delay with ten shells without
// integration each in a wait). Run from the repository root after `npm run build:next`, with node --expose-gc.
import { openSession } from '../next/dist/src/session/session.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const which = (n) => { try { return execFileSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).trim() || undefined; } catch { return undefined; } };
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'm2-')));
let ids = 0;
async function open(shell, cols = 100, rows = 30) {
  const home = fs.mkdtempSync(path.join(tmp, 'h-'));
  if (shell.endsWith('zsh')) fs.writeFileSync(path.join(home, '.zshenv'), 'skip_global_compinit=1\n');
  return openSession({ name: 'm', shell, cwd: home, cols, rows, env: { PATH: process.env.PATH, HOME: home, TERM: 'xterm-256color', LANG: 'C.UTF-8' }, parent: tmp, nextCommandId: () => ++ids, waitMs: 15000 });
}
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const r2 = (x) => Math.round(x * 100) / 100;
const mib = (b) => r2(b / 1048576);
const out = { platform: process.platform };
const only = (process.env.ONLY ?? 'drain,longline,macloop').split(',');

if (only.includes('drain')) {
  out.drain = {};
  for (const name of ['bash', 'zsh', 'fish']) {
    const shell = which(name);
    if (!shell) continue;
    const s = await open(shell);
    for (let i = 0; i < 3; i++) await s.run('true', { waitMs: 10000 });
    const timed = async (text) => { const t0 = process.hrtime.bigint(); const r = await s.run(text, { waitMs: 60000 }); if (r.kind !== 'ended') throw new Error(`${text}: ${r.kind}`); return ms(t0); };
    const prompts = [];
    for (let k = 0; k < 40; k++) prompts.push(await timed('true'));
    prompts.sort((a, b) => a - b);
    out.drain[name] = { runTrueMedianMs: r2(prompts[20]), runTrueP90Ms: r2(prompts[36]), runTrueMinMs: r2(prompts[0]) };
    await s.close({ force: true });
  }
}

if (only.includes('longline')) {
  out.longline = {};
  const shell = which('bash');
  for (const mb of (process.env.MB ?? '5,20').split(',').map(Number)) {
    globalThis.gc?.();
    const s = await open(shell);
    s.watch(/NEVER-MATCHES/, 0);
    let peak = process.memoryUsage().rss;
    const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 100);
    const cpu0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    const r = await s.run(`head -c ${mb * 1000000} /dev/zero | tr '\\0' x; echo`, { waitMs: Number(process.env.LIMIT_MS ?? 240000) });
    const wall = ms(t0);
    const cpu = process.cpuUsage(cpu0);
    clearInterval(sampler);
    globalThis.gc?.();
    const heap = process.memoryUsage().heapUsed;
    const lines = s.lines(0);
    out.longline[`${mb}MB`] = { ended: r.kind === 'ended', wallS: r2(wall / 1000), cpuS: r2((cpu.user + cpu.system) / 1e6), rssPeakMiB: mib(peak), heapAfterGcMiB: mib(heap), linesKept: lines.to - lines.from, longestLine: Math.max(...lines.lines.map((l) => l.length)) };
    await s.close({ force: true });
  }
}

if (only.includes('macloop')) {
  const many = [];
  for (let i = 0; i < 10; i++) { const m = await open('/bin/sh'); await m.run('sleep 100', { waitMs: 300 }); many.push(m); }
  const h = monitorEventLoopDelay({ resolution: 5 });
  h.enable();
  await Promise.all(many.map((m) => m.wait({ kind: 'end' }, { waitMs: 5000, from: 0 })));
  h.disable();
  out.macloop = { tenPlainEachWaiting: { p50: r2(h.percentile(50) / 1e6), p99: r2(h.percentile(99) / 1e6), max: r2(h.max / 1e6) } };
  for (const m of many) await m.close({ force: true });
}

console.log(JSON.stringify(out));
if (process.env.ON_VPS_EVIDENCE_DIR || process.env.ON_GH_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.ON_VPS_EVIDENCE_DIR ?? process.env.ON_GH_EVIDENCE_DIR, 'measure-r2.json'), JSON.stringify(out, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
