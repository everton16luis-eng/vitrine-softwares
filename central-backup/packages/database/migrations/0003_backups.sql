-- Fase 3 — políticas, jobs, execuções, snapshots, verificação e retenção.

-- Política: quando roda, quanto guarda e como verifica. Pode ser da empresa (client_id nulo) e
-- reaproveitada por vários clientes.
CREATE TABLE backup_policies (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id     bigint REFERENCES clients (id),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  schedule      text NOT NULL,                       -- cron de 5 campos, validado pela aplicação
  timezone      text NOT NULL DEFAULT 'America/Sao_Paulo',
  retention     jsonb NOT NULL,                      -- {keep_last, keep_daily, keep_weekly, keep_monthly, keep_yearly}
  verify_subset_percent int NOT NULL DEFAULT 5 CHECK (verify_subset_percent BETWEEN 1 AND 100),
  limit_upload_kbps int CHECK (limit_upload_kbps > 0),
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((retention->>'keep_last')::int >= 1)
);
CREATE UNIQUE INDEX ux_policies_name ON backup_policies (coalesce(client_id, 0), name) WHERE archived_at IS NULL;
CREATE TRIGGER trg_policies_updated BEFORE UPDATE ON backup_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Job: o quê (arquivos de uma aplicação ou um banco), de qual servidor, para qual destino.
CREATE TABLE backup_jobs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       bigint NOT NULL,
  server_id       bigint NOT NULL,
  policy_id       bigint NOT NULL REFERENCES backup_policies (id),
  destination_id  bigint NOT NULL REFERENCES backup_destinations (id),
  repository_id   bigint NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('arquivos', 'banco')),
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  application_id  bigint,
  database_id     bigint,
  paths           text[] NOT NULL DEFAULT '{}',
  excludes        text[] NOT NULL DEFAULT '{}',
  enabled         boolean NOT NULL DEFAULT true,
  next_run_at     timestamptz,
  last_run_at     timestamptz,
  last_status     text,
  last_success_at timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  UNIQUE (server_id, name),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id) ON DELETE RESTRICT,
  FOREIGN KEY (repository_id, client_id) REFERENCES backup_repositories (id, client_id),
  FOREIGN KEY (application_id, client_id) REFERENCES applications (id, client_id),
  FOREIGN KEY (database_id, client_id) REFERENCES databases (id, client_id),
  CHECK ((kind = 'banco') = (database_id IS NOT NULL)),
  CHECK (kind = 'banco' OR cardinality(paths) > 0)
);
CREATE INDEX ix_jobs_due ON backup_jobs (next_run_at) WHERE enabled AND archived_at IS NULL;
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON backup_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Execução de um job (agendada ou manual). A tarefa do agente é o transporte; a execução é o registro.
CREATE TABLE backup_runs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id     uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_id     bigint NOT NULL,
  job_id        bigint NOT NULL,
  task_id       bigint REFERENCES agent_task_queue (id),
  trigger       text NOT NULL CHECK (trigger IN ('agendado', 'manual')),
  scheduled_for timestamptz,
  status        text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'executando', 'concluido', 'validado', 'falha_verificacao', 'falhou', 'cancelado')),
  started_at    timestamptz,
  finished_at   timestamptz,
  snapshot_id   bigint,
  summary       jsonb,
  error         text,
  requested_by  bigint REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  UNIQUE (job_id, scheduled_for),
  FOREIGN KEY (job_id, client_id) REFERENCES backup_jobs (id, client_id)
);
CREATE INDEX ix_runs_job ON backup_runs (job_id, id DESC);
CREATE INDEX ix_runs_open ON backup_runs (status) WHERE status IN ('na_fila', 'executando');

-- Snapshot restic conhecido pela central. "validado" só depois da verificação feita pela central.
CREATE TABLE backup_snapshots (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id      bigint NOT NULL,
  repository_id  bigint NOT NULL,
  job_id         bigint NOT NULL,
  run_id         bigint,
  restic_id      text NOT NULL CHECK (restic_id ~ '^[0-9a-f]{64}$'),
  taken_at       timestamptz NOT NULL,
  hostname       text,
  paths          text[] NOT NULL DEFAULT '{}',
  stdin_filename text,
  files          bigint,
  size_bytes     bigint,
  added_bytes    bigint,
  status         text NOT NULL DEFAULT 'nao_verificado' CHECK (status IN ('nao_verificado', 'verificando', 'validado', 'falha_verificacao', 'removido')),
  verify_attempts int NOT NULL DEFAULT 0,
  verified_at    timestamptz,
  verify_details jsonb,
  verify_error   text,
  legal_hold     boolean NOT NULL DEFAULT false,
  legal_hold_reason text,
  removed_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  UNIQUE (repository_id, restic_id),
  FOREIGN KEY (repository_id, client_id) REFERENCES backup_repositories (id, client_id),
  FOREIGN KEY (job_id, client_id) REFERENCES backup_jobs (id, client_id),
  FOREIGN KEY (run_id, client_id) REFERENCES backup_runs (id, client_id),
  CHECK (NOT (legal_hold AND status = 'removido'))
);
CREATE INDEX ix_snapshots_job ON backup_snapshots (job_id, taken_at DESC);
CREATE INDEX ix_snapshots_verify ON backup_snapshots (id) WHERE status = 'nao_verificado';
ALTER TABLE backup_runs ADD FOREIGN KEY (snapshot_id, client_id) REFERENCES backup_snapshots (id, client_id);

-- uso de armazenamento e manutenção por repositório
ALTER TABLE backup_repositories
  ADD COLUMN size_bytes bigint,
  ADD COLUMN stats_at timestamptz,
  ADD COLUMN last_check_at timestamptz,
  ADD COLUMN last_check_ok boolean,
  ADD COLUMN last_retention_at timestamptz,
  ADD COLUMN retention_error text;

-- ------------------------------------------------------------------ RLS e privilégios
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['backup_jobs', 'backup_runs', 'backup_snapshots'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_%s ON %I USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id))', t, t);
  END LOOP;
END $$;
ALTER TABLE backup_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_policies_read ON backup_policies FOR SELECT USING (client_id IS NULL OR app_client_allowed(client_id));
CREATE POLICY p_policies_write ON backup_policies FOR ALL
  USING (CASE WHEN client_id IS NULL THEN coalesce(current_setting('app.client_scope', true), '') = '*' ELSE app_client_allowed(client_id) END)
  WITH CHECK (CASE WHEN client_id IS NULL THEN coalesce(current_setting('app.client_scope', true), '') = '*' ELSE app_client_allowed(client_id) END);

GRANT SELECT, INSERT, UPDATE ON backup_policies, backup_jobs, backup_runs, backup_snapshots TO central_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO central_app;
-- histórico de backup nunca é apagado pela aplicação: snapshots removidos ficam como "removido"
