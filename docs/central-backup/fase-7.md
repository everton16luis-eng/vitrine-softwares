# Fase 7 — Recuperação de desastre (DR)

Código em [`central-backup/`](../../central-backup). Continua a [Fase 6](fase-6.md).

## 1. O que foi construído

| Área | Entrega | Onde |
| --- | --- | --- |
| Migration | `0007_dr.sql`: `dr_plans` (versão gerada, revisão, pronto/pendente, RPO/RTO, servidor de destino) e `dr_exercises` (tempos medidos, nunca apagados); RLS por cliente | `packages/database/migrations` |
| Gerador do plano | Função pura que monta o plano a partir de dados **reais** da central. **Fontes:** inventário mais recente de cada seção, aplicações, bancos, jobs, último snapshot **validado** de cada job e histórico de restaurações concluídas. **Saída:** achados de compatibilidade, passos ordenados com tempo e a base de cada estimativa, RPO, RTO, pacotes e serviços a reproduzir, domínios e pontos de restauração | `apps/api/src/dr/plan.ts` |
| Compatibilidade | Pendências **críticas** (bloqueiam a reconstrução): distribuição diferente, arquitetura diferente (`x64`/`x86_64`/`amd64` são a mesma), disco do destino menor que o usado + 20 %, banco sem job ou sem snapshot validado, job sem snapshot validado, caminho de aplicação (instalação, dados, configuração) fora de todo job de arquivos, RPO/RTO acima da meta da aplicação. **Avisos:** versão do SO, memória menor, inventário sem pacotes/serviços, último backup mais velho que a meta. **Informação:** versão principal do PostgreSQL a instalar | idem |
| RPO | **Atual**: agora − último snapshot validado (o pior job). **Projetado**: maior intervalo entre execuções do agendamento (cron no fuso do cliente) | idem |
| RTO | Soma dos passos: criação da máquina (informada ou 15 min), preparo (10 min), restauração de cada banco (tamanho ÷ vazão × 1,5 para índices) e de cada job de arquivos, conferência (15 min + 5 por aplicação), DNS (TTL). A vazão é **medida** nas restaurações concluídas quando há pelo menos 50 MB restaurados; senão usa 30 MB/s e diz que é estimativa | idem |
| cloud-init | Script para a máquina nova: Node 22 (NodeSource, assinado), restic 0.19.1 **conferido pelo SHA-256 da release**, agente clonado de `AGENT_SOURCE_REPO` na ref fixada `AGENT_SOURCE_REF`, registro na central com **código de uso único** (4 h por padrão). Cria ou reaproveita o cadastro do servidor de destino. Recusado quando o plano tem pendência crítica ou sem a origem configurada | `apps/api/src/dr/artifacts.ts` |
| Ansible | Playbook com tags: `base` (repositório PGDG quando há PostgreSQL, pacotes relevantes da origem, diretórios das aplicações) e `servicos` (habilita e sobe as unidades **depois** das restaurações). YAML com escalares entre aspas: nada de `yes`/`0755` virando outro tipo. **Sem nenhum segredo** | idem |
| Exercícios | Registro de exercício simulado ou real, com início e fim. O **RTO medido** é a duração real. O **RPO medido** é o início menos o ponto restaurado mais antigo. As restaurações citadas precisam ser do mesmo cliente e estar concluídas. O registro guarda a revisão do plano e o RTO estimado para comparação | `apps/api/src/modules/dr.ts` |
| API | `GET/POST /api/v1/dr-plans`, `GET /:id` (com exercícios), `POST /:id/regenerate`, `POST /:id/archive`, `GET /:id/ansible`, `POST /:id/cloud-init`, `POST /:id/exercises`; tudo auditado | idem |

Permissões:

| Permissão | Perfis | Libera |
| --- | --- | --- |
| `dr.ver` | infra, auditor | consultar o plano e baixar o Ansible |
| `dr.planejar` | infra | criar, regenerar e arquivar |
| `dr.executar` | infra | gerar o cloud-init, que cria um código de registro, e registrar exercícios |

## 2. Procedimento de recuperação (perda total do servidor)

1. No painel, abra o plano do servidor e **regenere** (o plano usa o estado de agora).
2. Resolva as pendências críticas. Sem snapshot validado, não há recuperação.
3. Gere o **cloud-init** e crie a máquina no provedor com ele como *user data*. Em poucos minutos o
   agente novo aparece como `<servidor>-dr-<plano>`.
4. `ansible-playbook -i inventario.ini dr.yml --tags base`, com o host em `[dr_destino]`.
5. Na central, restaure os bancos (modo **novo banco** ou **produção** no servidor novo) e os
   arquivos, a partir dos pontos listados no plano.
6. `ansible-playbook -i inventario.ini dr.yml --tags servicos`.
7. Confira as aplicações e aponte o DNS.
8. Registre o exercício (ou a recuperação real) com início, fim e as restaurações usadas.

## 3. Testes

**Unitários** (`tests/unit/dr.test.ts`, 6 testes):

- **Plano completo**: pacotes filtrados; serviços sem os do sistema e com a unidade da aplicação; RPO atual 360 min e projetado 1440 min.
- **Incompatibilidades**: nove pendências esperadas, ordenadas por gravidade.
- **Metas e vazão**: metas acima do RPO/RTO; vazão medida (102,4 MB/s) contra a estimada, e pouco volume não conta como medida.
- **YAML**: ida e volta pelo parser `yaml`.
- **cloud-init**:
  - YAML válido;
  - `sha256sum -c` com o hash oficial e `set -euo pipefail`;
  - arm64;
  - recusa de origem `http`, de URL com `;` e de ref com `;`.
- **Ansible**: PGDG, pacotes, diretórios, tags e nenhuma palavra de segredo.

**Integração** (`tests/integration/fase7.test.ts`, 5 testes; agente, restic e rest-server reais):

- **Plano a partir do inventário coletado de verdade**:
  - o arquivo de configuração fora do backup vira pendência;
  - em Windows, o plano avisa que pacotes e serviços não foram coletados e que a distribuição muda;
  - ponto de restauração = snapshot validado;
  - o auditor consulta mas não cria.
- **cloud-init**:
  - 422 sem `AGENT_SOURCE_*`;
  - 409 com pendência; resolvida a pendência e regenerado, o plano fica **pronto** (revisão 2);
  - o código extraído do cloud-init **registra um agente novo** no servidor de destino, e a segunda tentativa com o mesmo código falha;
  - a segunda geração reaproveita o destino.
  - O teste também pegou um caso real: o disco usado desta máquina (193 GB) reprovou um destino de 200 GB.
- **Ansible**: baixado e lido.
- **Exercício**:
  - RTO medido de 40 min e RPO medido a partir da restauração real;
  - término antes do início, término no futuro e restauração inexistente dão 422;
  - auditoria.
- **Isolamento**: o usuário do cliente Beta recebe 404 em tudo do Alfa.

## 4. Limitações

| Item | Situação |
| --- | --- |
| Ansible | O YAML é validado por parser; **o playbook não foi executado** (não há Ansible nem Ubuntu neste ambiente). Rode `ansible-playbook --check` no primeiro uso |
| cloud-init | Gerado e conferido por parser. O registro foi provado com o código real, mas **não foi testado num provedor**. Os nomes NodeSource/PGDG valem para Debian/Ubuntu |
| Distros RPM | Pacotes e cloud-init assumem `apt` |
| Instalação do agente no destino | Depende de `AGENT_SOURCE_REPO` acessível pela máquina nova (repositório público ou com chave de implantação) |
| Recuperação automática ponta a ponta | Não existe botão que recria tudo sozinho: restaurações destrutivas continuam exigindo as aprovações da Fase 4 |
| Exercícios automáticos | Testes de restauração periódicos com tempo medido ficam na Fase 8 |
