// Retenção calculada pela central (não pelo `restic forget --keep-*`), porque precisa de regras que o
// restic não conhece:
//   - só snapshots VALIDADOS ocupam as vagas da política;
//   - retenção legal (legal_hold) nunca é removida;
//   - o snapshot validado mais recente nunca é removido;
//   - snapshots ainda não verificados nunca são removidos;
//   - snapshot que falhou na verificação só sai quando existe um validado mais novo.
// Snapshots restic são independentes entre si (a deduplicação é resolvida pelo prune), então não há
// cadeia de dependência como em backups incrementais tradicionais.
export interface RetentionPolicy {
  keep_last: number;
  keep_hourly?: number;
  keep_daily?: number;
  keep_weekly?: number;
  keep_monthly?: number;
  keep_yearly?: number;
}

export interface SnapshotInfo { id: number; taken_at: Date; status: string; legal_hold: boolean }
export interface RetentionPlan { keep: Map<number, string[]>; forget: number[] }

function bucketKey(d: Date, kind: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly', tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  if (kind === 'hourly') return `${p.year}-${p.month}-${p.day}T${p.hour}`;
  if (kind === 'daily') return `${p.year}-${p.month}-${p.day}`;
  if (kind === 'monthly') return `${p.year}-${p.month}`;
  if (kind === 'yearly') return `${p.year}`;
  // semana ISO (segunda a domingo) do dia local
  const local = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const dow = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - dow + 3);
  const firstThursday = new Date(Date.UTC(local.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((local.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${local.getUTCFullYear()}-W${week}`;
}

export function planRetention(snapshots: SnapshotInfo[], policy: RetentionPolicy, tz = 'UTC'): RetentionPlan {
  if (!(policy.keep_last >= 1)) throw new Error('A política precisa manter ao menos o último backup (keep_last ≥ 1).');
  const keep = new Map<number, string[]>();
  const add = (id: number, why: string) => keep.set(id, [...(keep.get(id) ?? []), why]);
  const sorted = [...snapshots].sort((a, b) => b.taken_at.getTime() - a.taken_at.getTime());
  const valid = sorted.filter((s) => s.status === 'validado');

  valid.slice(0, policy.keep_last).forEach((s) => add(s.id, 'ultimos'));
  for (const kind of ['hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const) {
    const n = policy[`keep_${kind}`] ?? 0;
    let last: string | null = null;
    let count = 0;
    for (const s of valid) {
      if (count >= n) break;
      const key = bucketKey(s.taken_at, kind, tz);
      if (key !== last) { add(s.id, kind); count++; last = key; }
    }
  }
  if (valid[0]) add(valid[0].id, 'mais_recente_validado');
  const newestValid = valid[0]?.taken_at.getTime() ?? -Infinity;
  for (const s of sorted) {
    if (s.legal_hold) add(s.id, 'retencao_legal');
    else if (s.status !== 'validado' && s.status !== 'falha_verificacao') add(s.id, 'nao_verificado');
    else if (s.status === 'falha_verificacao' && s.taken_at.getTime() > newestValid) add(s.id, 'falha_sem_validado_mais_novo');
  }
  const forget = sorted.filter((s) => !keep.has(s.id) && s.status !== 'removido').map((s) => s.id);
  return { keep, forget };
}
