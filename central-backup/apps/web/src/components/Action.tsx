// Ação da API num botão: abre um formulário (gerado do schema do corpo) ou uma confirmação, chama a
// rota e mostra o erro do servidor no campo certo. O botão só aparece se o usuário tem a permissão
// exigida pela rota — nenhum botão leva a algo que a API recusaria por perfil.
import { useEffect, useState, type ReactNode } from 'react';
import { request, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { bodySchema, type JsonSchema } from '../lib/openapi.ts';
import { Button, Dialog, Input, Label, Notice, Spinner, type ButtonProps } from './ui/index.tsx';
import { SchemaForm, initialValues, invalidateRefs, toBody, type Overrides } from './SchemaForm.tsx';
import { toast } from './toast.tsx';

export type ActionProps = {
  label: ReactNode;
  title?: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  /** Caminho no OpenAPI (com {id}); padrão: troca os números por {id}. */
  specPath?: string;
  initial?: Record<string, any>;
  overrides?: Overrides | ((values: Record<string, any>) => Overrides);
  /** Ajuste final do corpo (ex.: montar `config` a partir de campos). */
  transform?: (body: Record<string, any>, values: Record<string, any>) => Record<string, any>;
  /** Texto que o usuário precisa digitar para liberar ações destrutivas. */
  typeToConfirm?: string;
  description?: ReactNode;
  confirm?: ReactNode;
  submitLabel?: string;
  successMessage?: string | ((r: any) => string);
  onDone?: (result: any) => void;
  /** Mostra o resultado na própria janela em vez de fechá-la (códigos de instalação, QR etc.). */
  renderResult?: (result: any) => ReactNode;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  icon?: ReactNode;
  wide?: boolean;
  disabled?: boolean;
  /** Corpo fixo para ações sem formulário. */
  body?: Record<string, any>;
};

/** Igualdade estrutural independente da ordem das chaves (jsonb devolve outra ordem). */
const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as any)[k])])) : typeof v === 'number' ? String(v) : v); // bigint chega como texto
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));

const toSpec = (p: string) => p.replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/[0-9a-f-]{20,}(?=\/|$)/gi, '/{id}');

export function Action(p: ActionProps) {
  const { canRoute } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canRoute(p.method, p.path)) return null;
  return (
    <>
      <Button variant={p.variant ?? 'outline'} size={p.size ?? 'sm'} disabled={p.disabled} onClick={() => setOpen(true)}>{p.icon}{p.label}</Button>
      {open && <ActionDialog {...p} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ActionDialog(p: ActionProps & { onClose: () => void }) {
  const [schema, setSchema] = useState<JsonSchema | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(undefined);

  useEffect(() => {
    if (p.body) { setSchema(null); return; }
    bodySchema(p.method, p.specPath ?? toSpec(p.path)).then((s) => {
      setSchema(s);
      const ov0 = typeof p.overrides === 'function' ? p.overrides(p.initial ?? {}) : p.overrides ?? {};
      if (s) setValues(initialValues(s, p.initial, ov0));
    }, (e) => setLoadErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ov = typeof p.overrides === 'function' ? p.overrides(values) : p.overrides ?? {};
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrors({}); setFormErr(null);
    const local: Record<string, string> = {};
    let body: Record<string, any> | undefined = p.body ?? (schema ? toBody(schema, values, ov, '', local) : undefined);
    if (Object.keys(local).length) { setErrors(local); return; }
    if (body && p.transform) body = p.transform(body, values);
    // edição: manda só o que mudou (a API recusa, por exemplo, mexer no endereço de um destino em uso)
    if (body && p.method === 'PATCH' && p.initial) {
      for (const k of Object.keys(body)) if (same(body[k], p.initial[k])) delete body[k];
      if (!Object.keys(body).length) { toast('Nada foi alterado.', 'ok'); p.onClose(); return; }
    }
    setBusy(true);
    try {
      const r = await request(p.method, p.path, p.method === 'DELETE' ? undefined : body ?? {});
      invalidateRefs();
      const msg = typeof p.successMessage === 'function' ? p.successMessage(r) : p.successMessage;
      if (msg !== '') toast(msg ?? 'Feito.', 'ok');
      p.onDone?.(r);
      if (p.renderResult) setResult(r); else p.onClose();
    } catch (err) {
      if (err instanceof ApiError) { setFormErr(err.message); if (err.fields) setErrors(err.fields); }
      else setFormErr((err as Error).message);
    } finally { setBusy(false); }
  };

  const blocked = !!p.typeToConfirm && typed.trim() !== p.typeToConfirm;
  return (
    <Dialog open onClose={p.onClose} title={p.title ?? p.label} wide={p.wide}>
      {result !== undefined && p.renderResult ? (
        <div className="space-y-4">{p.renderResult(result)}<div className="flex justify-end"><Button onClick={p.onClose}>Fechar</Button></div></div>
      ) : loadErr ? <Notice tone="bad">{loadErr}</Notice> : schema === undefined ? <Spinner /> : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {p.description && <div className="text-sm text-muted-foreground">{p.description}</div>}
          {schema && <SchemaForm schema={schema} values={values} onChange={setValues} errors={errors} overrides={ov} />}
          {!schema && p.confirm && <div className="text-sm">{p.confirm}</div>}
          {p.typeToConfirm && (
            <div>
              <Label htmlFor="type-confirm">Digite <code className="rounded bg-muted px-1 font-mono">{p.typeToConfirm}</code> para confirmar</Label>
              <Input id="type-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          )}
          {formErr && <Notice tone="bad">{formErr}{errors._ && ` — ${errors._}`}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={p.onClose}>Cancelar</Button>
            <Button type="submit" loading={busy} disabled={blocked} variant={p.variant === 'destructive' ? 'destructive' : 'default'}>{p.submitLabel ?? 'Confirmar'}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
