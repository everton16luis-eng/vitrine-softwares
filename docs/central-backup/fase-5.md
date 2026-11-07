# Fase 5 — Monitoramento

Código em [`central-backup/`](../../central-backup). Continua a [Fase 4](fase-4.md).

## 1. O que foi construído

| Área | Entrega | Onde |
| --- | --- | --- |
| Coleta no agente | CPU (diferença entre amostras), load, memória e swap (`/proc/meminfo`), discos montados (statfs, um por dispositivo, só sistemas de arquivos reais), rede (`/proc/net/dev`, sem `lo`), serviços systemd com falha (no máximo a cada 5 min). Nada varre disco ou lista processos | `apps/agent/src/metrics.ts` |
| Transporte | No próprio heartbeat (conexão de saída já existente): nenhuma porta nova no servidor do cliente | `agent-protocol.ts` (`AgentMetrics`), gateway |
| Armazenamento | Última leitura em `servers.last_metrics`; série bruta com no máximo 1 amostra por minuto por servidor, guardada 14 dias; agregação horária (média e máximo) guardada 400 dias, a cada 5 min pelo worker, idempotente | `0005_monitoramento.sql`, `monitoring/metrics.ts` |
| Visão geral | `GET /api/v1/monitoring/overview`: por servidor, conexão, última leitura e saúde (`ok`, `atencao`, `critico`, `sem_agente`), com os problemas listados: agente sem contato, disco ≥ 90 %, memória ≥ 95 %, serviços com falha, jobs com falha e jobs sem backup validado | `modules/monitoring.ts` |
| Séries | `GET /api/v1/servers/:id/metrics?from&to&resolution=bruta\|hora`: até 48 h usa a série bruta, acima disso a horária | idem |
| Prometheus | `GET /api/v1/metrics` em formato texto 0.0.4, com `Authorization: Bearer <METRICS_TOKEN>` (comparação em tempo constante); **desligado** sem token. Métricas de servidor (up, CPU, load, memória, disco por ponto de montagem, unidades com falha), backup (horário do último validado, última execução ok), snapshots por situação, tamanho dos repositórios e tarefas em aberto | `monitoring/metrics.ts`, `deploy/prometheus/central-backup.yml` |

### Desvio justificado: Prometheus

A especificação pede Prometheus. O padrão seria um `node_exporter` em cada servidor de cliente,
raspado pelo Prometheus, mas isso **abriria uma porta de entrada** em cada servidor e contraria
a regra de que só o agente conecta, de dentro para fora. Por isso o agente coleta e envia as
métricas pelo heartbeat, e a **central** expõe tudo no formato Prometheus para um Prometheus
local (`127.0.0.1:4300`). Alertas e gráficos podem ser feitos no Prometheus/Grafana com os dados
reais. A Fase 6 traz alertas próprios para quem não quiser operar um Prometheus.

## 2. Testes

`tests/integration/fase5.test.ts`, 7 testes:

- O amostrador real do agente gera um formato válido pelo esquema e números coerentes.
- O heartbeat leva métricas reais. Dentro de um minuto só a última leitura é atualizada, sem nova amostra gravada.
- Agregação horária: a média e o máximo conferem com as amostras e uma nova rodada não duplica nada. A resolução é escolhida automaticamente e um intervalo invertido dá 422.
- Visão geral: um disco a 96 % aparece como `atencao` e um agente sem contato como `critico`, com o motivo.
- Prometheus:
  - sem token ou com token errado, 401;
  - com o token certo, o formato texto vem correto linha a linha, com aspas escapadas no nome do cliente;
  - sem `METRICS_TOKEN` configurado, 404.
- Isolamento: o usuário de outro cliente só vê o próprio servidor e recebe 404 nas métricas do outro.

## 3. Instalação

1. Gere o token e coloque no `.env` da central:

   ```bash
   openssl rand -hex 32
   ```

   ```ini
   METRICS_TOKEN=<valor>
   ```

2. Se for usar Prometheus, grave o mesmo valor em `/etc/prometheus/central-backup.token`, com
   permissão 0640 e dono `prometheus`. Depois inclua o trecho de `deploy/prometheus/central-backup.yml`
   no `prometheus.yml`.

## 4. Limitações

| Item | Situação |
| --- | --- |
| Métricas no Windows | O agente é para Linux. No Windows de desenvolvimento faltam load, rede e unidades com falha (ficam nulos) |
| Gráficos | Os dados e as séries estão prontos; as telas com gráficos vêm na etapa do frontend |
| Limiares da visão geral | Fixos (90 % de disco, 95 % de memória). As regras configuráveis por cliente chegam com os alertas (Fase 6) |
| Métricas de aplicação (HTTP, filas) | Fora do escopo: o agente não abre portas nem inspeciona aplicações |
