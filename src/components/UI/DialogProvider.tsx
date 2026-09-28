import React, { createContext, useContext, useCallback, useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { setDialogApi, type DialogApi } from './dialogService';

// Types
type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type AlertOptions = {
  title: string;
  message: string;
  actionLabel?: string;
};
type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  validate?: (value: string) => string | null;
};

type DialogState =
  | { type: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { type: 'alert'; opts: AlertOptions; resolve: () => void }
  | { type: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | null;

interface DialogContextType {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextType | null>(null);

export const useDialog = (): DialogContextType => {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
};

// Provider
export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<DialogState>(null);


  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    if (dialog) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      setDialog({ type: 'confirm', opts, resolve });
    });
  }, [dialog]);

  const alert = useCallback((opts: AlertOptions): Promise<void> => {
    if (dialog) return Promise.resolve();
    return new Promise<void>(resolve => {
      setDialog({ type: 'alert', opts, resolve });
    });
  }, [dialog]);

  const prompt = useCallback((opts: PromptOptions): Promise<string | null> => {
    if (dialog) return Promise.resolve(null);
    return new Promise<string | null>(resolve => {
      setPromptValue(opts.defaultValue ?? '');
      setPromptError(null);
      setDialog({ type: 'prompt', opts, resolve });
    });
  }, [dialog]);

  // Register imperative API for non-React callers (settingsStore etc)
  useEffect(() => {
    const api: DialogApi = { confirm, alert, prompt };
    setDialogApi(api);
    return () => setDialogApi(null as unknown as DialogApi);
  }, [confirm, alert, prompt]);

  // Focus & keyboard trap
  useEffect(() => {
    if (!dialog) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // Defer focus to next frame for animation
    const timer = requestAnimationFrame(() => {
      if (dialog.type === 'prompt') inputRef.current?.focus();
      else cancelRef.current?.focus();
      if (dialog.type === 'prompt' && inputRef.current && dialog.opts.defaultValue) {
        const v = dialog.opts.defaultValue;
        // Select basename without extension for convenience
        const dot = v.lastIndexOf('.');
        if (dot > 0 && dot < v.length - 1) inputRef.current.setSelectionRange(0, dot);
        else inputRef.current.select();
      }
    });
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        pendingRef.current = dialog;
        if (dialog.type === 'confirm') (dialog as Extract<DialogState, {type:'confirm'}>).resolve(false);
        else if (dialog.type === 'alert') (dialog as Extract<DialogState, {type:'alert'}>).resolve();
        else (dialog as Extract<DialogState, {type:'prompt'}>).resolve(null);
        setDialog(null);
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          (last as HTMLElement).focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          (first as HTMLElement).focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [dialog]);

  // Keep pending ref for cleanup
  useEffect(() => { pendingRef.current = dialog; }, [dialog]);

  const handlePromptSubmit = useCallback(() => {
    if (!dialog || dialog.type !== 'prompt') return;
    const validate = (dialog as Extract<DialogState, {type:'prompt'}>).opts.validate;
    if (validate) {
      const err = validate(promptValue);
      if (err) { setPromptError(err); return; }
    }
    const trimmed = promptValue;
    (dialog as Extract<DialogState, {type:'prompt'}>).resolve(trimmed);
    setDialog(null);
  }, [dialog, promptValue]);

  const confirmOpts = dialog?.type === 'confirm' ? dialog.opts : null;
  const alertOpts = dialog?.type === 'alert' ? dialog.opts : null;
  const promptOpts = dialog?.type === 'prompt' ? dialog.opts : null;

  const promptValidationError = (() => {
    if (!promptOpts?.validate) return promptError;
    const err = promptOpts.validate(promptValue);
    return err || promptError;
  })();

  const isPromptInvalid = !!promptOpts?.validate?.(promptValue);

  return (
    <DialogContext.Provider value={{ confirm, alert, prompt }}>
      {children}
      {ReactDOM.createPortal(
        <AnimatePresence>
          {dialog && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" role="presentation">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
                className="absolute inset-0 bg-black/55"
                onClick={() => {
                  if (dialog.type === 'confirm') (dialog as Extract<DialogState, {type:'confirm'}>).resolve(false);
                  else if (dialog.type === 'alert') (dialog as Extract<DialogState, {type:'alert'}>).resolve();
                  else (dialog as Extract<DialogState, {type:'prompt'}>).resolve(null);
                  setDialog(null);
                }}
                aria-hidden="true"
              />
              {/* Confirm */}
              {confirmOpts && (
                <motion.div
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="az-confirm-title"
                  aria-describedby="az-confirm-desc"
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-full max-w-[440px] rounded-[12px] border bg-[var(--az-surface)] shadow-[0_16px_40px_rgba(0,0,0,0.55),0_1px_0_rgba(255,255,255,0.04)_inset] overflow-hidden"
                  style={{ borderColor: 'var(--az-border)' }}
                >
                  <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-0">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-[8px] border ${confirmOpts.danger !== false ? 'bg-[var(--az-error-soft)] border-[var(--az-error-border)] text-[var(--az-error)]' : 'bg-[var(--az-surface-3)] border-[var(--az-border)] text-[var(--az-text-secondary)]'}`}>
                        <AlertTriangle size={15} strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <h3 id="az-confirm-title" className="text-[13px] font-[600] tracking-[-0.01em] leading-snug pr-2" style={{ color: 'var(--az-text)' }}>{confirmOpts.title}</h3>
                        <p id="az-confirm-desc" className="mt-1.5 text-[12.5px] leading-[1.5] break-words" style={{ color: 'var(--az-text-secondary)' }}>{confirmOpts.message}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => { (dialog as Extract<DialogState, {type:'confirm'}>).resolve(false); setDialog(null); }} aria-label="Close" className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[6px] text-white/40 hover:text-white/80 hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] -mr-1">
                      <X size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                  <div className="mt-5 px-6 pb-5 flex items-center justify-end gap-2">
                    <button ref={cancelRef} type="button" onClick={() => { (dialog as Extract<DialogState, {type:'confirm'}>).resolve(false); setDialog(null); }} className="min-w-[72px] px-3.5 py-2 text-[12.5px] font-[500] rounded-[8px] border bg-[var(--az-surface-3)] text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] transition-colors" style={{ borderColor: 'var(--az-border)' }}>
                      {confirmOpts.cancelLabel ?? 'Cancel'}
                    </button>
                    <button type="button" onClick={() => { (dialog as Extract<DialogState, {type:'confirm'}>).resolve(true); setDialog(null); }} className={`min-w-[72px] px-3.5 py-2 text-[12.5px] font-[600] rounded-[8px] border focus:outline-none focus-visible:ring-1 transition-colors ${confirmOpts.danger !== false ? 'bg-[#FF647C] border-[#FF647C] text-white hover:brightness-105 focus-visible:ring-red-400/40 shadow-[0_1px_2px_rgba(0,0,0,0.2)]' : 'bg-[var(--az-accent)] border-[var(--az-accent)] text-white hover:bg-[var(--az-accent-hover)] focus-visible:ring-[var(--az-accent-ring)]'}`}>
                      {confirmOpts.confirmLabel ?? 'Confirm'}
                    </button>
                  </div>
                </motion.div>
              )}
              {/* Alert */}
              {alertOpts && (
                <motion.div
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="az-alert-title"
                  aria-describedby="az-alert-desc"
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-full max-w-[440px] rounded-[12px] border bg-[var(--az-surface)] shadow-[0_16px_40px_rgba(0,0,0,0.55)] overflow-hidden"
                  style={{ borderColor: 'var(--az-border)' }}
                >
                  <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-0">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[8px] border bg-[var(--az-surface-3)] border-[var(--az-border)] text-[var(--az-text-secondary)]">
                        <AlertTriangle size={15} strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <h3 id="az-alert-title" className="text-[13px] font-[600] tracking-[-0.01em] leading-snug" style={{ color: 'var(--az-text)' }}>{alertOpts.title}</h3>
                        <p id="az-alert-desc" className="mt-1.5 text-[12.5px] leading-[1.5] break-words" style={{ color: 'var(--az-text-secondary)' }}>{alertOpts.message}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => { (dialog as Extract<DialogState, {type:'alert'}>).resolve(); setDialog(null); }} aria-label="Close" className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[6px] text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors -mr-1">
                      <X size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                  <div className="mt-5 px-6 pb-5 flex items-center justify-end">
                    <button ref={cancelRef} type="button" onClick={() => { (dialog as Extract<DialogState, {type:'alert'}>).resolve(); setDialog(null); }} className="min-w-[72px] px-3.5 py-2 text-[12.5px] font-[600] rounded-[8px] border bg-[var(--az-text)] border-[var(--az-text)] text-[var(--az-bg)] hover:bg-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] transition-colors">
                      {alertOpts.actionLabel ?? 'OK'}
                    </button>
                  </div>
                </motion.div>
              )}
              {/* Prompt */}
              {promptOpts && (
                <motion.div
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="az-prompt-title"
                  aria-describedby={promptOpts.message ? 'az-prompt-desc' : undefined}
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-full max-w-[440px] rounded-[12px] border bg-[var(--az-surface)] shadow-[0_16px_40px_rgba(0,0,0,0.55)] overflow-hidden"
                  style={{ borderColor: 'var(--az-border)' }}
                >
                  <div className="px-6 pt-5">
                    <div className="flex items-start justify-between gap-4">
                      <h3 id="az-prompt-title" className="text-[13px] font-[600] tracking-[-0.01em] leading-snug flex-1" style={{ color: 'var(--az-text)' }}>{promptOpts.title}</h3>
                      <button type="button" onClick={() => { (dialog as Extract<DialogState, {type:'prompt'}>).resolve(null); setDialog(null); }} aria-label="Close" className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[6px] text-white/40 hover:text-white/80 hover:bg-white/[0.06] -mr-1 -mt-1">
                        <X size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                    {promptOpts.message && <p id="az-prompt-desc" className="mt-1.5 text-[12.5px] leading-[1.5]" style={{ color: 'var(--az-text-secondary)' }}>{promptOpts.message}</p>}
                    <div className="mt-4">
                      <input
                        ref={inputRef}
                        value={promptValue}
                        onChange={e => { setPromptValue(e.target.value); if (promptError) setPromptError(null); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !isPromptInvalid) { e.preventDefault(); handlePromptSubmit(); }
                        }}
                        placeholder={promptOpts.placeholder}
                        className="w-full h-9 px-3 rounded-[8px] border bg-[var(--az-surface-2)] text-[13px] placeholder:text-white/30 focus:outline-none focus:border-[var(--az-accent-border)] focus:shadow-[var(--az-focus-ring)] transition-colors"
                        style={{ borderColor: promptValidationError ? 'var(--az-error-border)' : 'var(--az-border)', color: 'var(--az-text)' }}
                      />
                      {promptValidationError && <p className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--az-error)' }}>{promptValidationError}</p>}
                    </div>
                  </div>
                  <div className="mt-5 px-6 pb-5 flex items-center justify-end gap-2">
                    <button ref={cancelRef} type="button" onClick={() => { (dialog as Extract<DialogState, {type:'prompt'}>).resolve(null); setDialog(null); }} className="min-w-[72px] px-3.5 py-2 text-[12.5px] font-[500] rounded-[8px] border bg-[var(--az-surface-3)] text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] transition-colors" style={{ borderColor: 'var(--az-border)' }}>
                      {promptOpts.cancelLabel ?? 'Cancel'}
                    </button>
                    <button type="button" onClick={handlePromptSubmit} disabled={!!isPromptInvalid} className="min-w-[72px] px-3.5 py-2 text-[12.5px] font-[600] rounded-[8px] border bg-[var(--az-accent)] border-[var(--az-accent)] text-white hover:bg-[var(--az-accent-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] disabled:opacity-45 disabled:cursor-not-allowed transition-colors">
                      {promptOpts.confirmLabel ?? 'Continue'}
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </DialogContext.Provider>
  );
};
