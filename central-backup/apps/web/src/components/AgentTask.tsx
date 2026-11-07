// Envia ao agente uma operação do catálogo fechado (/api/v1/operations). Só aparecem as operações
// públicas que o perfil do usuário permite; os parâmetros vêm do schema de cada operação.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Terminal } from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import type { JsonSchema } from '../lib/openapi.ts';
import { Button, Dialog, Label, Notice, Select, Spinner } from './ui/index.tsx';
import { SchemaForm, initialValues, toBody } from './SchemaForm.tsx';
import { toast } from './toast.tsx';

type Op = { name: string; description: string; allowed: boolean; internal: boolean; destructive: boolean; timeout_s: number; params_schema: JsonSchema };

export function AgentTaskAction({ agentId, onDone }: { agentId: string; onDone?: () => void }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can('agentes.ver')) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Terminal />Enviar operação</Button>
      {open && <TaskDialog agentId={agentId} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function TaskDialog({ agentId, onClose, onDone }: { agentId: string; onClose: () => void; onDone?: () => void }) {
  const nav = useNavigate();
  const [ops, setOps] = useState<Op[] | null>(null);
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/api/v1/operations').then((r) => setOps(r.items.filter((o: Op) => !o.internal && o.allowed)), (e) => setErr(e.message)); }, []);
  const op = ops?.find((o) => o.name === name);
  const schema = op?.params_schema && op.params_schema.properties ? op.params_schema : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setErrors({});
    if (!op) return;
    const local: Record<string, string> = {};
    const params = schema ? toBody(schema, values, {}, '', local) : {};
    if (Object.keys(local).length) { setErrors(local); return; }
    setBusy(true);
    try {
      const t = await api.post(`/api/v1/agents/${agentId}/tasks`, { operation: op.name, params });
      toast('Tarefa enviada.'); onDone?.(); onClose(); nav(`/tarefas/${t.id ?? t.task?.id}`);
    } catch (x) {
      setErr((x as Error).message);
      if (x instanceof ApiError && x.fields) setErrors(Object.fromEntries(Object.entries(x.fields).map(([k, v]) => [k.replace(/^params\./, ''), v])));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Enviar operação ao agente">
      {!ops && !err ? <Spinner /> : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">Só operações do catálogo: o agente não executa comandos livres.</p>
          <div>
            <Label htmlFor="op" required>Operação</Label>
            <Select id="op" value={name} onChange={(e) => { setName(e.target.value); const o = ops?.find((x) => x.name === e.target.value); setValues(o?.params_schema?.properties ? initialValues(o.params_schema) : {}); }}>
              <option value="">Selecione…</option>
              {ops?.map((o) => <option key={o.name} value={o.name}>{o.name} — {o.description}</option>)}
            </Select>
          </div>
          {op?.destructive && <Notice tone="warn">Operação que altera o servidor.</Notice>}
          {schema && <SchemaForm schema={schema} values={values} onChange={setValues} errors={errors} />}
          {err && <Notice tone="bad">{err}</Notice>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy} disabled={!op}>Enviar</Button></div>
        </form>
      )}
    </Dialog>
  );
}
