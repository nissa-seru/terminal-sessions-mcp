# Which of a shell's jobs outlive its hangup, and what a listing by terminal or session sees of them
# before and after the shell is gone. Usage: python3 probes/hup.py [SHELL]
import json, os, pty, re, select, signal, subprocess, sys, time

LINUX = sys.platform.startswith('linux')
SHELL = sys.argv[1] if len(sys.argv) > 1 else '/bin/bash'


def stat(pid):
    if LINUX:
        try:
            s = open(f'/proc/{pid}/stat').read()
        except (FileNotFoundError, ProcessLookupError):
            return None
        f = s[s.rindex(')') + 2:].split(' ')
        return dict(state=f[0], ppid=int(f[1]), pgrp=int(f[2]), sid=int(f[3]), tty_nr=int(f[4]), tpgid=int(f[5]))
    r = subprocess.run(['ps', '-o', 'pid=,ppid=,pgid=,sess=,tty=,tdev=,tpgid=,stat=,command=', '-p', str(pid)], capture_output=True, text=True)
    return r.stdout.strip() or None


def read_until(fd, pat, timeout=10):
    buf = b''
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                buf += os.read(fd, 65536)
            except OSError:
                break
            if re.search(pat, buf):
                return buf
    return buf


pid, fd = pty.fork()
if pid == 0:
    os.environ['PS1'] = 'P> '
    os.execv(SHELL, [SHELL, '--norc', '--noprofile', '-i'] if SHELL.endswith('bash') else [SHELL, '-i'])

read_until(fd, rb'P> ')
cmds = [
    ('normal', 'sleep 601 & echo J=normal:$!'),
    ('disowned', 'sleep 602 & echo J=disowned:$!; disown'),
    ('doublefork', '(sleep 603 & echo J=doublefork:$!)'),
    # a job leads its own group, and setsid() refuses a group leader, so fork first, as setsid(1) does
    ('setsid', "python3 -c 'import os,sys,time; os.fork() and sys.exit(0); os.setsid(); print(\"J=setsid:%d\" % os.getpid(), flush=True); time.sleep(604)' &"),
    ('nohup', 'nohup sleep 605 >/dev/null 2>&1 & echo J=nohup:$!'),
    ('stopped_disowned', 'sleep 606 & p=$!; kill -STOP $p; echo J=stopped_disowned:$p; disown'),
]
jobs = {}
for name, c in cmds:
    os.write(fd, (c + '\n').encode())
    out = read_until(fd, rb'J=' + name.encode() + rb':(\d+)')
    m = re.search(rb'J=' + name.encode() + rb':(\d+)', out)
    jobs[name] = int(m.group(1)) if m else None
    read_until(fd, rb'P> ', 2)
time.sleep(0.5)

shell_tty = None
if not LINUX:
    shell_tty = subprocess.run(['ps', '-o', 'tty=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()

report = {'platform': sys.platform, 'shell': SHELL, 'shell_pid': pid, 'shell_stat': stat(pid), 'shell_tty': shell_tty, 'jobs': jobs, 'before': {k: stat(v) for k, v in jobs.items() if v}}
if not LINUX:
    for args in (['-t', shell_tty], ['-t', shell_tty.replace('tty', '')]):
        r = subprocess.run(['ps', *args, '-o', 'pid=,pgid=,command='], capture_output=True, text=True)
        report['ps ' + ' '.join(args)] = {'rc': r.returncode, 'out': r.stdout.strip().splitlines(), 'err': r.stderr.strip()}
else:
    # every process on the shell's terminal, by tty_nr, and every process in its session, by sid
    sh = stat(pid)
    on_tty, in_sess = [], []
    for d in os.listdir('/proc'):
        if d.isdigit():
            s = stat(int(d))
            if s and s['tty_nr'] == sh['tty_nr']:
                on_tty.append(int(d))
            if s and s['sid'] == sh['sid']:
                in_sess.append(int(d))
    report['on_tty'] = sorted(on_tty)
    report['in_session'] = sorted(in_sess)

t0 = time.time()
os.kill(pid, signal.SIGHUP)
_, status = os.waitpid(pid, 0)
report['shell_exit'] = {'status': status, 'ms': round((time.time() - t0) * 1000)}
time.sleep(1.0)
report['after_1s'] = {k: stat(v) for k, v in jobs.items() if v}
if LINUX:
    in_sess = [int(d) for d in os.listdir('/proc') if d.isdigit() and (stat(int(d)) or {}).get('sid') == pid]
    report['in_session_after'] = sorted(in_sess)
for v in jobs.values():
    if v:
        for s in (signal.SIGKILL,):
            try:
                os.kill(v, s)
            except ProcessLookupError:
                pass
print(json.dumps(report, indent=1))
