#!/usr/bin/env python3
"""How long each shell's line editor takes to read one typed line of growing length and run it.

The line is `: yyyy...; echo B''DONE`, typed whole into the shell's terminal while echo is read back, and
timed until BDONE comes. Sizes double until one takes longer than STOP seconds. Each shell starts
without the user's startup files. Times are a probe's, not a test's.
"""
import fcntl, os, pty, re, select, shutil, sys, time

STOP = float(os.environ.get('STOP', '15'))

def spawn(argv):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update({'TERM': 'xterm-256color', 'PS1': '$ '})
        os.execvp(argv[0], argv)
    return pid, fd

def settle(fd, ms=700):
    while True:
        r, _, _ = select.select([fd], [], [], ms / 1000)
        if not r:
            return
        try:
            if not os.read(fd, 1 << 20):
                return
        except OSError:
            return

def timed(fd, line, limit):
    """Writes `line` while reading, then reads until BDONE; returns seconds, or None past `limit`."""
    fl = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
    data = line.encode()
    tail = b''
    t0 = time.time()
    try:
        while time.time() - t0 < limit:
            r, w, _ = select.select([fd], [fd] if data else [], [], 0.2)
            if r:
                try:
                    tail = (tail + os.read(fd, 1 << 20))[-64:]
                except BlockingIOError:
                    pass
                if b'BDONE' in tail:
                    return time.time() - t0
            if w and data:
                try:
                    data = data[os.write(fd, data[:4096]):]
                except BlockingIOError:
                    pass
        return None
    finally:
        fcntl.fcntl(fd, fcntl.F_SETFL, fl)

ARGV = {'bash': ['bash', '--norc', '--noprofile', '-i'], 'zsh': ['zsh', '-f', '-i'], 'fish': ['fish', '--no-config', '-i']}
VERSION = {'bash': 'echo "$BASH_VERSION"', 'zsh': 'echo "$ZSH_VERSION"', 'fish': 'echo "$FISH_VERSION"'}

for shell in sys.argv[1:] or ['bash', 'zsh', 'fish']:
    if not shutil.which(shell):
        print(f'== {shell}: absent', flush=True)
        continue
    pid, fd = spawn(ARGV[shell])
    settle(fd, 1500)
    os.write(fd, (VERSION[shell] + '\r').encode())
    settle(fd)
    n = 1024
    while n <= 262144:
        s = timed(fd, ': ' + 'y' * n + "; echo B''DONE\r", STOP)
        print(f'== {shell} line={n}: {"over %.0fs" % STOP if s is None else "%.2fs" % s}', flush=True)
        if s is None:
            break
        settle(fd, 300)
        n *= 2
    try:
        os.kill(pid, 9)
    except OSError:
        pass
