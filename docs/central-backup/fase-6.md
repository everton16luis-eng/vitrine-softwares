# Fase 6 — Alertas, notificações e relatórios

Código em [`central-backup/`](../../central-backup). Continua a [Fase 5](fase-5.md).

## 1. O que foi construído

| Área | Entrega | Onde |
| --- | --- | --- |
| Migration | `0006_alertas.sql`: `notification_channels`, `alert_rules`, `alerts` (um incidente aberto por regra × entidade, com índice único parcial no fingerprint), `alert_notifications`; RLS; regras e canais da empresa exigem escopo total | `packages/database/migrations` |
| Regras | 8 tipos: `backup_falhou` (inclui reprovado na verificação), `backup_atrasado` (horas sem backup **validado**), `agente_sem_contato` (minutos), `disco` e `memoria` (%), `servicos_com_falha`, `repositorio_com_erro` (verificação ou retenção), `destino_com_erro`. Cada regra tem limite, severidade, intervalo de lembrete e canais; vale para um cliente ou para todos. `POST /alert-rules/recommended` cria o conjunto usual uma única vez | `alerts/evaluate.ts`, `modules/alerts.ts` |
| Avaliação | Worker a cada 60 s, com advisory lock. Abre um incidente novo, atualiza o que continua (ocorrências, sem nova notificação), resolve o que normalizou e envia lembrete enquanto ninguém reconhece. Um canal que falhou é reenviado na rodada seguinte (até 5 falhas em 24 h). As notificações saem **depois do commit** | idem |
| Canais | **E-mail** via SMTP (nodemailer, `SMTP_URL`/`SMTP_FROM`). **Webhook** JSON com `X-Central-Timestamp` e `X-Central-Assinatura: sha256=HMAC(chave, "ts.corpo")`, só `https` (ou `http` em 127.0.0.1) e sem seguir redirecionamento. **WhatsApp** pela API Cloud da Meta: texto ou modelo aprovado (necessário fora da janela de 24 h). A URL do webhook, a chave de assinatura e o token do WhatsApp ficam em `secrets` e **nunca voltam pela API**; o teste do canal faz um envio real | `alerts/channels.ts` |
| Incidentes | Lista (ativos, abertos, reconhecidos, resolvidos), reconhecimento com nota, histórico de notificações por canal; tudo auditado | `modules/alerts.ts` |
| Relatórios | `GET /api/v1/reports/backups?from&to&client_id&format=json\|csv`: execuções, validadas, falhas, taxa de sucesso, duração média, bytes novos, último validado, snapshots válidos e tamanho do repositório. O CSV usa `;`, BOM UTF-8 e **neutraliza fórmulas** (`=`, `+`, `-`, `@`) | idem |

## 2. Testes

`tests/integration/fase6.test.ts`, 6 testes. Entregas por protocolo real com servidores locais: um
receptor SMTP, um receptor HTTP que confere a assinatura HMAC e uma imitação da API do WhatsApp que
confere o token e o formato.

- **Canais**:
  - configuração inválida dá 422 (e-mail inválido, webhook externo sem TLS, segredo ausente);
  - os segredos não aparecem na listagem;
  - o teste de cada canal entrega de fato: e-mail com destinatário e assunto, webhook com a assinatura conferida, WhatsApp com Bearer e payload.
- **Regras recomendadas**: 8 criadas na primeira chamada e 0 na segunda.
- **Ciclo do incidente**:
  - disco a 96 % abre um incidente e manda 3 notificações;
  - a nova rodada não duplica nada e não notifica de novo;
  - o reconhecimento funciona e o segundo dá 409;
  - com o disco a 50 %, o incidente é resolvido e a resolução é notificada nos 3 canais.
- **Falha real de backup** (caminho inexistente):
  - o incidente traz o erro do agente;
  - com o webhook devolvendo 500, o e-mail e o WhatsApp saem mesmo assim e o erro fica registrado no canal;
  - na rodada seguinte, só o webhook é reenviado; depois de entregue, não repete.
- **Relatório**: números das execuções reais; no CSV, o nome de job `=SOMA(1;2)` sai neutralizado e entre aspas.
- **Isolamento**: outro cliente não vê os alertas nem o relatório do Alfa e não cria regra da empresa.

## 3. Configuração

No `.env` da central:

```ini
SMTP_URL=smtps://alertas%40exemplo.com.br:SENHA@smtp.exemplo.com.br:465
SMTP_FROM="Central de Backup <alertas@exemplo.com.br>"
```

WhatsApp:

1. Crie o app na Meta for Developers e o número no WhatsApp Business.
2. Gere um token de sistema (permanente).
3. Cadastre o canal com `phone_number_id`, os destinos (DDI + DDD + número, só dígitos) e, para
   avisos fora da janela de 24 h, um **modelo aprovado** com um parâmetro no corpo.

Para validar o seu receptor de webhook, recalcule `HMAC-SHA256(chave, timestamp + "." + corpo)`
e compare com o cabeçalho. Recuse timestamps com mais de 5 minutos.

## 4. Limitações

| Item | Situação |
| --- | --- |
| WhatsApp | Verificado contra uma imitação local da API (formato, token, rota). **Não testado contra a Meta**, que exige conta comercial verificada |
| SMTP | Verificado com um receptor local sem TLS. Com o provedor real use `smtps://` (465) ou STARTTLS (587) |
| Relatório em PDF | Não incluído: o JSON alimenta a tela e o CSV abre em planilha |
| Silenciar alertas em manutenção | Ainda não: desligue a regra temporariamente (`enabled: false`) |
