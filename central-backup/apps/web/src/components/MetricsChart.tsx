import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { qs, useApi } from '../lib/api.ts';
import { Card, CardContent, CardHeader, CardTitle, Empty, Notice, Select, Spinner } from './ui/index.tsx';
import { fmtBytes } from '../lib/utils.ts';

const RANGES = [{ h: 6, l: '6 horas' }, { h: 24, l: '24 horas' }, { h: 24 * 7, l: '7 dias' }, { h: 24 * 30, l: '30 dias' }, { h: 24 * 90, l: '90 dias' }];
const C = { cpu: '#2563eb', mem: '#16a34a', disk: '#d97706', rx: '#7c3aed', tx: '#db2777' };

export function MetricsChart({ serverId }: { serverId: number }) {
  const [hours, setHours] = useState(24);
  const range = useMemo(() => { const to = new Date(); return { from: new Date(to.getTime() - hours * 3600_000).toISOString(), to: to.toISOString() }; }, [hours]);
  const m = useApi(`/api/v1/servers/${serverId}/metrics${qs(range)}`);
  const pts = (m.data?.points ?? []).map((p: any) => ({ ...p, t: new Date(p.at).getTime() }));
  const tick = (v: number) => new Date(v).toLocaleString('pt-BR', hours > 48 ? { day: '2-digit', month: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  const label = (v: number) => new Date(v).toLocaleString('pt-BR');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Métricas {m.data?.resolution === 'hora' && <span className="font-normal text-muted-foreground">(média por hora)</span>}</CardTitle>
        <Select className="h-8 w-auto" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Período">
          {RANGES.map((r) => <option key={r.h} value={r.h}>{r.l}</option>)}
        </Select>
      </CardHeader>
      <CardContent>
        {m.error && <Notice tone="bad">{m.error.message}</Notice>}
        {m.loading ? <Spinner /> : !pts.length ? <Empty>Sem métricas no período. Elas chegam quando o agente está conectado.</Empty> : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={pts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={tick} stroke="var(--muted-fg)" fontSize={11} />
                  <YAxis domain={[0, 100]} unit="%" stroke="var(--muted-fg)" fontSize={11} width={44} />
                  <Tooltip labelFormatter={label} formatter={(v: number) => `${Number(v).toFixed(1)}%`} contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)' }} />
                  <Legend />
                  <Line dataKey="cpu_pct" name="CPU" stroke={C.cpu} dot={false} isAnimationActive={false} />
                  <Line dataKey="mem_used_pct" name="Memória" stroke={C.mem} dot={false} isAnimationActive={false} />
                  <Line dataKey="disk_max_pct" name="Disco (maior)" stroke={C.disk} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={pts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={tick} stroke="var(--muted-fg)" fontSize={11} />
                  <YAxis tickFormatter={(v) => fmtBytes(v)} stroke="var(--muted-fg)" fontSize={11} width={64} />
                  <Tooltip labelFormatter={label} formatter={(v: number) => `${fmtBytes(v)}/s`} contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)' }} />
                  <Legend />
                  <Line dataKey="net_rx_bps" name="Rede (entrada)" stroke={C.rx} dot={false} isAnimationActive={false} />
                  <Line dataKey="net_tx_bps" name="Rede (saída)" stroke={C.tx} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
