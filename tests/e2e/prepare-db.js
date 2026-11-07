// Prepara o banco de TESTES (DATABASE_URL_TEST, nome terminado em _test) para a verificação no navegador:
// recria o esquema com as migrações e os seeds do projeto e cria um usuário da equipe e um cliente
// com a senha de teste usada nos testes de integração. Nunca toca o banco de desenvolvimento.
import { resetDatabase, createStaff, createCustomer, closeDatabase, db } from '../integration/helpers.js';

export const E2E_ADMIN = 'e2e-admin@exemplo.test';
export const E2E_CLIENTE = 'e2e-cliente@exemplo.test';

await resetDatabase();
await createStaff(E2E_ADMIN, 'administrador', { nome: 'Equipe E2E' });
const { clienteId } = await createCustomer(E2E_CLIENTE, { nome: 'Cliente E2E' });
// Um lead real pelo mesmo caminho do formulário público não é possível aqui sem servidor;
// os registros comerciais são criados pela própria interface durante os testes.
const n = await db.one('SELECT count(*)::int AS n FROM produtos');
console.log(`Banco de testes pronto: ${n.n} produtos dos seeds, cliente #${clienteId}.`);
await closeDatabase();
