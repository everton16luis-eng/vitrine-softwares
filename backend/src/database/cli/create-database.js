// Cria os bancos de desenvolvimento e de testes (se ainda não existirem),
// conectando-se ao banco de manutenção "postgres" com as mesmas credenciais.
import 'dotenv/config';
import pg from 'pg';

const targets = [process.env.DATABASE_URL, process.env.DATABASE_URL_TEST].filter(Boolean);
if (!targets.length) {
  console.error('Defina DATABASE_URL (e opcionalmente DATABASE_URL_TEST) no arquivo .env.');
  process.exit(1);
}

for (const url of targets) {
  const parsed = new URL(url);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(dbName)) {
    console.error(`Nome de banco inválido: "${dbName}". Use apenas letras, números e _.`);
    process.exitCode = 1;
    continue;
  }
  parsed.pathname = '/postgres';
  const client = new pg.Client({
    connectionString: parsed.toString(),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  try {
    await client.connect();
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount) {
      console.log(`[db] banco "${dbName}" já existe.`);
    } else {
      // Identificador validado pela regex acima; CREATE DATABASE não aceita parâmetros.
      await client.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
      console.log(`[db] banco "${dbName}" criado.`);
    }
  } catch (err) {
    console.error(`[db] não foi possível criar "${dbName}": ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
