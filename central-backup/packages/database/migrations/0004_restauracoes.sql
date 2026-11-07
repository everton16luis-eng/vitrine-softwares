-- Fase 4 — restauração. Produção exige: quem pede tem `restaurar.producao`, OUTRA pessoa aprova
-- (com a mesma permissão), as duas digitam o nome do servidor, e um backup de segurança do estado
-- atual precisa ficar VALIDADO antes de a restauração começar.
CREATE TABLE restore_requests (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_id       bigint NOT NULL,
  server_id       bigint NOT NULL,
  job_id          bigint NOT NULL,
  snapshot_id     bigint NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('arquivos', 'banco')),
  mode            text NOT NULL CHECK (mode IN ('temporario', 'caminho', 'novo_banco', 'producao')),
  options         jsonb NOT NULL DEFAULT '{}',   -- includes, target_dir, new_name, new_file
  reason          text NOT NULL CHECK (length(reason) BETWEEN 5 AND 1000),
  status          text NOT NULL CHECK (status IN ('aguardando_aprovacao', 'backup_seguranca', 'na_fila', 'executando', 'concluido', 'falhou', 'recusado', 'cancelado')),
  requested_by    bigint NOT NULL REFERENCES users (id),
  approved_by     bigint REFERENCES users (id),
  approved_at     timestamptz,
  decision_note   text,
  safety_run_id   bigint,
  task_id         bigint REFERENCES agent_task_queue (id),
  result          jsonb,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  UNIQUE (id, client_id),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id),
  FOREIGN KEY (job_id, client_id) REFERENCES backup_jobs (id, client_id),
  FOREIGN KEY (snapshot_id, client_id) REFERENCES backup_snapshots (id, client_id),
  FOREIGN KEY (safety_run_id, client_id) REFERENCES backup_runs (id, client_id),
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK (mode <> 'producao' OR status IN ('aguardando_aprovacao', 'recusado', 'cancelado') OR approved_by IS NOT NULL)
);
-- no máximo uma restauração de produção em andamento por job
CREATE UNIQUE INDEX ux_restore_prod_active ON restore_requests (job_id) WHERE mode = 'producao' AND status IN ('aguardando_aprovacao', 'backup_seguranca', 'na_fila', 'executando');
CREATE INDEX ix_restore_open ON restore_requests (status) WHERE status IN ('backup_seguranca', 'na_fila', 'executando');

-- RLS e privilégios (snapshot com restauração em andamento conta como retido: veja backups/maintenance.ts)
ALTER TABLE restore_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_restore_requests ON restore_requests USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id));
GRANT SELECT, INSERT, UPDATE ON restore_requests TO central_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO central_app;

-- backup de segurança feito antes de restaurar por cima da produção
ALTER TABLE backup_runs DROP CONSTRAINT backup_runs_trigger_check;
ALTER TABLE backup_runs ADD CONSTRAINT backup_runs_trigger_check CHECK (trigger IN ('agendado', 'manual', 'seguranca'));
