-- =====================================================================
-- 001 - Esquema inicial da plataforma
-- Valores monetários: NUMERIC(14,2). Datas/horas: TIMESTAMPTZ (UTC).
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_atualizar_timestamp() RETURNS trigger AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Controle de acesso
-- ---------------------------------------------------------------------
CREATE TABLE perfis (
  id            SERIAL PRIMARY KEY,
  codigo        VARCHAR(40)  NOT NULL UNIQUE,
  nome          VARCHAR(80)  NOT NULL,
  descricao     TEXT,
  sistema       BOOLEAN      NOT NULL DEFAULT false, -- perfis de sistema não podem ser excluídos
  criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE permissoes (
  id        SERIAL PRIMARY KEY,
  codigo    VARCHAR(60) NOT NULL UNIQUE,
  descricao VARCHAR(200) NOT NULL,
  grupo     VARCHAR(40) NOT NULL
);

CREATE TABLE perfis_permissoes (
  perfil_id    INT NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  permissao_id INT NOT NULL REFERENCES permissoes(id) ON DELETE CASCADE,
  PRIMARY KEY (perfil_id, permissao_id)
);

-- ---------------------------------------------------------------------
-- Arquivos (biblioteca de mídia e documentos privados)
-- ---------------------------------------------------------------------
CREATE TABLE arquivos (
  id                 SERIAL PRIMARY KEY,
  nome_original      VARCHAR(255) NOT NULL,
  chave              VARCHAR(255) NOT NULL UNIQUE, -- caminho relativo dentro do driver de armazenamento
  privado            BOOLEAN      NOT NULL DEFAULT false,
  mime               VARCHAR(100) NOT NULL,
  tamanho            INT          NOT NULL CHECK (tamanho >= 0),
  largura            INT,
  altura             INT,
  texto_alternativo  VARCHAR(300),
  origem             VARCHAR(40)  NOT NULL DEFAULT 'proprio'
                     CHECK (origem IN ('proprio','pexels','unsplash','pixabay','captura_de_tela','cliente','outro')),
  autor              VARCHAR(200),
  url_origem         VARCHAR(500),
  licenca            VARCHAR(200),
  licenca_verificada_em DATE,
  enviado_por        INT,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Clientes e usuários
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
  id             SERIAL PRIMARY KEY,
  nome           VARCHAR(160) NOT NULL,
  email          VARCHAR(254) NOT NULL,
  telefone       VARCHAR(30),
  empresa        VARCHAR(160),
  documento      VARCHAR(30),  -- CPF/CNPJ: preencher somente quando necessário (ex.: emissão fiscal/contrato)
  observacoes    TEXT,
  origem         VARCHAR(40) NOT NULL DEFAULT 'manual',
  anonimizado_em TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_clientes_email ON clientes (lower(email)) WHERE anonimizado_em IS NULL;
CREATE INDEX ix_clientes_nome ON clientes (lower(nome));

CREATE TABLE usuarios (
  id                 SERIAL PRIMARY KEY,
  tipo               VARCHAR(10)  NOT NULL CHECK (tipo IN ('equipe','cliente')),
  nome               VARCHAR(160) NOT NULL,
  email              VARCHAR(254) NOT NULL,
  senha_hash         VARCHAR(255), -- nulo até o convite ser aceito
  ativo              BOOLEAN      NOT NULL DEFAULT true,
  cliente_id         INT REFERENCES clientes(id) ON DELETE RESTRICT,
  tentativas_falhas  INT          NOT NULL DEFAULT 0,
  bloqueado_ate      TIMESTAMPTZ,
  ultimo_login_em    TIMESTAMPTZ,
  senha_alterada_em  TIMESTAMPTZ,
  criado_em          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_usuario_cliente CHECK (
    (tipo = 'cliente' AND cliente_id IS NOT NULL) OR (tipo = 'equipe' AND cliente_id IS NULL)
  )
);
CREATE UNIQUE INDEX ux_usuarios_email ON usuarios (lower(email));
CREATE UNIQUE INDEX ux_usuarios_cliente ON usuarios (cliente_id) WHERE cliente_id IS NOT NULL;

ALTER TABLE arquivos ADD CONSTRAINT fk_arquivos_usuario FOREIGN KEY (enviado_por) REFERENCES usuarios(id) ON DELETE SET NULL;

CREATE TABLE usuarios_perfis (
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  perfil_id  INT NOT NULL REFERENCES perfis(id) ON DELETE RESTRICT,
  PRIMARY KEY (usuario_id, perfil_id)
);

CREATE TABLE sessoes (
  id           BIGSERIAL PRIMARY KEY,
  usuario_id   INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash   CHAR(64) NOT NULL UNIQUE, -- SHA-256 do token; o token em si só existe no cookie
  csrf_token   CHAR(64) NOT NULL,
  ip           VARCHAR(64),
  user_agent   VARCHAR(300),
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em    TIMESTAMPTZ NOT NULL,
  revogada_em  TIMESTAMPTZ
);
CREATE INDEX ix_sessoes_usuario ON sessoes (usuario_id) WHERE revogada_em IS NULL;

CREATE TABLE tokens_acesso (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  finalidade  VARCHAR(20) NOT NULL CHECK (finalidade IN ('redefinir_senha','convite')),
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expira_em   TIMESTAMPTZ NOT NULL,
  usado_em    TIMESTAMPTZ,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
CREATE TABLE categorias (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(120) NOT NULL,
  slug          VARCHAR(140) NOT NULL UNIQUE,
  descricao     TEXT,
  imagem_id     INT REFERENCES arquivos(id) ON DELETE SET NULL,
  ordem         INT NOT NULL DEFAULT 0,
  ativa         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE produtos (
  id                  SERIAL PRIMARY KEY,
  categoria_id        INT NOT NULL REFERENCES categorias(id) ON DELETE RESTRICT,
  nome                VARCHAR(140) NOT NULL,
  slug                VARCHAR(160) NOT NULL UNIQUE,
  resumo              VARCHAR(400) NOT NULL,
  descricao           TEXT,
  problema_resolvido  TEXT,
  publico_alvo        TEXT,
  requisitos_tecnicos TEXT,
  modelo_contratacao  VARCHAR(30) NOT NULL DEFAULT 'sob_orcamento'
                      CHECK (modelo_contratacao IN ('licenca_perpetua','assinatura','implantacao','sob_orcamento','personalizado')),
  preco               NUMERIC(14,2) CHECK (preco IS NULL OR preco >= 0),
  moeda               CHAR(3) NOT NULL DEFAULT 'BRL',
  preco_descricao     VARCHAR(80), -- ex.: "a partir de", "por mês"
  status_comercial    VARCHAR(30) NOT NULL DEFAULT 'em_planejamento'
                      CHECK (status_comercial IN ('em_planejamento','em_desenvolvimento','demonstracao_disponivel','disponivel','em_manutencao','arquivado')),
  publicado           BOOLEAN NOT NULL DEFAULT false,
  publicado_em        TIMESTAMPTZ,
  destaque            BOOLEAN NOT NULL DEFAULT false,
  dados_demonstrativos BOOLEAN NOT NULL DEFAULT false, -- registro criado como demonstração
  imagem_id           INT REFERENCES arquivos(id) ON DELETE SET NULL,
  imagem_url          VARCHAR(300), -- imagem estática do projeto (ex.: mockups em /assets)
  demo_tipo           VARCHAR(10) NOT NULL DEFAULT 'nenhuma' CHECK (demo_tipo IN ('nenhuma','interna','externa')),
  demo_url            VARCHAR(500),
  demo_disponivel     BOOLEAN NOT NULL DEFAULT false,
  demo_aviso          VARCHAR(300),
  documentacao_url    VARCHAR(500),
  manual_url          VARCHAR(500),
  video_url           VARCHAR(500),
  seo_title           VARCHAR(70),
  seo_description     VARCHAR(170),
  ordem               INT NOT NULL DEFAULT 0,
  arquivado_em        TIMESTAMPTZ,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_produto_arquivado_nao_publicado CHECK (NOT (publicado AND status_comercial = 'arquivado')),
  CONSTRAINT ck_produto_demo_externa CHECK (demo_tipo <> 'externa' OR demo_url IS NOT NULL)
);
CREATE INDEX ix_produtos_publicos ON produtos (publicado, ordem) WHERE publicado;
CREATE INDEX ix_produtos_categoria ON produtos (categoria_id);
CREATE INDEX ix_produtos_busca ON produtos USING gin (to_tsvector('portuguese', nome || ' ' || resumo || ' ' || coalesce(descricao,'')));

CREATE TABLE produto_funcionalidades (
  id         SERIAL PRIMARY KEY,
  produto_id INT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  tipo       VARCHAR(20) NOT NULL DEFAULT 'funcionalidade' CHECK (tipo IN ('funcionalidade','beneficio')),
  titulo     VARCHAR(160) NOT NULL,
  descricao  TEXT,
  icone      VARCHAR(40),
  ordem      INT NOT NULL DEFAULT 0
);
CREATE INDEX ix_produto_funcionalidades ON produto_funcionalidades (produto_id, tipo, ordem);

CREATE TABLE produto_imagens (
  id         SERIAL PRIMARY KEY,
  produto_id INT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  arquivo_id INT REFERENCES arquivos(id) ON DELETE CASCADE,
  url_estatica VARCHAR(300),
  legenda    VARCHAR(200),
  ordem      INT NOT NULL DEFAULT 0,
  CONSTRAINT ck_imagem_origem CHECK (arquivo_id IS NOT NULL OR url_estatica IS NOT NULL)
);
CREATE INDEX ix_produto_imagens ON produto_imagens (produto_id, ordem);

CREATE TABLE produto_faqs (
  id         SERIAL PRIMARY KEY,
  produto_id INT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  pergunta   VARCHAR(300) NOT NULL,
  resposta   TEXT NOT NULL,
  ordem      INT NOT NULL DEFAULT 0
);

CREATE TABLE servicos (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(140) NOT NULL,
  slug            VARCHAR(160) NOT NULL UNIQUE,
  resumo          VARCHAR(400) NOT NULL,
  descricao       TEXT,
  icone           VARCHAR(40),
  imagem_id       INT REFERENCES arquivos(id) ON DELETE SET NULL,
  beneficios      TEXT[] NOT NULL DEFAULT '{}',
  preco           NUMERIC(14,2) CHECK (preco IS NULL OR preco >= 0),
  preco_descricao VARCHAR(80),
  status          VARCHAR(20) NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','publicado','arquivado')),
  ordem           INT NOT NULL DEFAULT 0,
  seo_title       VARCHAR(70),
  seo_description VARCHAR(170),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE planos (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(120) NOT NULL,
  descricao       TEXT,
  tipo_cobranca   VARCHAR(30) NOT NULL
                  CHECK (tipo_cobranca IN ('licenca_perpetua','assinatura_mensal','assinatura_anual','implantacao_unica','sob_orcamento','personalizado')),
  preco           NUMERIC(14,2) CHECK (preco IS NULL OR preco >= 0),
  moeda           CHAR(3) NOT NULL DEFAULT 'BRL',
  periodicidade   VARCHAR(20) NOT NULL DEFAULT 'unica' CHECK (periodicidade IN ('unica','mensal','anual','nao_aplicavel')),
  limites         TEXT,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  ordem           INT NOT NULL DEFAULT 0,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_plano_preco CHECK (tipo_cobranca IN ('sob_orcamento','personalizado') OR preco IS NOT NULL)
);

CREATE TABLE plano_funcionalidades (
  id        SERIAL PRIMARY KEY,
  plano_id  INT NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
  descricao VARCHAR(200) NOT NULL,
  ordem     INT NOT NULL DEFAULT 0
);

CREATE TABLE planos_produtos (
  plano_id   INT NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
  produto_id INT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  PRIMARY KEY (plano_id, produto_id)
);

-- ---------------------------------------------------------------------
-- Leads, contatos e LGPD
-- ---------------------------------------------------------------------
CREATE TABLE leads (
  id             SERIAL PRIMARY KEY,
  nome           VARCHAR(160) NOT NULL,
  email          VARCHAR(254) NOT NULL,
  telefone       VARCHAR(30),
  empresa        VARCHAR(160),
  status         VARCHAR(30) NOT NULL DEFAULT 'novo'
                 CHECK (status IN ('novo','em_atendimento','aguardando_cliente','qualificado','convertido','encerrado','spam')),
  origem         VARCHAR(40) NOT NULL DEFAULT 'site',
  responsavel_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  cliente_id     INT REFERENCES clientes(id) ON DELETE SET NULL,
  anonimizado_em TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_leads_status ON leads (status, criado_em DESC);
CREATE INDEX ix_leads_email ON leads (lower(email));

CREATE TABLE contatos (
  id               SERIAL PRIMARY KEY,
  lead_id          INT REFERENCES leads(id) ON DELETE SET NULL,
  tipo             VARCHAR(20) NOT NULL DEFAULT 'contato' CHECK (tipo IN ('contato','orcamento','apresentacao','personalizado')),
  nome             VARCHAR(160) NOT NULL,
  email            VARCHAR(254) NOT NULL,
  telefone         VARCHAR(30),
  empresa          VARCHAR(160),
  produto_id       INT REFERENCES produtos(id) ON DELETE SET NULL,
  servico_id       INT REFERENCES servicos(id) ON DELETE SET NULL,
  assunto          VARCHAR(200),
  mensagem         TEXT NOT NULL,
  dados_extras     JSONB NOT NULL DEFAULT '{}'::jsonb, -- levantamento de requisitos (desenvolvimento personalizado)
  consentimento_em TIMESTAMPTZ NOT NULL,              -- ciência da política de privacidade
  aceita_comunicacoes BOOLEAN NOT NULL DEFAULT false, -- consentimento opcional, nunca pré-marcado
  ip_hash          CHAR(64),                           -- hash do IP (com segredo) para antiabuso, sem guardar o IP
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_contatos_criado ON contatos (criado_em DESC);

CREATE TABLE lead_interacoes (
  id         SERIAL PRIMARY KEY,
  lead_id    INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo       VARCHAR(20) NOT NULL CHECK (tipo IN ('nota','status','email','ligacao','reuniao','whatsapp','sistema','conversao')),
  descricao  TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_lead_interacoes ON lead_interacoes (lead_id, criado_em DESC);

CREATE TABLE solicitacoes_titulares (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(160) NOT NULL,
  email         VARCHAR(254) NOT NULL,
  tipo          VARCHAR(20) NOT NULL CHECK (tipo IN ('acesso','correcao','exclusao','anonimizacao','portabilidade','revogacao','informacao')),
  descricao     TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'recebida' CHECK (status IN ('recebida','em_analise','atendida','indeferida')),
  resposta      TEXT,
  atendido_por  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  atendido_em   TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Comercial: orçamentos, pedidos, pagamentos, contratos e licenças
-- ---------------------------------------------------------------------
CREATE TABLE orcamentos (
  id                    SERIAL PRIMARY KEY,
  numero                VARCHAR(20) NOT NULL UNIQUE,
  lead_id               INT REFERENCES leads(id) ON DELETE SET NULL,
  cliente_id            INT REFERENCES clientes(id) ON DELETE RESTRICT,
  contato_id            INT REFERENCES contatos(id) ON DELETE SET NULL,
  produto_id            INT REFERENCES produtos(id) ON DELETE SET NULL,
  servico_id            INT REFERENCES servicos(id) ON DELETE SET NULL,
  titulo                VARCHAR(200) NOT NULL,
  descricao_solicitacao TEXT,
  status                VARCHAR(30) NOT NULL DEFAULT 'novo'
                        CHECK (status IN ('novo','em_analise','em_elaboracao','enviado','aguardando_resposta','aceito','recusado','expirado','cancelado')),
  moeda                 CHAR(3) NOT NULL DEFAULT 'BRL',
  subtotal              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  desconto              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  total                 NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  validade              DATE,
  condicoes_comerciais  TEXT,
  informacoes_adicionais TEXT,
  observacoes_internas  TEXT,
  responsavel_id        INT REFERENCES usuarios(id) ON DELETE SET NULL,
  enviado_em            TIMESTAMPTZ,
  respondido_em         TIMESTAMPTZ,
  motivo_recusa         TEXT,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_orcamento_desconto CHECK (desconto <= subtotal)
);
CREATE INDEX ix_orcamentos_status ON orcamentos (status, criado_em DESC);
CREATE INDEX ix_orcamentos_cliente ON orcamentos (cliente_id);

CREATE TABLE orcamento_itens (
  id             SERIAL PRIMARY KEY,
  orcamento_id   INT NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  produto_id     INT REFERENCES produtos(id) ON DELETE SET NULL,
  servico_id     INT REFERENCES servicos(id) ON DELETE SET NULL,
  plano_id       INT REFERENCES planos(id) ON DELETE SET NULL,
  descricao      VARCHAR(300) NOT NULL,
  quantidade     INT NOT NULL CHECK (quantidade > 0),
  preco_unitario NUMERIC(14,2) NOT NULL CHECK (preco_unitario >= 0),
  desconto       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  total          NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  ordem          INT NOT NULL DEFAULT 0
);

CREATE TABLE orcamento_historico (
  id              SERIAL PRIMARY KEY,
  orcamento_id    INT NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  usuario_id      INT REFERENCES usuarios(id) ON DELETE SET NULL,
  status_anterior VARCHAR(30),
  status_novo     VARCHAR(30),
  descricao       TEXT NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pedidos (
  id               SERIAL PRIMARY KEY,
  numero           VARCHAR(20) NOT NULL UNIQUE,
  cliente_id       INT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  orcamento_id     INT REFERENCES orcamentos(id) ON DELETE SET NULL,
  status           VARCHAR(30) NOT NULL DEFAULT 'rascunho'
                   CHECK (status IN ('rascunho','aguardando_pagamento','em_andamento','concluido','cancelado')),
  status_pagamento VARCHAR(20) NOT NULL DEFAULT 'pendente'
                   CHECK (status_pagamento IN ('pendente','parcial','pago','estornado')),
  forma_pagamento  VARCHAR(20) CHECK (forma_pagamento IN ('pix','boleto','transferencia','cartao','gateway','outro')),
  moeda            CHAR(3) NOT NULL DEFAULT 'BRL',
  subtotal         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  desconto         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  total            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  desconto_autorizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  observacoes      TEXT,
  data_pedido      DATE NOT NULL DEFAULT CURRENT_DATE,
  data_vencimento  DATE,
  concluido_em     TIMESTAMPTZ,
  cancelado_em     TIMESTAMPTZ,
  criado_por       INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pedido_desconto CHECK (desconto <= subtotal)
);
CREATE INDEX ix_pedidos_cliente ON pedidos (cliente_id);
CREATE INDEX ix_pedidos_data ON pedidos (data_pedido DESC);

CREATE TABLE pedido_itens (
  id             SERIAL PRIMARY KEY,
  pedido_id      INT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id     INT REFERENCES produtos(id) ON DELETE SET NULL,
  servico_id     INT REFERENCES servicos(id) ON DELETE SET NULL,
  plano_id       INT REFERENCES planos(id) ON DELETE SET NULL,
  descricao      VARCHAR(300) NOT NULL,
  quantidade     INT NOT NULL CHECK (quantidade > 0),
  preco_unitario NUMERIC(14,2) NOT NULL CHECK (preco_unitario >= 0),
  desconto       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  total          NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  ordem          INT NOT NULL DEFAULT 0
);

CREATE TABLE pedido_historico (
  id          SERIAL PRIMARY KEY,
  pedido_id   INT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  usuario_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  descricao   TEXT NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pagamentos (
  id                 SERIAL PRIMARY KEY,
  pedido_id          INT NOT NULL REFERENCES pedidos(id) ON DELETE RESTRICT,
  valor              NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  metodo             VARCHAR(20) NOT NULL CHECK (metodo IN ('pix','boleto','transferencia','cartao','gateway','outro')),
  provedor           VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (provedor IN ('manual','mercadopago','stripe')),
  status             VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','falhou','estornado','cancelado')),
  referencia_externa VARCHAR(120), -- id da transação no provedor ou identificador do comprovante
  confirmado_em      TIMESTAMPTZ,
  confirmado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL, -- confirmação manual (conferência de extrato)
  observacoes        TEXT,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pagamento_confirmado CHECK (status <> 'confirmado' OR confirmado_em IS NOT NULL)
);
CREATE UNIQUE INDEX ux_pagamentos_ref ON pagamentos (provedor, referencia_externa) WHERE referencia_externa IS NOT NULL AND provedor <> 'manual';

CREATE TABLE eventos_pagamento (
  id           BIGSERIAL PRIMARY KEY,
  provedor     VARCHAR(20) NOT NULL,
  evento_id    VARCHAR(120) NOT NULL,
  tipo         VARCHAR(80),
  assinatura_valida BOOLEAN NOT NULL,
  processado_em TIMESTAMPTZ,
  payload      JSONB NOT NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provedor, evento_id)
);

CREATE TABLE contratos (
  id            SERIAL PRIMARY KEY,
  numero        VARCHAR(20) NOT NULL UNIQUE,
  cliente_id    INT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  pedido_id     INT REFERENCES pedidos(id) ON DELETE SET NULL,
  titulo        VARCHAR(200) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','vigente','suspenso','encerrado','cancelado')),
  data_inicio   DATE,
  data_fim      DATE,
  valor         NUMERIC(14,2) CHECK (valor IS NULL OR valor >= 0),
  moeda         CHAR(3) NOT NULL DEFAULT 'BRL',
  arquivo_id    INT REFERENCES arquivos(id) ON DELETE SET NULL,
  observacoes   TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_contrato_datas CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio)
);
CREATE INDEX ix_contratos_cliente ON contratos (cliente_id);

CREATE TABLE licencas (
  id            SERIAL PRIMARY KEY,
  identificador VARCHAR(40) NOT NULL UNIQUE, -- identificador administrativo, não é chave de ativação
  cliente_id    INT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  produto_id    INT NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
  contrato_id   INT REFERENCES contratos(id) ON DELETE SET NULL,
  pedido_id     INT REFERENCES pedidos(id) ON DELETE SET NULL,
  tipo          VARCHAR(20) NOT NULL CHECK (tipo IN ('perpetua','assinatura','avaliacao','personalizada')),
  status        VARCHAR(20) NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','suspensa','expirada','revogada')),
  data_inicio   DATE NOT NULL,
  data_fim      DATE,
  limites       TEXT,
  observacoes   TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_licenca_datas CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);
CREATE INDEX ix_licencas_cliente ON licencas (cliente_id);

CREATE TABLE cliente_arquivos (
  id         SERIAL PRIMARY KEY,
  cliente_id INT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  arquivo_id INT NOT NULL REFERENCES arquivos(id) ON DELETE CASCADE,
  titulo     VARCHAR(200) NOT NULL,
  descricao  TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, arquivo_id)
);

CREATE TABLE chamados (
  id            SERIAL PRIMARY KEY,
  cliente_id    INT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  usuario_id    INT REFERENCES usuarios(id) ON DELETE SET NULL,
  produto_id    INT REFERENCES produtos(id) ON DELETE SET NULL,
  assunto       VARCHAR(200) NOT NULL,
  mensagem      TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','em_atendimento','respondido','fechado')),
  resposta      TEXT,
  respondido_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  respondido_em TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_chamados_cliente ON chamados (cliente_id);

-- ---------------------------------------------------------------------
-- Conteúdo, configurações, notificações e auditoria
-- ---------------------------------------------------------------------
CREATE TABLE paginas (
  id              SERIAL PRIMARY KEY,
  slug            VARCHAR(120) NOT NULL UNIQUE,
  titulo          VARCHAR(200) NOT NULL,
  conteudo        TEXT NOT NULL DEFAULT '', -- Markdown (renderizado com escape de HTML)
  tipo            VARCHAR(20) NOT NULL DEFAULT 'institucional' CHECK (tipo IN ('institucional','juridica')),
  revisao_pendente BOOLEAN NOT NULL DEFAULT false, -- exibe aviso de documento pendente de revisão
  publicado       BOOLEAN NOT NULL DEFAULT true,
  seo_title       VARCHAR(70),
  seo_description VARCHAR(170),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conteudos (
  chave         VARCHAR(100) PRIMARY KEY, -- ex.: home.hero.titulo
  grupo         VARCHAR(40) NOT NULL,
  rotulo        VARCHAR(120) NOT NULL,
  tipo          VARCHAR(20) NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','texto_longo','markdown','link','imagem')),
  valor         TEXT NOT NULL DEFAULT '',
  arquivo_id    INT REFERENCES arquivos(id) ON DELETE SET NULL,
  ordem         INT NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE faqs (
  id            SERIAL PRIMARY KEY,
  pergunta      VARCHAR(300) NOT NULL,
  resposta      TEXT NOT NULL,
  ordem         INT NOT NULL DEFAULT 0,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE configuracoes (
  chave         VARCHAR(80) PRIMARY KEY,
  valor         JSONB NOT NULL,
  publica       BOOLEAN NOT NULL DEFAULT false, -- pode ser exposta ao site público
  descricao     VARCHAR(200),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE modelos_email (
  chave         VARCHAR(60) PRIMARY KEY,
  nome          VARCHAR(120) NOT NULL,
  assunto       VARCHAR(200) NOT NULL,
  corpo         TEXT NOT NULL, -- texto com marcadores {{variavel}}
  variaveis     TEXT[] NOT NULL DEFAULT '{}',
  ativo         BOOLEAN NOT NULL DEFAULT true,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE emails_registro (
  id           BIGSERIAL PRIMARY KEY,
  modelo       VARCHAR(60),
  destinatario VARCHAR(254) NOT NULL,
  assunto      VARCHAR(200) NOT NULL,
  status       VARCHAR(20) NOT NULL CHECK (status IN ('enviado','nao_configurado','falhou')),
  erro         VARCHAR(500),
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notificacoes (
  id         BIGSERIAL PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE, -- nulo = toda a equipe com a permissão indicada
  permissao  VARCHAR(60),
  tipo       VARCHAR(40) NOT NULL,
  titulo     VARCHAR(200) NOT NULL,
  mensagem   TEXT,
  link       VARCHAR(300),
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE notificacoes_lidas (
  notificacao_id BIGINT NOT NULL REFERENCES notificacoes(id) ON DELETE CASCADE,
  usuario_id     INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lida_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notificacao_id, usuario_id)
);

CREATE TABLE auditoria (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nome VARCHAR(160), -- cópia para preservar o histórico se o usuário for removido
  acao        VARCHAR(60) NOT NULL,
  entidade    VARCHAR(60) NOT NULL,
  entidade_id VARCHAR(40),
  detalhes    JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          VARCHAR(64),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_auditoria_data ON auditoria (criado_em DESC);
CREATE INDEX ix_auditoria_entidade ON auditoria (entidade, entidade_id);

-- Contagem diária agregada, sem dados pessoais (não exige cookies)
CREATE TABLE visualizacoes_produtos (
  produto_id INT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  data       DATE NOT NULL,
  total      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (produto_id, data)
);

CREATE TABLE sequencias_documentos (
  prefixo VARCHAR(10) NOT NULL,
  ano     INT NOT NULL,
  ultimo  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (prefixo, ano)
);

-- Triggers de atualizado_em
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['perfis','arquivos','clientes','usuarios','categorias','produtos','servicos','planos','leads',
    'solicitacoes_titulares','orcamentos','pedidos','pagamentos','contratos','licencas','chamados','paginas','conteudos',
    'faqs','configuracoes','modelos_email']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_atualizado BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp()', t);
  END LOOP;
END $$;
