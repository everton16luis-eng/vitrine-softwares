#!/bin/bash
# Executado pela unidade central-pgbackrest@<stanza>.<tipo>.service como postgres.
# Grava em /var/lib/central-pgbackrest/<instância>/: rc (código do backup), check, info.json, stderr.
set -uo pipefail
inst="${1:-}"
if [[ ! "$inst" =~ ^([A-Za-z0-9][A-Za-z0-9_.-]{0,62})\.(full|diff|incr|info)$ ]]; then echo "instância inválida: $inst" >&2; exit 2; fi
stanza="${BASH_REMATCH[1]}"
kind="${BASH_REMATCH[2]}"
base="${STATE_DIRECTORY:-/var/lib/central-pgbackrest}"
out="$base/$inst"
rm -rf "$out"
mkdir -m 0755 "$out"
rc=0
if [ "$kind" != "info" ]; then
  pgbackrest --stanza="$stanza" --type="$kind" --log-level-console=warn backup 2>"$out/stderr" || rc=$?
fi
if pgbackrest --stanza="$stanza" --log-level-console=warn check 2>"$out/check.err"; then
  echo ok > "$out/check"
else
  tail -c 800 "$out/check.err" > "$out/check"
fi
pgbackrest --stanza="$stanza" --output=json info > "$out/info.json" 2>>"$out/stderr" || true
echo "$rc" > "$out/rc"
chmod 0644 "$out"/*
exit "$rc"
