-- Fase 2 — cadastros: segredos (envelope por cliente), bancos, aplicações, destinos e repositórios.

-- ------------------------------------------------------------------ segredos
-- DEK por cliente (AES-256-GCM), cifrada pela KEK. Segredos da empresa (client_id nulo) usam a KEK.
CREATE TABLE client_keys (
  client_id  bigint PRIMARY KEY REFERENCES clients (id) ON DELETE RESTRICT,
  dek_enc    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

CREATE TABLE secrets (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id  uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_id  bigint REFERENCES clients (id) ON DELETE RESTRICT,
  kind       text NOT NULL CHECK (kind ~ '^[a-z0-9_]{3,40}$'),
  ciphertext text NOT NULL,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

ALTER TABLE agents ADD COLUMN enc_public_key text;
ALTER TABLE agent_task_queue ADD COLUMN sealed_secrets jsonb; -- cifrado para a chave do agente; entra na assinatura

-- ------------------------------------------------------------------ bancos de dados
CREATE TABLE databases (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       bigint NOT NULL,
  server_id       bigint NOT NULL,
  engine          text NOT NULL CHECK (engine IN ('postgresql', 'mysql', 'mariadb', 'sqlite', 'mongodb')),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  db_name         text,
  host            text,
  port            int CHECK (port BETWEEN 1 AND 65535),
  socket_path     text,
  file_path       text,
  tech_user       text,
  credential_id   bigint REFERENCES secrets (id),
  version         text,
  size_bytes      bigint,
  connection_status text NOT NULL DEFAULT 'nao_testado' CHECK (connection_status IN ('nao_testado', 'ok', 'erro')),
  last_test_at    timestamptz,
  last_test_error text,
  last_backup_at  timestamptz,
  notes           text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id) ON DELETE RESTRICT,
  CHECK ((engine = 'sqlite') = (file_path IS NOT NULL)),
  CHECK (engine = 'sqlite' OR db_name IS NOT NULL)
);
CREATE UNIQUE INDEX ux_databases_target ON databases (server_id, engine, coalesce(host, ''), coalesce(port, 0), coalesce(db_name, file_path)) WHERE archived_at IS NULL;
CREATE TRIGGER trg_databases_updated BEFORE UPDATE ON databases FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------ aplicações
CREATE TABLE applications (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id     bigint NOT NULL,
  server_id     bigint NOT NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  technology    text,
  version       text,
  install_dir   text,
  systemd_unit  text CHECK (systemd_unit ~ '^[A-Za-z0-9@._-]+\.service$'),
  data_dirs     text[] NOT NULL DEFAULT '{}',
  config_files  text[] NOT NULL DEFAULT '{}',
  excludes      text[] NOT NULL DEFAULT '{}',
  domains       text[] NOT NULL DEFAULT '{}',
  notes         text,
  rpo_minutes   int CHECK (rpo_minutes > 0),
  rto_minutes   int CHECK (rto_minutes > 0),
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  UNIQUE (server_id, name),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_applications_updated BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE application_databases (
  application_id bigint NOT NULL,
  database_id    bigint NOT NULL,
  client_id      bigint NOT NULL,
  PRIMARY KEY (application_id, database_id),
  FOREIGN KEY (application_id, client_id) REFERENCES applications (id, client_id) ON DELETE CASCADE,
  FOREIGN KEY (database_id, client_id) REFERENCES databases (id, client_id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------ destinos e repositórios
CREATE TABLE backup_destinations (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       bigint REFERENCES clients (id), -- nulo = destino da empresa, compartilhado (repositórios separados por servidor)
  kind            text NOT NULL CHECK (kind IN ('local_rest', 's3')),
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  config          jsonb NOT NULL DEFAULT '{}', -- nunca contém segredos
  access_secret_id bigint REFERENCES secrets (id), -- s3: chave de acesso
  immutable       boolean NOT NULL DEFAULT false,
  capacity_bytes  bigint,
  status          text NOT NULL DEFAULT 'nao_testado' CHECK (status IN ('nao_testado', 'ok', 'erro')),
  last_check_at   timestamptz,
  last_check_error text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_destinations_name ON backup_destinations (coalesce(client_id, 0), name) WHERE archived_at IS NULL;
CREATE TRIGGER trg_destinations_updated BEFORE UPDATE ON backup_destinations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- um repositório restic por servidor × destino; senha própria gerada pela central
CREATE TABLE backup_repositories (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  destination_id     bigint NOT NULL REFERENCES backup_destinations (id) ON DELETE RESTRICT,
  server_id          bigint NOT NULL,
  client_id          bigint NOT NULL,
  tool               text NOT NULL DEFAULT 'restic' CHECK (tool IN ('restic')),
  repo_user          text NOT NULL,
  path               text NOT NULL,
  password_secret_id bigint NOT NULL REFERENCES secrets (id),
  access_secret_id   bigint REFERENCES secrets (id), -- local_rest: senha HTTP do usuário do rest-server
  initialized_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  UNIQUE (destination_id, server_id, tool),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id) ON DELETE RESTRICT
);

-- ------------------------------------------------------------------ RLS e privilégios
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_keys', 'databases', 'applications', 'application_databases', 'backup_repositories'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_%s ON %I USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id))', t, t);
  END LOOP;
END $$;
-- segredos e destinos da empresa (client_id nulo) só existem para quem tem escopo total
ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_secrets ON secrets USING (CASE WHEN client_id IS NULL THEN coalesce(current_setting('app.client_scope', true), '') = '*' ELSE app_client_allowed(client_id) END)
  WITH CHECK (CASE WHEN client_id IS NULL THEN coalesce(current_setting('app.client_scope', true), '') = '*' ELSE app_client_allowed(client_id) END);
ALTER TABLE backup_destinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_destinations_read ON backup_destinations FOR SELECT USING (client_id IS NULL OR app_client_allowed(client_id));
CREATE POLICY p_destinations_write ON backup_destinations FOR ALL
  USING (CASE WHEN client_id IS NULL THEN coalesce(current_setting('app.client_scope', true), '') = '*' ELSE app_client_allowed(client_id) END)
  WITH CHECK (CASE WHEN client_id IS NULL THEN coalesce(current_setting('app.client_scope', true), '') = '*' ELSE app_client_allowed(client_id) END);

GRANT SELECT, INSERT, UPDATE, DELETE ON client_keys, secrets, databases, applications, application_databases, backup_destinations, backup_repositories TO central_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO central_app;
-- a DEK nunca é apagada pela aplicação (sem ela os segredos do cliente se perdem)
REVOKE DELETE ON client_keys FROM central_app;
