export class AppError extends Error {
  constructor(message, { status = 400, code = 'ERRO', details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true; // mensagem pode ser exibida ao usuário
  }
}

export class ValidationError extends AppError {
  constructor(fields, message = 'Verifique os campos destacados.') {
    super(message, { status: 422, code: 'VALIDACAO', details: fields });
  }
}

export const notFound = (what = 'Registro') => new AppError(`${what} não encontrado.`, { status: 404, code: 'NAO_ENCONTRADO' });
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new AppError(msg, { status: 403, code: 'SEM_PERMISSAO' });
export const unauthorized = (msg = 'Faça login para continuar.') => new AppError(msg, { status: 401, code: 'NAO_AUTENTICADO' });
export const conflict = (msg) => new AppError(msg, { status: 409, code: 'CONFLITO' });
export const badRequest = (msg) => new AppError(msg, { status: 400, code: 'REQUISICAO_INVALIDA' });

/** Converte violações conhecidas do PostgreSQL em mensagens amigáveis. */
export function fromPgError(err) {
  if (!err || !err.code) return null;
  switch (err.code) {
    case '23505':
      return conflict(uniqueMessage(err.constraint));
    case '23503':
      return conflict('Operação não permitida: existem registros relacionados.');
    case '23514':
      return new AppError('Os dados violam uma regra de negócio.', { status: 422, code: 'REGRA', details: { constraint: err.constraint } });
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return badRequest('Formato de dado inválido.');
    default:
      return null;
  }
}

function uniqueMessage(constraint = '') {
  if (constraint.includes('email')) return 'Já existe um cadastro com este e-mail.';
  if (constraint.includes('slug')) return 'Já existe um registro com este endereço (slug).';
  if (constraint.includes('identificador')) return 'Identificador já utilizado.';
  return 'Registro duplicado.';
}
