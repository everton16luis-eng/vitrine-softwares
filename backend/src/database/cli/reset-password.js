// Redefinição de senha de um usuário da equipe pelo terminal (ex.: administrador que esqueceu a senha).
// - Interativo: pergunta o e-mail e a nova senha (a senha não é exibida no terminal).
// - Também desbloqueia a conta, zera as tentativas falhas e encerra as sessões abertas.
import readline from 'node:readline';
import { withTransaction, closePool } from '../pool.js';
import { hashPassword, passwordProblem } from '../../modules/auth/password.js';
import { revokeAllSessions } from '../../modules/auth/session.service.js';

// Um único leitor para todas as perguntas: funciona no terminal e com entrada redirecionada.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
let hiding = false;
const write = rl._writeToOutput?.bind(rl);
// Enquanto a senha é digitada, só a quebra de linha final é exibida.
if (write) rl._writeToOutput = (str) => { if (!hiding) write(str); else if (/[\r\n]/.test(str)) write('\n'); };

async function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  hiding = hidden && process.stdin.isTTY;
  const { value = '' } = await lines.next();
  hiding = false;
  return value.trim();
}

try {
  const email = (await ask('E-mail do usuário: ')).toLowerCase();
  const senha = await ask('Nova senha (mín. 10 caracteres, letras e números): ', { hidden: true });
  const confirm = await ask('Confirme a nova senha: ', { hidden: true });
  if (confirm !== senha) throw new Error('As senhas não conferem.');
  const problem = passwordProblem(senha, email);
  if (problem) throw new Error(problem);

  await withTransaction(async (tx) => {
    const user = await tx.one("SELECT id, nome FROM usuarios WHERE lower(email) = $1 AND tipo = 'equipe' FOR UPDATE", [email]);
    if (!user) throw new Error('Nenhum usuário da equipe com esse e-mail.');
    await tx.query('UPDATE usuarios SET senha_hash = $2, senha_alterada_em = now(), tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = $1',
      [user.id, await hashPassword(senha)]);
    await revokeAllSessions(user.id, tx);
    await tx.query("INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id) VALUES ($1, $2, 'redefinir_senha_terminal', 'usuario', $3)",
      [user.id, user.nome, String(user.id)]);
  });
  console.log(`Senha redefinida para ${email}. A conta foi desbloqueada; acesse /admin para entrar.`);
} catch (err) {
  console.error(`Não foi possível redefinir a senha: ${err.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
  await closePool();
}
