#!/usr/bin/env bash
# Instala o agente da Central de Backup a partir de uma cópia deste repositório.
# Uso (no servidor do cliente, como root):
#   sudo ./apps/agent/install/install.sh            # executado de dentro de central-backup/
# Depois registre com o comando mostrado no painel e inicie o serviço.
#
# Não baixa nada de terceiros além das dependências npm do próprio agente (package-lock).
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEST=/opt/central-agent
STATE=/var/lib/central-agent

[ "$(id -u)" -eq 0 ] || { echo "Execute como root (sudo)." >&2; exit 1; }
[ -f "$SRC/package.json" ] && [ -d "$SRC/apps/agent" ] || { echo "Execute a partir de uma cópia de central-backup/." >&2; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 22.18 não encontrado. Instale (ex.: pacote oficial do NodeSource ou nvm) e rode de novo." >&2
  exit 1
fi
NODE_OK=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=18)?1:0)')
[ "$NODE_OK" = 1 ] || { echo "Node.js $(node -v) é antigo: o agente precisa de >= 22.18." >&2; exit 1; }
# backup: restic >= 0.17 (--stdin-from-command). O Ubuntu 24.04 traz 0.16; use o binário oficial.
if command -v restic >/dev/null 2>&1; then
  RV=$(restic version 2>/dev/null | awk '{print $2}')
  case "$RV" in 0.1[0-6].*|0.[0-9].*) echo "Aviso: restic $RV é antigo; backups de banco exigem >= 0.17 (veja docs/central-backup/fase-3.md)." >&2 ;; esac
else
  echo "Aviso: restic não encontrado; o agente não conseguirá fazer backups (veja docs/central-backup/fase-3.md)." >&2
fi
for cmd in lsblk df systemctl; do command -v "$cmd" >/dev/null 2>&1 || echo "Aviso: '$cmd' não encontrado; a seção correspondente do inventário ficará indisponível." >&2; done

id central-agent >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin central-agent
install -d -m 0755 "$DEST"
install -d -m 0700 -o central-agent -g central-agent "$STATE"

# somente o necessário para o agente: pacotes compartilhados e apps/agent
rm -rf "$DEST/packages" "$DEST/apps"
mkdir -p "$DEST/apps"
cp -r "$SRC/packages" "$DEST/packages"
cp -r "$SRC/apps/agent" "$DEST/apps/agent"
cp "$SRC/package.json" "$SRC/package-lock.json" "$DEST/"
rm -rf "$DEST/packages/database/migrations"
(cd "$DEST" && npm ci --omit=dev --workspace=@central/agent --no-audit --no-fund)
chown -R root:root "$DEST"

cat > /usr/local/bin/central-agent <<'WRAP'
#!/usr/bin/env bash
# Executa o agente sempre como o usuário central-agent (os arquivos de estado pertencem a ele).
export CENTRAL_AGENT_DIR=/var/lib/central-agent NODE_NO_WARNINGS=1
if [ "$(id -u)" -eq 0 ]; then exec runuser -u central-agent -- node /opt/central-agent/apps/agent/src/main.ts "$@"; fi
exec node /opt/central-agent/apps/agent/src/main.ts "$@"
WRAP
chmod 0755 /usr/local/bin/central-agent

install -m 0644 "$SRC/apps/agent/install/central-agent.service" /etc/systemd/system/central-agent.service

# pgBackRest (opcional): unidade auxiliar que roda como postgres + regra polkit que deixa o agente
# iniciar SOMENTE central-pgbackrest@<stanza>.<tipo>.service. Requer polkit com regras JS (>= 0.106).
if command -v pgbackrest >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  chmod 0755 "$DEST/apps/agent/install/pgbackrest-run.sh"
  install -m 0644 "$SRC/apps/agent/install/central-pgbackrest@.service" /etc/systemd/system/central-pgbackrest@.service
  if [ -d /etc/polkit-1/rules.d ]; then
    install -m 0644 "$SRC/apps/agent/install/49-central-pgbackrest.rules" /etc/polkit-1/rules.d/49-central-pgbackrest.rules
    echo "pgBackRest: unidade auxiliar e regra polkit instaladas."
  else
    echo "Aviso: polkit sem /etc/polkit-1/rules.d (versão antiga); o agente não poderá disparar o pgBackRest (veja docs/central-backup/fase-8.md)." >&2
  fi
fi
systemctl daemon-reload

echo
echo "Agente instalado em $DEST."
echo "1) Registre com o comando mostrado no painel (sudo central-agent enroll --url ... --ca-sha256 ... --code ...)"
echo "2) Inicie: sudo systemctl enable --now central-agent"
echo "3) Acompanhe: journalctl -u central-agent -f"
