#!/bin/sh
# Does a background subshell of an interactive zsh keep the shell's ignored SIGHUP? Prints SigIgn masks (bit 0 is HUP).
for shell in zsh bash; do
  command -v $shell >/dev/null || continue
  echo "== $shell"
  $shell -i -c "trap '' HUP; grep SigIgn /proc/\$\$/status | sed 's/^/shell /'; (sh -c 'grep SigIgn /proc/\$PPID/status | sed \"s/^/subshell /\"; grep SigIgn /proc/\$\$/status | sed \"s/^/its child /\"') & wait" 2>&1 | grep -E 'shell|child'
done
