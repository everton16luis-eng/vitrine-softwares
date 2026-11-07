// Formulário gerado a partir do JSON Schema da API. Cada campo vira o controle adequado (texto,
// número, enum, booleano, listas uma-por-linha, objetos aninhados) e os campos `*_id`/`*_ids` viram
// seletores com os registros reais. A conversão para o corpo final respeita `nullable`/obrigatório.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api.ts';
import { enumValues, typeOf, type JsonSchema } from '../lib/openapi.ts';
import { Input, Label, Select, Textarea, statusLabel } from './ui/index.tsx';
import { cn } from '../lib/utils.ts';

export const LABELS: Record<string, string> = {
  legal_name: 'Razão social', trade_name: 'Nome fantasia', cnpj: 'CNPJ', tech_contact: 'Contato técnico', email: 'E-mail', phone: 'Telefone',
  notes: 'Observações', status: 'Situação', rpo_minutes: 'RPO (minutos)', rto_minutes: 'RTO (minutos)', client_id: 'Cliente', server_id: 'Servidor',
  name: 'Nome', hostname: 'Hostname', ip_addresses: 'Endereços IP (um por linha)', provider: 'Provedor', ttl_minutes: 'Validade (minutos)',
  reason: 'Motivo', operation: 'Operação', params: 'Parâmetros', password: 'Senha', roles: 'Perfis', client_ids: 'Clientes permitidos (vazio = conforme perfil)',
  current_password: 'Senha atual', new_password: 'Senha nova', engine: 'Motor', db_name: 'Nome do banco', host: 'Host', port: 'Porta',
  socket_path: 'Socket', file_path: 'Arquivo (SQLite)', tech_user: 'Usuário técnico', technology: 'Tecnologia', version: 'Versão',
  install_dir: 'Diretório de instalação', systemd_unit: 'Unidade systemd', data_dirs: 'Diretórios de dados (um por linha)',
  config_files: 'Arquivos de configuração (um por linha)', excludes: 'Exclusões (uma por linha)', domains: 'Domínios (um por linha)',
  database_ids: 'Bancos usados', kind: 'Tipo', config: 'Configuração', immutable: 'Imutável (append-only)', capacity_bytes: 'Capacidade (bytes)',
  access_key_id: 'Access key ID', secret_access_key: 'Secret access key', schedule: 'Agenda (cron)', timezone: 'Fuso horário', retention: 'Retenção',
  keep_last: 'Manter últimos', keep_hourly: 'Por hora', keep_daily: 'Diários', keep_weekly: 'Semanais', keep_monthly: 'Mensais', keep_yearly: 'Anuais',
  verify_subset_percent: 'Verificação: % dos dados lidos', limit_upload_kbps: 'Limite de upload (KB/s)', restore_test_days: 'Teste de restauração a cada N dias',
  policy_id: 'Política', destination_id: 'Destino', application_id: 'Aplicação', database_id: 'Banco', paths: 'Caminhos (um por linha)', enabled: 'Ativo',
  hold: 'Reter', snapshot_id: 'Snapshot', mode: 'Modo', includes: 'Incluir só (um caminho por linha)', target_dir: 'Diretório de destino',
  new_name: 'Nome do banco novo', new_file: 'Arquivo novo', confirmation: 'Confirmação', note: 'Observação', secret: 'Segredo',
  threshold: 'Limite', severity: 'Severidade', remind_hours: 'Lembrar a cada (horas)', channel_ids: 'Canais', target: 'Servidor de destino',
  os_name: 'Sistema', os_version: 'Versão do sistema', arch: 'Arquitetura', memory_bytes: 'Memória (bytes)', disk_bytes: 'Disco (bytes)',
  provision_minutes: 'Tempo para provisionar (min)', dns_ttl_minutes: 'TTL do DNS (min)', outcome: 'Resultado', started_at: 'Início', finished_at: 'Fim',
  restore_ids: 'Restaurações usadas', stanza: 'Stanza', full_schedule: 'Agenda do full (cron)', diff_schedule: 'Agenda do diff (cron)', type: 'Tipo',
  code: 'Código', to: 'Destinatários (um por linha)', url: 'URL', signing_key: 'Chave de assinatura (HMAC)', phone_number_id: 'Phone number ID',
  template: 'Template', language: 'Idioma', api_base: 'URL base da API', access_token: 'Token de acesso', agent_url: 'URL do rest-server (vista do agente)',
  data_dir: 'Diretório de dados', endpoint: 'Endpoint', bucket: 'Bucket', prefix: 'Prefixo', region: 'Região'
};

type Ref = { path: string; label: (r: any) => string; value?: (r: any) => string | number; filter?: (r: any, form: Record<string, any>) => boolean };
const by = (k: string) => (r: any) => String(r[k] ?? r.id);
export const REFS: Record<string, Ref> = {
  client_id: { path: '/api/v1/clients?limit=200', label: by('legal_name') },
  client_ids: { path: '/api/v1/clients?limit=200', label: by('legal_name') },
  server_id: { path: '/api/v1/servers?limit=200', label: (r) => `${r.name} — ${r.client_name}` },
  policy_id: { path: '/api/v1/backup-policies', label: (r) => `${r.name} (${r.schedule})` },
  destination_id: { path: '/api/v1/storage', label: (r) => `${r.name} (${r.kind})` },
  database_id: { path: '/api/v1/databases?limit=200', label: (r) => `${r.name} — ${r.engine} @ ${r.server_name}`, filter: (r, f) => !f.server_id || r.server_id === Number(f.server_id) },
  database_ids: { path: '/api/v1/databases?limit=200', label: (r) => `${r.name} — ${r.engine}`, filter: (r, f) => !f.server_id || r.server_id === Number(f.server_id) },
  application_id: { path: '/api/v1/applications?limit=200', label: (r) => `${r.name} @ ${r.server_name}`, filter: (r, f) => !f.server_id || r.server_id === Number(f.server_id) },
  channel_ids: { path: '/api/v1/notification-channels', label: (r) => `${r.name} (${r.kind})` },
  roles: { path: '/api/v1/roles', label: (r) => `${r.name} (${r.code})`, value: (r) => r.code },
  restore_ids: { path: '/api/v1/restores', label: (r) => `${r.server_name} — ${r.job_name} — ${r.status}`, value: (r) => r.id }
};

const refCache = new Map<string, Promise<any[]>>();
function useRef_(path: string | undefined) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let p = refCache.get(path);
    if (!p) { p = api.get(path).then((r) => r.items ?? []); refCache.set(path, p); p.catch(() => refCache.delete(path)); }
    p.then(setRows, (e) => setErr(e.message));
  }, [path]);
  return { rows, err };
}
export const invalidateRefs = () => refCache.clear();

export type Overrides = Record<string, { schema?: JsonSchema; hidden?: boolean; label?: string; help?: ReactNode; widget?: 'password' | 'textarea' | 'json' | 'datetime' }>;

/** Valor inicial do formulário (strings para os campos de texto). */
export function initialValues(schema: JsonSchema, init: Record<string, any> = {}, ov: Overrides = {}, prefix = ''): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, s0] of Object.entries(schema.properties ?? {})) {
    const s = ov[prefix + k]?.schema ?? s0;
    const v = init?.[k];
    const t = typeOf(s);
    if (t === 'object' && s.properties) out[k] = initialValues(s, isObj(v) ? v : {}, ov, `${prefix}${k}.`);
    else if (t === 'array') out[k] = REFS[k] ? (v ?? []).map(String) : (v ?? []).join('\n');
    else if (t === 'boolean') out[k] = v ?? (s.default as boolean | undefined) ?? '';
    else if (t === 'object') out[k] = v === undefined ? '' : JSON.stringify(v, null, 2);
    else out[k] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Converte o estado do formulário no corpo da requisição. `errors` recebe problemas locais. */
export function toBody(schema: JsonSchema, values: Record<string, any>, ov: Overrides = {}, prefix = '', errors: Record<string, string> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const req = new Set(schema.required ?? []);
  for (const [k, s0] of Object.entries(schema.properties ?? {})) {
    const key = prefix + k;
    const o = ov[key];
    if (o?.hidden) continue;
    const s = o?.schema ?? s0;
    const t = typeOf(s);
    const v = values[k];
    if (t === 'object' && s.properties) {
      const inner = toBody(s, isObj(v) ? v : {}, ov, `${key}.`, errors);
      if (Object.keys(inner).length || req.has(k)) out[k] = inner;
      continue;
    }
    if (t === 'array') {
      const list = Array.isArray(v) ? v : String(v ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
      const it = s.items ? typeOf(s.items) : 'string';
      if (list.length || req.has(k)) out[k] = it === 'integer' || it === 'number' ? list.map(Number) : list;
      continue;
    }
    if (t === 'boolean') { if (v !== '' && v !== undefined) out[k] = v === true || v === 'true'; continue; }
    const str = String(v ?? '').trim();
    if (str === '') { if (s.nullable && !req.has(k) && values.__touched?.[k]) out[k] = null; continue; }
    if (t === 'object' || o?.widget === 'json' || (!t && !s.anyOf)) {
      try { out[k] = JSON.parse(str); } catch { errors[key] = 'JSON inválido.'; }
      continue;
    }
    if (t === 'integer' || t === 'number') {
      const n = Number(str.replace(',', '.'));
      if (!Number.isFinite(n) || (t === 'integer' && !Number.isInteger(n))) errors[key] = 'Número inválido.';
      else out[k] = n;
      continue;
    }
    if (s.format === 'date-time' || o?.widget === 'datetime') {
      const d = new Date(str);
      if (Number.isNaN(d.getTime())) errors[key] = 'Data inválida.'; else out[k] = d.toISOString();
      continue;
    }
    out[k] = str;
  }
  return out;
}

type Props = {
  schema: JsonSchema;
  values: Record<string, any>;
  onChange: (v: Record<string, any>) => void;
  errors?: Record<string, string>;
  overrides?: Overrides;
  prefix?: string;
  root?: Record<string, any>;
};

export function SchemaForm({ schema, values, onChange, errors = {}, overrides = {}, prefix = '', root }: Props) {
  const req = new Set(schema.required ?? []);
  const form = root ?? values;
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v, __touched: { ...(values.__touched ?? {}), [k]: true } });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Object.entries(schema.properties ?? {}).map(([k, s0]) => {
        const key = prefix + k;
        const o = overrides[key];
        if (o?.hidden) return null;
        const s = o?.schema ?? s0;
        const t = typeOf(s);
        const label = o?.label ?? LABELS[k] ?? k;
        const err = errors[key] ?? errors[k];
        if (t === 'object' && s.properties) {
          return (
            <fieldset key={key} className="col-span-full rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">{label}{req.has(k) && <span className="text-destructive"> *</span>}</legend>
              {o?.help && <div className="mb-2 text-xs text-muted-foreground">{o.help}</div>}
              <SchemaForm schema={s} values={isObj(values[k]) ? values[k] : {}} onChange={(v) => set(k, v)} errors={errors} overrides={overrides} prefix={`${key}.`} root={form} />
            </fieldset>
          );
        }
        const wide = t === 'array' || t === 'object' || o?.widget === 'textarea' || o?.widget === 'json' || (s.maxLength ?? 0) > 600 || !t;
        return (
          <div key={key} className={cn(wide && 'col-span-full', t === 'boolean' && 'flex items-end')}>
            {t !== 'boolean' && <Label htmlFor={`f-${key}`} required={req.has(k)}>{label}</Label>}
            <Control id={`f-${key}`} name={k} schema={s} widget={o?.widget} value={values[k]} onChange={(v) => set(k, v)} label={label} invalid={!!err} form={form} />
            {o?.help && <div className="mt-1 text-xs text-muted-foreground">{o.help}</div>}
            {err && <div className="mt-1 text-xs text-destructive">{err}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Control({ id, name, schema: s, widget, value, onChange, label, invalid, form }: { id: string; name: string; schema: JsonSchema; widget?: string; value: any; onChange: (v: unknown) => void; label: string; invalid: boolean; form: Record<string, any> }) {
  const t = typeOf(s);
  const enums = enumValues(s);
  const ref = REFS[name];
  const refs = useRef_(ref?.path);
  const a = { id, 'aria-invalid': invalid || undefined } as const;
  if (ref && (t === 'integer' || t === 'string' || t === 'array')) {
    const val = ref.value ?? ((r: any) => r.id);
    const rows = (refs.rows ?? []).filter((r) => !ref.filter || ref.filter(r, form));
    if (refs.err) return <div className="text-xs text-destructive">Não foi possível carregar {label.toLowerCase()}: {refs.err}</div>;
    if (t === 'array') {
      const sel = new Set<string>((value ?? []).map(String));
      return (
        <div {...a} className="max-h-40 overflow-y-auto rounded-md border border-border p-2 text-sm">
          {!refs.rows && <span className="text-muted-foreground">Carregando…</span>}
          {refs.rows && !rows.length && <span className="text-muted-foreground">Nenhum registro disponível.</span>}
          {rows.map((r) => {
            const v = String(val(r));
            return (
              <label key={v} className="flex cursor-pointer items-center gap-2 py-0.5">
                <input type="checkbox" checked={sel.has(v)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(v); else n.delete(v); onChange([...n]); }} />
                {ref.label(r)}
              </label>
            );
          })}
        </div>
      );
    }
    return (
      <Select {...a} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{refs.rows ? (s.nullable ? '— nenhum (global) —' : 'Selecione…') : 'Carregando…'}</option>
        {rows.map((r) => <option key={String(val(r))} value={String(val(r))}>{ref.label(r)}</option>)}
      </Select>
    );
  }
  if (enums) {
    return (
      <Select {...a} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecione…</option>
        {enums.map((v) => <option key={String(v)} value={String(v)}>{statusLabel(v)}</option>)}
      </Select>
    );
  }
  if (t === 'boolean') {
    return (
      <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
        <input id={id} type="checkbox" checked={value === true || value === 'true'} onChange={(e) => onChange(e.target.checked)} />{label}
      </label>
    );
  }
  if (t === 'array' || widget === 'textarea' || (s.maxLength ?? 0) > 600) return <Textarea {...a} rows={t === 'array' ? 3 : 4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  if (t === 'object' || widget === 'json' || !t) return <Textarea {...a} rows={5} placeholder="{ }" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  if (s.format === 'date-time' || widget === 'datetime') return <Input {...a} type="datetime-local" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  const secret = widget === 'password' || /password|secret|token|signing_key/.test(name);
  return (
    <Input {...a} type={secret ? 'password' : t === 'integer' || t === 'number' ? 'number' : s.format === 'email' ? 'email' : 'text'}
      autoComplete={secret ? 'new-password' : 'off'} min={s.minimum} max={s.maximum} maxLength={s.maxLength} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  );
}
