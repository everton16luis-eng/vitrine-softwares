-- Fase 1 — fundação: acesso, auditoria, clientes, servidores, agentes e fila de tarefas.
--
-- Isolamento entre clientes em duas camadas:
--   1. chaves estrangeiras compostas (id, client_id): o banco recusa ligar recursos de clientes diferentes;
--   2. Row Level Security: a aplicação conecta (ou faz SET ROLE) como "central_app", que não é dona das
--      tabelas, e cada transação declara app.client_scope ('*' ou lista de ids). Sem escopo, nada aparece.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_app') THEN CREATE ROLE central_app NOLOGIN; END IF;
  -- o usuário da conexão precisa poder fazer SET ROLE central_app (no PG16+, quem cria o papel sem
  -- ser superusuário recebe só ADMIN, sem SET)
  BEGIN
    IF current_setting('server_version_num')::int >= 160000 THEN
      EXECUTE format('GRANT central_app TO %I WITH SET TRUE', current_user);
    ELSE
      EXECUTE format('GRANT central_app TO %I', current_user);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'Não foi possível conceder central_app a %: %', current_user, SQLERRM;
  END;
END $$;

CREATE FUNCTION app_client_allowed(cid bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.client_scope', true), '') = '*'
      OR cid = ANY (string_to_array(nullif(nullif(current_setting('app.client_scope', true), ''), '*'), ',')::bigint[])
$$;

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ------------------------------------------------------------------ acesso
CREATE TABLE users (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             text NOT NULL,
  name              text NOT NULL CHECK (length(name) BETWEEN 2 AND 150),
  password_hash     text NOT NULL,
  totp_secret_enc   text,
  totp_enabled      boolean NOT NULL DEFAULT false,
  totp_last_counter bigint NOT NULL DEFAULT -1,
  status            text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'bloqueado', 'desativado')),
  failed_logins     int NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  last_login_at     timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mfa_recovery_codes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_mfa_recovery_user ON mfa_recovery_codes (user_id) WHERE used_at IS NULL;

CREATE TABLE roles (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]{3,40}$'),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  system      boolean NOT NULL DEFAULT false
);
CREATE TABLE permissions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+\.[a-z_]+$'),
  description text NOT NULL,
  grp         text NOT NULL
);
CREATE TABLE role_permissions (
  role_id       bigint NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id bigint NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_roles (
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  id              text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'), -- sha256 do token do cookie
  user_id         bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token      text NOT NULL,
  ip              inet,
  user_agent      text,
  mfa_verified_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX ix_sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

-- ------------------------------------------------------------------ clientes
CREATE TABLE clients (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legal_name   text NOT NULL CHECK (length(legal_name) BETWEEN 2 AND 200),
  trade_name   text,
  cnpj         text CHECK (cnpj ~ '^\d{14}$'),
  tech_contact text,
  email        text,
  phone        text,
  notes        text,
  status       text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'encerrado')),
  rpo_minutes  int CHECK (rpo_minutes > 0),
  rto_minutes  int CHECK (rto_minutes > 0),
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_clients_cnpj ON clients (cnpj) WHERE cnpj IS NOT NULL;
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_client_scopes (
  user_id   bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id bigint NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);

-- ------------------------------------------------------------------ servidores
CREATE TABLE servers (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id         uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_id         bigint NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,
  name              text NOT NULL,
  hostname          text,
  ip_addresses      inet[] NOT NULL DEFAULT '{}',
  os_name           text,
  os_version        text,
  arch              text,
  cpu_model         text,
  cpu_cores         int,
  memory_bytes      bigint,
  disks             jsonb NOT NULL DEFAULT '[]',
  storage_bytes     bigint,
  network           jsonb NOT NULL DEFAULT '[]',
  uptime_s          bigint,
  provider          text,
  notes             text,
  connection_status text NOT NULL DEFAULT 'sem_agente' CHECK (connection_status IN ('sem_agente', 'online', 'offline', 'degradado')),
  last_seen_at      timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  UNIQUE (client_id, name)
);
CREATE TRIGGER trg_servers_updated BEFORE UPDATE ON servers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE server_inventory (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id    bigint NOT NULL,
  client_id    bigint NOT NULL,
  collected_at timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  data         jsonb NOT NULL,
  hash         text NOT NULL,
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id) ON DELETE CASCADE
);
CREATE INDEX ix_inventory_server ON server_inventory (server_id, collected_at DESC);
CREATE UNIQUE INDEX ux_inventory_dedup ON server_inventory (server_id, hash);

-- ------------------------------------------------------------------ agentes
CREATE TABLE agents (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id         uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  server_id         bigint NOT NULL,
  client_id         bigint NOT NULL,
  version           text,
  protocol          int,
  status            text NOT NULL DEFAULT 'ativo' CHECK (status IN ('provisionando', 'ativo', 'revogado')),
  last_heartbeat_at timestamptz,
  clock_skew_s      int,
  pending_results   int NOT NULL DEFAULT 0,
  revoked_at        timestamptz,
  revoked_by        bigint REFERENCES users (id),
  revoked_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id) ON DELETE RESTRICT
);
-- no máximo um agente não revogado por servidor
CREATE UNIQUE INDEX ux_agents_server_active ON agents (server_id) WHERE status <> 'revogado';

CREATE TABLE agent_enrollment_codes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id   bigint NOT NULL,
  client_id   bigint NOT NULL,
  code_hash   text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  used_by_agent_id bigint REFERENCES agents (id),
  failed_attempts int NOT NULL DEFAULT 0,
  created_by  bigint REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id) ON DELETE CASCADE
);

CREATE TABLE agent_credentials (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id       bigint NOT NULL,
  client_id      bigint NOT NULL,
  cert_serial    text NOT NULL UNIQUE CHECK (cert_serial ~ '^[0-9a-f]+$'),
  cert_fingerprint text NOT NULL UNIQUE,
  not_before     timestamptz NOT NULL,
  not_after      timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_id, client_id) REFERENCES agents (id, client_id) ON DELETE CASCADE
);
CREATE INDEX ix_agent_credentials_agent ON agent_credentials (agent_id);

-- ------------------------------------------------------------------ fila de tarefas (fonte da verdade)
CREATE TABLE agent_task_queue (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id         uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  agent_id          bigint NOT NULL,
  client_id         bigint NOT NULL,
  operation         text NOT NULL,
  operation_version int NOT NULL,
  params            jsonb NOT NULL DEFAULT '{}',
  signature         text NOT NULL, -- Ed25519 da central sobre o conteúdo da tarefa (assinada na criação)
  signing_key_id    text NOT NULL,
  issued_at         timestamptz NOT NULL,
  idempotency_key   text NOT NULL UNIQUE,
  lock_key          text NOT NULL,
  status            text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'na_fila', 'aguardando_agente', 'executando', 'concluido', 'validando', 'validado', 'falhou', 'cancelado', 'restaurando')),
  priority          int NOT NULL DEFAULT 100,
  attempt           int NOT NULL DEFAULT 0,
  max_attempts      int NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  timeout_s         int NOT NULL,
  available_at      timestamptz NOT NULL DEFAULT now(),
  lease_until       timestamptz,
  expires_at        timestamptz NOT NULL,
  started_at        timestamptz,
  finished_at       timestamptz,
  result            jsonb,
  error             text,
  requested_by      bigint REFERENCES users (id),
  origin_type       text,
  origin_id         bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_id, client_id) REFERENCES agents (id, client_id) ON DELETE RESTRICT
);
-- uma tarefa ativa por recurso (evita execuções duplicadas); "pendente" espera o lock liberar
CREATE UNIQUE INDEX ux_task_lock_active ON agent_task_queue (lock_key) WHERE status IN ('na_fila', 'aguardando_agente', 'executando', 'restaurando');
CREATE INDEX ix_task_lock_waiting ON agent_task_queue (lock_key, priority, id) WHERE status = 'pendente';
CREATE INDEX ix_task_agent_ready ON agent_task_queue (agent_id, priority, available_at) WHERE status = 'na_fila';
CREATE INDEX ix_task_lease ON agent_task_queue (lease_until) WHERE status IN ('executando', 'restaurando');
CREATE INDEX ix_task_pending ON agent_task_queue (available_at) WHERE status IN ('pendente', 'aguardando_agente');
CREATE TRIGGER trg_task_updated BEFORE UPDATE ON agent_task_queue FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE agent_task_logs (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id   bigint NOT NULL REFERENCES agent_task_queue (id) ON DELETE CASCADE,
  client_id bigint NOT NULL,
  attempt   int NOT NULL,
  at        timestamptz NOT NULL,
  level     text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message   text NOT NULL
);
CREATE INDEX ix_task_logs_task ON agent_task_logs (task_id, id);

-- ------------------------------------------------------------------ chaves do sistema e configurações
CREATE TABLE system_keys (
  name        text PRIMARY KEY CHECK (name IN ('ca', 'gateway_tls', 'task_signing')),
  key_id      text NOT NULL,
  cert_pem    text,
  public_pem  text,
  private_enc text NOT NULL, -- cifrado pela KEK (envelope)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE task_signing_keys_history (
  key_id     text PRIMARY KEY,
  public_pem text NOT NULL,
  retired_at timestamptz
);
CREATE TABLE system_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by bigint REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ auditoria (append-only, encadeada)
CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('usuario', 'agente', 'sistema')),
  actor_id   bigint,
  ip         inet,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  client_id  bigint,
  details    jsonb NOT NULL DEFAULT '{}',
  prev_hash  text NOT NULL,
  hash       text NOT NULL
);
CREATE INDEX ix_audit_at ON audit_logs (at DESC);
CREATE INDEX ix_audit_entity ON audit_logs (entity, entity_id);
CREATE INDEX ix_audit_client ON audit_logs (client_id, at DESC);

CREATE FUNCTION audit_row_digest(prev text, r audit_logs) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|', prev, (extract(epoch FROM r.at) * 1000000)::bigint::text, r.actor_type,
    coalesce(r.actor_id::text, ''), coalesce(host(r.ip), ''), r.action, r.entity, coalesce(r.entity_id, ''),
    coalesce(r.client_id::text, ''), r.details::text), 'UTF8')), 'hex')
$$;

-- SECURITY DEFINER: enxerga toda a cadeia mesmo com RLS ativa para o papel da aplicação.
CREATE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE last text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs_chain'));
  SELECT hash INTO last FROM audit_logs ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := coalesce(last, repeat('0', 64));
  NEW.hash := audit_row_digest(NEW.prev_hash, NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_audit_chain BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_chain();

CREATE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs é somente inclusão: alterações e exclusões não são permitidas.'; END $$;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();

/** Primeiro registro cuja cadeia não confere (NULL = íntegra). */
CREATE FUNCTION audit_verify() RETURNS TABLE (broken_id bigint, checked bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r audit_logs; prev text := repeat('0', 64); n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit_logs ORDER BY id LOOP
    n := n + 1;
    IF r.prev_hash <> prev OR r.hash <> audit_row_digest(prev, r) THEN broken_id := r.id; checked := n; RETURN NEXT; RETURN; END IF;
    prev := r.hash;
  END LOOP;
  broken_id := NULL; checked := n; RETURN NEXT;
END $$;

-- ------------------------------------------------------------------ RLS e privilégios do papel da aplicação
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_clients ON clients USING (app_client_allowed(id)) WITH CHECK (app_client_allowed(id));
CREATE POLICY p_clients_insert ON clients FOR INSERT WITH CHECK (coalesce(current_setting('app.client_scope', true), '') = '*');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['servers', 'server_inventory', 'agents', 'agent_enrollment_codes', 'agent_credentials', 'agent_task_queue', 'agent_task_logs', 'user_client_scopes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_%s ON %I USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id))', t, t);
  END LOOP;
END $$;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_audit_select ON audit_logs FOR SELECT USING (client_id IS NULL OR app_client_allowed(client_id));
CREATE POLICY p_audit_insert ON audit_logs FOR INSERT WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO central_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO central_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO central_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM central_app;
REVOKE INSERT, UPDATE, DELETE ON roles, permissions, role_permissions FROM central_app;
GRANT EXECUTE ON FUNCTION audit_verify() TO central_app;
