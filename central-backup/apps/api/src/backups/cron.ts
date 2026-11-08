// Agenda cron de 5 campos (minuto hora dia mês dia-da-semana) avaliada no fuso do cliente.
// Aceita "*", "*/n", "a-b", "a-b/n" e listas. Dia do mês e dia da semana juntos: vale qualquer um
// dos dois (semântica do cron clássico). Nomes (jan, mon) não são aceitos: menos ambiguidade.
const FIELDS = [
  { name: 'minuto', min: 0, max: 59 },
  { name: 'hora', min: 0, max: 23 },
  { name: 'dia do mês', min: 1, max: 31 },
  { name: 'mês', min: 1, max: 12 },
  { name: 'dia da semana', min: 0, max: 7 }
] as const;

export interface Cron { sets: Set<number>[]; domStar: boolean; dowStar: boolean; source: string }

/** Intervalo mínimo entre execuções: protege o servidor do cliente de agendas excessivas. */
export const MIN_INTERVAL_MINUTES = 15;

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A agenda precisa de 5 campos: minuto hora dia mês dia-da-semana.');
  const sets = parts.map((part, i) => {
    const f = FIELDS[i]!;
    const set = new Set<number>();
    for (const item of part.split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
      if (!m) throw new Error(`Campo ${f.name} inválido: "${item}".`);
      const step = m[4] ? Number(m[4]) : 1;
      const lo = m[1] === '*' ? f.min : Number(m[2]);
      const hi = m[1] === '*' ? f.max : m[3] !== undefined ? Number(m[3]) : m[4] ? f.max : lo;
      if (step < 1 || lo < f.min || hi > f.max || lo > hi) throw new Error(`Campo ${f.name} fora do intervalo ${f.min}-${f.max}: "${item}".`);
      for (let v = lo; v <= hi; v += step) set.add(i === 4 && v === 7 ? 0 : v);
    }
    return set;
  });
  return { sets, domStar: parts[2] === '*', dowStar: parts[4] === '*', source: parts.join(' ') };
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function localParts(t: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { minute: Number(p.minute), hour: Number(p.hour), day: Number(p.day), month: Number(p.month), dow: WEEKDAY[p.weekday!]! };
}

/**
 * Próximo instante (UTC) estritamente depois de `after` que satisfaz a agenda no fuso `tz`.
 * Pula meses/dias/horas inteiros que não casam; no máximo ~400 dias à frente.
 */
export function nextRun(cron: Cron, tz: string, after: Date): Date {
  const MIN = 60_000;
  let t = Math.floor(after.getTime() / MIN) * MIN + MIN;
  const limit = after.getTime() + 400 * 24 * 3600 * 1000;
  const [mins, hours, doms, months, dows] = cron.sets as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  while (t < limit) {
    const p = localParts(t, tz);
    const dayOk = cron.domStar && cron.dowStar ? true
      : cron.domStar ? dows.has(p.dow)
        : cron.dowStar ? doms.has(p.day)
          : doms.has(p.day) || dows.has(p.dow);
    if (!months.has(p.month) || !dayOk) { t += ((24 - p.hour) * 60 - p.minute) * MIN; continue; }
    if (!hours.has(p.hour)) { t += (60 - p.minute) * MIN; continue; }
    if (!mins.has(p.minute)) { t += MIN; continue; }
    return new Date(t);
  }
  throw new Error('A agenda não tem execução nos próximos 400 dias.');
}

/** Valida a agenda e o intervalo mínimo entre execuções (amostra das próximas 50). */
export function checkSchedule(expr: string, tz: string, now = new Date()) {
  if (!isValidTimeZone(tz)) throw new Error(`Fuso horário desconhecido: ${tz}.`);
  const cron = parseCron(expr);
  let prev = nextRun(cron, tz, now);
  for (let i = 0; i < 50; i++) {
    const next = nextRun(cron, tz, prev);
    if (next.getTime() - prev.getTime() < MIN_INTERVAL_MINUTES * 60_000) throw new Error(`Intervalo mínimo entre backups é de ${MIN_INTERVAL_MINUTES} minutos.`);
    prev = next;
  }
  return cron;
}
