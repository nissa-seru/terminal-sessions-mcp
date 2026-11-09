trap '' INT
PATH=/usr/bin:/bin:$PATH
f=$1
m=$(stty -g 2>/dev/null) || exit 0
stty -icanon min 0 time 0 2>/dev/null || { stty "$m" 2>/dev/null; exit 0; }
dd bs=65536 count=1 2>/dev/null > "$f"
if [ -s "$f" ]; then
  stty min 0 time 1 2>/dev/null
  while :; do
    n=$(wc -c < "$f")
    dd bs=65536 count=1 2>/dev/null >> "$f"
    [ $(($(wc -c < "$f"))) -gt $((n)) ] && [ $((n)) -lt 1048576 ] || break
  done
fi
stty "$m" 2>/dev/null
if [ ! -s "$f" ]; then rm -f "$f"; fi
