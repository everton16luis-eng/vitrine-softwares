// Erros com significado para a API. Mensagens em português, seguras para exibir ao usuário.
// O formato de resposta segue RFC 9457 (problem details) — ver apps/api/src/plugins/errors.ts.

export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors | undefined;

  constructor(message: string, opts: { status?: number; code?: string; fields?: FieldErrors } = {}) {
    super(message);
    this.status = opts.status ?? 400;
    this.code = opts.code ?? 'ERRO';
    this.fields = opts.fields;
  }
}

export const validationError = (fields: FieldErrors, message = 'Verifique os campos destacados.') =>
  new AppError(message, { status: 422, code: 'VALIDACAO', fields });
export const notFound = (what = 'Registro') => new AppError(`${what} não encontrado.`, { status: 404, code: 'NAO_ENCONTRADO' });
export const unauthorized = (message = 'Faça login para continuar.') => new AppError(message, { status: 401, code: 'NAO_AUTENTICADO' });
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(message, { status: 403, code: 'SEM_PERMISSAO' });
export const conflict = (message: string) => new AppError(message, { status: 409, code: 'CONFLITO' });
export const badRequest = (message: string) => new AppError(message, { status: 400, code: 'REQUISICAO_INVALIDA' });
