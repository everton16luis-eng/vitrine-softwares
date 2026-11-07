# Fase 4 — Restauração

Código em [`central-backup/`](../../central-backup). Continua a [Fase 3](fase-3.md).

## 1. Regras

| Modo | Para | Toca a produção? | Quem pode | Fluxo |
| --- | --- | --- | --- | --- |
| `temporario` | arquivos | não: diretório do agente `restores/<id>` | `restauracoes.solicitar` | vai direto para a fila |
| `caminho` | arquivos | não: diretório **novo ou vazio** (o agente recusa diretório com conteúdo) | `restauracoes.solicitar` | vai direto para a fila |
| `novo_banco` | bancos | não: banco novo (PostgreSQL, MySQL/MariaDB, MongoDB) ou arquivo novo (SQLite) | `restauracoes.solicitar` | vai direto para a fila |
| `producao` | bancos | **sim** | quem pede: `restaurar.producao`; quem aprova: **outra pessoa** com `restauracoes.aprovar` e `restaurar.producao` | 1. pedido com o nome do servidor digitado<br>2. aprovação com o nome digitado de novo<br>3. **backup de segurança** do estado atual<br>4. o backup de segurança é **validado**<br>5. só então a restauração |

Outras garantias:

- Só snapshots **validados** podem ser restaurados.
- Uma restauração de produção ativa por job (índice único). Restauração e backup do mesmo job nunca
  rodam juntos (mesma chave de lock).
- Snapshot com restauração em andamento conta como retido: a retenção não o remove.
- PostgreSQL em produção: `pg_restore --clean --if-exists --single-transaction`. Ou entra tudo, ou o
  banco fica como estava.
- SQLite em produção: o dump é gravado ao lado do arquivo, passa por `integrity_check` e só então
  substitui o original (`rename` atômico).
- Se o backup de segurança falha (ou não valida), a restauração **não acontece** e a produção não é tocada.
- Restaurar **arquivos por cima da produção não está disponível**: exige um auxiliar privilegiado que
  esta versão não inclui. A API responde 409 explicando o motivo, e não há botão sem implementação.
- Erros só de metadados (dono, data, xattr, ACL), comuns ao restaurar sem root, viram aviso. O
  conteúdo é conferido: em restauração completa, a quantidade de arquivos restaurados precisa bater
  com a do snapshot.
- Trilha de auditoria: `restauracao.solicitar`, `restauracao.aprovar`/`restauracao.recusar`/`restauracao.cancelar`, `restauracao.concluir`/`restauracao.falhou`.

## 2. API

| Método | Rota | Permissão |
| --- | --- | --- |
| GET | `/api/v1/snapshots/:id/files?path=` | `restauracoes.solicitar`. Prévia lida pela central, sem carga no servidor do cliente |
| GET | `/api/v1/restores`, `/api/v1/restores/:id` (com logs do agente) | `restauracoes.solicitar` |
| POST | `/api/v1/restores` | `restauracoes.solicitar` (+ `restaurar.producao` para produção) |
| POST | `/api/v1/restores/:id/approve` | `restauracoes.aprovar` + `restaurar.producao`, não pode ser quem pediu |
| POST | `/api/v1/restores/:id/reject` | `restauracoes.aprovar` |
| POST | `/api/v1/restores/:id/cancel` | quem pediu ou quem aprova, antes de começar |

## 3. Testes

`npm test`: **63/63**. `npm run typecheck`: sem erros. A Fase 4 tem 7 testes
(`tests/integration/fase4.test.ts`), com restic, rest-server, PostgreSQL 18 e SQLite **reais**:

- **Prévia**: lista `a.txt`, `b.txt` e `sub` do snapshot, sem o `.log` excluído; caminho com `..` dá 422.
- **Arquivos**:
  - restauração temporária com o conteúdo igual ao original e a conferência de contagem `ok`;
  - um diretório com conteúdo é recusado e o arquivo existente fica intacto;
  - restaurar arquivos em produção dá 409.
- **PostgreSQL em banco novo**: as 500 linhas restauradas e a senha ausente da resposta.
- **Produção**:
  - o operador recebe 403;
  - confirmação errada dá 422;
  - um segundo pedido simultâneo dá 409;
  - sem aprovação nada acontece;
  - quem pediu não aprova (403);
  - a confirmação errada do aprovador dá 422;
  - com tudo certo: backup de segurança `validado`, depois a restauração. As 400 linhas do "acidente" voltam a 500, e a auditoria registra exatamente solicitar → aprovar → concluir.
- **Backup de segurança falha** (senha do banco errada): a restauração falha e a produção fica intacta.
- **SQLite em produção**: o arquivo volta ao conteúdo do snapshot.
- **Isolamento**: outro cliente não vê restaurações nem a prévia (404).

## 4. Limitações

| Item | Situação |
| --- | --- |
| Arquivos por cima da produção | Não incluído (precisa de um auxiliar com privilégio de escrita, a projetar com cuidado). Hoje: restaurar em diretório novo e trocar manualmente |
| `caminho` no Linux | A unit do agente tem o sistema de arquivos somente leitura: o diretório precisa estar em `ReadWritePaths` (drop-in da unit) ou dentro de `/var/lib/central-agent` |
| PostgreSQL em banco novo | O usuário técnico precisa de `CREATEDB` |
| MySQL/MariaDB e MongoDB | Código pronto, **não executado** aqui |
| Banco em uso durante a restauração de produção | O PostgreSQL faz em transação única, mas as aplicações conectadas podem receber erros nesse intervalo; pare a aplicação antes (a orquestração de parada entra com o plano de DR, Fase 7) |
