import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
 * Premium Azemax confirmation dialog — dark IDE surface, compact 400-460px,
 * subtle animation, accessible focus trap, Cancel is safe default.
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // Safe default: focus Cancel to prevent accidental destructive Enter
    requestAnimationFrame(() => cancelRef.current?.focus());

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'));
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
    // Prevent background scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [open, onCancel]);

  return ReactDOM.createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
            className="absolute inset-0 bg-black/55"
            onClick={onCancel}
            aria-hidden="true"
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={messageId}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[440px] rounded-[12px] border bg-[var(--az-surface)] shadow-[0_16px_40px_rgba(0,0,0,0.55),0_1px_0_rgba(230,237,248,0.04)_inset] overflow-hidden"
            style={{ borderColor: 'var(--az-border)' }}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-0">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-[8px] border ${danger ? 'bg-[var(--az-error-soft)] border-[var(--az-error-border)] text-[var(--az-error)]' : 'bg-[var(--az-surface-3)] border-[var(--az-border)] text-[var(--az-text-secondary)]'}`}>
                  <AlertTriangle size={15} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h3 id={titleId} className="text-[13px] font-[600] tracking-[-0.01em] leading-snug pr-2" style={{ color: 'var(--az-text)' }}>
                    {title}
                  </h3>
                  <p id={messageId} className="mt-1.5 text-[12.5px] leading-[1.5] break-words" style={{ color: 'var(--az-text-secondary)' }}>
                    {message}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Close"
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[6px] text-white/40 hover:text-white/80 hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] -mr-1"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>

            {/* Actions */}
            <div className="mt-5 px-6 pb-5 flex items-center justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={onCancel}
                className="min-w-[72px] px-3.5 py-2 text-[12.5px] font-[500] rounded-[8px] border bg-[var(--az-surface-3)] text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] transition-colors"
                style={{ borderColor: 'var(--az-border)' }}
              >
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={onConfirm}
                className={`min-w-[72px] px-3.5 py-2 text-[12.5px] font-[600] rounded-[8px] border focus:outline-none focus-visible:ring-1 transition-colors ${
                  danger
                    ? 'bg-[#FF7D8B] border-[#FF7D8B] text-white hover:brightness-105 focus-visible:ring-[rgba(255,125,139,0.4)] shadow-[0_1px_2px_rgba(0,0,0,0.2)]'
                    : 'bg-[var(--az-accent)] border-[var(--az-accent)] text-white hover:bg-[var(--az-accent-hover)] focus-visible:ring-[var(--az-accent-ring)]'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};