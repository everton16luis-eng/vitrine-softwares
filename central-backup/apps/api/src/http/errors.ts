// Respostas de erro padronizadas (RFC 9457). Erros inesperados nunca expõem detalhes internos.
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@central/shared';

const TYPE = 'https://central-backup.local/erros/';

export function errorHandler(err: FastifyError | AppError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.code(err.status).type('application/problem+json').send({
      type: TYPE + err.code.toLowerCase(), title: err.message, status: err.status, code: err.code, fields: err.fields, request_id: req.id
    });
  }
  const fe = err as FastifyError;
  if (fe.validation) {
    const fields: Record<string, string> = {};
    for (const v of fe.validation) {
      const missing = (v.params as { missingProperty?: string })?.missingProperty;
      const extra = (v.params as { additionalProperty?: string })?.additionalProperty;
      const key = [v.instancePath?.slice(1).replace(/\//g, '.'), missing ?? extra].filter(Boolean).join('.') || fe.validationContext || '_';
      fields[key] ??= extra ? 'Campo não permitido.' : missing ? 'Campo obrigatório.' : (v.message ?? 'Valor inválido.');
    }
    return reply.code(422).type('application/problem+json').send({ type: TYPE + 'validacao', title: 'Verifique os campos destacados.', status: 422, code: 'VALIDACAO', fields, request_id: req.id });
  }
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    return reply.code(fe.statusCode).type('application/problem+json').send({
      type: TYPE + 'requisicao', title: fe.statusCode === 429 ? 'Muitas tentativas. Aguarde e tente novamente.' : 'Requisição inválida.', status: fe.statusCode, code: fe.code ?? 'REQUISICAO_INVALIDA', request_id: req.id
    });
  }
  req.log.error({ err }, 'erro inesperado');
  if (process.env.CB_DEBUG) console.error('[CB_DEBUG]', err);
  return reply.code(500).type('application/problem+json').send({ type: TYPE + 'interno', title: 'Erro interno. A equipe pode consultar o identificador nos logs.', status: 500, code: 'ERRO_INTERNO', request_id: req.id });
}
