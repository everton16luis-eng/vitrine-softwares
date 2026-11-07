import { useEffect, useState } from 'react';
import { cn } from '../lib/utils.ts';

type T = { id: number; text: string; tone: 'ok' | 'bad' };
let seq = 0;
const listeners = new Set<(t: T) => void>();
export const toast = (text: string, tone: 'ok' | 'bad' = 'ok') => listeners.forEach((fn) => fn({ id: ++seq, text, tone }));

export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    const fn = (t: T) => { setItems((x) => [...x, t]); setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), t.tone === 'bad' ? 8000 : 4000); };
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cn('pointer-events-auto max-w-sm rounded-md border px-4 py-2 text-sm shadow-lg', t.tone === 'ok' ? 'border-success/40 bg-card' : 'border-destructive/40 bg-card text-destructive')}>{t.text}</div>
      ))}
    </div>
  );
}
