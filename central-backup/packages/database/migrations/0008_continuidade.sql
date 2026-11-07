-- Fase 8 — testes periódicos de restauração, pgBackRest e backup da própria central.

-- ------------------------------------------------------------------ testes de restauração
-- Um teste é uma restauração criada pelo sistema (sem solicitante), só em modos que não tocam a
-- produção, que o agente confere e descarta.
ALTER TABLE restore_requests ADD COLUMN drill boolean NOT NULL DEFAULT false;
ALTER TABLE restore_requests ADD COLUMN duration_s int;
ALTER TABLE restore_requests ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE restore_requests ADD CONSTRAINT restore_requests_requester CHECK (requested_by IS NOT NULL OR drill);
ALTER TABLE restore_requests ADD CONSTRAINT restore_requests_drill_mode CHECK (NOT drill OR mode IN ('temporario', 'novo_banco'));
ALTER TABLE backup_policies ADD COLUMN restore_test_days int CHECK (restore_test_days BETWEEN 1 AND 365);
ALTER TABLE backup_jobs ADD COLUMN last_restore_test_at timestamptz;
ALTER TABLE backup_jobs ADD COLUMN last_restore_test_status text CHECK (last_restore_test_status IN ('ok', 'falhou'));
ALTER TABLE backup_jobs ADD COLUMN last_restore_test_id bigint;

-- ------------------------------------------------------------------ pgBackRest
-- Backup físico do PostgreSQL (full/diff/incr + WAL) feito pelo pgBackRest instalado no servidor.
-- A central agenda, executa pela operação fechada e guarda o `pgbackrest info` (sem segredos: o
-- repositório e a cifra do pgBackRest ficam na configuração do próprio servidor).
CREATE TABLE pgbackrest_stanzas (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id        bigint NOT NULL,
  server_id        bigint NOT NULL,
  database_id      bigint,
  stanza           text NOT NULL CHECK (stanza ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$'),
  full_schedule    text NOT NULL,
  diff_schedule    text,
  timezone         text NOT NULL DEFAULT 'America/Sao_Paulo',
  enabled          boolean NOT NULL DEFAULT true,
  next_full_at     timestamptz,
  next_diff_at     timestamptz,
  status           text NOT NULL DEFAULT 'nao_verificado' CHECK (status IN ('nao_verificado', 'ok', 'erro')),
  last_error       text,
  last_info        jsonb,
  last_info_at     timestamptz,
  last_backup_label text,
  last_backup_type text,
  last_backup_at   timestamptz,
  last_backup_bytes bigint,
  wal_min          text,
  wal_max          text,
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  UNIQUE (server_id, stanza),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id),
  FOREIGN KEY (database_id, client_id) REFERENCES databases (id, client_id)
);
CREATE TRIGGER trg_pgbr_updated BEFORE UPDATE ON pgbackrest_stanzas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE pgbackrest_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id   bigint NOT NULL,
  stanza_id   bigint NOT NULL,
  type        text NOT NULL CHECK (type IN ('full', 'diff', 'incr', 'info')),
  trigger     text NOT NULL CHECK (trigger IN ('agendado', 'manual')),
  status      text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'executando', 'concluido', 'falhou', 'cancelado')),
  task_id     bigint REFERENCES agent_task_queue (id),
  label       text,
  error       text,
  requested_by bigint REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (stanza_id, client_id) REFERENCES pgbackrest_stanzas (id, client_id)
);
CREATE UNIQUE INDEX ux_pgbr_active ON pgbackrest_runs (stanza_id) WHERE status IN ('na_fila', 'executando');

-- ------------------------------------------------------------------ backup da própria central
-- Sem cliente: só quem tem escopo total enxerga (o papel da aplicação lê pelo escopo '*').
CREATE TABLE system_backups (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger       text NOT NULL CHECK (trigger IN ('agendado', 'manual')),
  status        text NOT NULL DEFAULT 'executando' CHECK (status IN ('executando', 'validado', 'falhou')),
  snapshot_id   text CHECK (snapshot_id ~ '^[0-9a-f]{64}$'),
  bytes         bigint,
  tables        int,
  details       jsonb NOT NULL DEFAULT '{}',
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE UNIQUE INDEX ux_system_backups_running ON system_backups ((true)) WHERE status = 'executando';

-- ------------------------------------------------------------------ alertas novos
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_kind_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_kind_check CHECK (kind IN ('backup_atrasado', 'backup_falhou', 'agente_sem_contato', 'disco', 'memoria',
  'servicos_com_falha', 'repositorio_com_erro', 'destino_com_erro', 'teste_restauracao_falhou', 'pgbackrest_com_erro'));

-- ------------------------------------------------------------------ RLS e privilégios
ALTER TABLE pgbackrest_stanzas ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_pgbackrest_stanzas ON pgbackrest_stanzas USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id));
ALTER TABLE pgbackrest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_pgbackrest_runs ON pgbackrest_runs USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id));
ALTER TABLE system_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_system_backups ON system_backups USING (coalesce(current_setting('app.client_scope', true), '') = '*')
  WITH CHECK (coalesce(current_setting('app.client_scope', true), '') = '*');
GRANT SELECT, INSERT, UPDATE ON pgbackrest_stanzas, pgbackrest_runs, system_backups TO central_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO central_app;
