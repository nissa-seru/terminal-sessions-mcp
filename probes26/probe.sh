set -u
docker pull -q ubuntu:26.04 > /dev/null || { echo "no ubuntu:26.04 image"; exit 1; }
nodedir=$(dirname "$(dirname "$(command -v node)")")
docker run --rm -v "$PWD":/w -v "$nodedir":/nodejs -w /w ubuntu:26.04 bash -c '
  apt-get update -qq > /dev/null 2>&1 && apt-get install -y -qq python3 zsh fish procps > /dev/null 2>&1 || echo "apt failed"
  echo "stty: $(stty --version 2>&1 | head -1); dd: $(dd --version 2>&1 | head -1); sh: $(readlink -f /bin/sh)"
  cat > /tmp/steps.sh <<"EOF"
sleep 1
m=$(stty -g); echo "stty -g rc=$? m=[$m]"
stty -icanon min 0 time 0; echo "stty -icanon min 0 time 0 rc=$?"
stty -a | tr "\n" " " | grep -o "min = [0-9]*; time = [0-9]*\|-\?icanon" | tr "\n" " "; echo
dd bs=65536 count=1 > /tmp/out 2>/tmp/dd.err; echo "dd rc=$? out=$(wc -c < /tmp/out) err=[$(cat /tmp/dd.err | tr "\n" " ")]"
stty "$m"; echo "stty restore rc=$?"
EOF
  python3 - <<"EOF"
import pty, os, time, select
def drive(argv, typed):
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(argv[0], argv)
    time.sleep(0.3)
    os.write(fd, typed)
    out = b""
    end = time.time() + 6
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                d = os.read(fd, 65536)
            except OSError:
                break
            if not d: break
            out += d
        else:
            p, _ = os.waitpid(pid, os.WNOHANG)
            if p: break
    try: os.kill(pid, 9); os.waitpid(pid, 0)
    except Exception: pass
    return out.decode(errors="replace")
print("--- steps (typed: echo TYPEAHEAD + newline)")
print(drive(["sh", "/tmp/steps.sh"], b"echo TYPEAHEAD\n"))
print("--- drain.sh as shipped (typed partial: echo PARTIAL)")
open("/tmp/d.sh", "w").write(open("/w/probes26/drain.sh").read())
print(drive(["sh", "-c", "sleep 1; sh /tmp/d.sh /tmp/f; echo rc=$?; ls -l /tmp/f 2>&1; cat -A /tmp/f 2>/dev/null; echo"], b"echo PARTIAL"))
print("--- drain.sh with sh -x")
print(drive(["sh", "-c", "sleep 1; sh -x /tmp/d.sh /tmp/g 2>&1; echo rc=$?"], b"echo PARTIAL2"))
EOF
  export PATH=/nodejs/bin:$PATH
  TSM_SHELLS=bash,zsh,fish perl -e "alarm shift; exec @ARGV" 300 node --test --test-reporter=spec --test-name-pattern="typed ahead" next/dist/spec/live-session.spec.js > /tmp/live.txt 2>&1
  echo "live spec exit $?"
  grep -E "^ℹ (tests|pass|fail|skipped)" /tmp/live.txt | tr "\n" " "; echo
  grep -E "✖" /tmp/live.txt | sort | uniq -c | head -12
'
