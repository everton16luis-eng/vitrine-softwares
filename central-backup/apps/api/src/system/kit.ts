// Kit de recuperação da central: tudo o que NÃO está no backup do banco e é necessário para
// reerguer a central em outra máquina — a KEK (sem ela os segredos do dump são ilegíveis), o acesso
// ao repositório do backup da central e as referências do gateway. Cifrado com uma frase-senha
// (scrypt + AES-256-GCM). Deve ser guardado fora do servidor (cofre de senhas, papel em cofre).
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export interface KitContent {
  created_at: string;
  kek: string;                 // conteúdo do arquivo da KEK (linhas id:base64)
  self_backup: { repository: string; password: string } | null;
  database_name: string;
  gateway: { public_url: string; ca_sha256: string | null };
  notes: string;
}

const HEADER = 'CENTRAL-BACKUP-KIT-1';
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export function passphraseProblem(p: string) {
  if (p.length < 16) return 'A frase-senha precisa ter pelo menos 16 caracteres.';
  if (new Set(p).size < 8) return 'A frase-senha é repetitiva demais.';
  return null;
}

export function sealKit(content: KitContent, passphrase: string) {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase.normalize('NFC'), salt, 32, SCRYPT);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(HEADER));
  const data = Buffer.concat([c.update(JSON.stringify(content)), c.final()]);
  const body = { kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
  const b64 = Buffer.from(JSON.stringify(body)).toString('base64');
  return `${HEADER}\n# Kit de recuperação da Central de Backup — criado em ${content.created_at}.\n# Abra com: npm run kit -- abrir --arquivo <este arquivo>\n${b64.match(/.{1,76}/g)!.join('\n')}\n`;
}

export function openKit(text: string, passphrase: string): KitContent {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== HEADER) throw new Error('Arquivo não é um kit de recuperação da central.');
  let body: Record<string, any>;
  try { body = JSON.parse(Buffer.from(lines.filter((l) => !l.startsWith('#')).slice(1).join(''), 'base64').toString('utf8')); } catch { throw new Error('Kit corrompido.'); }
  if (body.kdf !== 'scrypt' || body.N > 2 ** 20) throw new Error('Parâmetros do kit não suportados.');
  const key = scryptSync(passphrase.normalize('NFC'), Buffer.from(body.salt, 'base64'), 32, { N: body.N, r: body.r, p: body.p, maxmem: SCRYPT.maxmem * 4 });
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(body.iv, 'base64'));
  d.setAAD(Buffer.from(HEADER));
  d.setAuthTag(Buffer.from(body.tag, 'base64'));
  try {
    return JSON.parse(Buffer.concat([d.update(Buffer.from(body.data, 'base64')), d.final()]).toString('utf8'));
  } catch { throw new Error('Frase-senha incorreta ou kit adulterado.'); }
}
