-- Fase 7 — planos de recuperação de desastre e exercícios registrados.

-- Plano: gerado a partir do inventário, cadastros, jobs e snapshots validados do servidor de origem.
-- `plan` guarda a versão gerada (passos, achados de compatibilidade, RPO/RTO); regenerar sobrescreve
-- e incrementa `revision`. `target_server_id` é o cadastro do servidor de destino criado para o cloud-init.
CREATE TABLE dr_plans (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id        uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_id        bigint NOT NULL,
  server_id        bigint NOT NULL,
  name             text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  target           jsonb NOT NULL,
  plan             jsonb NOT NULL,
  ready            boolean NOT NULL,
  rpo_minutes      int,
  rto_minutes      int,
  revision         int NOT NULL DEFAULT 1,
  target_server_id bigint,
  created_by       bigint NOT NULL REFERENCES users (id),
  generated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id),
  FOREIGN KEY (target_server_id, client_id) REFERENCES servers (id, client_id)
);
CREATE TRIGGER trg_dr_plans_updated BEFORE UPDATE ON dr_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_dr_plans_server ON dr_plans (server_id) WHERE archived_at IS NULL;

-- Exercício: execução (simulada ou real) do plano, com tempos MEDIDOS. Nunca é apagado.
CREATE TABLE dr_exercises (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id         uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_id         bigint NOT NULL,
  plan_id           bigint NOT NULL,
  plan_revision     int NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('simulado', 'real')),
  outcome           text NOT NULL CHECK (outcome IN ('sucesso', 'parcial', 'falhou')),
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz NOT NULL,
  measured_rto_minutes int NOT NULL CHECK (measured_rto_minutes >= 0),
  measured_rpo_minutes int CHECK (measured_rpo_minutes >= 0),
  estimated_rto_minutes int,
  restore_ids       uuid[] NOT NULL DEFAULT '{}',
  notes             text NOT NULL CHECK (length(notes) BETWEEN 5 AND 5000),
  recorded_by       bigint NOT NULL REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_id, client_id) REFERENCES dr_plans (id, client_id),
  CHECK (finished_at >= started_at)
);
CREATE INDEX ix_dr_exercises_plan ON dr_exercises (plan_id, started_at DESC);

ALTER TABLE dr_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_dr_plans ON dr_plans USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id));
ALTER TABLE dr_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_dr_exercises ON dr_exercises USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id));
GRANT SELECT, INSERT, UPDATE ON dr_plans TO central_app;
GRANT SELECT, INSERT ON dr_exercises TO central_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO central_app;
