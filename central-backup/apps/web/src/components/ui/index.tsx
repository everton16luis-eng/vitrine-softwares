// Componentes base no estilo shadcn/ui (mesmas variantes e tokens), sem dependências extras.
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, X } from 'lucide-react';
import { cn } from '../../lib/utils.ts';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        outline: 'border border-border bg-card hover:bg-muted',
        ghost: 'hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline px-0'
      },
      size: { default: 'h-9 px-4', sm: 'h-8 px-3 text-xs', icon: 'size-9' }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
);
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...p }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...p}>
    {loading && <Loader2 className="animate-spin" />}{children}
  </button>
));

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-lg border border-border bg-card', className)} {...p} />;
export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3', className)} {...p} />;
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn('text-sm font-semibold', className)} {...p} />;
export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('p-4', className)} {...p} />;

const field = 'w-full rounded-md border border-border bg-card px-3 text-sm placeholder:text-muted-foreground disabled:opacity-60 aria-[invalid=true]:border-destructive';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, 'h-9', className)} {...p} />);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, 'min-h-20 py-2 font-mono text-xs', className)} {...p} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, 'h-9 pr-8', className)} {...p} />);

export function Label({ children, htmlFor, required }: { children: ReactNode; htmlFor?: string; required?: boolean }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted-foreground">{children}{required && <span className="text-destructive"> *</span>}</label>;
}

const tones = {
  default: 'bg-muted text-foreground',
  ok: 'bg-success/15 text-success',
  warn: 'bg-warning/15 text-warning',
  bad: 'bg-destructive/15 text-destructive',
  info: 'bg-primary/15 text-primary'
};
export type Tone = keyof typeof tones;
export const Badge = ({ tone = 'default', children, className }: { tone?: Tone; children: ReactNode; className?: string }) => (
  <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>
);

/** Cor para os estados usados pela API. */
export function toneOf(status: unknown): Tone {
  const s = String(status ?? '');
  if (/^(ok|online|ativo|validado|concluido|concluida|sucesso|enviado|aprovado|resolvido|pronto|true)$/.test(s)) return 'ok';
  if (/(falh|erro|critico|offline|revogado|rejeitad|bloquead|corromp)/.test(s)) return 'bad';
  if (/(atencao|aviso|pendente|aguardando|degradado|reconhecido|cancelad|executando|em_andamento|na_fila|enfileirad|sem_agente|aberto)/.test(s)) return 'warn';
  return 'default';
}
/** Rótulo em português (com acento) para os códigos de estado da API. */
const STATUS_PT: Record<string, string> = {
  aguardando_aprovacao: 'aguardando aprovação', backup_seguranca: 'backup de segurança', concluido: 'concluído', concluida: 'concluída', falha_verificacao: 'falha na verificação',
  nao_testado: 'não testado', na_fila: 'na fila', critico: 'crítico', atencao: 'atenção', sem_agente: 'sem agente', aguardando_agente: 'aguardando agente', em_andamento: 'em andamento',
  restaurando: 'restaurando', validando: 'validando', removido: 'removido', revogado: 'revogado', reconhecido: 'reconhecido', resolvido: 'resolvido', aberto: 'aberto'
};
export const statusLabel = (v: unknown) => STATUS_PT[String(v)] ?? String(v).replace(/_/g, ' ');
export const StatusBadge = ({ value }: { value: unknown }) => (value == null || value === '' ? <span className="text-muted-foreground">—</span> : <Badge tone={toneOf(value)}>{statusLabel(value)}</Badge>);

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto', className)}><table className="w-full text-sm">{children}</table></div>;
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => <th className={cn('border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap', className)}>{children}</th>;
export const Td = ({ children, className, ...p }: HTMLAttributes<HTMLTableCellElement> & { colSpan?: number }) => <td className={cn('border-b border-border px-3 py-2 align-top', className)} {...p}>{children}</td>;

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={cn('m-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50', wide ? 'max-w-4xl' : 'max-w-xl')}>
      {open && <>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar"><X /></Button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
      </>}
    </dialog>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn('-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm whitespace-nowrap', value === t.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cn('rounded-md px-3 py-2 text-sm', tones[tone])}>{children}</div>;
}
export const Spinner = () => <div className="flex justify-center p-6 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="p-6 text-center text-sm text-muted-foreground">{children}</div>;

/** Lista de pares rótulo/valor para telas de detalhe. */
export function Fields({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v ?? '—'}</dd></div>
      ))}
    </dl>
  );
}
export const Code = ({ children }: { children: ReactNode }) => <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{children}</pre>;
