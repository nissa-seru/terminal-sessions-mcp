import { Transcript } from './dist/src/session/transcript.js';
const N = '12345678901234567890';
const mk = () => new Transcript(21, 30, { reply() {}, pressure() {}, redact: (s) => s.replaceAll(N, '[redacted]..........'), redactSpan: 20, mark: () => false });
const show = (t, label) => { const l = t.lines(0); console.log(label, JSON.stringify({ from: l.from, to: l.to, lens: l.lines.map((x) => x.length), tails: l.lines.map((x) => JSON.stringify(x.slice(-25))) })); };
const w = (t, d) => new Promise((r) => t.write(d, r));
for (const pre of ['', 'prompt$ cmd\r\n']) {
  const t = mk();
  await w(t, pre + 'x'.repeat(65533) + N + 'xxxx');
  show(t, `pre=${JSON.stringify(pre)} before:`);
  const term = t['term']; const b = term.buffer.normal;
  console.log('cursor', b.cursorY, b.cursorX, 'baseY', b.baseY, 'length', b.length, 'next wrapped', b.getLine(b.baseY + b.cursorY + 1)?.isWrapped, 'cursor row', JSON.stringify(b.getLine(b.baseY + b.cursorY).translateToString(true)));
  await w(t, '\x1b[?1049h\x1b[?1049l\r\n');
  show(t, '  after:');
}
