# Central de Backup, Monitoramento e Disaster Recovery

Status: **Fases 1 a 8 implementadas e testadas (98/98)**: fundação ([fase-1.md](fase-1.md)), cadastros e destinos ([fase-2.md](fase-2.md)), backups com verificação e retenção ([fase-3.md](fase-3.md)), restauração ([fase-4.md](fase-4.md)), monitoramento ([fase-5.md](fase-5.md)), alertas e relatórios ([fase-6.md](fase-6.md)), recuperação de desastre ([fase-7.md](fase-7.md)), continuidade: testes de restauração, pgBackRest, backup da central e rotação de chaves ([fase-8.md](fase-8.md)). Painel web em [painel-web.md](painel-web.md). Falta o aceite em VM Ubuntu real.
Decisões em [06-riscos-e-decisoes.md](06-riscos-e-decisoes.md#3-decisões-tomadas-07112026). Código em
[`central-backup/`](../../central-backup).

| Documento | Conteúdo |
| --- | --- |
| [01-arquitetura.md](01-arquitetura.md) | Diagrama de componentes, comunicação central ↔ agentes, fila de tarefas, motor de backup, armazenamento, monitoramento, DR |
| [02-modelo-de-dados.md](02-modelo-de-dados.md) | Esquema PostgreSQL (entidades, chaves, índices, estados, retenção) |
| [03-api.md](03-api.md) | Contratos REST `/api/v1`, protocolo do agente, catálogo de operações |
| [04-seguranca.md](04-seguranca.md) | Identidade dos agentes (mTLS), segredos, RBAC, isolamento entre clientes, auditoria |
| [05-plano.md](05-plano.md) | Estrutura do monorepo, fases, estratégia de testes, critérios de aceitação |
| [06-riscos-e-decisoes.md](06-riscos-e-decisoes.md) | Riscos técnicos e decisões que dependem da empresa |
| [fase-1.md](fase-1.md) | Fase 1: o que foi feito, desvios do plano, instalação, testes e pendências |

## 1. O que existe hoje e o que muda

A plataforma atual (`vitrine-softwares`) é um site de vendas + painel administrativo em
**Node.js/JavaScript, Express 5, PostgreSQL e painel em JavaScript puro com Bootstrap**. Ela já tem uma
**Central de Implantação** cujo desenho valida vários princípios exigidos agora:

| Já existe na Central de Implantação | Como será aproveitado |
| --- | --- |
| Painel nunca executa comandos; grava tarefas numa fila | Mesmo princípio, agora com agentes remotos |
| Catálogo fechado de operações, `execFile` sem shell, parâmetros revalidados no agente e no auxiliar root | Mesmo padrão no agente de backup (auxiliar root com lista fechada) |
| Passos idempotentes, retomada após queda, uma tarefa ativa por recurso | Mesmo modelo de lease/lock, generalizado |
| Credenciais cifradas (AES‑256‑GCM) e mascaradas em logs | Evolui para criptografia por envelope com chave mestra fora do banco |
| Auditoria, RBAC por permissões | Reaproveitado como modelo; auditoria passa a ser à prova de alteração |

A diferença essencial: a Central de Implantação roda **no mesmo servidor** das aplicações, com agente
local. A nova central administra **dezenas ou centenas de servidores de clientes**, por agentes
remotos que se conectam de fora para dentro. É um produto novo, não uma tela a mais.

## 2. Recomendação principal: aplicação separada, ligada à plataforma

O escopo exige TypeScript, Fastify, React, Redis/BullMQ, Prometheus e Docker Compose — tecnologias
diferentes das do site atual. Em vez de reescrever o site (o que violaria a regra 14, "não substituir
tecnologias funcionais sem justificativa"), a proposta é:

- **Criar a Central de Backup como aplicação própria** (monorepo `central-backup/`), com banco,
  sessões e usuários próprios, publicada num subdomínio interno (ex.: `infra.suaempresa.com.br`).
- **Ligar as duas plataformas** sem misturar os riscos: item de menu no painel atual levando à
  central; importação/sincronização opcional dos clientes já cadastrados; no futuro, SSO.

Justificativa técnica (além das tecnologias obrigatórias):

1. **Raio de impacto.** A central guarda o acesso aos dados de todos os clientes. O site de vendas é
   público e recebe tráfego anônimo. Se os dois compartilharem processo, banco e sessão, uma falha no
   site vira acesso a todos os backups. Separados, a central pode ficar atrás de VPN/IP restrito e 2FA.
2. **Disponibilidade.** A central precisa estar no ar justamente quando um servidor caiu. Ela não pode
   depender do mesmo VPS dos sistemas que protege (ver decisão D2).
3. **Ciclo de vida.** O agente instalado nos clientes evolui com versões e atualização assinada; isso
   pede pacotes, contratos versionados e testes próprios.

As decisões que a empresa precisa tomar estão em [06-riscos-e-decisoes.md](06-riscos-e-decisoes.md).
