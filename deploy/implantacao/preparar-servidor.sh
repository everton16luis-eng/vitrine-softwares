#!/usr/bin/env bash
# Prepara um servidor Ubuntu/Debian para a Central de Implantação.
#
#   sudo bash deploy/implantacao/preparar-servidor.sh [--sem-agente]
#
# O que este script FAZ (somente isto):
#   1. cria o usuário de sistema "implantador" (sem login), que executa o agente;
#   2. cria /srv/clientes (instalações dos clientes) e /var/www/vitrine-acme (validação do SSL);
#   3. instala o auxiliar root e a política em /usr/local/lib/vitrine-implantacao (somente leitura);
#   4. cria UMA regra de sudoers que permite ao "implantador" chamar apenas esse auxiliar
#      (validada com visudo antes de ser ativada);
#   5. instala e inicia o serviço systemd "vitrine-implantacao-agente" (exceto com --sem-agente).
#
# O que este script NÃO faz: não instala pacotes, não altera o Nginx, o PostgreSQL, o firewall,
# portas ou serviços existentes, e não reinicia nenhuma aplicação. Os requisitos que faltarem são
# apenas informados. Pode ser executado de novo com segurança (por exemplo, após atualizar o código).
set -euo pipefail

AGENT_USER="implantador"
LIB_DIR="/usr/local/lib/vitrine-implantacao"
BASE_DIR="/srv/clientes"
ACME_DIR="/var/www/vitrine-acme"
SUDOERS_FILE="/etc/sudoers.d/vitrine-implantacao"
UNIT_FILE="/etc/systemd/system/vitrine-implantacao-agente.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WITH_AGENT=1
[[ "${1:-}" == "--sem-agente" ]] && WITH_AGENT=0

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Execute como root (sudo)."
[[ -r /etc/debian_version ]] || fail "Este script suporta apenas Ubuntu/Debian."
[[ -f "$PROJECT_DIR/backend/src/modules/deployments/policy.js" ]] || fail "Projeto não encontrado em $PROJECT_DIR."

# ---------------------------------------------------------------- Node.js
NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || fail "Node.js não encontrado no PATH do root. Instale o Node.js 20+ do sistema (ex.: NodeSource)."
NODE_BIN="$(readlink -f "$NODE_BIN")"
case "$NODE_BIN" in
  /home/*|/root/*) fail "O Node.js em $NODE_BIN está no diretório de um usuário (nvm?). Use uma instalação do sistema (/usr/bin/node)." ;;
esac
# O binário chamado via sudo precisa pertencer ao root e não poder ser alterado por outros usuários.
[[ "$(stat -c %u "$NODE_BIN")" == "0" ]] || fail "$NODE_BIN não pertence ao root."
[[ "$(stat -c %A "$NODE_BIN" | cut -c6,9)" == "--" ]] || fail "$NODE_BIN pode ser alterado por outros usuários."
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || fail "Node.js 20+ é necessário (encontrado: $("$NODE_BIN" -v))."
info "Node.js: $NODE_BIN ($("$NODE_BIN" -v))"

# ---------------------------------------------------------------- requisitos (apenas verificação)
missing=()
for cmd in git nginx certbot runuser visudo psql pg_dump; do command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd"); done
id postgres >/dev/null 2>&1 || missing+=("usuário postgres (PostgreSQL local)")
if ((${#missing[@]})); then
  warn "Itens ausentes (instale-os antes da primeira implantação): ${missing[*]}"
  warn "Sugestão: apt-get install git nginx certbot postgresql postgresql-client"
fi
systemctl is-active --quiet certbot.timer 2>/dev/null || [[ -f /etc/cron.d/certbot ]] || warn "Renovação automática do certbot não detectada (certbot.timer)."

# ---------------------------------------------------------------- usuário e diretórios
if id "$AGENT_USER" >/dev/null 2>&1; then
  info "Usuário $AGENT_USER já existe."
else
  useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin --comment "Central de Implantacao (agente)" "$AGENT_USER"
  info "Usuário $AGENT_USER criado."
fi
install -d -o root -g root -m 0755 "$BASE_DIR"
install -d -o root -g root -m 0755 "$ACME_DIR"
info "Diretórios $BASE_DIR e $ACME_DIR prontos."

# ---------------------------------------------------------------- auxiliar root (somente leitura)
install -d -o root -g root -m 0755 "$LIB_DIR"
install -o root -g root -m 0644 "$SCRIPT_DIR/helper.mjs" "$LIB_DIR/helper.mjs"
install -o root -g root -m 0644 "$PROJECT_DIR/backend/src/modules/deployments/policy.js" "$LIB_DIR/policy.mjs"
"$NODE_BIN" -e "import('$LIB_DIR/helper.mjs').then((m) => { if (!m.OPERACOES?.length) process.exit(1); })" || fail "O auxiliar instalado não pôde ser carregado."
info "Auxiliar instalado em $LIB_DIR."

# ---------------------------------------------------------------- sudoers (uma única regra)
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cat > "$tmp" <<EOF
# Central de Implantação: o agente só pode chamar o auxiliar root (que tem lista fechada de operações).
Defaults:$AGENT_USER !requiretty, env_reset
$AGENT_USER ALL=(root) NOPASSWD: $NODE_BIN $LIB_DIR/helper.mjs *
EOF
visudo -cf "$tmp" >/dev/null || fail "A regra de sudoers gerada é inválida; nada foi alterado."
install -o root -g root -m 0440 "$tmp" "$SUDOERS_FILE"
info "Regra de sudoers instalada em $SUDOERS_FILE."

# ---------------------------------------------------------------- serviço do agente
if (( WITH_AGENT )); then
  [[ -f "$PROJECT_DIR/.env" ]] || warn "$PROJECT_DIR/.env não encontrado: o agente usa a mesma configuração (banco, APP_SECRET/IMPLANTACAO_CHAVE) do site."
  if ! runuser -u "$AGENT_USER" -- test -r "$PROJECT_DIR/backend/src/agent/agent.js"; then
    warn "O usuário $AGENT_USER não consegue ler $PROJECT_DIR. Conceda leitura, por exemplo:"
    warn "  chgrp -R $AGENT_USER $PROJECT_DIR && chmod -R g+rX $PROJECT_DIR"
  fi
  if [[ -f "$PROJECT_DIR/.env" ]] && ! runuser -u "$AGENT_USER" -- test -r "$PROJECT_DIR/.env"; then
    warn "O usuário $AGENT_USER não consegue ler $PROJECT_DIR/.env. Sugestão: chgrp $AGENT_USER $PROJECT_DIR/.env && chmod 640 $PROJECT_DIR/.env"
  fi
  sed -e "s#@PROJECT_DIR@#$PROJECT_DIR#g" -e "s#@NODE_BIN@#$NODE_BIN#g" -e "s#@AGENT_USER@#$AGENT_USER#g" -e "s#@LIB_DIR@#$LIB_DIR#g" \
    "$SCRIPT_DIR/vitrine-implantacao-agente.service" > "$tmp"
  install -o root -g root -m 0644 "$tmp" "$UNIT_FILE"
  systemctl daemon-reload
  systemctl enable --quiet vitrine-implantacao-agente.service
  systemctl restart vitrine-implantacao-agente.service
  info "Agente ativo: systemctl status vitrine-implantacao-agente  ·  logs: journalctl -u vitrine-implantacao-agente -f"
fi

cat <<EOF

Pronto. Próximos passos:
  - No .env do site, defina IMPLANTACAO_IPS com o(s) IP(s) públicos deste servidor e IMPLANTACAO_EMAIL_SSL.
  - Recomendado: defina IMPLANTACAO_CHAVE (32+ caracteres aleatórios) e guarde uma cópia segura.
  - Cadastre a receita do software no painel (Implantação › Receitas por software).
  - Sempre que atualizar o código do painel, execute este script de novo para atualizar o auxiliar.
EOF
