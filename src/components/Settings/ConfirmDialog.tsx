import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Lightweight accessible confirmation dialog used for destructive actions.
 * Supports Cancel/Confirm, Escape to close, focus management and a simple
 * Tab trap. Renders as a fixed overlay so it works from any panel.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}) => {
  const titleId = React.useId();
  const messageId = React.useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
      // Simple Tab trap between the two buttons while the dialog is open
      if (e.key === 'Tab' && confirmRef.current) {
        const buttons = Array.from(confirmRef.current.parentElement?.querySelectorAll<HTMLButtonElement>('button') ?? []);
        if (buttons.length === 0) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="relative w-full max-w-[340px] rounded-xl border border-white/10 bg-[#161b22] shadow-2xl shadow-black/50 p-4"
      >
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg ${danger ? 'bg-red-500/15 text-red-400' : 'bg-[var(--az-surface-3)] text-[var(--az-text)] border border-[var(--az-border)]'}`}>
            <AlertTriangle size={16} />
          </div>
          <div className="min-w-0">
            <h3 id={titleId} className="text-[13px] font-semibold text-white/90 leading-snug">
              {title}
            </h3>
            <p id={messageId} className="mt-1 text-[12px] text-white/50 leading-relaxed">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-white/[0.06] border border-white/10 text-white/70 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-[12px] font-semibold rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 transition-colors ${
              danger
                ? 'bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25 focus-visible:ring-red-400/50'
                : 'bg-blue-500/15 border-blue-500/30 text-[var(--az-text)] hover:bg-blue-500/25 focus-visible:ring-blue-400/50'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};