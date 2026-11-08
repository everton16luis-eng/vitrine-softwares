# Levantamento de Requisitos

Módulo do painel (menu **Descoberta → Levantamento de Requisitos**, rota `#/levantamentos`) para conduzir
a reunião de descoberta com o cliente: entrevista guiada por etapas, 5 porquês, consolidação, conclusão
com versionamento e relatório PDF.

## Fluxo

1. **Novo levantamento** — cliente e projeto existentes ou novos (um cliente tem vários projetos; um
   projeto tem vários levantamentos), responsável, data da reunião e observações iniciais. O roteiro
   ativo do banco de perguntas é copiado para o levantamento (alterações futuras no banco não o afetam).
2. **Entrevista** — uma etapa por vez, com trilho de etapas, barra de progresso, perguntas obrigatórias
   marcadas, "Pular", complemento nas respostas estruturadas e observações por etapa. Tudo é salvo
   sozinho (indicador "Salvo às…"); ao voltar, a entrevista abre na última etapa trabalhada.
3. **5 porquês** — até cinco níveis por problema, causa identificada e observações.
4. **Revisão e conclusão** — situação, obrigatórias pendentes (com atalho para cada uma), consolidação
   por tema (resumo executivo, contexto, objetivo, categorias) com as respostas relacionadas, observações
   finais e **Concluir** (exige as obrigatórias respondidas; trava a versão).
5. **Reabrir** — pede o motivo e cria a versão seguinte com o mesmo conteúdo. A versão concluída nunca é
   alterada (protegida também por gatilhos no banco) e pode ser consultada e comparada.
6. **Relatórios PDF** — pré-visualização em HTML e geração do PDF da versão em exibição. Cada PDF fica
   guardado no armazenamento privado, ligado à versão, com páginas, tamanho e SHA-256; nunca é sobrescrito.
   Nome: `levantamento-requisitos-<cliente>-<projeto>.pdf` (sufixo `-vN` a partir da versão 2).

Também: duplicar (mesmas perguntas, sem respostas), comparar duas entrevistas ou versões, arquivar,
histórico de alterações (valor anterior/novo, usuário, data) e o **banco de perguntas** (etapas,
categorias, perguntas dos 8 tipos, alternativas, obrigatoriedade, ativação, ordem, duplicação; só
perguntas/etapas/categorias personalizadas podem ser excluídas — as do roteiro inicial são desativadas).

## Permissões

| Código | Permite |
| --- | --- |
| `levantamentos.ver` | Consultar levantamentos, versões, histórico, pré-visualização e PDFs |
| `levantamentos.criar` | Criar e duplicar levantamentos, clientes e projetos |
| `levantamentos.editar` | Responder, 5 porquês, consolidação, arquivar/desarquivar, editar clientes e projetos |
| `levantamentos.perguntas` | Gerenciar o banco de perguntas |
| `levantamentos.concluir` | Concluir e reabrir |
| `levantamentos.pdf` | Gerar PDFs |

O administrador recebe todas. Em instalações novas o perfil *Gerente comercial* recebe todas menos
`levantamentos.perguntas`; em instalações existentes atribua pelo menu *Usuários e perfis*.

## Gerador de PDF

Usa `playwright-core` (dependência de produção) com o **Chrome/Chromium do sistema** — nenhum navegador é
baixado. O caminho é detectado sozinho; se não for encontrado, informe `PDF_CHROME_PATH` no `.env`.
`PDF_TIMEOUT_SEGUNDOS` (padrão 90) limita cada geração. O HTML é renderizado offline, com JavaScript
desligado e sem acesso à rede. Chrome 131 ou mais novo produz cabeçalho, rodapé e "Página X de Y" pelo
próprio CSS; versões antigas usam um rodapé de reserva.

## Atualização em produção (VPS)

Comandos um por linha, como usuário do sistema (`vitrine`), na pasta da aplicação:

```bash
npm ci --omit=dev
```

```bash
npm run db:migrate
```

Aplicar só os seeds deste módulo (permissões e roteiro inicial de 8 etapas e 75 perguntas), sem tocar
no catálogo:

```bash
node --input-type=module -e "import { withTransaction, closePool } from './backend/src/database/pool.js'; for (const f of ['01-acesso.js', '06-levantamento-requisitos.js']) { const m = await import('./database/seeds/' + f); await withTransaction((tx) => m.seed(tx)); } await closePool();"
```

Instalar o Google Chrome, se o servidor ainda não tiver (Ubuntu x86-64; o pacote `.deb` oficial evita o
Chromium em *snap*, cujo confinamento costuma falhar quando executado por um serviço systemd):

```bash
wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
```

```bash
sudo apt-get install -y /tmp/google-chrome.deb
```

Depois:

```bash
sudo systemctl restart vitrine-softwares
```

Em *Levantamentos → (um levantamento) → Relatórios PDF* o botão "Gerar PDF" fica desabilitado, com aviso,
enquanto o navegador não for encontrado.

## Testes e exemplos

- `tests/unit/requirements-answers.test.js` — regras puras (tipos de resposta, progresso, 5 porquês, nome
  do arquivo, texto seguro do relatório).
- `tests/integration/12-levantamento-requisitos.test.js` — API completa, permissões, versionamento e
  proteções no banco, PDF guardado.
- `tests/e2e/levantamento.mjs` — fluxo completo no navegador (desktop e 390 px) com axe-core; capturas em
  `docs/ui/capturas/levantamento/`.
- `tests/e2e/relatorios-exemplo.mjs` — gera os PDFs de exemplo em `docs/levantamento/exemplos/`
  (pequeno, intermediário, extenso, respostas muito longas, sem respostas, 5 porquês).
