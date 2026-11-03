// Domínios das instalações: verificação de DNS (A/AAAA) contra os IPs do servidor
// e instruções simples para o cliente quando o apontamento ainda não está correto.
import dns from 'node:dns';
import net from 'node:net';
import { db } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { audit } from '../../services/audit.js';
import { notFound } from '../../utils/errors.js';
import { pagination, paged, likeTerm } from '../../utils/common.js';
import { addLog } from './deployments.service.js';

export const DNS_STATUS = { nao_verificado: 'Não verificado', ok: 'Apontando para o servidor', divergente: 'Apontando para outro servidor', sem_registro: 'Sem registro', erro: 'Erro na consulta' };
export const SSL_STATUS = { pendente: 'Pendente', emitido: 'Válido', erro: 'Erro', expirando: 'Expira em breve', expirado: 'Expirado' };

let resolver = {
  resolve4: (h) => dns.promises.resolve4(h),
  resolve6: (h) => dns.promises.resolve6(h)
};
/** Somente testes: substitui o resolvedor DNS. */
export const _setResolver = (r) => { resolver = r; };

const serverIps = () => env.implantacao.ips;

async function lookup(fn, host) {
  try { return { ips: await fn(host) }; } catch (err) {
    if (['ENODATA', 'ENOTFOUND', 'ENODOMAIN', 'NXDOMAIN'].includes(err.code)) return { ips: [] };
    return { ips: [], error: err.code || err.message };
  }
}

/** Instruções em linguagem simples para o cliente ajustar o DNS no provedor dele. */
export function dnsInstructions(nome, ips = serverIps()) {
  const v4 = ips.filter((ip) => net.isIPv4(ip));
  const v6 = ips.filter((ip) => net.isIPv6(ip));
  if (!v4.length && !v6.length) return 'Configuração técnica pendente: defina IMPLANTACAO_IPS com o(s) IP(s) público(s) do servidor.';
  const labels = nome.split('.');
  const host = labels.length > 2 ? labels.slice(0, -2).join('.') : '@ (raiz do domínio)';
  const lines = [
    `No painel onde o domínio ${nome} é administrado (registro.br, Cloudflare, GoDaddy, Hostinger etc.), abra a área de DNS e:`,
    ...v4.map((ip) => `• crie (ou altere) um registro do tipo A com nome "${host}" apontando para ${ip};`),
    ...v6.map((ip) => `• crie (ou altere) um registro do tipo AAAA com nome "${host}" apontando para ${ip};`),
    v6.length ? null : '• se existir um registro AAAA para esse nome, remova-o;',
    '• se usar Cloudflare, deixe a nuvem cinza ("somente DNS") até o certificado ser emitido.',
    'A propagação costuma levar de alguns minutos a algumas horas. A verificação é repetida automaticamente.'
  ].filter(Boolean);
  return lines.join('\n');
}

/** Consulta A/AAAA e compara com os IPs do servidor. */
export async function checkDns(nome) {
  const ips = serverIps();
  const [a, aaaa] = await Promise.all([lookup(resolver.resolve4, nome), lookup(resolver.resolve6, nome)]);
  const ipv4 = a.ips;
  const ipv6 = aaaa.ips;
  let status;
  let mensagem;
  if (a.error && aaaa.error) { status = 'erro'; mensagem = `Falha na consulta DNS (${a.error}).`; }
  else if (!ipv4.length && !ipv6.length) { status = 'sem_registro'; mensagem = 'O domínio ainda não possui registros A/AAAA.'; }
  else if (!ips.length) { status = 'erro'; mensagem = 'IMPLANTACAO_IPS não configurado: não é possível comparar com o servidor.'; }
  else {
    const all = [...ipv4, ...ipv6];
    const wrong = all.filter((ip) => !ips.includes(ip));
    const v4ok = !ipv4.length || ipv4.every((ip) => ips.includes(ip));
    const v6ok = !ipv6.length || ipv6.every((ip) => ips.includes(ip));
    if (v4ok && v6ok && all.some((ip) => ips.includes(ip))) { status = 'ok'; mensagem = `Apontando corretamente (${all.join(', ')}).`; }
    else { status = 'divergente'; mensagem = `Registros apontam para ${wrong.join(', ')} — o servidor usa ${ips.join(', ')}.`; }
  }
  return { status_dns: status, ipv4, ipv6, mensagem, instrucoes: status === 'ok' ? null : dnsInstructions(nome, ips) };
}

/** Verifica e grava o resultado no domínio da implantação. */
export async function verifyDomain(implantacaoId, conn = db) {
  const d = await conn.one('SELECT * FROM dominios WHERE implantacao_id = $1', [implantacaoId]);
  if (!d) throw notFound('Domínio');
  const r = await checkDns(d.nome);
  await conn.query('UPDATE dominios SET status_dns = $2, ipv4 = $3, ipv6 = $4, dns_verificado_em = now(), mensagem = $5 WHERE id = $1',
    [d.id, r.status_dns, r.ipv4, r.ipv6, r.mensagem]);
  return { ...r, nome: d.nome };
}

export async function listDomains(query = {}) {
  const p = pagination(query);
  const params = [];
  const where = [];
  if (query.busca) { params.push(likeTerm(query.busca)); where.push(`(d.nome ILIKE $1 OR c.nome ILIKE $1)`); }
  if (query.status_dns && DNS_STATUS[query.status_dns]) { params.push(query.status_dns); where.push(`d.status_dns = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM dominios d JOIN implantacoes i ON i.id = d.implantacao_id JOIN clientes c ON c.id = i.cliente_id JOIN produtos p ON p.id = i.produto_id';
  const { total } = await db.one(`SELECT count(*)::int AS total ${from} ${w}`, params);
  const rows = await db.many(`SELECT d.*, i.codigo, i.status AS implantacao_status, c.nome AS cliente_nome, p.nome AS produto_nome
    ${from} ${w} ORDER BY d.nome LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

export async function verifyDomainById(domainId, req) {
  const d = await db.one('SELECT implantacao_id FROM dominios WHERE id = $1', [domainId]);
  if (!d) throw notFound('Domínio');
  const r = await verifyDomain(d.implantacao_id);
  await addLog(db, d.implantacao_id, r.status_dns === 'ok' ? 'info' : 'aviso', `DNS de ${r.nome} verificado pelo painel: ${r.mensagem}`);
  await audit(req, 'verificar_dns', 'dominio', domainId, { status: r.status_dns });
  return r;
}
