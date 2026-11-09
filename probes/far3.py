#!/usr/bin/env python3
"""Probe, in a real terminal, a far shell given text by one typed line that decodes and evals it.

E: for texts of growing size, each byte outside a small safe set escaped as \\0ooo, typed as
   ` eval "$(printf '%b' '...')"` (fish: ` eval (printf '%b' '...' | string collect)`). The text
   sets a variable to a long string of the bytes a line editor would act on, then prints its
   length and the pipeline statuses kept by a capture appended inside the same eval.
H: which typed lines reach a history file that saves as lines are entered (zsh with
   INC_APPEND_HISTORY, bash with PROMPT_COMMAND='history -a', fish), with and without a
   leading space, before and after saving is turned off.
Each shell starts without the user's startup files. Times are a probe's, not a test's.
"""
import os, pty, re, select, shutil, sys, tempfile, time

def spawn(argv, env):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update(env)
        os.execvp(argv[0], argv)
    return pid, fd

def write_all(fd, data):
    """Writes everything while reading what the shell echoes, so neither side's buffer fills and stops the other."""
    import fcntl
    fl = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
    got = b''
    try:
        while data:
            r, w, _ = select.select([fd], [fd], [], 1)
            if r:
                try:
                    got += os.read(fd, 1 << 20)
                except BlockingIOError:
                    pass
            if w:
                try:
                    data = data[os.write(fd, data[:65536]):]
                except BlockingIOError:
                    pass
    finally:
        fcntl.fcntl(fd, fcntl.F_SETFL, fl)
    return got

def read_until(fd, pat, limit, buf=b''):
    end = time.time() + limit
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                d = os.read(fd, 1 << 20)
            except OSError:
                break
            if not d:
                break
            buf = (buf + d)[-65536:]
            m = re.search(pat, buf)
            if m:
                return buf, m
    return buf, None

def settle(fd, ms=700):
    buf = b''
    while True:
        r, _, _ = select.select([fd], [], [], ms / 1000)
        if not r:
            return buf
        try:
            d = os.read(fd, 1 << 20)
        except OSError:
            return buf
        if not d:
            return buf
        buf += d

SAFE = set(b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,._+:@%/=-')
def esc(text):
    return ''.join(chr(b) if b in SAFE else '\\0%03o' % b for b in text.encode())

PAYLOAD = 'ab"$`\\!~\t#\';*?[x]{y}|&<>()\n'

def program(shell, n):
    p = (PAYLOAD * (n // len(PAYLOAD) + 1))[:n]
    if shell == 'fish':
        q = "'" + p.replace('\\', '\\\\').replace("'", "\\'") + "'"
        return f"set x {q}\nfalse | true | false\n\nset -g __p $pipestatus; printf 'GO''T=%s PS=%s\\n' (string length -- \"$x\") \"$__p\""
    q = "'" + p.replace("'", "'\\''") + "'"
    ps = '${(j: :)pipestatus}' if shell == 'zsh' else '${PIPESTATUS[*]}'
    return f"x={q}\nfalse | true | false\n\n__p=\"{ps}\"; printf 'GO''T=%s PS=%s\\n' \"${{#x}}\" \"$__p\""

def line(shell, text):
    e = esc(text)
    if shell == 'fish':
        return f" eval (printf '%b' '{e}' | string collect)\r"
    return f" eval \"$(printf '%b' '{e}')\"\r"

ARGV = {
    'bash': ['bash', '--norc', '--noprofile', '-i'],
    'zsh': ['zsh', '-f', '-i'],
    'fish': ['fish', '--no-config', '-i'],
}
VERSION = {'bash': 'echo "$BASH_VERSION"', 'zsh': 'echo "$ZSH_VERSION"', 'fish': 'echo "$FISH_VERSION"'}

def start(shell, env):
    pid, fd = spawn(ARGV[shell], {'TERM': 'xterm-256color', 'PS1': '$ ', **env})
    settle(fd, 1500)
    return pid, fd

def stop(pid, fd):
    try:
        os.kill(pid, 9)
    except OSError:
        pass
    try:
        os.close(fd)
    except OSError:
        pass

def probe_eval(shell, sizes):
    pid, fd = start(shell, {})
    os.write(fd, (VERSION[shell] + '\r').encode())
    print(f'== {shell} version: {settle(fd).decode(errors="replace").splitlines()[-2:]}')
    for n in sizes:
        text = program(shell, n)
        ln = line(shell, text)
        t0 = time.time()
        echoed = write_all(fd, ln.encode())
        tw = time.time() - t0
        out, m = read_until(fd, rb'GOT=(\d+) PS=([0-9 ]*)', int(os.environ.get('LIMIT', '120')), echoed[-4096:])
        dt = time.time() - t0
        print(f'== {shell} E n={n} line={len(ln)}: {m.group(0).decode() if m else "NO ANSWER tail " + repr(out[-160:])} after {dt:.2f}s (typing {tw:.2f}s)')
        settle(fd, 500)
        if not m:
            break
    stop(pid, fd)

def probe_history(shell):
    d = tempfile.mkdtemp()
    hf = os.path.join(d, 'h')
    env = {}
    if shell == 'fish':
        env['XDG_DATA_HOME'] = d
        hf = os.path.join(d, 'fish', 'fish_history')
    else:
        env['HISTFILE'] = hf
    pid, fd = start(shell, env)
    setup = {'zsh': 'setopt INC_APPEND_HISTORY', 'bash': "PROMPT_COMMAND='history -a'; HISTCONTROL=", 'fish': 'true'}[shell]
    off = {'zsh': 'unset HISTFILE', 'bash': 'unset HISTFILE', 'fish': "set -g fish_history ''"}[shell]
    for l in [setup, 'echo plain1', ' echo spaced1', 'echo plain2', ' ' + off, 'echo after1', ' echo after2']:
        os.write(fd, (l + '\r').encode())
        settle(fd, 400)
    time.sleep(0.5)
    try:
        saved = open(hf).read()
    except OSError as e:
        saved = f'<{e.__class__.__name__}>'
    kept = [w for w in ['plain1', 'spaced1', 'plain2', 'HISTFILE', 'fish_history', 'after1', 'after2'] if w in saved]
    print(f'== {shell} H saved: {kept}')
    stop(pid, fd)

sizes = [int(s) for s in os.environ.get('SIZES', '4096 65536 262144 1048576').split()]
for s in sys.argv[1:] or ['bash', 'zsh', 'fish']:
    if not shutil.which(s):
        print(f'== {s}: absent')
        continue
    probe_eval(s, sizes)
    probe_history(s)
