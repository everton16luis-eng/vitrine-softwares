import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { RefreshCw, Search } from 'lucide-react';
import { api, qs, ApiError } from '../lib/api.ts';
import { Button, Card, Empty, Input, Notice, Select, Spinner, StatusBadge, Table, Td, Th } from './ui/index.tsx';
import { fmtBytes, fmtDate } from '../lib/utils.ts';

export type Column<R = any> = { key: string; label: string; render?: (r: R) => ReactNode; className?: string };
export type Filter = { key: string; label: string; options?: { value: string; label: string }[] };

/** Renderização padrão por nome de campo (datas, bytes, estados, booleanos). */
export function cell(key: string, v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>;
  if (/(_at|_for|^at)$/.test(key)) return <span className="tabular whitespace-nowrap">{fmtDate(v)}</span>;
  if (/bytes/.test(key)) return <span className="tabular">{fmtBytes(v)}</span>;
  if (/(status|health|severity|connection_status)$/.test(key)) return <StatusBadge value={v} />;
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (Array.isArray(v)) return v.length ? v.join(', ') : <span className="text-muted-foreground">—</span>;
  if (typeof v === 'object') return <code className="text-xs">{JSON.stringify(v)}</code>;
  return String(v);
}

type Props = {
  path: string;
  columns: Column[];
  rowLink?: (r: any) => string;
  rowActions?: (r: any, reload: () => void) => ReactNode;
  filters?: Filter[];
  search?: boolean;
  params?: Record<string, unknown>;
  title?: ReactNode;
  actions?: (reload: () => void) => ReactNode;
  empty?: ReactNode;
  /** Recarrega sozinho a cada N segundos (execuções em andamento). */
  refreshEvery?: number;
  reloadKey?: unknown;
};

export function DataList({ path, columns, rowLink, rowActions, filters = [], search, params = {}, title, actions, empty, refreshEvery, reloadKey }: Props) {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const [items, setItems] = useState<any[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [more, setMore] = useState(false);
  const url = (c?: string | null) => `${path}${qs({ ...params, ...f, q: search ? applied : undefined, cursor: c ?? undefined })}`;

  useEffect(() => {
    let alive = true;
    api.get(url()).then((r) => { if (alive) { setItems(r.items ?? []); setCursor(r.next_cursor ?? null); setErr(null); } },
      (e: ApiError) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, applied, JSON.stringify(f), JSON.stringify(params), tick, reloadKey]);
  useEffect(() => {
    if (!refreshEvery) return;
    const t = setInterval(() => setTick((x) => x + 1), refreshEvery * 1000);
    return () => clearInterval(t);
  }, [refreshEvery]);
  const reload = () => setTick((x) => x + 1);
  const loadMore = async () => {
    setMore(true);
    try { const r = await api.get(url(cursor)); setItems((x) => [...(x ?? []), ...(r.items ?? [])]); setCursor(r.next_cursor ?? null); }
    catch (e) { setErr((e as Error).message); } finally { setMore(false); }
  };

  return (
    <Card>
      {(title || search || filters.length > 0 || actions) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {title && <h3 className="mr-auto text-sm font-semibold">{title}</h3>}
          {search && (
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); setApplied(q); }}>
              <Input className="h-8 w-48" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
              <Button size="sm" variant="outline" type="submit" aria-label="Buscar"><Search /></Button>
            </form>
          )}
          {filters.map((fl) => (
            <Select key={fl.key} className="h-8 w-auto" aria-label={fl.label} value={f[fl.key] ?? ''} onChange={(e) => setF({ ...f, [fl.key]: e.target.value })}>
              <option value="">{fl.label}: todos</option>
              {fl.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ))}
          <Button size="sm" variant="ghost" onClick={reload} aria-label="Atualizar" title="Atualizar"><RefreshCw /></Button>
          {actions?.(reload)}
        </div>
      )}
      {err && <div className="p-4"><Notice tone="bad">{err}</Notice></div>}
      {!items && !err && <Spinner />}
      {items && items.length === 0 && <Empty>{empty ?? 'Nenhum registro.'}</Empty>}
      {items && items.length > 0 && (
        <Table>
          <thead><tr>{columns.map((c) => <Th key={c.key} className={c.className}>{c.label}</Th>)}{rowActions && <Th />}</tr></thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={r.id ?? r.public_id ?? i} className="hover:bg-muted/50">
                {columns.map((c, j) => (
                  <Td key={c.key} className={c.className}>
                    {j === 0 && rowLink ? <Link className="font-medium text-primary hover:underline" to={rowLink(r)}>{c.render ? c.render(r) : cell(c.key, r[c.key])}</Link>
                      : c.render ? c.render(r) : cell(c.key, r[c.key])}
                  </Td>
                ))}
                {rowActions && <Td className="text-right"><div className="flex justify-end gap-1">{rowActions(r, reload)}</div></Td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {cursor && <div className="flex justify-center border-t border-border p-2"><Button variant="ghost" size="sm" loading={more} onClick={loadMore}>Carregar mais</Button></div>}
    </Card>
  );
}
