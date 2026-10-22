/**
 * Replaces native alert/confirm/prompt (decision D5) and the legacy sub-admin useDialog().
 *   const dialog = useDialog();
 *   await dialog.alert('Saved');                                   -> void
 *   if (await dialog.confirm('Delete?', { variant: 'danger', okLabel: 'Delete' })) ...
 *   const v = await dialog.prompt('Reason?', { multiline: true, required: true }); // null on cancel
 *   toast.success('Done'); toast.error('Failed');
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from 'lucide-react';
import { Modal } from './Modal';
import { cn } from './cn';

type DialogKind = 'alert' | 'confirm' | 'prompt';
interface DialogOpts {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger' | 'success' | 'warning';
  multiline?: boolean;
  required?: boolean;
  type?: 'text' | 'number';
  defaultValue?: string;
  placeholder?: string;
}
interface DialogState extends DialogOpts {
  kind: DialogKind;
  message: ReactNode;
  resolve: (v: any) => void;
}
interface DialogApi {
  alert: (message: ReactNode, opts?: DialogOpts) => Promise<void>;
  confirm: (message: ReactNode, opts?: DialogOpts) => Promise<boolean>;
  prompt: (message: ReactNode, opts?: DialogOpts) => Promise<string | null>;
}

const Ctx = createContext<DialogApi | null>(null);
let globalApi: DialogApi | null = null;
/** Imperative access for non-React modules (map code). */
export const dialogs = {
  alert: (m: ReactNode, o?: DialogOpts) => (globalApi ? globalApi.alert(m, o) : Promise.resolve(window.alert(String(m)))),
  confirm: (m: ReactNode, o?: DialogOpts) => (globalApi ? globalApi.confirm(m, o) : Promise.resolve(window.confirm(String(m)))),
  prompt: (m: ReactNode, o?: DialogOpts) => (globalApi ? globalApi.prompt(m, o) : Promise.resolve(window.prompt(String(m)))),
};

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const [value, setValue] = useState('');
  const queue = useRef<DialogState[]>([]);

  const open = useCallback((d: DialogState) => {
    setState((cur) => {
      if (cur) {
        queue.current.push(d);
        return cur;
      }
      setValue(d.defaultValue ?? '');
      return d;
    });
  }, []);

  const api: DialogApi = {
    alert: (message, opts) => new Promise((resolve) => open({ kind: 'alert', message, resolve, ...opts })),
    confirm: (message, opts) => new Promise((resolve) => open({ kind: 'confirm', message, resolve, ...opts })),
    prompt: (message, opts) => new Promise((resolve) => open({ kind: 'prompt', message, resolve, ...opts })),
  };
  globalApi = api;

  const close = (result: any) => {
    state?.resolve(result);
    const next = queue.current.shift() || null;
    if (next) setValue(next.defaultValue ?? '');
    setState(next);
  };
  const cancelResult = state?.kind === 'confirm' ? false : state?.kind === 'prompt' ? null : undefined;
  const okDisabled = state?.kind === 'prompt' && state.required && !value.trim();
  const submit = () => {
    if (okDisabled) return;
    close(state?.kind === 'confirm' ? true : state?.kind === 'prompt' ? value : undefined);
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <Modal
        show={!!state}
        onHide={() => close(cancelResult)}
        size="compact"
        zIndex={11000}
        title={state?.title || (state?.kind === 'confirm' ? 'Please confirm' : state?.kind === 'prompt' ? 'Input required' : 'Notice')}
        footer={
          <>
            {state?.kind !== 'alert' && (
              <button className="btn btn-sm btn-secondary" onClick={() => close(cancelResult)}>
                {state?.cancelLabel || 'Cancel'}
              </button>
            )}
            <button className={cn('btn btn-sm', `btn-${state?.variant || 'primary'}`)} disabled={okDisabled} onClick={submit}>
              {state?.okLabel || 'OK'}
            </button>
          </>
        }
      >
        <div className="whitespace-pre-line text-[0.9rem] text-ink">{state?.message}</div>
        {state?.kind === 'prompt' &&
          (state.multiline ? (
            <textarea autoFocus className="textarea mt-2" rows={3} value={value} placeholder={state.placeholder} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input
              autoFocus
              className="input mt-2"
              type={state.type || 'text'}
              value={value}
              placeholder={state.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          ))}
      </Modal>
    </Ctx.Provider>
  );
}

export const useDialog = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDialog outside DialogProvider');
  return v;
};

/* ---------------- Toasts (legacy ToastNotification.css look) ---------------- */
type ToastKind = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; kind: ToastKind; message: ReactNode }
let push: ((t: Omit<ToastItem, 'id'>) => void) | null = null;
const show = (kind: ToastKind) => (message: ReactNode) => push?.({ kind, message });
export const toast = { success: show('success'), error: show('error'), warning: show('warning'), info: show('info') };

const TOAST_STYLE: Record<ToastKind, string> = {
  success: 'bg-[linear-gradient(135deg,rgba(16,185,129,0.95),rgba(5,150,105,0.95))] border-l-[#059669]',
  error: 'bg-[linear-gradient(135deg,rgba(239,68,68,0.95),rgba(220,38,38,0.95))] border-l-[#dc2626]',
  warning: 'bg-[linear-gradient(135deg,rgba(245,158,11,0.95),rgba(217,119,6,0.95))] border-l-[#d97706]',
  info: 'bg-[linear-gradient(135deg,rgba(59,130,246,0.95),rgba(37,99,235,0.95))] border-l-[#2563eb]',
};
const ICON = { success: CheckCircle2, error: XCircle, warning: TriangleAlert, info: Info };

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let n = 0;
    push = (t) => {
      const id = ++n;
      setItems((p) => [...p, { ...t, id }]);
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), t.kind === 'error' ? 6000 : 4000);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div className="pointer-events-none fixed right-3 left-3 top-[60px] z-[12000] flex flex-col items-end gap-2 sm:left-auto sm:right-6 sm:top-[80px]">
      {items.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className={cn('pointer-events-auto flex w-full items-center gap-3 rounded-xl border-l-4 px-5 py-4 text-white shadow-lg backdrop-blur-md animate-slide-in-right sm:min-w-[300px] sm:max-w-[500px]', TOAST_STYLE[t.kind])}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
              <Icon size={20} />
            </span>
            <div className="flex-1 text-[0.9rem] font-medium leading-[1.4]">{t.message}</div>
            <button className="opacity-80 hover:scale-110 hover:opacity-100" onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
