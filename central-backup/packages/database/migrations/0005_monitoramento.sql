-- Fase 5 — métricas dos servidores (enviadas pelo agente no heartbeat).
-- Brutas: no máximo uma por minuto por servidor, guardadas 14 dias. Horárias: 400 dias.
CREATE TABLE server_metrics (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id   bigint NOT NULL,
  client_id   bigint NOT NULL,
  at          timestamptz NOT NULL,
  cpu_pct     real,
  load1       real,
  mem_used_pct real,
  swap_used_pct real,
  disk_max_pct real,          -- disco mais cheio (alertas)
  net_rx_bps  bigint,
  net_tx_bps  bigint,
  failed_units int,
  data        jsonb NOT NULL,  -- amostra completa (discos por ponto de montagem)
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id) ON DELETE CASCADE
);
CREATE INDEX ix_metrics_server_at ON server_metrics (server_id, at DESC);
CREATE INDEX ix_metrics_at ON server_metrics (at);

CREATE TABLE server_metrics_hourly (
  server_id   bigint NOT NULL,
  client_id   bigint NOT NULL,
  hour        timestamptz NOT NULL,
  samples     int NOT NULL,
  cpu_avg     real, cpu_max real,
  load1_avg   real,
  mem_used_avg real, mem_used_max real,
  disk_max_pct real,
  net_rx_avg  bigint, net_tx_avg bigint,
  PRIMARY KEY (server_id, hour),
  FOREIGN KEY (server_id, client_id) REFERENCES servers (id, client_id) ON DELETE CASCADE
);

ALTER TABLE servers ADD COLUMN last_metrics jsonb, ADD COLUMN last_metrics_at timestamptz;

ALTER TABLE server_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_server_metrics ON server_metrics USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id));
ALTER TABLE server_metrics_hourly ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_server_metrics_hourly ON server_metrics_hourly USING (app_client_allowed(client_id)) WITH CHECK (app_client_allowed(client_id));
-- métricas brutas expiram (não são dados de backup): DELETE só nesta tabela
GRANT SELECT, INSERT, DELETE ON server_metrics TO central_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON server_metrics_hourly TO central_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO central_app;
