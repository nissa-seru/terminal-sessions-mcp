// Probe: the session's terminal modes while ssh, su and sudo ask their questions, and at the shell prompts they lead to.
// Run on a Linux runner with a local sshd, and a user tsmprobe whose password is in TSM_PW.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as proc from '../next/dist/src/session/proc.js';
import { openSession } from '../next/dist/src/session/session.js';

const pw = process.env.TSM_PW;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'canon-')));
let ids = 0;
const s = await openSession({ name: 'c', shell: '/bin/bash', cwd: tmp, cols: 120, rows: 30, env: { PATH: process.env.PATH, HOME: process.env.HOME, TERM: 'xterm-256color', LANG: 'C.UTF-8' }, parent: tmp, nextCommandId: () => ++ids, waitMs: 10_000 });
const pts = s.pts;
const tail = () => s.lines(Math.max(0, s.lines(0).to - 4)).lines.map((l) => `   | ${l.slice(0, 120)}`).join('\n');
const at = (label) => {
  const f = s.front();
  console.log(`== ${label}: modes ${JSON.stringify(proc.modes(pts))}; front ${f.state}${f.process ? ` ${f.process.argv.slice(0, 60)}` : ''}\n${tail()}`);
};
const send = async (bytes, until, quietMs) => {
  const r = await s.send(bytes, { waitMs: 15_000, ...(until && { until }), ...(quietMs && { quietMs }) });
  if (until && r.by !== 'match') console.log(`!! no match for ${until}: ${r.by}`);
  return r;
};
try {
  at('the session prompt');
  await send('su tsmprobe\r', /Password:/);
  at('su asks for a password');
  await send(`${pw}\r`, /tsmprobe@/);
  await new Promise((r) => setTimeout(r, 500));
  at('su: the shell prompt');
  await send('sudo -k true\r', /password for tsmprobe/);
  at('sudo asks for a password');
  await send('\x03', undefined, 500);
  await send('exit\r', undefined, 500);
  await send('ssh -o UserKnownHostsFile=/tmp/kh-probe -o StrictHostKeyChecking=ask -o PubkeyAuthentication=no tsmprobe@localhost\r', /yes\/no/);
  at('ssh asks about the host key');
  await send('yes\r', /password:/);
  at('ssh asks for a password');
  await send(`${pw}\r`, /tsmprobe@/);
  await new Promise((r) => setTimeout(r, 1000));
  at('ssh: the far prompt');
  await send('cat\r', undefined, 500);
  at('ssh: cat in front on the far side');
  await send('\x03', undefined, 500);
  await send('exit\r', undefined, 1000);
  await send(`script -qfc 'bash --norc --noprofile -i' /dev/null\r`, undefined, 1000);
  at('script: the far prompt');
  await send('exit\r', undefined, 1000);
  await send('cat\r', undefined, 500);
  at('cat in front locally');
  await send('\x03', undefined, 500);
} finally {
  await s.close({ force: true });
}
