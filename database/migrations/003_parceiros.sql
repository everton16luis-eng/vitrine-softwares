-- Clientes e parceiros exibidos na página inicial ("Empresas que confiam em nossas soluções").
-- Não confundir com a tabela "clientes" (cadastro comercial): aqui ficam apenas as marcas
-- autorizadas para divulgação.
--
-- Logomarcas:
--   - o arquivo ORIGINAL enviado fica no armazenamento privado (nunca é servido no site) e
--     permite reprocessar quando o padrão visual mudar;
--   - as versões PROCESSADAS (WebP, dimensões idênticas para todas as marcas) ficam no
--     armazenamento público: monocromática (exibição padrão) e colorida (passar o mouse).

CREATE TABLE parceiros (
  id                     SERIAL PRIMARY KEY,
  nome                   VARCHAR(150) NOT NULL,
  site_url               VARCHAR(500),
  ativo                  BOOLEAN NOT NULL DEFAULT true,
  divulgacao_autorizada  BOOLEAN NOT NULL DEFAULT false,
  ordem                  INT NOT NULL DEFAULT 0,
  observacoes            TEXT,
  logo_original_chave    VARCHAR(80),
  logo_original_mime     VARCHAR(40),
  logo_original_nome     VARCHAR(200),
  logo_original_tamanho  INT,
  logo_original_largura  INT,
  logo_original_altura   INT,
  logo_mono_chave        VARCHAR(80),
  logo_cor_chave         VARCHAR(80),
  logo_info              JSONB,
  logo_processada_em     TIMESTAMPTZ,
  criado_em              TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_parceiros_publicos ON parceiros (ordem, nome) WHERE ativo AND divulgacao_autorizada;

CREATE TRIGGER trg_parceiros_atualizado BEFORE UPDATE ON parceiros FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp();
