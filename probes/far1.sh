#!/bin/bash
# Probe for a far shell's hooks: what each shell's printf '%b' decodes, whether one probe line
# parses in bash, zsh and fish, and what bash's PIPESTATUS shows after eval of a pipeline.
# Output is passed through od so control bytes show.
for s in bash zsh fish; do
  command -v $s >/dev/null || { echo "== $s: absent"; continue; }
  case $s in
    bash) v=$(bash -c 'echo $BASH_VERSION') ;;
    zsh) v=$(zsh -c 'echo $ZSH_VERSION') ;;
    fish) v=$(fish -c 'echo $FISH_VERSION') ;;
  esac
  echo "== $s $v"
  echo "-- probe line"
  $s -c "printf '\\033]133;K;%s;%s;%s;%s\\007' 1.23 \"\$FISH_VERSION\" \"\$ZSH_VERSION\" \"\$BASH_VERSION\"" 2>&1 | od -c | head -4
  echo "-- %b with \\101 and \\0101 and \\x41 and \\\\ and ~"
  $s -c "printf '%b|' '\\101' '\\0101' '\\x41' 'a\\\\b' '~x' '\\012'" 2>&1 | od -c | head -3
done
echo "== bash PIPESTATUS after eval"
bash -c 'eval "false | true"; echo "eval: ${PIPESTATUS[*]} st=$?"'
bash -c 'x=$(printf "%b" "false | true | (exit 3)"); eval "$x"; echo "eval decoded: ${PIPESTATUS[*]}"'
bash -c 'f() { eval "$1"; }; f "false | true"; echo "in function: ${PIPESTATUS[*]}"'
echo "== script"
command -v script && script --version 2>&1 | head -1
