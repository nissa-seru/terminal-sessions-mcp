set -u
echo "uname: $(uname -s); sudo: $(sudo -V 2>/dev/null | head -1)"
sudo -n true 2>/dev/null && echo "sudo -n: ok" || { echo "sudo -n: refused"; exit 0; }
# A job shell, as a session's shell would be, that starts sudo in the background.
python3 - <<'EOF'
import os, pty, subprocess, time, signal
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", "--norc", "--noprofile", "-i"])
time.sleep(0.5)
os.write(fd, b"sudo -n sleep 300 &\r")
time.sleep(2.0)
def kids(p):
    out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,pgid=,uid=,comm="], capture_output=True, text=True).stdout
    rows = [l.split(None, 4) for l in out.strip().splitlines()]
    by = {}
    for r in rows:
        by.setdefault(int(r[1]), []).append(r)
    res, todo = [], [p]
    while todo:
        for r in by.get(todo.pop(), []):
            res.append(r); todo.append(int(r[0]))
    return res
d = kids(pid)
for r in d:
    print("descendant pid=%s ppid=%s pgid=%s uid=%s %s" % tuple(r))
for g in sorted({int(r[2]) for r in d}):
    try:
        os.killpg(g, signal.SIGKILL)
        print("killpg", g, "ok")
    except OSError as e:
        print("killpg", g, "error", e.errno, os.strerror(e.errno))
time.sleep(0.5)
print("left:", [" ".join(r) for r in kids(pid)])
subprocess.run(["sudo", "-n", "pkill", "-f", "sleep 300"])
os.kill(pid, 9)
EOF
