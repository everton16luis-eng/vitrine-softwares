-- Fase 6 — alertas (regras, canais, incidentes deduplicados, notificações) e relatórios.

-- Canal de notificação. Endereços que funcionam como credencial (URL de webhook, token do WhatsApp)
-- ficam em `secrets`; `config` guarda só o que não é segredo.
CREATE TABLE notification_channels (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id   bigint REFERENCES clients (id),
  kind        text NOT NULL CHECK (kind IN ('email', 'webhook', 'whatsapp')),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  config      jsonb NOT NULL DEFAULT '{}',
  secret_id   bigint REFERENCES secrets (id),
  enabled     boolean NOT NULL DEFAULT true,
  last_ok_at  timestamptz,
  last_error  text,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_channels_updated BEFORE UPDATE ON notification_channels FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Regra: client_id nulo = vale para todos os clientes (da empresa).
CREATE TABLE alert_rules (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id     bigint REFERENCES clients (id),
  kind          text NOT NULL CHECK (kind IN ('backup_atrasado', 'backup_falhou', 'agente_sem_contato', 'disco', 'memoria', 'servicos_com_falha', 'repositorio_com_erro', 'destino_com_erro')),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  threshold     real,
  severity      text NOT NULL DEFAULT 'aviso' CHECK (severity IN ('aviso', 'critico')),
  remind_hours  int NOT NULL DEFAULT 24 CHECK (remind_hours BETWEEN 1 AND 720),
  channel_ids   bigint[] NOT NULL DEFAULT '{}',
  enabled       boolean NOT NULL DEFAULT true,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_rules_updated BEFORE UPDATE ON alert_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Incidente: um por regra × entidade enquanto aberto (deduplicação pelo fingerprint).
CREATE TABLE alerts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_id       bigint NOT NULL REFERENCES clients (id),
  rule_id         bigint NOT NULL REFERENCES alert_rules (id),
  fingerprint     text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       bigint NOT NULL,
  severity        text NOT NULL,
  title           text NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'reconhecido', 'resolvido')),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  occurrences     int NOT NULL DEFAULT 1,
  acknowledged_by bigint REFERENCES users (id),
  acknowledged_at timestamptz,
  ack_note        text,
  resolved_at     timestamptz,
  last_notified_at timestamptz
);
CREATE UNIQUE INDEX ux_alerts_open ON alerts (fingerprint) WHERE status <> 'resolvido';
CREATE INDEX ix_alerts_client ON alerts (client_id, status, opened_at DESC);

CREATE TABLE alert_notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id    bigint NOT NULL REFERENCES alerts (id),
  client_id   bigint NOT NULL,
  channel_id  bigint NOT NULL REFERENCES notification_channels (id),
  event       text NOT NULL CHECK (event IN ('aberto', 'lembrete', 'resolvido', 'teste')),
  status      text NOT NULL CHECK (status IN ('enviado', 'falhou')),
  error       text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notifications_alert ON alert_notifications (alert_id, at DESC);

-- ------------------------------------------------------------------ RLS e privilégios
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_alerts ON alerts USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id));
ALTER TABLE alert_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_alert_notifications ON alert_notifications USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_channels', 'alert_rules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_%s_read ON %I FOR SELECT USING (client_id IS NULL OR app_client_allowed(client_id))', t, t);
    EXECUTE format($f$CREATE POLICY p_%s_write ON %I FOR ALL
      USING (CASE WHEN client_id IS NULL THEN coalesce(current_setting('app.client_scope', true), '') = '*' ELSE app_client_allowed(client_id) END)
      WITH CHECK (CASE WHEN client_id IS NULL THEN coalesce(current_setting('app.client_scope', true), '') = '*' ELSE app_client_allowed(client_id) END)$f$, t, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON notification_channels, alert_rules, alerts, alert_notifications TO central_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO central_app;
