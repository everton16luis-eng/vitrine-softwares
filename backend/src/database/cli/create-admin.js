// Criação segura do PRIMEIRO administrador.
// - Interativo: pergunta nome, e-mail e senha (a senha não é exibida no terminal).
// - Não interativo: usa ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD do ambiente.
// Recusa-se a executar se já existir um administrador ativo (use o painel para criar outros).
import readline from 'node:readline';
import { withTransaction, closePool, one } from '../pool.js';
import { hashPassword, passwordProblem } from '../../modules/auth/password.js';
import { v, validate } from '../../utils/validation.js';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (str) => { rl.output.write(str.includes(question) ? str : ''); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

try {
  const existing = await one(
    `SELECT u.id FROM usuarios u JOIN usuarios_perfis up ON up.usuario_id = u.id JOIN perfis p ON p.id = up.perfil_id
      WHERE p.codigo = 'administrador' AND u.ativo LIMIT 1`);
  if (existing) {
    console.error('Já existe um administrador ativo. Por segurança, novos usuários devem ser criados pelo painel (Usuários).');
    process.exitCode = 1;
  } else {
    const fromEnv = process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD;
    const nome = fromEnv ? process.env.ADMIN_NAME || 'Administrador' : await ask('Nome do administrador: ');
    const email = fromEnv ? process.env.ADMIN_EMAIL : await ask('E-mail: ');
    const senha = fromEnv ? process.env.ADMIN_PASSWORD : await ask('Senha (mín. 10 caracteres, letras e números): ', { hidden: true });
    if (!fromEnv) {
      const confirm = await ask('Confirme a senha: ', { hidden: true });
      if (confirm !== senha) throw new Error('As senhas não conferem.');
    }
    const { value, errors } = validate({ nome: v.string({ min: 2, max: 160 }), email: v.email() }, { nome, email });
    if (errors) throw new Error(Object.entries(errors).map(([k, m]) => `${k}: ${m}`).join('; '));
    const problem = passwordProblem(senha, value.email);
    if (problem) throw new Error(problem);

    await withTransaction(async (tx) => {
      const role = await tx.one("SELECT id FROM perfis WHERE codigo = 'administrador'");
      if (!role) throw new Error('Perfis não encontrados. Execute antes: npm run db:seed');
      const user = await tx.one(
        "INSERT INTO usuarios (tipo, nome, email, senha_hash, senha_alterada_em) VALUES ('equipe', $1, $2, $3, now()) RETURNING id",
        [value.nome, value.email, await hashPassword(senha)]);
      await tx.query('INSERT INTO usuarios_perfis (usuario_id, perfil_id) VALUES ($1, $2)', [user.id, role.id]);
      await tx.query("INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id) VALUES ($1, $2, 'criar_primeiro_admin', 'usuario', $1)", [user.id, value.nome]);
    });
    console.log(`Administrador criado: ${value.email}. Acesse /admin para entrar.`);
    if (fromEnv) console.log('Lembre-se de remover ADMIN_PASSWORD do arquivo .env.');
  }
} catch (err) {
  console.error(`Não foi possível criar o administrador: ${err.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
