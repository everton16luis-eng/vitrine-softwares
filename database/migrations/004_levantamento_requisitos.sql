-- Levantamento de Requisitos: entrevistas de descoberta com clientes em potencial.
--
-- Organização
--   lr_clientes / lr_projetos  repositório de descoberta. Um cliente tem vários projetos; um projeto
--                              tem vários levantamentos. O cliente daqui NÃO é o cadastro comercial
--                              ("clientes"), que exige e-mail único e está ligado a conta, pedidos e
--                              LGPD: quem participa de uma reunião de descoberta muitas vezes ainda é só
--                              um contato. O vínculo com o cadastro comercial/lead é opcional.
--   lr_etapas / lr_categorias / lr_perguntas
--                              banco de perguntas administrável (nada fica fixo no código).
--
-- Preservação histórica (requisito 15.1)
--   lr_roteiro_etapas / lr_roteiro_perguntas
--                              fotografia do roteiro tirada na criação do levantamento (textos, tipos,
--                              alternativas, categoria). Imutável: editar ou excluir uma pergunta do
--                              banco não altera levantamentos existentes.
--   lr_versoes                 cada levantamento tem versões numeradas. Só existe uma versão "em
--                              trabalho" por vez; a versão concluída fica travada (trigger) e a
--                              reabertura cria a versão seguinte, copiando o conteúdo.
--   lr_historico               valor anterior e novo de cada alteração, com usuário e data/hora.
--                              Não pode ser apagado; só a própria sessão de edição (mesmo usuário,
--                              mesmo campo, até 5 minutos) pode atualizar o "valor novo".
--   lr_relatorios              PDFs gerados, cada um ligado à versão que o originou. Imutável.

-- ---------------------------------------------------------------------
-- Banco de perguntas
-- ---------------------------------------------------------------------
CREATE TABLE lr_etapas (
  id            SERIAL PRIMARY KEY,
  titulo        VARCHAR(160) NOT NULL,
  descricao     TEXT,
  ordem         INT NOT NULL DEFAULT 0,
  ativa         BOOLEAN NOT NULL DEFAULT true,
  padrao        BOOLEAN NOT NULL DEFAULT false,  -- criada pela instalação (não pode ser excluída, só desativada)
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Categorias agrupam respostas na consolidação do relatório (problemas, regras, integrações...).
CREATE TABLE lr_categorias (
  id            SERIAL PRIMARY KEY,
  chave         VARCHAR(40) NOT NULL UNIQUE CHECK (chave ~ '^[a-z][a-z0-9_]{1,39}$'),
  titulo        VARCHAR(120) NOT NULL,
  descricao     TEXT,
  ordem         INT NOT NULL DEFAULT 0,
  ativa         BOOLEAN NOT NULL DEFAULT true,
  padrao        BOOLEAN NOT NULL DEFAULT false,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lr_perguntas (
  id             SERIAL PRIMARY KEY,
  etapa_id       INT NOT NULL REFERENCES lr_etapas(id) ON DELETE RESTRICT,
  categoria_id   INT REFERENCES lr_categorias(id) ON DELETE SET NULL,
  enunciado      VARCHAR(500) NOT NULL,
  orientacao     TEXT,
  tipo           VARCHAR(20) NOT NULL CHECK (tipo IN ('texto_curto','texto_longo','sim_nao','selecao_unica','selecao_multipla','numero','data','observacoes')),
  obrigatoria    BOOLEAN NOT NULL DEFAULT false,
  ordem          INT NOT NULL DEFAULT 0,
  ativa          BOOLEAN NOT NULL DEFAULT true,
  personalizada  BOOLEAN NOT NULL DEFAULT true,  -- false = roteiro inicial (só pode ser desativada)
  opcoes         JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(opcoes) = 'array'),
  revisao        INT NOT NULL DEFAULT 1,          -- incrementa a cada edição (fica gravada na fotografia)
  criado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_lr_pergunta_opcoes CHECK (tipo NOT IN ('selecao_unica','selecao_multipla') OR jsonb_array_length(opcoes) >= 2)
);
CREATE INDEX ix_lr_perguntas_etapa ON lr_perguntas (etapa_id, ordem);

-- ---------------------------------------------------------------------
-- Clientes e projetos da descoberta
-- ---------------------------------------------------------------------
CREATE TABLE lr_clientes (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(160) NOT NULL,
  empresa       VARCHAR(160),
  email         VARCHAR(254),
  telefone      VARCHAR(30),
  observacoes   TEXT,
  cliente_id    INT REFERENCES clientes(id) ON DELETE SET NULL,  -- vínculo opcional com o cadastro comercial
  lead_id       INT REFERENCES leads(id) ON DELETE SET NULL,
  criado_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_lr_clientes_nome ON lr_clientes (lower(nome));

CREATE TABLE lr_projetos (
  id            SERIAL PRIMARY KEY,
  cliente_id    INT NOT NULL REFERENCES lr_clientes(id) ON DELETE RESTRICT,
  nome          VARCHAR(200) NOT NULL,
  descricao     TEXT,
  situacao      VARCHAR(30) NOT NULL DEFAULT 'em_descoberta'
                CHECK (situacao IN ('em_descoberta','aguardando_detalhamento','em_especificacao','em_proposta','encerrado')),
  criado_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_lr_projetos_cliente ON lr_projetos (cliente_id);

-- ---------------------------------------------------------------------
-- Levantamentos
-- ---------------------------------------------------------------------
CREATE TABLE levantamentos (
  id                   SERIAL PRIMARY KEY,
  codigo               VARCHAR(20) NOT NULL UNIQUE,
  projeto_id           INT NOT NULL REFERENCES lr_projetos(id) ON DELETE RESTRICT,
  responsavel_id       INT REFERENCES usuarios(id) ON DELETE SET NULL,
  responsavel_nome     VARCHAR(160) NOT NULL,   -- cópia: preserva o nome mesmo se o usuário for removido
  data_reuniao         DATE NOT NULL,
  observacoes_iniciais TEXT,
  status               VARCHAR(20) NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento','concluido','arquivado')),
  status_anterior      VARCHAR(20) CHECK (status_anterior IN ('em_andamento','concluido')),
  etapa_atual          INT NOT NULL DEFAULT 0 CHECK (etapa_atual BETWEEN 0 AND 1000),  -- posição para retomar a entrevista
  origem_id            INT REFERENCES levantamentos(id) ON DELETE SET NULL,           -- duplicado a partir de
  categorias           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- fotografia das categorias (consolidação)
  criado_por           INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em         TIMESTAMPTZ,
  arquivado_em         TIMESTAMPTZ
);
CREATE INDEX ix_levantamentos_projeto ON levantamentos (projeto_id);
CREATE INDEX ix_levantamentos_status ON levantamentos (status, criado_em DESC);
CREATE INDEX ix_levantamentos_data ON levantamentos (data_reuniao DESC);

-- Fotografia do roteiro (imutável)
CREATE TABLE lr_roteiro_etapas (
  id               SERIAL PRIMARY KEY,
  levantamento_id  INT NOT NULL REFERENCES levantamentos(id) ON DELETE CASCADE,
  ordem            INT NOT NULL,
  titulo           VARCHAR(160) NOT NULL,
  descricao        TEXT,
  origem_etapa_id  INT,  -- sem FK: a etapa original pode deixar de existir
  UNIQUE (levantamento_id, ordem)
);

CREATE TABLE lr_roteiro_perguntas (
  id                  SERIAL PRIMARY KEY,
  levantamento_id     INT NOT NULL REFERENCES levantamentos(id) ON DELETE CASCADE,
  etapa_id            INT NOT NULL REFERENCES lr_roteiro_etapas(id) ON DELETE CASCADE,
  ordem               INT NOT NULL,
  origem_pergunta_id  INT,  -- sem FK, pelo mesmo motivo
  origem_revisao      INT,
  enunciado           VARCHAR(500) NOT NULL,
  orientacao          TEXT,
  tipo                VARCHAR(20) NOT NULL,
  obrigatoria         BOOLEAN NOT NULL,
  opcoes              JSONB NOT NULL DEFAULT '[]'::jsonb,
  categoria_chave     VARCHAR(40),
  categoria_titulo    VARCHAR(120)
);
CREATE INDEX ix_lr_roteiro_perguntas ON lr_roteiro_perguntas (levantamento_id, etapa_id, ordem);

-- Versões do conteúdo
CREATE TABLE lr_versoes (
  id                 SERIAL PRIMARY KEY,
  levantamento_id    INT NOT NULL REFERENCES levantamentos(id) ON DELETE CASCADE,
  numero             INT NOT NULL CHECK (numero >= 1),
  status             VARCHAR(20) NOT NULL DEFAULT 'em_trabalho' CHECK (status IN ('em_trabalho','concluida')),
  consolidacao       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- síntese do entrevistador por categoria + resumo
  observacoes_finais TEXT,
  origem_versao_id   INT REFERENCES lr_versoes(id),  -- sempre do mesmo levantamento (removidas juntas)
  motivo_reabertura  TEXT,
  criada_por         INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criada_por_nome    VARCHAR(160),
  criada_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluida_por      INT REFERENCES usuarios(id) ON DELETE SET NULL,
  concluida_por_nome VARCHAR(160),
  concluida_em       TIMESTAMPTZ,
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (levantamento_id, numero)
);
CREATE UNIQUE INDEX ux_lr_versao_em_trabalho ON lr_versoes (levantamento_id) WHERE status = 'em_trabalho';

CREATE TABLE lr_respostas (
  versao_id      INT NOT NULL REFERENCES lr_versoes(id) ON DELETE CASCADE,
  pergunta_id    INT NOT NULL REFERENCES lr_roteiro_perguntas(id) ON DELETE CASCADE,
  valor          JSONB,                 -- { "valor": <conforme o tipo>, "detalhe": "texto opcional" }
  pulada         BOOLEAN NOT NULL DEFAULT false,
  atualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (versao_id, pergunta_id)
);

CREATE TABLE lr_notas_etapa (
  versao_id      INT NOT NULL REFERENCES lr_versoes(id) ON DELETE CASCADE,
  etapa_id       INT NOT NULL REFERENCES lr_roteiro_etapas(id) ON DELETE CASCADE,
  texto          TEXT NOT NULL,
  atualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (versao_id, etapa_id)
);

-- Investigação de problemas — 5 porquês
CREATE TABLE lr_investigacoes (
  id             SERIAL PRIMARY KEY,
  versao_id      INT NOT NULL REFERENCES lr_versoes(id) ON DELETE CASCADE,
  ordem          INT NOT NULL DEFAULT 0,
  problema       TEXT NOT NULL,
  niveis         JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(niveis) = 'array' AND jsonb_array_length(niveis) <= 5),
  causa          TEXT,
  observacoes    TEXT,
  criado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_lr_investigacoes_versao ON lr_investigacoes (versao_id, ordem);

-- Histórico de alterações (somente inclusão; ver trigger)
CREATE TABLE lr_historico (
  id               BIGSERIAL PRIMARY KEY,
  levantamento_id  INT NOT NULL REFERENCES levantamentos(id) ON DELETE CASCADE,
  versao_id        INT REFERENCES lr_versoes(id) ON DELETE CASCADE,
  tipo             VARCHAR(20) NOT NULL CHECK (tipo IN ('resposta','nota_etapa','investigacao','consolidacao','dados')),
  referencia_id    INT,                 -- pergunta, etapa ou investigação (do roteiro do levantamento)
  campo            VARCHAR(60),         -- subcampo alterado (ex.: chave da consolidação)
  rotulo           VARCHAR(500),        -- texto legível (enunciado no momento da alteração)
  valor_anterior   JSONB,
  valor_novo       JSONB,
  usuario_id       INT REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nome     VARCHAR(160),
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_lr_historico ON lr_historico (levantamento_id, criado_em DESC);
CREATE INDEX ix_lr_historico_ref ON lr_historico (versao_id, tipo, referencia_id, campo);

-- PDFs gerados (imutável)
CREATE TABLE lr_relatorios (
  id               SERIAL PRIMARY KEY,
  levantamento_id  INT NOT NULL REFERENCES levantamentos(id) ON DELETE CASCADE,
  versao_id        INT NOT NULL REFERENCES lr_versoes(id) ON DELETE CASCADE,
  versao_numero    INT NOT NULL,
  versao_status    VARCHAR(20) NOT NULL,  -- situação da versão no momento da geração
  arquivo_chave    VARCHAR(80) NOT NULL,  -- armazenamento privado
  nome_arquivo     VARCHAR(200) NOT NULL,
  tamanho          INT NOT NULL,
  paginas          INT,
  sha256           CHAR(64) NOT NULL,
  conteudo_sha256  CHAR(64) NOT NULL,     -- impressão digital dos dados usados no documento
  gerado_por       INT REFERENCES usuarios(id) ON DELETE SET NULL,
  gerado_por_nome  VARCHAR(160),
  gerado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_lr_relatorios ON lr_relatorios (levantamento_id, gerado_em DESC);

-- ---------------------------------------------------------------------
-- Regras de integridade no banco (valem mesmo fora da aplicação)
-- ---------------------------------------------------------------------

-- Fotografia do roteiro e relatórios: nunca alterados. A exclusão só acontece em cascata, quando o
-- próprio levantamento é removido (a aplicação não oferece exclusão de levantamentos: só arquivamento).
CREATE OR REPLACE FUNCTION fn_lr_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registro histórico do levantamento não pode ser alterado (%).', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lr_roteiro_etapas_imutavel BEFORE UPDATE ON lr_roteiro_etapas FOR EACH ROW EXECUTE FUNCTION fn_lr_imutavel();
CREATE TRIGGER trg_lr_roteiro_perguntas_imutavel BEFORE UPDATE ON lr_roteiro_perguntas FOR EACH ROW EXECUTE FUNCTION fn_lr_imutavel();
CREATE TRIGGER trg_lr_relatorios_imutavel BEFORE UPDATE ON lr_relatorios FOR EACH ROW EXECUTE FUNCTION fn_lr_imutavel();

-- Histórico: sem exclusão direta; atualização só para estender a mesma sessão de edição.
CREATE OR REPLACE FUNCTION fn_lr_historico_protegido() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Permitido apenas em cascata (remoção do levantamento inteiro).
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'O histórico do levantamento não pode ser apagado.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.levantamento_id IS DISTINCT FROM OLD.levantamento_id OR NEW.versao_id IS DISTINCT FROM OLD.versao_id
     OR NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.referencia_id IS DISTINCT FROM OLD.referencia_id
     OR NEW.campo IS DISTINCT FROM OLD.campo OR NEW.valor_anterior IS DISTINCT FROM OLD.valor_anterior
     OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id OR NEW.criado_em IS DISTINCT FROM OLD.criado_em
     OR OLD.atualizado_em < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'O histórico do levantamento não pode ser alterado.' USING ERRCODE = 'P0001';
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_lr_historico_protegido BEFORE UPDATE OR DELETE ON lr_historico FOR EACH ROW EXECUTE FUNCTION fn_lr_historico_protegido();

-- Versão concluída: travada. Nada de alterar a própria versão nem seu conteúdo.
CREATE OR REPLACE FUNCTION fn_lr_versao_travada() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;  -- cascata do levantamento
  IF OLD.status = 'concluida' THEN
    RAISE EXCEPTION 'A versão % do levantamento está concluída e não pode ser alterada.', OLD.numero USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_lr_versoes_travada BEFORE UPDATE OR DELETE ON lr_versoes FOR EACH ROW EXECUTE FUNCTION fn_lr_versao_travada();

CREATE OR REPLACE FUNCTION fn_lr_conteudo_da_versao() RETURNS trigger AS $$
DECLARE st VARCHAR(20);
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;  -- cascata
  SELECT status INTO st FROM lr_versoes WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.versao_id ELSE NEW.versao_id END;
  IF st IS DISTINCT FROM 'em_trabalho' THEN
    RAISE EXCEPTION 'Somente a versão em trabalho do levantamento pode ser alterada.' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.versao_id IS DISTINCT FROM OLD.versao_id THEN
    RAISE EXCEPTION 'Conteúdo não pode mudar de versão.' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_lr_respostas_versao BEFORE INSERT OR UPDATE OR DELETE ON lr_respostas FOR EACH ROW EXECUTE FUNCTION fn_lr_conteudo_da_versao();
CREATE TRIGGER trg_lr_notas_versao BEFORE INSERT OR UPDATE OR DELETE ON lr_notas_etapa FOR EACH ROW EXECUTE FUNCTION fn_lr_conteudo_da_versao();
CREATE TRIGGER trg_lr_investigacoes_versao BEFORE INSERT OR UPDATE OR DELETE ON lr_investigacoes FOR EACH ROW EXECUTE FUNCTION fn_lr_conteudo_da_versao();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lr_etapas','lr_categorias','lr_perguntas','lr_clientes','lr_projetos','levantamentos']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_atualizado BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp()', t);
  END LOOP;
END $$;
