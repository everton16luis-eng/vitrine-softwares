-- Central de Implantação: receitas por software, implantações por cliente,
-- fila de tarefas executada pelo agente, passos com ponto de controle,
-- logs, verificações, domínios, segredos cifrados e backups.
-- Nenhuma tabela existente é alterada.

CREATE TABLE receitas_implantacao (
  id               SERIAL PRIMARY KEY,
  produto_id       INT NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
  nome             VARCHAR(120) NOT NULL,
  ativa            BOOLEAN NOT NULL DEFAULT true,
  tecnologia       VARCHAR(20) NOT NULL DEFAULT 'node' CHECK (tecnologia IN ('node')),
  repositorio_url  VARCHAR(500) NOT NULL,
  referencia       VARCHAR(100) NOT NULL DEFAULT 'main',      -- branch ou tag
  versao_app       VARCHAR(40),                                -- rótulo exibido (ex.: 1.4.0)
  node_versao_minima SMALLINT NOT NULL DEFAULT 20 CHECK (node_versao_minima BETWEEN 16 AND 40),
  requer_banco     BOOLEAN NOT NULL DEFAULT true,
  comandos         JSONB NOT NULL DEFAULT '{}'::jsonb,         -- { instalacao:[[argv]], build, migracoes, seed, personalizacao, inicio:[argv] }
  variaveis        JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{ nome, origem, valor }]
  campos_cliente   JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{ chave, rotulo, tipo, obrigatorio, responsavel, ajuda }]
  diretorios_persistentes JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["storage", "uploads"]
  nginx_opcoes     JSONB NOT NULL DEFAULT '{}'::jsonb,
  verificacoes     JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{ caminho, status, contem }]
  memoria_mb       INT CHECK (memoria_mb IS NULL OR memoria_mb > 0),
  disco_mb         INT CHECK (disco_mb IS NULL OR disco_mb > 0),
  orientacoes_uso  TEXT,                                       -- vai para o resumo de entrega
  token_git_cifrado TEXT,                                      -- token de leitura de repositório privado (cifrado; nunca devolvido)
  observacoes      TEXT,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (produto_id, nome)
);

CREATE TABLE implantacoes (
  id              SERIAL PRIMARY KEY,
  codigo          VARCHAR(20) NOT NULL UNIQUE,
  slug            VARCHAR(40) NOT NULL UNIQUE,
  cliente_id      INT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  produto_id      INT NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
  receita_id      INT NOT NULL REFERENCES receitas_implantacao(id) ON DELETE RESTRICT,
  pedido_id       INT REFERENCES pedidos(id) ON DELETE SET NULL,
  contrato_id     INT REFERENCES contratos(id) ON DELETE SET NULL,
  licenca_id      INT REFERENCES licencas(id) ON DELETE SET NULL,
  responsavel_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'em_preparacao'
                  CHECK (status IN ('em_preparacao','aguardando_cliente','pronta_para_instalar','em_execucao','aguardando_tecnico','falhou','em_validacao','pronta_para_entrega','entregue','cancelada')),
  etapa_atual     SMALLINT NOT NULL DEFAULT 2 CHECK (etapa_atual BETWEEN 1 AND 7),
  progresso       SMALLINT NOT NULL DEFAULT 0 CHECK (progresso BETWEEN 0 AND 100),
  porta           INT NOT NULL UNIQUE CHECK (porta BETWEEN 4100 AND 4999),
  dados_cliente   JSONB NOT NULL DEFAULT '{}'::jsonb,   -- somente valores NÃO sigilosos
  versao_instalada VARCHAR(100),                    -- commit/tag efetivamente instalado
  release_atual   VARCHAR(20),                      -- pasta em releases/ (AAAAMMDDHHMMSS) usada pelos passos
  contratada_em   DATE NOT NULL DEFAULT CURRENT_DATE,
  instalada_em    TIMESTAMPTZ,
  entregue_em     TIMESTAMPTZ,
  entregue_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
  resumo_entrega  JSONB,
  observacoes     TEXT,
  criado_por      INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_implantacoes_cliente ON implantacoes (cliente_id);
CREATE INDEX ix_implantacoes_status ON implantacoes (status);

-- Linha do tempo das 7 etapas
CREATE TABLE implantacao_etapas (
  implantacao_id INT NOT NULL REFERENCES implantacoes(id) ON DELETE CASCADE,
  etapa          SMALLINT NOT NULL CHECK (etapa BETWEEN 1 AND 7),
  status         VARCHAR(20) NOT NULL DEFAULT 'pendente'
                 CHECK (status IN ('pendente','em_andamento','aguardando_cliente','aguardando_tecnico','concluida','falhou')),
  detalhe        TEXT,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (implantacao_id, etapa)
);

-- Passos técnicos com ponto de controle (retomada e reexecução)
CREATE TABLE implantacao_passos (
  implantacao_id INT NOT NULL REFERENCES implantacoes(id) ON DELETE CASCADE,
  passo          VARCHAR(40) NOT NULL,
  ordem          SMALLINT NOT NULL,
  etapa          SMALLINT NOT NULL CHECK (etapa BETWEEN 3 AND 6),
  status         VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','executando','concluido','falhou','ignorado','aguardando')),
  tentativas     INT NOT NULL DEFAULT 0,
  iniciado_em    TIMESTAMPTZ,
  concluido_em   TIMESTAMPTZ,
  erro           TEXT,
  PRIMARY KEY (implantacao_id, passo)
);

-- Fila de tarefas consumida pelo agente
CREATE TABLE tarefas_implantacao (
  id             SERIAL PRIMARY KEY,
  implantacao_id INT NOT NULL REFERENCES implantacoes(id) ON DELETE CASCADE,
  tipo           VARCHAR(20) NOT NULL CHECK (tipo IN ('instalar','reexecutar','personalizar','testar')),
  passo          VARCHAR(40),
  status         VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','executando','concluida','falhou','cancelada','aguardando')),
  tentativas     INT NOT NULL DEFAULT 0,
  solicitada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  agente         VARCHAR(80),
  heartbeat_em   TIMESTAMPTZ,
  criada_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciada_em    TIMESTAMPTZ,
  finalizada_em  TIMESTAMPTZ,
  erro           TEXT
);
-- Uma única tarefa ativa por implantação (impede execuções concorrentes e duplicadas)
CREATE UNIQUE INDEX ux_tarefa_ativa ON tarefas_implantacao (implantacao_id) WHERE status IN ('pendente','executando');
CREATE INDEX ix_tarefas_fila ON tarefas_implantacao (status, criada_em);

CREATE TABLE implantacao_logs (
  id             BIGSERIAL PRIMARY KEY,
  implantacao_id INT NOT NULL REFERENCES implantacoes(id) ON DELETE CASCADE,
  tarefa_id      INT REFERENCES tarefas_implantacao(id) ON DELETE SET NULL,
  passo          VARCHAR(40),
  nivel          VARCHAR(10) NOT NULL CHECK (nivel IN ('info','aviso','erro','comando','saida')),
  mensagem       TEXT NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_logs_implantacao ON implantacao_logs (implantacao_id, id);

CREATE TABLE implantacao_verificacoes (
  id             SERIAL PRIMARY KEY,
  implantacao_id INT NOT NULL REFERENCES implantacoes(id) ON DELETE CASCADE,
  tarefa_id      INT REFERENCES tarefas_implantacao(id) ON DELETE SET NULL,
  codigo         VARCHAR(40) NOT NULL,
  descricao      VARCHAR(200) NOT NULL,
  ok             BOOLEAN NOT NULL,
  detalhe        TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_verificacoes_implantacao ON implantacao_verificacoes (implantacao_id, id DESC);

-- Segredos cifrados (AES-256-GCM). O valor nunca é devolvido pela API.
CREATE TABLE implantacao_segredos (
  implantacao_id INT NOT NULL REFERENCES implantacoes(id) ON DELETE CASCADE,
  chave          VARCHAR(64) NOT NULL,
  valor_cifrado  TEXT NOT NULL,
  origem         VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','gerado','sistema')),
  definido_por   INT REFERENCES usuarios(id) ON DELETE SET NULL,
  definido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (implantacao_id, chave)
);

CREATE TABLE dominios (
  id               SERIAL PRIMARY KEY,
  implantacao_id   INT NOT NULL UNIQUE REFERENCES implantacoes(id) ON DELETE CASCADE,
  nome             VARCHAR(253) NOT NULL,
  status_dns       VARCHAR(20) NOT NULL DEFAULT 'nao_verificado' CHECK (status_dns IN ('nao_verificado','ok','divergente','sem_registro','erro')),
  ipv4             TEXT[] NOT NULL DEFAULT '{}',
  ipv6             TEXT[] NOT NULL DEFAULT '{}',
  dns_verificado_em TIMESTAMPTZ,
  status_ssl       VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status_ssl IN ('pendente','emitido','erro','expirando','expirado')),
  ssl_expira_em    TIMESTAMPTZ,
  ssl_verificado_em TIMESTAMPTZ,
  renovacao_automatica BOOLEAN,
  mensagem         TEXT,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_dominios_nome ON dominios (lower(nome));

CREATE TABLE implantacao_backups (
  id             SERIAL PRIMARY KEY,
  implantacao_id INT NOT NULL REFERENCES implantacoes(id) ON DELETE CASCADE,
  arquivo        VARCHAR(300) NOT NULL,
  tamanho_bytes  BIGINT,
  motivo         VARCHAR(200) NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sinal de vida dos agentes (o painel avisa quando nenhum agente está ativo)
CREATE TABLE agentes_implantacao (
  nome       VARCHAR(80) PRIMARY KEY,
  executor   VARCHAR(20) NOT NULL,
  versao     VARCHAR(40),
  visto_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['receitas_implantacao','implantacoes','dominios']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_atualizado BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp()', t);
  END LOOP;
END $$;
