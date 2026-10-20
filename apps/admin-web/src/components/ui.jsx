import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, RefreshCw, X } from 'lucide-react';
import { money } from '../lib/format';

const cx = (...c) => c.filter(Boolean).join(' ');

// ───────── Buttons ─────────

const BUTTON = {
  primary: 'bg-brand text-white hover:bg-brand-dark border-brand',
  secondary: 'bg-brand-soft text-brand-dark hover:bg-brand-soft-strong border-brand-soft',
  outline: 'bg-surface text-ink hover:bg-surface-muted border-line',
  ghost: 'bg-transparent text-brand hover:bg-brand-soft border-transparent',
  danger: 'bg-bad text-white hover:bg-red-800 border-bad',
};

/** min-h-11 (44px) keeps touch targets usable on tablets and phones. */
export function Button({ children, variant = 'primary', size = 'md', icon: Icon, loading, disabled, className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4',
        BUTTON[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

// ───────── Form fields ─────────

export function Field({ label, error, hint, children, id: idProp, className }) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
      ) : null}
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputClass = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink placeholder:text-ink-muted aria-[invalid=true]:border-bad focus:border-brand';

export function Input({ label, error, hint, className, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(a11y) => <input {...a11y} {...props} className={inputClass} />}
    </Field>
  );
}

export function Textarea({ label, error, hint, className, rows = 3, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(a11y) => <textarea {...a11y} rows={rows} {...props} className={cx(inputClass, 'py-2')} />}
    </Field>
  );
}

export function Select({ label, error, hint, className, children, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(a11y) => (
        <select {...a11y} {...props} className={inputClass}>
          {children}
        </select>
      )}
    </Field>
  );
}

/** Accessible on/off switch. */
export function Switch({ checked, onChange, label, disabled, description }) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-ok' : 'bg-line',
        )}
      >
        <span className={cx('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
      </button>
      {description ? (
        <label htmlFor={id} className="text-sm text-ink-muted">
          {description}
        </label>
      ) : null}
    </div>
  );
}

// ───────── Display ─────────

const BADGE = {
  brand: 'bg-brand-soft text-brand-dark',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  neutral: 'bg-surface-muted text-ink-muted',
};

/** Status pill: colour always paired with text. */
export function Badge({ tone = 'neutral', children, icon: Icon }) {
  return (
    <span className={cx('inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', BADGE[tone])}>
      {Icon ? <Icon className="size-3" aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Card({ children, className, ...props }) {
  return (
    <section className={cx('rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-sm sm:p-5', className)} {...props}>
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-extrabold">{title}</h1>
        {description ? <p className="mt-1 text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div aria-hidden className={cx('animate-pulse rounded-lg bg-surface-muted', className)} />;
}

export function LoadingBlock({ label = 'Loading' }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, message, action }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon className="size-7" aria-hidden />
      </div>
      <h2 className="text-lg font-bold">{title}</h2>
      {message ? <p className="max-w-md text-ink-muted">{message}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-bad-soft text-bad">
        <AlertCircle className="size-7" aria-hidden />
      </div>
      <h2 className="text-lg font-bold">We couldn’t load this</h2>
      <p className="max-w-md text-ink-muted">{error?.message ?? 'Something went wrong.'}</p>
      {onRetry ? (
        <Button variant="outline" icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

// ───────── Overlays ─────────

/** Modal dialog with focus moved inside, Escape to close, and a labelled title. */
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null);
  const titleId = useId();
  // Callers usually pass an inline onClose; keep the latest in a ref so the effect below runs only
  // when the dialog opens. (Re-running it on every render moved focus back to the first field.)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button:not([data-close])')?.focus();
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current?.();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-cream shadow-xl sm:rounded-2xl', size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="flex-1 text-lg font-bold">
            {title}
          </h2>
          <button data-close type="button" onClick={onClose} aria-label="Close" className="flex size-10 items-center justify-center rounded-full hover:bg-surface-muted">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', destructive, onConfirm, onCancel, loading }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-ink-muted">{message}</p>
    </Modal>
  );
}

const ToastContext = createContext({ show: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="pointer-events-auto flex max-w-md items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm text-white shadow-lg">
            {t.tone === 'success' ? <CheckCircle2 className="size-4 shrink-0" aria-hidden /> : t.tone === 'danger' ? <AlertCircle className="size-4 shrink-0" aria-hidden /> : <Info className="size-4 shrink-0" aria-hidden />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ───────── Tables ─────────

/** Responsive table: scrolls horizontally on narrow screens instead of breaking the page. */
export function Table({ columns, rows, rowKey, onRowClick, empty }) {
  if (!rows.length) return empty ?? null;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-surface-muted text-ink-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-4 py-3 font-semibold', c.align === 'right' && 'text-right')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cx('border-t border-line', onRowClick && 'cursor-pointer hover:bg-cream')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx('px-4 py-3 align-top', c.align === 'right' && 'text-right tabular-nums')}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-muted">
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

/** Integer kobo rendered with the shared formatter (₦2,500 / ₦2,500.50). */
export function Money({ kobo, className }) {
  return <span className={cx('tabular-nums whitespace-nowrap', className)}>{money(kobo)}</span>;
}
