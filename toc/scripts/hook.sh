#!/usr/bin/env bash
# Hook Stop do toc. Só abre o Node (lento no Windows) quando há um laço nesta pasta ou acima:
# um cd para uma subpasta não pode desligar o laço sem ninguém perceber.
# Uso: bash hook.sh [caminho do node]
d=$PWD
while [ -n "$d" ]; do
  if [ -f "$d/.claude/toc/estado.json" ]; then
    exec "${1:-node}" "$(dirname "$0")/toc.mjs" hook
  fi
  d=${d%/*}
done
exit 0
