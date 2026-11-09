#!/usr/bin/env python3
"""Probe, in a real terminal, two ways to give a shell a command's text without files.

A: a function sets the terminal raw without echo, prints a ready mark, and reads exactly N bytes
   with head -c; the probe writes the bytes only after the ready mark. Reports the length read,
   whether the bytes were echoed, and the terminal's modes after.
B: one typed line of 64 KiB through the line editor: how long until its command's output appears.
Each shell starts without the user's startup files. Times here are a probe's, not a test's.
"""
import os, pty, re, select, shutil, sys, time

def spawn(argv):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        os.environ['PS1'] = '$ '
        os.execvp(argv[0], argv)
    return pid, fd

def read_until(fd, pat, limit):
    buf = b''
    end = time.time() + limit
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                d = os.read(fd, 65536)
            except OSError:
                break
            if not d:
                break
            buf += d
            if re.search(pat, buf):
                return buf, True
    return buf, False

def settle(fd, ms=700):
    buf = b''
    while True:
        r, _, _ = select.select([fd], [], [], ms / 1000)
        if not r:
            return buf
        try:
            d = os.read(fd, 65536)
        except OSError:
            return buf
        if not d:
            return buf
        buf += d

FUNCS = {
    'bash': "__tsm_get() { local m; m=$(stty -g); stty raw -echo; printf '\\033]133;R;x\\007'; __tsm_x=$(head -c \"$1\"); stty \"$m\"; }",
    'zsh': "__tsm_get() { local m; m=$(stty -g); stty raw -echo; printf '\\033]133;R;x\\007'; __tsm_x=$(head -c \"$1\"); stty \"$m\"; }",
    'fish': "function __tsm_get; set -l m (stty -g); stty raw -echo; printf '\\e]133;R;x\\a'; set -g __tsm_x (head -c $argv[1] | string collect); stty $m; end",
}
LEN = {
    'bash': "printf 'LE''N=%s\\n' \"${#__tsm_x}\"; stty -a | grep -o -- '-\\?icanon' | sed 's/^/MO''DE=/'",
    'zsh': "printf 'LE''N=%s\\n' \"${#__tsm_x}\"; stty -a | grep -o -- '-\\?icanon' | sed 's/^/MO''DE=/'",
    'fish': "printf 'LE''N=%s\\n' (string length -- \"$__tsm_x\"); stty -a | grep -o -- '-\\?icanon' | sed 's/^/MO''DE=/'",
}
ARGV = {
    'bash': ['bash', '--norc', '--noprofile', '-i'],
    'zsh': ['zsh', '-f', '-i'],
    'fish': ['fish', '--no-config', '-i'],
}

def one(shell):
    if not shutil.which(shell):
        print(f'== {shell}: absent')
        return
    pid, fd = spawn(ARGV[shell])
    settle(fd, 1500)
    os.write(fd, (FUNCS[shell] + '\r').encode())
    settle(fd)
    for n in (2000, 70000):
        body = ('ab\\012~c' * (n // 7 + 1))[:n].encode()
        os.write(fd, f' __tsm_get {n}\r'.encode())
        out, ok = read_until(fd, rb'\x1b\]133;R;x\x07', 10)
        if not ok:
            print(f'== {shell} A n={n}: no ready mark; tail {out[-200:]!r}')
            continue
        t0 = time.time()
        os.write(fd, body)
        os.write(fd, (LEN[shell] + '\r').encode())
        out, ok = read_until(fd, rb'MODE=\S+', 20)
        m = re.search(rb'LEN=(\d+)', out)
        md = re.search(rb'MODE=(\S+)', out)
        echoed = b'ab\\012~c' * 3 in out
        print(f'== {shell} A n={n}: read {m.group(1).decode() if m else None}, echoed {echoed}, after {md.group(1).decode() if md else None}, {time.time() - t0:.2f}s')
        settle(fd, 300)
    for n in (4096, 65536):
        line = ': ' + 'a' * n + "; echo B''DONE\r"
        t0 = time.time()
        os.write(fd, line.encode())
        out, ok = read_until(fd, rb'BDONE', 120)
        print(f'== {shell} B n={n}: done {ok} after {time.time() - t0:.2f}s')
        settle(fd, 500)
    os.write(fd, b'exit\r')
    settle(fd, 500)
    try:
        os.kill(pid, 9)
    except OSError:
        pass

for s in sys.argv[1:] or ['bash', 'zsh', 'fish']:
    one(s)
