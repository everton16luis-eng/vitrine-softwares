// Gera apps/web/src/lib/perms.gen.ts a partir das rotas da API (método + caminho -> permissão),
// para o painel esconder ações que o usuário não pode executar. Rode: npm run web:gen
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = 'apps/api/src/modules';
const out: Record<string, string | null> = {};
const re = /(?:\br|\bapp)\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,\s*\{[^}]*?preValidation:\s*requireAuth\(('([^']*)')?\)/gs;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
  const src = readFileSync(path.join(dir, f), 'utf8');
  for (const m of src.matchAll(re)) out[`${m[1]!.toUpperCase()} ${m[2]!.replace(/:(\w+)/g, '{$1}')}`] = m[4] ?? null;
}
const keys = Object.keys(out).sort();
writeFileSync('apps/web/src/lib/perms.gen.ts', `// GERADO por scripts/web-gen.ts — não edite à mão.\nexport const ROUTE_PERMS: Record<string, string | null> = {\n${keys.map((k) => `  '${k}': ${out[k] === null ? 'null' : `'${out[k]}'`}`).join(',\n')}\n};\n`);
console.log(`${keys.length} rotas`);

// Schemas de `config`/`secret` por tipo (na API o campo é um objeto livre validado depois, então o
// OpenAPI não os descreve): exportados aqui para o formulário do painel usar exatamente as mesmas regras.
const { LocalRestConfig, S3Config, S3Credentials } = await import('../apps/api/src/storage/destinations.ts');
const { EmailConfig, WebhookSecret, WhatsappConfig, WhatsappSecret } = await import('../apps/api/src/alerts/channels.ts');
const schemas = { storage: { local_rest: LocalRestConfig, s3: S3Config, s3_credential: S3Credentials }, channels: { email: EmailConfig, webhook_secret: WebhookSecret, whatsapp: WhatsappConfig, whatsapp_secret: WhatsappSecret } };
writeFileSync('apps/web/src/lib/schemas.gen.ts', `// GERADO por scripts/web-gen.ts — não edite à mão.\nimport type { JsonSchema } from './openapi.ts';\nexport const CONFIG_SCHEMAS = ${JSON.stringify(schemas, null, 1)} as unknown as Record<'storage' | 'channels', Record<string, JsonSchema>>;\n`);
console.log('schemas de configuração gerados');
