import os, pty, select, subprocess, sys, time

def drive(argv, steps, env=None):
    pid, fd = pty.fork()
    if pid == 0:
        e = dict(os.environ, **(env or {}))
        os.execvpe(argv[0], argv, e)
    out = b""
    def pump(t):
        nonlocal out
        end = time.time() + t
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try:
                    out += os.read(fd, 65536)
                except OSError:
                    return
    pump(2.0)
    for s in steps:
        if isinstance(s, (int, float)):
            pump(s)
        else:
            os.write(fd, s)
    pump(1.5)
    try:
        os.kill(pid, 9)
    except OSError:
        pass
    return out.decode("utf8", "replace")

import re
def show(name, text, keys):
    clean = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\r", "", text)
    found = {k: (k in clean) for k in keys}
    print(f"{name}: {found}")
    print("   tail:", repr(clean[-500:]))

fish = subprocess.run(["fish", "--version"], capture_output=True, text=True).stdout.strip() if subprocess.run(["sh", "-c", "command -v fish"], capture_output=True).returncode == 0 else ""
print("fish:", fish or "none")
bashv = subprocess.run(["bash", "--version"], capture_output=True, text=True).stdout.splitlines()[0]
print("bash:", bashv)

if fish:
    # A: history append, in an interactive session
    t = drive(["fish", "--no-config", "-i"], [b"history append -- 'echo APPENDED_PROBE'\r", 0.5, b"history search --max 1 | string replace APPENDED_PROBE SEEN_APPENDED\r", 1.0])
    show("A history append", t, ["SEEN_APPENDED", "Unknown", "unknown option", "Expected"])
    # B: a C-c between two commands of a fish_postexec handler
    setup = b"function __p --on-event fish_postexec; set -q __arm; or return; set -e __arm; set -g a 1; for i in (seq 1 300000); set -l x $i; end; set -g b 1; end\r"
    t = drive(["fish", "--no-config", "-i"], [setup, 1.0, b"set -g __arm 1\r", 0.4, b"\x03", 4.0, b"functions -e __p; echo B_A=$a B_B=$b\r", 0.8])
    show("B postexec C-c, plain", t, ["B_A=1 B_B=1", "B_A=1 B_B=\n", "B_A= B_B="])
    # C: the same with an empty SIGINT handler defined around the second half
    setup = b"function __p --on-event fish_postexec; set -q __arm; or return; set -e __arm; set -g a 1; function __noint --on-signal SIGINT; end; for i in (seq 1 300000); set -l x $i; end; set -g b 1; functions -e __noint; end\r"
    t = drive(["fish", "--no-config", "-i"], [setup, 1.0, b"set -g __arm 1\r", 0.4, b"\x03", 4.0, b"functions -e __p; echo C_A=$a C_B=$b\r", 0.8])
    show("C postexec C-c, SIGINT handler", t, ["C_A=1 C_B=1", "C_A=1 C_B=\n"])

# D: bash, a user's INT trap read in a command substitution, then ignored and restored around a sleep, and a C-c during it
rc = "trap 'echo USER_TRAP_RAN' INT\n__h() { local t; t=$(builtin trap -p INT); builtin trap '' INT; sleep 1; echo HOOK_DONE; builtin eval \"${t:-builtin trap - INT}\"; }\nPROMPT_COMMAND=__h\n"
open("/tmp/probe-rc", "w").write(rc)
t = drive(["bash", "--norc", "--noprofile", "-i"], [b". /tmp/probe-rc\r", 2.0, b"true\r", 0.4, b"\x03", 2.0, b"echo D_TRAP=[$(trap -p INT)]\r", 2.0])
show("D bash", t, ["HOOK_DONE", "D_TRAP=[trap -- 'echo USER_TRAP_RAN' SIGINT]", "D_TRAP=[]"])

if subprocess.run(["sh", "-c", "command -v zsh"], capture_output=True).returncode == 0:
    rc = "trap 'echo USER_TRAP_RAN' INT\n__h() { setopt localoptions localtraps; trap '' INT; sleep 1; echo HOOK_DONE }\nprecmd_functions+=(__h)\n"
    open("/tmp/probe-zrc", "w").write(rc)
    t = drive(["zsh", "-f", "-i"], [b". /tmp/probe-zrc\r", 2.0, b"true\r", 0.4, b"\x03", 2.0, b"echo \"E_TRAP=[$(trap)]\"\r", 2.0])
    show("E zsh", t, ["HOOK_DONE", "E_TRAP=[trap -- 'echo USER_TRAP_RAN' INT]", "E_TRAP=[]"])
print("--- done")
