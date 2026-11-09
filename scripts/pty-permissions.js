// node-pty's macOS prebuilds ship spawn-helper without its execute bit, and node-pty starts every shell through it.
const fs = require('node:fs');
const path = require('node:path');

function ptyDir() {
  try {
    return path.dirname(require.resolve('node-pty/package.json'));
  } catch {
    return undefined;
  }
}

const dir = process.argv[2] ?? ptyDir();
if (dir) {
  const helpers = [path.join(dir, 'build', 'Release', 'spawn-helper'), path.join(dir, 'build', 'Debug', 'spawn-helper')];
  let prebuilds = [];
  try {
    prebuilds = fs.readdirSync(path.join(dir, 'prebuilds'));
  } catch {}
  for (const p of prebuilds) helpers.push(path.join(dir, 'prebuilds', p, 'spawn-helper'));
  for (const f of helpers) {
    try {
      fs.chmodSync(f, 0o755);
    } catch (e) {
      if (e.code !== 'ENOENT') process.stderr.write(`term-sessions-mcp: couldn't make ${f} executable (${e.code}). Shells won't start on macOS until it is: chmod +x ${f}\n`);
    }
  }
}
